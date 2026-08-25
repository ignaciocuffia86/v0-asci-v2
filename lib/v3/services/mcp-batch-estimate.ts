import "server-only"

import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { getWorkspaceUsage, checkResearchQuota, getContactEnrichmentLimits } from "@/lib/v3/plans"
import { getMonthlyPoolUsage, principalColumns, type McpPrincipal } from "@/lib/v3/mcp-usage"

// ═══════════════════════════════════════════════════════════════════════════
// Preflight de costo POR LOTE.
//
// El circuito prepare_* → planHash → run_*(userConfirmed) es lo mejor diseñado
// del MCP, pero opera a nivel de UNA cuenta. Para un lote de 42 eso son 42
// confirmaciones para una sola decisión de presupuesto, y en la práctica ninguna
// se toma con información: no existía forma de preguntar "¿cuánto me cuesta este
// lote?" sin pedir 42 previews.
//
// Esta tool responde esa pregunta en una llamada y devuelve UN batchPlanHash.
// Es Tier 0: no reserva cupo, no reserva créditos, no consume nada. Estimar no
// tiene por qué costar.
//
// REGLA QUE NO SE NEGOCIA: si no hay telemetría suficiente para estimar el costo,
// devuelve null y lo dice. Un número inventado en una pantalla de autorización de
// presupuesto es peor que no tener número, porque se lee como si fuera medido.
// ═══════════════════════════════════════════════════════════════════════════

export type BatchOperation = "research" | "enrichment" | "research+enrichment"

/** Ventana de telemetría de la que sale el costo por cuenta. */
const COST_WINDOW_DAYS = 90
/** Vigencia de la cotización. Después hay que volver a estimar. */
const PLAN_TTL_MINUTES = 60
/** Mismo techo que screen_account_list: lo que entra en una conversación. */
export const MAX_ACCOUNTS_PER_BATCH = 200

export type ResearchCostSample = {
  research_job_id: string | null
  cost_usd: number | string
}

export type AverageCost = {
  perAccountUsd: number | null
  samples: number
}

/**
 * Costo promedio de investigar UNA cuenta, a partir de la telemetría real.
 *
 * Agrupa por `research_job_id` y promedia entre jobs, no entre filas: un research
 * genera varias llamadas al modelo (scoring, estructura, síntesis, interpretación
 * de vacantes) y promediar filas daría el costo de una llamada suelta, que es
 * varias veces menor. El error sería en la dirección peligrosa —subestimar lo que
 * el usuario está por autorizar—, así que la unidad tiene que ser el job.
 *
 * Las filas sin `research_job_id` se descartan: son costo real pero no se pueden
 * atribuir a una cuenta, y meterlas al promedio lo ensucia sin decir cuánto.
 */
export function averageCostPerResearch(rows: ResearchCostSample[]): AverageCost {
  const byJob = new Map<string, number>()
  for (const row of rows) {
    if (!row.research_job_id) continue
    byJob.set(row.research_job_id, (byJob.get(row.research_job_id) ?? 0) + Number(row.cost_usd || 0))
  }
  if (!byJob.size) return { perAccountUsd: null, samples: 0 }
  const total = [...byJob.values()].reduce((sum, value) => sum + value, 0)
  return { perAccountUsd: total / byJob.size, samples: byJob.size }
}

/** Redondeo a centavos para mostrar. Null se propaga: no se convierte en 0. */
export function roundUsd(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100
}

export type QuotaItemLike = {
  companyId: string | null
  allowed: boolean
  isRefresh: boolean
  reason: string | null
  nextAutoRefreshDate: string | null
}

export type QuotaClassification = {
  /** Consumen una unidad y cuestan tokens. */
  needed: QuotaItemLike[]
  /** Ya investigadas: cooldown, seguimiento automático o refresh no permitido. NO cuestan. */
  free: QuotaItemLike[]
  /** No entran en el cupo del mes. Es un BLOQUEO, no un ahorro. */
  blockedByQuota: QuotaItemLike[]
}

/**
 * Separa las cuentas del lote en las tres categorías que importan para cotizar.
 *
 * El discriminador es `isRefresh`, y la distinción no es sutil: `checkResearchQuota`
 * devuelve `allowed: false` por dos motivos OPUESTOS. Una cuenta ya investigada que
 * está en seguimiento no consume nada y es una buena noticia —el lote sale más
 * barato—. Una cuenta nueva que no entra en el cupo del mes es un bloqueo: el lote
 * NO se puede correr entero.
 *
 * Meterlas en la misma bolsa es el mismo error que ya se corrigió una vez en
 * run_account_research, donde una cuenta en auto-refresh se reportaba como
 * PLAN_QUOTA_EXCEEDED y el modelo le decía al usuario "te quedaste sin cuota"
 * teniendo cupo de sobra. Acá el error sería al revés y peor: presentar un lote
 * que no entra en el plan como si fuera más barato de lo cotizado.
 */
export function classifyResearchQuota(items: QuotaItemLike[]): QuotaClassification {
  return {
    needed: items.filter((item) => item.allowed),
    free: items.filter((item) => !item.allowed && item.isRefresh),
    blockedByQuota: items.filter((item) => !item.allowed && !item.isRefresh),
  }
}

export type BatchEstimateParams = {
  operation: BatchOperation
  companyIds: string[]
  roles?: string[]
  maxContactsPerAccount?: number
}

export async function estimateBatch(principal: McpPrincipal, params: BatchEstimateParams) {
  const companyIds = [...new Set(params.companyIds.map((id) => id.trim()).filter(Boolean))]
  if (!companyIds.length) throw new Error("BATCH_EMPTY:El lote no tiene ninguna cuenta.")
  if (companyIds.length > MAX_ACCOUNTS_PER_BATCH) {
    throw new Error(`BATCH_TOO_MANY:${companyIds.length} cuentas (máx ${MAX_ACCOUNTS_PER_BATCH}). Partí el lote.`)
  }

  const admin = createAdminClient()
  const wantsResearch = params.operation !== "enrichment"
  const wantsEnrichment = params.operation !== "research"

  const [companiesRes, followedRes, usage] = await Promise.all([
    admin.from("companies").select("id,name,country").in("id", companyIds),
    admin.schema("v3").from("followed_accounts").select("company_id").eq("workspace_id", principal.workspaceId).eq("is_active", true).in("company_id", companyIds),
    getWorkspaceUsage(principal.workspaceId),
  ])

  const known = new Map((companiesRes.data ?? []).map((row) => [row.id, row]))
  const notFound = companyIds.filter((id) => !known.has(id))
  const resolved = companyIds.filter((id) => known.has(id))
  const followed = new Set((followedRes.data ?? []).map((row) => row.company_id))

  // ── Lugares del plan ──────────────────────────────────────────────────────
  // Solo cuentan las que NO están seguidas: reestimar un lote ya guardado no
  // vuelve a pedir lugares.
  const slotsNeeded = resolved.filter((id) => !followed.has(id)).length
  const slotsAvailable = Math.max(0, usage.config.followedCap - usage.followedCount)

  // ── Research ──────────────────────────────────────────────────────────────
  const quota = wantsResearch && resolved.length
    ? await checkResearchQuota({ workspaceId: principal.workspaceId, companies: resolved.map((id) => ({ input: id, companyId: id })) })
    : null

  const classified = classifyResearchQuota(quota?.items ?? [])
  const researchNeeded = classified.needed.length
  // `quota.monthlyRemaining` viene DESPUÉS de simular el consumo del lote: la
  // función descuenta una unidad por cada cuenta permitida mientras itera. Para
  // mostrar el punto de partida hay que devolver las unidades sumadas.
  const monthlyRemainingBefore = (quota?.monthlyRemaining ?? 0) + researchNeeded

  // ── Costo real, de la telemetría ──────────────────────────────────────────
  const since = new Date(Date.now() - COST_WINDOW_DAYS * 86400000).toISOString()
  const { data: costRows } = await admin
    .schema("v3")
    .from("ai_usage_log")
    .select("research_job_id,cost_usd")
    .eq("workspace_id", principal.workspaceId)
    .eq("generation_mode", "server_managed")
    .not("research_job_id", "is", null)
    .gte("created_at", since)

  const workspaceCost = averageCostPerResearch(costRows ?? [])
  // Sin historial propio (workspace nuevo, o que solo usó client-assisted) se cae
  // al promedio de la plataforma. Es una estimación peor y el payload lo declara.
  let costSource: "workspace" | "platform" | "none" = workspaceCost.samples ? "workspace" : "none"
  let perAccountUsd = workspaceCost.perAccountUsd
  let samples = workspaceCost.samples

  if (!samples) {
    const { data: globalRows } = await admin
      .schema("v3")
      .from("ai_usage_log")
      .select("research_job_id,cost_usd")
      .eq("generation_mode", "server_managed")
      .not("research_job_id", "is", null)
      .gte("created_at", since)
      .limit(5000)
    const platform = averageCostPerResearch(globalRows ?? [])
    if (platform.samples) {
      costSource = "platform"
      perAccountUsd = platform.perAccountUsd
      samples = platform.samples
    }
  }

  const estimatedResearchUsd = perAccountUsd === null ? null : perAccountUsd * researchNeeded

  // ── Apollo ────────────────────────────────────────────────────────────────
  const enrichmentLimits = wantsEnrichment ? await getContactEnrichmentLimits(principal.workspaceId) : null
  const creditsUsed = wantsEnrichment ? await getMonthlyPoolUsage(principal.workspaceId, "apollo_enrichment") : 0
  const creditsAvailable = enrichmentLimits ? Math.max(0, enrichmentLimits.monthlyUnits - creditsUsed) : 0
  const contactsPerAccount = enrichmentLimits
    ? Math.min(params.maxContactsPerAccount ?? enrichmentLimits.maxContacts, enrichmentLimits.maxContacts)
    : 0
  // PEOR CASO, igual que reserva el preview por cuenta. Apollo puede devolver
  // menos contactos de los pedidos y ahí se cobra menos: subestimar sería mentirle
  // a quien autoriza.
  const estimatedCredits = wantsEnrichment ? resolved.length * contactsPerAccount : 0

  // ── Bloqueos ──────────────────────────────────────────────────────────────
  const blockers: string[] = []
  if (slotsNeeded > slotsAvailable) {
    blockers.push(`Faltan lugares del plan: el lote necesita ${slotsNeeded} y hay ${slotsAvailable} libres de ${usage.config.followedCap}. Liberá cuentas con remove_workspace_account o achicá el lote.`)
  }
  if (classified.blockedByQuota.length) {
    // El motivo lo escribe checkResearchQuota y distingue trial de plan pago: se
    // reenvía tal cual en vez de reescribirlo peor.
    blockers.push(
      `${classified.blockedByQuota.length} cuenta(s) no entran en el cupo de research: ${classified.blockedByQuota[0].reason}`,
    )
  }
  if (wantsEnrichment && enrichmentLimits && !enrichmentLimits.allowed) {
    blockers.push(enrichmentLimits.reason ?? "El plan no permite enrichment de contactos.")
  }
  if (wantsEnrichment && enrichmentLimits?.allowed && estimatedCredits > creditsAvailable) {
    blockers.push(`Faltan créditos de Apollo: el peor caso son ${estimatedCredits} y quedan ${creditsAvailable} este mes. El lote se puede correr igual, pero se va a cortar al agotarlos.`)
  }

  const warnings: string[] = []
  if (notFound.length) warnings.push(`${notFound.length} companyId(s) no existen en el catálogo y quedaron fuera de la cotización.`)
  if (classified.free.length) warnings.push(`${classified.free.length} cuenta(s) NO suman costo: ya están investigadas, en cooldown o en seguimiento automático. El lote sale más barato por eso.`)
  if (costSource === "platform") warnings.push(`El costo sale del promedio de la plataforma (${samples} researches), no de este workspace: todavía no tiene historial propio de research server-managed.`)
  if (costSource === "none") warnings.push("NO hay telemetría suficiente para estimar el costo en dólares. El resto de los números (lugares, unidades, créditos) sí son exactos.")

  // ── Congelar el plan ──────────────────────────────────────────────────────
  const planPayload = {
    operation: params.operation,
    companyIds: resolved.slice().sort(),
    roles: params.roles?.slice().sort() ?? null,
    contactsPerAccount: wantsEnrichment ? contactsPerAccount : null,
  }
  const batchPlanHash = crypto.createHash("sha256").update(JSON.stringify(planPayload)).digest("hex").slice(0, 40)
  const expiresAt = new Date(Date.now() + PLAN_TTL_MINUTES * 60 * 1000)

  const estimate = {
    accounts: { requested: companyIds.length, resolved: resolved.length, notFound },
    slots: { needed: slotsNeeded, available: slotsAvailable, cap: usage.config.followedCap, alreadySaved: resolved.length - slotsNeeded },
    research: wantsResearch
      ? {
          needed: researchNeeded,
          // Las dos categorías van SEPARADAS a propósito: `alreadyCovered` abarata
          // el lote, `blockedByQuota` impide correrlo entero. Colapsarlas haría
          // leer un lote que no entra como si fuera más barato.
          alreadyCovered: classified.free.length,
          alreadyCoveredReasons: classified.free.slice(0, 5).map((item) => ({ companyId: item.companyId, reason: item.reason })),
          blockedByQuota: classified.blockedByQuota.length,
          monthlyRemainingBefore,
          monthlyRemainingAfter: Math.max(0, monthlyRemainingBefore - researchNeeded),
          pool: "monthlyServerResearch",
        }
      : null,
    enrichment: wantsEnrichment
      ? {
          allowed: enrichmentLimits?.allowed ?? false,
          estimatedCredits,
          creditsAvailable,
          monthlyUnits: enrichmentLimits?.monthlyUnits ?? 0,
          contactsPerAccount,
          basis: "Peor caso: contactsPerAccount por cuenta. Apollo puede devolver menos y ahí se cobra menos.",
        }
      : null,
    estimatedCostUsd: {
      research: roundUsd(estimatedResearchUsd),
      perAccount: perAccountUsd === null ? null : Math.round(perAccountUsd * 10000) / 10000,
      source: costSource,
      samples,
      windowDays: COST_WINDOW_DAYS,
      note:
        costSource === "none"
          ? "Sin telemetría suficiente. No se estima un costo en dólares antes que inventar uno."
          : `Promedio real de ${samples} research(es) server-managed de los últimos ${COST_WINDOW_DAYS} días, agrupado por research_job_id. Apollo no está incluido: sus créditos se cuentan aparte.`,
    },
    plan: usage.plan,
  }

  const cols = principalColumns(principal)
  await admin.schema("v3").from("mcp_batch_plans").upsert(
    {
      workspace_id: principal.workspaceId,
      user_id: principal.userId,
      api_key_id: cols.api_key_id,
      oauth_token_id: cols.oauth_token_id,
      batch_plan_hash: batchPlanHash,
      operation: params.operation,
      plan_payload: planPayload,
      estimate,
      status: "estimated",
      expires_at: expiresAt.toISOString(),
    },
    { onConflict: "workspace_id,batch_plan_hash" },
  )

  return {
    ...estimate,
    batchPlanHash,
    expiresAt: expiresAt.toISOString(),
    blockers,
    warnings,
    executable: blockers.length === 0,
    interpretationGuidance: [
      "Esta tool NO gasta nada: mide y congela la cotización. No reserva cupo ni créditos.",
      "MOSTRALE AL USUARIO, antes de ejecutar nada: cuántos lugares del plan ocupa, cuántas unidades de research consume, cuántos créditos de Apollo en el peor caso, y el costo estimado en dólares. Con eso alcanza UNA confirmación para el lote entero.",
      "Si `estimatedCostUsd.research` viene en null, decilo así: no hay telemetría para estimarlo. NO inventes un número ni lo derives de otra cuenta.",
      "`estimatedCostUsd.source` en \"platform\" significa que el promedio no es de este workspace. Aclaralo.",
      "Si `executable` es false, leé `blockers`: el lote no se puede correr entero como está. No lo intentes igual esperando que entre.",
      "El `batchPlanHash` vence en 1 hora y queda ligado a ESTAS cuentas y roles. Si cambian, volvé a estimar: un hash viejo no autoriza un lote distinto.",
    ].join("\n"),
  }
}
