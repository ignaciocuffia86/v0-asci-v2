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

export type WorkspacePlan = "trial" | "silver" | "gold" | "platinum"

export interface PlanConfig {
  label: string
  /** Máximo de cuentas seguidas activas (cap del plan). */
  followedCap: number
  /** Researches nuevos por mes calendario (empresas no investigadas antes por el workspace). */
  monthlyResearchCap: number
  /** Trial: researches totales de por vida del workspace. */
  lifetimeResearchCap: number | null
  /** Usuarios (miembros activos + invitaciones pendientes) por workspace. */
  maxUsers: number | null
  /** El cron mensual refresca las cuentas seguidas de este plan. */
  allowsCron: boolean
  /** Permite crear y usar API keys (MCP). */
  allowsApiKeys: boolean
  /** Permite re-investigar (refresh manual) una empresa existente. */
  allowsManualRefresh: boolean
  /** Días de cooldown entre researches de la misma empresa. */
  refreshCooldownDays: number
}

export const PLAN_CONFIG: Record<WorkspacePlan, PlanConfig> = {
  trial: {
    label: "Trial",
    followedCap: 2,
    monthlyResearchCap: 2,
    lifetimeResearchCap: 2,
    maxUsers: 1,
    allowsCron: false,
    allowsApiKeys: false,
    allowsManualRefresh: false,
    refreshCooldownDays: 30,
  },
  silver: {
    label: "Silver",
    followedCap: 30,
    monthlyResearchCap: 30,
    lifetimeResearchCap: null,
    maxUsers: 3,
    allowsCron: true,
    allowsApiKeys: false,
    allowsManualRefresh: true,
    refreshCooldownDays: 30,
  },
  gold: {
    label: "Gold",
    followedCap: 60,
    monthlyResearchCap: 60,
    lifetimeResearchCap: null,
    maxUsers: 10,
    allowsCron: true,
    allowsApiKeys: false,
    allowsManualRefresh: true,
    refreshCooldownDays: 30,
  },
  platinum: {
    label: "Platinum",
    followedCap: 120,
    monthlyResearchCap: 120,
    lifetimeResearchCap: null,
    maxUsers: null,
    allowsCron: true,
    allowsApiKeys: true,
    allowsManualRefresh: true,
    refreshCooldownDays: 30,
  },
}

export const PLAN_ORDER: WorkspacePlan[] = ["trial", "silver", "gold", "platinum"]

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
}

export interface ResearchQuotaResult {
  plan: WorkspacePlan
  items: ResearchQuotaItem[]
  monthlyRemaining: number
}

/**
 * Valida el cupo de research para un lote de empresas.
 * - Empresa nueva para el workspace → consume cupo mensual (o de por vida en trial).
 * - Empresa ya investigada → refresh manual: requiere plan pago, cooldown de 30 días
 *   y NO estar seguida (las seguidas se refrescan solas vía cron).
 */
export async function checkResearchQuota(params: {
  workspaceId: string
  companies: { input: string; companyId: string | null }[]
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

  return { plan, items, monthlyRemaining: Math.max(0, monthlyRemaining) }
}

// ─── Check de follow ─────────────────────────────────────────

export async function checkFollowQuota(
  workspaceId: string
): Promise<{ allowed: boolean; reason: string | null; used: number; cap: number }> {
  const usage = await getWorkspaceUsage(workspaceId)
  const cap = usage.config.followedCap
  if (usage.followedCount >= cap) {
    return {
      allowed: false,
      used: usage.followedCount,
      cap,
      reason: `Alcanzaste el límite de ${cap} cuentas seguidas del plan ${usage.config.label}. Dejá de seguir alguna cuenta o hacé upgrade de plan.`,
    }
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

// ─── Check de API keys ───────────────────────────────────────

export async function checkApiKeyAccess(
  workspaceId: string
): Promise<{ allowed: boolean; reason: string | null }> {
  const plan = await getWorkspacePlan(workspaceId)
  if (!PLAN_CONFIG[plan].allowsApiKeys) {
    return {
      allowed: false,
      reason: `Las API keys y el acceso MCP están disponibles solo en el plan Platinum (tu plan actual: ${PLAN_CONFIG[plan].label}).`,
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
