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
//   measured    — sale de un ledger real (el AI Gateway cobra eso).
//   estimated   — cantidad real, precio supuesto (Apollo: créditos × tarifa).
//   unavailable — no lo tenemos (Apify hoy). Viaja null, NO cero.
//
// La diferencia entre `null` y `0` no es cosmética: cero significa "no gastó",
// null significa "no sabemos". Poner cero donde no sabemos es la forma más
// barata de subreportar un costo.
// ═══════════════════════════════════════════════════════════════════════════

export type CostQuality = "measured" | "estimated" | "unavailable"

export type AiCost = { costUsd: number; inputTokens: number; outputTokens: number; calls: number }
export type ApolloCost = { credits: number; costUsd: number; runs: number; contactsFound: number; cacheHits: number }
export type ApifyCost = { runs: number; rowsIngested: number; costUsd: number | null }

export type CostBreakdown = { ai: AiCost; apollo: ApolloCost; apify: ApifyCost }

export type AiRow = { cost_usd: number | string | null; input_tokens: number | null; output_tokens: number | null }
export type ApolloRow = { credits_spent: number | null; contacts_found: number | null; cache_hit: boolean | null }
export type ApifyRow = { metadata: Record<string, unknown> | null }

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
 * `queued` lo escribe el commit de la reserva y son las filas que entraron al
 * pipeline. `costUsd` es null a propósito: Apify no nos está devolviendo el
 * consumo del run (ver docs/plan-mcp-admin.md §4.2). Cuando lo devuelva, este es
 * el único lugar que cambia.
 */
export function sumApify(rows: ApifyRow[]): ApifyCost {
  const rowsIngested = rows.reduce((total, row) => {
    const queued = row.metadata?.queued
    return total + (typeof queued === "number" ? queued : 0)
  }, 0)
  return { runs: rows.length, rowsIngested, costUsd: null }
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
  const missing: string[] = []
  if (breakdown.apify.costUsd === null && breakdown.apify.runs > 0) missing.push("apify")
  return {
    usd: roundUsd(breakdown.ai.costUsd + breakdown.apollo.costUsd + (breakdown.apify.costUsd ?? 0)),
    partial: missing.length > 0,
    missing,
    quality: {
      ai: "measured",
      apollo: breakdown.apollo.runs ? "estimated" : "measured",
      apify: breakdown.apify.costUsd === null ? "unavailable" : "measured",
    },
  }
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
    admin.schema("v3").from("mcp_usage_reservations")
      .select("metadata, user_id")
      .eq("workspace_id", principal.workspaceId)
      .eq("status", "committed")
      .eq("metadata->>kind", "job_scrape")
      .eq("metadata->>batchJobId", batchJobId),
  ])

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
    admin.schema("v3").from("mcp_usage_reservations")
      .select("metadata, user_id")
      .eq("workspace_id", principal.workspaceId)
      .eq("status", "committed")
      .eq("metadata->>kind", "job_scrape")
      .gte("created_at", from).lte("created_at", to),
  ])

  return assemble({
    scope: "period" as const,
    context: { from, to },
    ai: (aiRes.data ?? []) as (AiRow & { user_id: string })[],
    apollo: (apolloRes.data ?? []) as (ApolloRow & { user_id: string })[],
    apify: (apifyRes.data ?? []) as (ApifyRow & { user_id: string })[],
    groupBy: params.groupBy,
    admin,
  })
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
      breakdown.apify.runs > 0
        ? `Hubo ${breakdown.apify.runs} scraping(s) de vacantes con ${breakdown.apify.rowsIngested} fila(s) ingestadas: su costo en dólares NO lo tenemos y NO está en el total. No lo estimes.`
        : "No hubo scraping de vacantes en este alcance.",
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
