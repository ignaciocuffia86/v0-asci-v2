import { createAdminClient } from "@/lib/supabase/admin"

// ═══════════════════════════════════════════════════════════
// Planes por workspace (tenant) y cuotas de consumo.
//
// Definiciones de operaciones:
// - INVESTIGAR: primera investigación de una empresa. Consume IA y
//   cuenta contra el cupo mensual de researches nuevos.
// - FOLLOW: seguir una cuenta ya investigada. No consume IA; ocupa
//   1 lugar del cap del plan y entra al cron de refresh mensual.
// - REFRESH manual: re-investigar una empresa existente. Consume IA;
//   máx 1 vez cada 30 días por cuenta. Si la cuenta está seguida se
//   bloquea (el cron ya la refresca) y se informa la fecha del próximo
//   digest automático.
// - CRON: refresh automático mensual de las seguidas. No consume cupo;
//   solo en planes pagos (trial excluido).
// ═══════════════════════════════════════════════════════════

// La definición de planes vive en plan-config.ts (módulo puro, importable
// desde client components); acá se re-exporta para no romper a los consumers.
export {
  PLAN_CONFIG,
  PLAN_ORDER,
  type PlanConfig,
  type WorkspacePlan,
} from "./plan-config"
import { PLAN_CONFIG, type PlanConfig, type WorkspacePlan } from "./plan-config"

// ─── Lectura del plan (cache corto en memoria) ───────────────

const planCache = new Map<string, { plan: WorkspacePlan; expiresAt: number }>()
const PLAN_CACHE_TTL_MS = 60_000

export async function getWorkspacePlan(workspaceId: string): Promise<WorkspacePlan> {
  const cached = planCache.get(workspaceId)
  if (cached && cached.expiresAt > Date.now()) return cached.plan

  const admin = createAdminClient()
  const { data } = await admin
    .schema("v3")
    .from("workspaces")
    .select("plan")
    .eq("id", workspaceId)
    .maybeSingle()

  const plan = (data?.plan as WorkspacePlan) ?? "trial"
  planCache.set(workspaceId, { plan, expiresAt: Date.now() + PLAN_CACHE_TTL_MS })
  return plan
}

export function invalidatePlanCache(workspaceId: string) {
  planCache.delete(workspaceId)
}

// ─── Uso actual (para UI y checks) ───────────────────────────

export interface WorkspaceUsage {
  plan: WorkspacePlan
  config: PlanConfig
  followedCount: number
  monthlyResearchCount: number
  lifetimeResearchCount: number
  memberCount: number
  pendingInvitations: number
}

function monthStartIso(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

export async function getWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsage> {
  const admin = createAdminClient()
  const plan = await getWorkspacePlan(workspaceId)
  const config = PLAN_CONFIG[plan]

  const [followedRes, monthlyRes, lifetimeRes, membersRes, invitesRes] = await Promise.all([
    admin
      .schema("v3")
      .from("followed_accounts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("is_active", true),
    admin
      .schema("v3")
      .from("research_jobs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("source", "user")
      .gte("created_at", monthStartIso()),
    admin
      .schema("v3")
      .from("research_jobs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("source", "user"),
    admin
      .schema("v3")
      .from("workspace_members")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    admin
      .schema("v3")
      .from("workspace_invitations")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("accepted_at", null)
      .gt("expires_at", new Date().toISOString()),
  ])

  return {
    plan,
    config,
    followedCount: followedRes.count ?? 0,
    monthlyResearchCount: monthlyRes.count ?? 0,
    lifetimeResearchCount: lifetimeRes.count ?? 0,
    memberCount: membersRes.count ?? 0,
    pendingInvitations: invitesRes.count ?? 0,
  }
}

// ─── Check de cuota de research ──────────────────────────────

export interface ResearchQuotaItem {
  input: string
  companyId: string | null
  allowed: boolean
  isRefresh: boolean
  reason: string | null
  /** Fecha estimada del próximo refresh automático (si está seguida). */
  nextAutoRefreshDate: string | null
  /**
   * Solo en modo `unrestricted`: por qué ESTA cuenta habría quedado bloqueada con
   * los topes puestos. `allowed` viene en true igual.
   *
   * Existe porque el perfil admin apaga el bloqueo, no la medición: sin este campo
   * la única forma de saber cuánto cupo "habría" consumido un informe sería volver
   * a calcularlo, y el cálculo ya se hizo acá.
   */
  wouldBlockReason?: string | null
}

export interface ResearchQuotaResult {
  plan: WorkspacePlan
  items: ResearchQuotaItem[]
  monthlyRemaining: number
  /** True si los topes se midieron pero no se aplicaron. Ver `unrestricted`. */
  unrestricted?: boolean
}

/**
 * Valida el cupo de research para un lote de empresas.
 * - Empresa nueva para el workspace → consume cupo mensual (o de por vida en trial).
 * - Empresa ya investigada → refresh manual: requiere plan pago, cooldown de 30 días
 *   y NO estar seguida (las seguidas se refrescan solas vía cron).
 */
/**
 * Libera los bloqueos de cupo conservando el motivo, para el perfil admin.
 *
 * Es una función aparte y pura por una razón concreta: es la única parte de
 * `checkResearchQuota` que se puede probar sin base, y es justo la que decide si
 * un tope se aplica. Si estuviera embebida en las 100 líneas de consultas, el
 * comportamiento que distingue al perfil admin quedaría sin cobertura.
 *
 * `reason` se vacía porque los callers lo muestran cuando `allowed` es false, y un
 * item permitido con motivo de bloqueo se leería como un error. El motivo no se
 * pierde: viaja en `wouldBlockReason`, que es lo que después permite decir cuánto
 * cupo habría consumido el informe.
 */
export function releaseQuotaBlocks(items: ResearchQuotaItem[]): ResearchQuotaItem[] {
  return items.map((item) =>
    item.allowed ? item : { ...item, allowed: true, reason: null, wouldBlockReason: item.reason },
  )
}

export async function checkResearchQuota(params: {
  workspaceId: string
  companies: { input: string; companyId: string | null }[]
  /**
   * Credencial sin topes (perfil admin). NO saltea el cálculo: lo corre entero y
   * después libera el bloqueo, conservando en `wouldBlockReason` lo que habría
   * dicho. Saltearlo sería más simple y perdería exactamente el dato que el perfil
   * admin existe para producir.
   */
  unrestricted?: boolean
}): Promise<ResearchQuotaResult> {
  const admin = createAdminClient()
  const plan = await getWorkspacePlan(params.workspaceId)
  const config = PLAN_CONFIG[plan]
  const usage = await getWorkspaceUsage(params.workspaceId)

  const companyIds = params.companies.map((c) => c.companyId).filter(Boolean) as string[]

  // Researches previos del workspace por empresa (para distinguir nuevo vs refresh)
  const priorByCompany = new Map<string, string>() // companyId → last created_at
  const followedInfo = new Map<string, { refreshDay: number | null; lastRefreshedAt: string | null }>()

  if (companyIds.length > 0) {
    const [priorRes, followedRes] = await Promise.all([
      admin
        .schema("v3")
        .from("research_jobs")
        .select("company_id, created_at")
        .eq("workspace_id", params.workspaceId)
        .in("company_id", companyIds)
        .order("created_at", { ascending: false }),
      admin
        .schema("v3")
        .from("followed_accounts")
        .select("company_id, refresh_day, last_refreshed_at")
        .eq("workspace_id", params.workspaceId)
        .eq("is_active", true)
        .in("company_id", companyIds),
    ])
    for (const row of priorRes.data ?? []) {
      if (row.company_id && !priorByCompany.has(row.company_id)) {
        priorByCompany.set(row.company_id, row.created_at)
      }
    }
    for (const row of followedRes.data ?? []) {
      followedInfo.set(row.company_id, {
        refreshDay: row.refresh_day,
        lastRefreshedAt: row.last_refreshed_at,
      })
    }
  }

  let monthlyRemaining = config.monthlyResearchCap - usage.monthlyResearchCount
  if (config.lifetimeResearchCap !== null) {
    monthlyRemaining = Math.min(
      monthlyRemaining,
      config.lifetimeResearchCap - usage.lifetimeResearchCount
    )
  }

  const cooldownMs = config.refreshCooldownDays * 24 * 60 * 60 * 1000

  const items: ResearchQuotaItem[] = params.companies.map((c) => {
    const prior = c.companyId ? priorByCompany.get(c.companyId) : undefined
    const isRefresh = Boolean(prior)

    if (!isRefresh) {
      // ── Empresa nueva: consume cupo ──
      if (monthlyRemaining <= 0) {
        const reason =
          plan === "trial"
            ? "El plan Trial permite investigar 2 cuentas en total. Para investigar más cuentas, hacé upgrade de plan."
            : `Alcanzaste el cupo de ${config.monthlyResearchCap} investigaciones nuevas este mes (plan ${config.label}). El cupo se renueva el 1° del próximo mes.`
        return { input: c.input, companyId: c.companyId, allowed: false, isRefresh, reason, nextAutoRefreshDate: null }
      }
      monthlyRemaining--
      return { input: c.input, companyId: c.companyId, allowed: true, isRefresh, reason: null, nextAutoRefreshDate: null }
    }

    // ── Refresh manual ──
    if (!config.allowsManualRefresh) {
      return {
        input: c.input,
        companyId: c.companyId,
        allowed: false,
        isRefresh,
        reason: "El plan Trial no permite re-investigar cuentas. Podés consultar la información ya investigada desde Cuentas.",
        nextAutoRefreshDate: null,
      }
    }

    const followed = c.companyId ? followedInfo.get(c.companyId) : undefined
    if (followed) {
      const next = nextRefreshDateFor(followed.refreshDay)
      return {
        input: c.input,
        companyId: c.companyId,
        allowed: false,
        isRefresh,
        reason: `Esta cuenta está en seguimiento: se refresca automáticamente y las novedades llegan en el digest del ${next}. No hace falta re-investigarla manualmente.`,
        nextAutoRefreshDate: next,
      }
    }

    const lastAt = prior ? new Date(prior).getTime() : 0
    if (Date.now() - lastAt < cooldownMs) {
      const availableAt = new Date(lastAt + cooldownMs)
      return {
        input: c.input,
        companyId: c.companyId,
        allowed: false,
        isRefresh,
        reason: `Esta cuenta ya fue investigada en los últimos ${config.refreshCooldownDays} días. Vas a poder refrescarla a partir del ${formatDateEs(availableAt)}.`,
        nextAutoRefreshDate: null,
      }
    }

    return { input: c.input, companyId: c.companyId, allowed: true, isRefresh, reason: null, nextAutoRefreshDate: null }
  })

  if (params.unrestricted) {
    return {
      plan,
      unrestricted: true,
      monthlyRemaining: Math.max(0, monthlyRemaining),
      items: releaseQuotaBlocks(items),
    }
  }

  return { plan, items, monthlyRemaining: Math.max(0, monthlyRemaining) }
}

// ─── Check de follow ─────────────────────────────────────────

export async function checkFollowQuota(
  workspaceId: string,
  /**
   * Credencial sin topes (perfil admin). Mismo criterio que `checkResearchQuota`:
   * se sigue midiendo (`used` y `cap` viajan igual) y solo se libera el bloqueo.
   *
   * Sin esto el perfil admin no cumple su objetivo: `followedCap` frena
   * `save_account` y, con él, `create_batch_job` — o sea, exactamente el "armar
   * bases sin tanto límite" que motivó el perfil. El plan escrito no lo tenía en
   * la lista de guards; apareció al implementarlo.
   */
  unrestricted = false,
): Promise<{ allowed: boolean; reason: string | null; used: number; cap: number; wouldBlockReason?: string | null }> {
  const usage = await getWorkspaceUsage(workspaceId)
  const cap = usage.config.followedCap
  if (usage.followedCount >= cap) {
    const reason = `Alcanzaste el límite de ${cap} cuentas seguidas del plan ${usage.config.label}. Dejá de seguir alguna cuenta o hacé upgrade de plan.`
    if (unrestricted) return { allowed: true, reason: null, used: usage.followedCount, cap, wouldBlockReason: reason }
    return { allowed: false, used: usage.followedCount, cap, reason }
  }
  return { allowed: true, reason: null, used: usage.followedCount, cap }
}

// ─── Check de usuarios (seats) ───────────────────────────────

export async function checkSeatQuota(
  workspaceId: string
): Promise<{ allowed: boolean; reason: string | null; used: number; cap: number | null }> {
  const usage = await getWorkspaceUsage(workspaceId)
  const cap = usage.config.maxUsers
  if (cap === null) return { allowed: true, reason: null, used: usage.memberCount, cap }

  const used = usage.memberCount + usage.pendingInvitations
  if (used >= cap) {
    return {
      allowed: false,
      used,
      cap,
      reason: `El plan ${usage.config.label} permite hasta ${cap} ${cap === 1 ? "usuario" : "usuarios"} por workspace (incluyendo invitaciones pendientes). Hacé upgrade para invitar más miembros.`,
    }
  }
  return { allowed: true, reason: null, used, cap }
}

// ─── Límites de enrichment de contactos (Apollo) ─────────────

export interface ContactEnrichmentLimits {
  plan: WorkspacePlan
  allowed: boolean
  reason: string | null
  monthlyUnits: number
  /** Tope de cargos por ejecución. `null` = sin tope (credencial sin topes). */
  maxRoles: number | null
  maxContacts: number
  freshnessDays: number
}

/**
 * Límites de enrichment de contactos para un workspace. Fuente única para la app
 * y para el MCP: ninguna tool debe hardcodear 10 cargos, 10 contactos ni 90 días.
 * Los créditos de Apollo los absorbe ASCI, por eso el tope es por plan.
 *
 * `unrestricted` levanta SOLO el tope de cargos. Es deliberado que no levante
 * `maxContacts`: los cargos son puntería —afinan a quién se busca— mientras que
 * los contactos son el gasto, porque el crédito se paga por contacto revelado.
 * Levantar la puntería no cuesta un peso más; levantar el gasto sí, y ese techo
 * lo mueve el presupuesto del lote, no este flag.
 *
 * El tope de cargos es un límite de plan y el perfil admin existe para no
 * tenerlos. `maxRoles: null` significa "sin tope", nunca "cero".
 */
export async function getContactEnrichmentLimits(
  workspaceId: string,
  unrestricted = false,
): Promise<ContactEnrichmentLimits> {
  const plan = await getWorkspacePlan(workspaceId)
  const config = PLAN_CONFIG[plan]
  return {
    plan,
    allowed: config.allowsContactEnrichment,
    reason: config.allowsContactEnrichment
      ? null
      : `La búsqueda de tomadores de decisión requiere un plan pago (tu plan actual: ${config.label}).`,
    monthlyUnits: config.monthlyContactEnrichmentUnits,
    maxRoles: unrestricted ? null : config.maxRolesPerEnrichment,
    maxContacts: config.maxContactsPerEnrichment,
    freshnessDays: config.contactFreshnessDays,
  }
}

// ─── Check de API keys ───────────────────────────────────────

export async function checkApiKeyAccess(
  workspaceId: string
): Promise<{ allowed: boolean; reason: string | null }> {
  const plan = await getWorkspacePlan(workspaceId)
  if (!PLAN_CONFIG[plan].allowsApiKeys) {
    return {
      allowed: false,
      reason: `Las API keys y el acceso MCP con IA requieren un plan pago (tu plan actual: ${PLAN_CONFIG[plan].label}).`,
    }
  }
  return { allowed: true, reason: null }
}

// ─── Helpers ─────────────────────────────────────────────────

/** Próxima fecha en que el cron toca esa cuenta (según su refresh_day 1-28). */
function nextRefreshDateFor(refreshDay: number | null): string {
  const day = refreshDay && refreshDay >= 1 && refreshDay <= 28 ? refreshDay : 1
  const now = new Date()
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day))
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCMonth(candidate.getUTCMonth() + 1)
  }
  return formatDateEs(candidate)
}

function formatDateEs(d: Date): string {
  return d.toLocaleDateString("es", { day: "numeric", month: "long" })
}
