import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { APOLLO_USD_PER_CREDIT } from "@/lib/v3/plan-config"
import type { McpPrincipal } from "@/lib/v3/mcp-usage"

// ═══════════════════════════════════════════════════════════════════════════
// Cuánto costó, después de gastarlo.
//
// El perfil admin levanta los topes; lo que lo hace defendible es poder decir
// cuánto costó un informe y quién lo gastó. Esa información YA se registraba
// entera —tres tablas distintas— y nadie la leía junta.
//
// CADA NÚMERO DECLARA DE QUÉ CALIDAD ES. Es la decisión de diseño de este
// módulo: un total que mezcla una cifra medida con una supuesta, sin decirlo, es
// una cifra inventada con apariencia de precisión.
//
//   measured    — sale de un ledger real (el AI Gateway cobra eso; el
//                 `usageTotalUsd` de cada corrida de Apify).
//   estimated   — cantidad real, precio supuesto (Apollo: créditos × tarifa).
//   partial     — algunas corridas reportaron su costo y otras no. La suma es un
//                 PISO, no el total.
//   unavailable — no lo tenemos. Viaja null, NO cero.
//
// La diferencia entre `null` y `0` no es cosmética: cero significa "no gastó",
// null significa "no sabemos". Poner cero donde no sabemos es la forma más
// barata de subreportar un costo.
// ═══════════════════════════════════════════════════════════════════════════

export type CostQuality = "measured" | "estimated" | "partial" | "unavailable"

export type AiCost = { costUsd: number; inputTokens: number; outputTokens: number; calls: number }
export type ApolloCost = { credits: number; costUsd: number; runs: number; contactsFound: number; cacheHits: number }
export type ApifyCost = {
  runs: number
  /** Cuántas de esas corridas trajeron su costo. Si es menor que `runs`, la suma es un piso. */
  runsWithCost: number
  rowsIngested: number
  costUsd: number | null
}

export type CostBreakdown = { ai: AiCost; apollo: ApolloCost; apify: ApifyCost }

export type AiRow = { cost_usd: number | string | null; input_tokens: number | null; output_tokens: number | null }
export type ApolloRow = { credits_spent: number | null; contacts_found: number | null; cache_hit: boolean | null }
/** Una fila de `v3.apify_runs`. `cost_usd` es numeric: viaja como string. */
export type ApifyRow = { cost_usd: number | string | null; rows_ingested: number | null }

/** Suma el gasto de IA. Es la única cifra medida de verdad: la cobra el gateway. */
export function sumAi(rows: AiRow[]): AiCost {
  return rows.reduce<AiCost>(
    (acc, row) => ({
      costUsd: acc.costUsd + Number(row.cost_usd ?? 0),
      inputTokens: acc.inputTokens + (row.input_tokens ?? 0),
      outputTokens: acc.outputTokens + (row.output_tokens ?? 0),
      calls: acc.calls + 1,
    }),
    { costUsd: 0, inputTokens: 0, outputTokens: 0, calls: 0 },
  )
}

/**
 * Suma el gasto de Apollo.
 *
 * `cacheHits` viaja aparte y no es un detalle: es la diferencia entre "buscamos
 * 40 contactos" y "pagamos 40 contactos". Una corrida servida desde caché
 * devuelve datos y no gasta un crédito, así que contarla como gasto infla el
 * costo del informe.
 */
export function sumApollo(rows: ApolloRow[]): ApolloCost {
  const totals = rows.reduce(
    (acc, row) => ({
      credits: acc.credits + (row.credits_spent ?? 0),
      contactsFound: acc.contactsFound + (row.contacts_found ?? 0),
      cacheHits: acc.cacheHits + (row.cache_hit ? 1 : 0),
      runs: acc.runs + 1,
    }),
    { credits: 0, contactsFound: 0, cacheHits: 0, runs: 0 },
  )
  return { ...totals, costUsd: roundUsd(totals.credits * APOLLO_USD_PER_CREDIT) }
}

/**
 * Suma el scraping de vacantes.
 *
 * Las filas salen de `v3.apify_runs`, el ledger: una por corrida, con su costo
 * medido (`usageTotalUsd` de Apify) y las filas que entraron al pipeline. El
 * ledger es la única fuente — cubre también el cron y explore, que no tienen
 * reserva de MCP y antes no registraban su gasto en ningún lado.
 *
 * Las corridas viejas —anteriores a que se empezara a guardar el costo— no tienen
 * el campo, y ese es el caso que decide el diseño de esta función: sumar solo las
 * que sí lo tienen y decir CUÁNTAS fueron. Un informe con tres corridas de las
 * cuales una reporta US$ 0,014 no costó US$ 0,014 en Apify: costó por lo menos
 * eso. `runsWithCost` es lo que deja distinguir un total de un piso, y lo que
 * hace que `totalUsd` marque el total como parcial en vez de darlo por cerrado.
 *
 * Lo que este número NO incluye: el alquiler mensual del actor (US$ 29,99 fijos).
 * Ver la nota de `ApifyRunResult.usageTotalUsd` en apify-client.ts.
 */
export function sumApify(rows: ApifyRow[]): ApifyCost {
  let rowsIngested = 0
  let runsWithCost = 0
  let costUsd = 0

  for (const row of rows) {
    rowsIngested += Math.max(0, Math.round(Number(row.rows_ingested ?? 0)) || 0)

    // `numeric` vuelve como string, así que se convierte antes de decidir. Se
    // exige finito y no negativo: un null explícito (no se pudo leer el costo)
    // cae acá y NO cuenta como corrida medida, que es la distinción del caso.
    const usage = row.cost_usd === null || row.cost_usd === undefined ? Number.NaN : Number(row.cost_usd)
    if (Number.isFinite(usage) && usage >= 0) {
      runsWithCost += 1
      costUsd += usage
    }
  }

  return { runs: rows.length, runsWithCost, rowsIngested, costUsd: runsWithCost > 0 ? roundUsd(costUsd) : null }
}

/**
 * El total, y qué quedó afuera.
 *
 * Suma solo lo que tiene número. Si Apify no expone su consumo, su costo no se
 * inventa en cero: queda fuera del total y el total se rotula como parcial, con
 * el concepto faltante nombrado. Un lector que ve "US$ 4,20" y un lector que ve
 * "US$ 4,20 (sin Apify)" toman decisiones distintas.
 */
export function totalUsd(breakdown: CostBreakdown): {
  usd: number
  partial: boolean
  missing: string[]
  quality: Record<string, CostQuality>
} {
  const { runs, runsWithCost } = breakdown.apify
  // Una sola corrida sin costo alcanza para que el total sea un piso. No importa
  // que las otras diez sí lo tengan: lo que se está afirmando con `partial: false`
  // es "esto es lo que costó", y con una corrida sin medir eso no es cierto.
  const apifyIncomplete = runs > 0 && runsWithCost < runs

  const missing: string[] = []
  if (apifyIncomplete) missing.push(runsWithCost === 0 ? "apify" : `apify (${runs - runsWithCost} de ${runs} corridas)`)

  return {
    usd: roundUsd(breakdown.ai.costUsd + breakdown.apollo.costUsd + (breakdown.apify.costUsd ?? 0)),
    partial: missing.length > 0,
    missing,
    quality: {
      ai: "measured",
      apollo: breakdown.apollo.runs ? "estimated" : "measured",
      apify: runs === 0 || runsWithCost === runs ? "measured" : runsWithCost === 0 ? "unavailable" : "partial",
    },
  }
}

/**
 * Cómo se cuenta el scraping en el informe.
 *
 * Tres frases distintas para tres situaciones distintas, y la del medio es la que
 * justifica que exista esta función: cuando parte de las corridas reportaron su
 * costo, decir el número sin decir que faltan corridas lo convierte en un total
 * que no es. El caso "todo medido" además aclara que el alquiler mensual del
 * actor queda afuera, para que nadie lea la cifra como la factura de Apify.
 */
export function apifyNote(apify: ApifyCost): string {
  if (apify.runs === 0) return "No hubo scraping de vacantes en este alcance."

  const cuantos = `${apify.runs} scraping(s) de vacantes con ${apify.rowsIngested} fila(s) ingestadas`

  if (apify.runsWithCost === 0) {
    return `Hubo ${cuantos}: su costo en dólares NO lo tenemos y NO está en el total. No lo estimes.`
  }
  if (apify.runsWithCost < apify.runs) {
    return `Hubo ${cuantos}. Solo ${apify.runsWithCost} de las ${apify.runs} corridas reportaron su costo: los US$ ${apify.costUsd?.toFixed(4)} de Apify son un PISO, no el total. Decilo así.`
  }
  return `Hubo ${cuantos} por US$ ${apify.costUsd?.toFixed(4)}, medido por Apify corrida por corrida. Es uso de plataforma (cómputo, proxy, storage) y NO incluye el alquiler mensual del actor, que son US$ 29,99 fijos al mes se scrapee o no.`
}

export function roundUsd(value: number): number {
  return Math.round(value * 10000) / 10000
}

/** Primer día del mes en curso, en UTC. El default del modo período. */
export function defaultPeriodStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

type Params = {
  batchJobId?: string
  from?: string
  to?: string
  groupBy?: "user"
}

export async function getCostSummary(principal: McpPrincipal, params: Params) {
  const admin = createAdminClient()

  return params.batchJobId
    ? batchSummary(admin, principal, params.batchJobId, params.groupBy)
    : periodSummary(admin, principal, params)
}

type Admin = ReturnType<typeof createAdminClient>

/**
 * El ledger que falla NO puede leerse como "no hubo scraping".
 *
 * supabase-js no tira: ante un error devuelve `{ data: null, error }`, y el
 * `?? []` de abajo lo convertiría en cero corridas. Sería exactamente el error
 * que este módulo existe para no cometer, y encima en el caso más probable: la
 * migración del ledger todavía sin aplicar mientras el código ya está deployado.
 * Un error explícito es peor experiencia y mejor información.
 */
function assertLedgerAvailable(result: { error: { message: string } | null }): void {
  if (!result.error) return
  throw new Error(
    `APIFY_LEDGER_UNAVAILABLE:No se pudo leer v3.apify_runs (${result.error.message}). ` +
      "Si la migración del ledger todavía no se aplicó, el costo de scraping no está disponible: " +
      "no lo reportes como cero.",
  )
}


/**
 * Costo de UN informe.
 *
 * La cadena de atribución ya existía y no hubo que inventarla: el lote conoce sus
 * research_job_id y sus enrichment_plan_hash, y esas son las claves con las que
 * el gasto quedó registrado. Lo único que faltaba era el scraping, que es una
 * tool suelta: por eso `scrape_company_job_postings` acepta un `batchJobId` que
 * se estampa en la reserva.
 */
async function batchSummary(admin: Admin, principal: McpPrincipal, batchJobId: string, groupBy?: "user") {
  const { data: job } = await admin
    .schema("v3")
    .from("mcp_batch_jobs")
    .select("id, created_at, finished_at, accounts_total, operation")
    .eq("id", batchJobId)
    .eq("workspace_id", principal.workspaceId)
    .maybeSingle()

  if (!job) {
    throw new Error(
      "BATCH_JOB_NOT_FOUND:Ese batchJobId no existe en este workspace. Sacalo de la respuesta de create_batch_job.",
    )
  }

  const { data: items } = await admin
    .schema("v3")
    .from("mcp_batch_job_items")
    .select("research_job_id, enrichment_plan_hash")
    .eq("batch_job_id", batchJobId)

  const researchJobIds = (items ?? []).map((i) => i.research_job_id).filter(Boolean) as string[]
  const planHashes = (items ?? []).map((i) => i.enrichment_plan_hash).filter(Boolean) as string[]

  const [aiRes, apolloRes, apifyRes] = await Promise.all([
    researchJobIds.length
      ? admin.schema("v3").from("ai_usage_log")
          .select("cost_usd, input_tokens, output_tokens, user_id")
          // El filtro por workspace es redundante —los research_job_id salen de un
          // lote que ya se validó contra este workspace— y va igual: es la última
          // barrera si alguna vez un id llega por otro camino.
          .eq("workspace_id", principal.workspaceId)
          .in("research_job_id", researchJobIds)
      : emptyRows(),
    // Las corridas de Apollo del lote se buscan por batch_job_id Y por plan_hash.
    //
    // No es redundancia: `batch_job_id` lo escribe la preparación cuando el gasto
    // se autorizó contra el presupuesto del lote, y es el camino bueno. El cruce
    // por plan_hash cubre las corridas anteriores a eso y las que se prepararon
    // sueltas y después se anotaron en el item. Se deduplica por id de corrida,
    // así que una que aparezca por los dos caminos se cuenta una sola vez.
    admin.schema("v3").from("contact_enrichment_runs")
      .select("id, credits_spent, contacts_found, cache_hit, user_id")
      .eq("workspace_id", principal.workspaceId)
      .or(`batch_job_id.eq.${batchJobId}${planHashes.length ? `,plan_hash.in.(${planHashes.join(",")})` : ""}`),
    admin.schema("v3").from("apify_runs")
      .select("cost_usd, rows_ingested, user_id")
      .eq("workspace_id", principal.workspaceId)
      .eq("batch_job_id", batchJobId),
  ])

  assertLedgerAvailable(apifyRes)

  return assemble({
    scope: "batch" as const,
    context: { batchJobId, operation: job.operation, accounts: job.accounts_total, startedAt: job.created_at, finishedAt: job.finished_at },
    ai: (aiRes.data ?? []) as (AiRow & { user_id: string })[],
    apollo: dedupeById((apolloRes.data ?? []) as Array<ApolloRow & { user_id: string; id?: string }>),
    apify: (apifyRes.data ?? []) as (ApifyRow & { user_id: string })[],
    groupBy,
    admin,
  })
}

/** Una corrida que llega por dos caminos se cuenta una sola vez. */
function dedupeById<T extends { id?: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (!row.id) return true
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}

/** Costo de un período. Por defecto, el mes en curso. */
async function periodSummary(admin: Admin, principal: McpPrincipal, params: Params) {
  const from = params.from ?? defaultPeriodStart(new Date())
  const to = params.to ?? new Date().toISOString()

  const [aiRes, apolloRes, apifyRes] = await Promise.all([
    admin.schema("v3").from("ai_usage_log")
      .select("cost_usd, input_tokens, output_tokens, user_id")
      .eq("workspace_id", principal.workspaceId)
      .gte("created_at", from).lte("created_at", to),
    admin.schema("v3").from("contact_enrichment_runs")
      .select("credits_spent, contacts_found, cache_hit, user_id")
      .eq("workspace_id", principal.workspaceId)
      .gte("created_at", from).lte("created_at", to),
    admin.schema("v3").from("apify_runs")
      .select("cost_usd, rows_ingested, user_id")
      .eq("workspace_id", principal.workspaceId)
      .gte("created_at", from).lte("created_at", to),
  ])

  assertLedgerAvailable(apifyRes)

  const summary = await assemble({
    scope: "period" as const,
    context: { from, to },
    ai: (aiRes.data ?? []) as (AiRow & { user_id: string })[],
    apollo: (apolloRes.data ?? []) as (ApolloRow & { user_id: string })[],
    apify: (apifyRes.data ?? []) as (ApifyRow & { user_id: string })[],
    groupBy: params.groupBy,
    admin,
  })

  // El gasto COMPARTIDO solo se le muestra a una credencial sin topes. Para un
  // cliente sería ruido —no es su costo y no puede accionarlo—; para ASCI es la
  // pregunta entera: el cron es lo que más va a gastar cuando esto escale.
  return principal.unrestricted ? { ...summary, sharedSpend: await sharedSpend(admin, from, to) } : summary
}

/**
 * El gasto que no es de ningún workspace: el cron.
 *
 * Es la mitad invisible del costo. Medido contra producción, el 78% del gasto de
 * IA registrado no tiene `workspace_id`, y `get_cost_summary` filtraba por
 * workspace: el grueso de la factura no aparecía en la única herramienta que
 * existe para mirarla. No era un bug del filtro —ese gasto efectivamente no es de
 * un workspace— sino que faltaba mirarlo por su propia dimensión.
 *
 * Apify se corta por ORIGEN (`source` del ledger) y la IA por FEATURE. Son las dos
 * preguntas distintas: "cuánto me cuesta el cron" y "en qué etapa del research se
 * va la plata".
 */
async function sharedSpend(admin: Admin, from: string, to: string) {
  const [apifyRes, aiRes] = await Promise.all([
    admin.schema("v3").from("apify_runs")
      .select("cost_usd, rows_ingested, source")
      .is("workspace_id", null)
      .gte("created_at", from).lte("created_at", to),
    admin.schema("v3").from("ai_usage_log")
      .select("cost_usd, input_tokens, output_tokens, feature")
      .is("workspace_id", null)
      .gte("created_at", from).lte("created_at", to),
  ])

  assertLedgerAvailable(apifyRes)
  const apifyRows = (apifyRes.data ?? []) as (ApifyRow & { source: string })[]
  const aiRows = (aiRes.data ?? []) as (AiRow & { feature: string })[]

  const apify = sumApify(apifyRows)
  const ai = sumAi(aiRows)

  return {
    apify: {
      ...apify,
      bySource: groupSum(apifyRows, (r) => r.source, sumApify),
    },
    ai: {
      ...ai,
      // Por FEATURE y no por origen: `ai_usage_log` no tiene todavía la columna
      // que diga quién disparó el gasto. Para este bucket casi no importa —lo que
      // no tiene workspace es, hoy, el cron— y `feature` contesta la pregunta que
      // de verdad se hace: en qué etapa del research se va la plata.
      byFeature: groupSum(aiRows, (r) => r.feature, sumAi),
    },
    totalUsd: roundUsd(ai.costUsd + (apify.costUsd ?? 0)),
    note:
      "Este gasto NO es de ningún workspace: lo dispara el cron y una corrida sirve a TODAS las cuentas que siguen esa empresa. No se lo repartas a nadie por usuario — la unidad real es la empresa.",
  }
}

/** Agrupa por una clave y aplica el mismo sumador, ordenando por costo. */
function groupSum<Row, Out extends { costUsd: number | null }>(
  rows: Row[],
  keyOf: (row: Row) => string,
  sum: (rows: Row[]) => Out,
): Array<Out & { key: string }> {
  const buckets = new Map<string, Row[]>()
  for (const row of rows) {
    const key = keyOf(row)
    buckets.set(key, [...(buckets.get(key) ?? []), row])
  }
  return [...buckets.entries()]
    .map(([key, group]) => ({ key, ...sum(group) }))
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0))
}

function emptyRows() {
  return Promise.resolve({ data: [] as never[] })
}

async function assemble(input: {
  scope: "batch" | "period"
  context: Record<string, unknown>
  ai: (AiRow & { user_id: string })[]
  apollo: (ApolloRow & { user_id: string })[]
  apify: (ApifyRow & { user_id: string })[]
  groupBy?: "user"
  admin: Admin
}) {
  const breakdown: CostBreakdown = {
    ai: sumAi(input.ai),
    apollo: sumApollo(input.apollo),
    apify: sumApify(input.apify),
  }
  const total = totalUsd(breakdown)

  const by = input.groupBy === "user" ? await groupByUser(input) : undefined

  return {
    scope: input.scope,
    ...input.context,
    ...breakdown,
    totalUsd: total.usd,
    totalIsPartial: total.partial,
    quality: total.quality,
    ...(by ? { byUser: by } : {}),
    interpretationGuidance: [
      `Total: US$ ${total.usd.toFixed(4)}${total.partial ? ` — PARCIAL, no incluye ${total.missing.join(", ")}` : ""}.`,
      "El costo de IA está medido por el AI Gateway. El de Apollo es una ESTIMACIÓN: los créditos son reales, el precio (US$ 0,01 por crédito) es la tarifa contratada, y hoy la cuenta asume 1 crédito por contacto, que es cierto mientras solo se revelen emails.",
      apifyNote(breakdown.apify),
      breakdown.apollo.cacheHits > 0
        ? `${breakdown.apollo.cacheHits} corrida(s) de Apollo salieron de caché: devolvieron datos sin gastar créditos.`
        : "",
    ].filter(Boolean).join("\n"),
  }
}

async function groupByUser(input: {
  ai: (AiRow & { user_id: string })[]
  apollo: (ApolloRow & { user_id: string })[]
  apify: (ApifyRow & { user_id: string })[]
  admin: Admin
}) {
  const userIds = new Set<string>()
  for (const row of [...input.ai, ...input.apollo, ...input.apify]) if (row.user_id) userIds.add(row.user_id)
  if (!userIds.size) return []

  const { data: profiles } = await input.admin
    .from("profiles")
    .select("id, full_name")
    .in("id", [...userIds])
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string) ?? null]))

  return [...userIds]
    .map((userId) => {
      const breakdown: CostBreakdown = {
        ai: sumAi(input.ai.filter((r) => r.user_id === userId)),
        apollo: sumApollo(input.apollo.filter((r) => r.user_id === userId)),
        apify: sumApify(input.apify.filter((r) => r.user_id === userId)),
      }
      const total = totalUsd(breakdown)
      return { userId, name: nameById.get(userId) ?? null, ...breakdown, totalUsd: total.usd, totalIsPartial: total.partial }
    })
    .sort((a, b) => b.totalUsd - a.totalUsd)
}
