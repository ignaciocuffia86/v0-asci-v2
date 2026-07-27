import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { followAccount, unfollowAccount } from "@/lib/v3/services/accounts"
import { checkFollowQuota, getContactEnrichmentLimits, getWorkspaceUsage } from "@/lib/v3/plans"
import type { McpPrincipal } from "./mcp-usage"

// ═══════════════════════════════════════════════════════════
// Ciclo de vida de cuentas guardadas del workspace (Fase 1).
//
// Regla rectora del flujo MCP:
//  - BUSCAR una empresa solo consulta el catálogo global. No consume cupo.
//  - TRABAJAR una empresa (research client-assisted, recomendación de cargos,
//    enrichment Apollo) exige que esté guardada en el workspace.
//  - Guardar = followed_accounts.is_active = true. Consume 1 lugar del plan.
//  - Eliminar = soft delete. Libera el cupo inmediatamente y preserva histórico.
//
// La cuenta guardada NO es una entidad nueva: es v3.followed_accounts, que ya
// alimenta el cron de refresh mensual y el digest. Guardar desde el MCP entra
// exactamente al mismo ciclo que guardar desde la UI.
// ═══════════════════════════════════════════════════════════

/** Estados posibles de una cuenta frente al workspace. */
export type SavedAccountState = "saved" | "not_saved" | "company_not_found"

export interface SavedAccountGuard {
  state: SavedAccountState
  companyId: string
  companyName: string | null
  followedAccountId: string | null
  /** Cupo del plan al momento de la consulta, para que el modelo pueda explicarlo. */
  accountLimit: { used: number; total: number; remaining: number } | null
  /** Acción que el modelo debe proponer al usuario antes de reintentar. */
  nextAction: "none" | "save_account" | "resolve_company" | "upgrade_plan"
  message: string | null
}

/**
 * Verifica si una empresa está guardada por el workspace.
 *
 * Devuelve un resultado estructurado en lugar de lanzar: las tools del MCP
 * necesitan explicarle al modelo qué falta y cuánto cupo queda, no solo fallar.
 * Para uso interno donde el guard es una precondición dura, usar assertSavedAccount.
 */
export async function requireSavedAccount(
  principal: McpPrincipal,
  companyId: string
): Promise<SavedAccountGuard> {
  const admin = createAdminClient()

  const [companyRes, followedRes] = await Promise.all([
    admin.from("companies").select("id,name").eq("id", companyId).maybeSingle(),
    admin
      .schema("v3")
      .from("followed_accounts")
      .select("id,is_active")
      .eq("workspace_id", principal.workspaceId)
      .eq("company_id", companyId)
      .maybeSingle(),
  ])

  if (!companyRes.data) {
    return {
      state: "company_not_found",
      companyId,
      companyName: null,
      followedAccountId: null,
      accountLimit: null,
      nextAction: "resolve_company",
      message: "No existe una empresa con ese companyId en el catálogo. Buscala de nuevo con search_companies.",
    }
  }

  if (followedRes.data?.is_active) {
    return {
      state: "saved",
      companyId,
      companyName: companyRes.data.name,
      followedAccountId: followedRes.data.id,
      accountLimit: null,
      nextAction: "none",
      message: null,
    }
  }

  const quota = await checkFollowQuota(principal.workspaceId)
  return {
    state: "not_saved",
    companyId,
    companyName: companyRes.data.name,
    followedAccountId: null,
    accountLimit: { used: quota.used, total: quota.cap, remaining: Math.max(0, quota.cap - quota.used) },
    nextAction: quota.allowed ? "save_account" : "upgrade_plan",
    message: quota.allowed
      ? `${companyRes.data.name} todavía no está guardada en el workspace. Para investigarla o buscar tomadores de decisión primero hay que guardarla, y eso ocupa 1 de los ${quota.cap} lugares del plan. Pedí confirmación al usuario antes de llamar save_account.`
      : quota.reason,
  }
}

export interface SavedAccountsBlocked {
  allowed: false
  reason: "ACCOUNTS_NOT_SAVED"
  blockedAccounts: SavedAccountGuard[]
  nextAction: "save_account" | "resolve_company" | "upgrade_plan"
  message: string
}

/**
 * Guard para las tools que TRABAJAN una cuenta (research y icebreakers).
 *
 * Devuelve un bloqueo estructurado en lugar de lanzar, para que el modelo pueda
 * explicar qué falta y pedir confirmación. Es imprescindible llamarlo ANTES de
 * reservar cuota: si no, la ejecución consume cupo de research sobre cuentas que
 * el workspace nunca guardó.
 */
export async function guardSavedAccounts(
  principal: McpPrincipal,
  companyIds: string[]
): Promise<SavedAccountsBlocked | null> {
  const guards = await Promise.all(companyIds.map((companyId) => requireSavedAccount(principal, companyId)))
  const blocked = guards.filter((guard) => guard.state !== "saved")
  if (!blocked.length) return null

  const missing = blocked.filter((guard) => guard.state === "not_saved")
  const unresolved = blocked.filter((guard) => guard.state === "company_not_found")
  const noQuota = blocked.some((guard) => guard.nextAction === "upgrade_plan")

  return {
    allowed: false,
    reason: "ACCOUNTS_NOT_SAVED",
    blockedAccounts: blocked,
    nextAction: unresolved.length ? "resolve_company" : noQuota ? "upgrade_plan" : "save_account",
    message: [
      missing.length
        ? `Estas cuentas todavía no están guardadas en el workspace: ${missing.map((guard) => guard.companyName ?? guard.companyId).join(", ")}. Guardar cada una ocupa 1 lugar del plan, así que pedí confirmación al usuario y llamá save_account antes de reintentar.`
        : null,
      unresolved.length
        ? `No se encontraron en el catálogo: ${unresolved.map((guard) => guard.companyId).join(", ")}. Volvé a buscarlas con search_companies.`
        : null,
      noQuota ? "Además no hay cupo disponible en el plan: liberá un lugar o hacé upgrade." : null,
    ]
      .filter(Boolean)
      .join(" "),
  }
}

/** Variante dura del guard, para servicios internos que no dialogan con el modelo. */
export async function assertSavedAccount(principal: McpPrincipal, companyId: string): Promise<string> {
  const guard = await requireSavedAccount(principal, companyId)
  if (guard.state !== "saved" || !guard.followedAccountId) {
    throw new Error(guard.state === "company_not_found" ? "COMPANY_NOT_FOUND" : "ACCOUNT_NOT_SAVED")
  }
  return guard.followedAccountId
}

// ─── prepare_save_account ────────────────────────────────────

export interface SaveAccountPreview {
  companyId: string
  companyName: string
  website: string | null
  country: string | null
  industry: string | null
  alreadySaved: boolean
  consumesQuota: boolean
  accountLimit: { used: number; total: number; remaining: number }
  allowed: boolean
  blockedReason: string | null
  unlocks: string[]
  requiresUserConfirmation: boolean
  message: string
}

/**
 * Previsualiza el guardado sin escribir nada. Existe para que el modelo pueda
 * mostrarle al usuario el costo en cupo ANTES de ocupar un lugar del plan.
 */
export async function prepareSaveAccount(
  principal: McpPrincipal,
  companyId: string
): Promise<SaveAccountPreview> {
  const admin = createAdminClient()

  const [companyRes, followedRes, quota] = await Promise.all([
    admin.from("companies").select("id,name,website,country,industry").eq("id", companyId).maybeSingle(),
    admin
      .schema("v3")
      .from("followed_accounts")
      .select("id,is_active")
      .eq("workspace_id", principal.workspaceId)
      .eq("company_id", companyId)
      .maybeSingle(),
    checkFollowQuota(principal.workspaceId),
  ])

  if (!companyRes.data) throw new Error("COMPANY_NOT_FOUND")

  const alreadySaved = Boolean(followedRes.data?.is_active)
  // Reactivar una cuenta dada de baja también ocupa un lugar activo.
  const consumesQuota = !alreadySaved
  const limits = await getContactEnrichmentLimits(principal.workspaceId)

  const unlocks = [
    "Investigación de noticias y tech radar con los tokens del cliente",
    "Recomendación de cargos justificada por señales",
    ...(limits.allowed ? ["Búsqueda de tomadores de decisión en Apollo"] : []),
  ]

  const allowed = alreadySaved || quota.allowed

  return {
    companyId: companyRes.data.id,
    companyName: companyRes.data.name,
    website: companyRes.data.website,
    country: companyRes.data.country,
    industry: companyRes.data.industry,
    alreadySaved,
    consumesQuota,
    accountLimit: { used: quota.used, total: quota.cap, remaining: Math.max(0, quota.cap - quota.used) },
    allowed,
    blockedReason: allowed ? null : quota.reason,
    unlocks,
    requiresUserConfirmation: consumesQuota && allowed,
    message: alreadySaved
      ? `${companyRes.data.name} ya está guardada en el workspace. Podés trabajarla sin consumir cupo adicional.`
      : allowed
        ? `Guardar ${companyRes.data.name} ocupa 1 de los ${quota.cap} lugares del plan (usados: ${quota.used}). Confirmá con el usuario antes de llamar save_account.`
        : (quota.reason ?? "No hay cupo disponible en el plan."),
  }
}

// ─── save_account ────────────────────────────────────────────

export interface SaveAccountResult {
  saved: boolean
  companyId: string
  companyName: string
  followedAccountId: string | null
  idempotent: boolean
  accountLimit: { used: number; total: number; remaining: number }
  blockedReason: string | null
  message: string
}

/**
 * Guarda la cuenta en el workspace. Requiere userConfirmed explícito porque
 * consume un lugar del plan. Idempotente: si ya estaba guardada no vuelve a
 * contar y reactiva las que habían sido dadas de baja.
 */
export async function saveAccount(
  principal: McpPrincipal,
  params: { companyId: string; userConfirmed: boolean }
): Promise<SaveAccountResult> {
  if (!params.userConfirmed) throw new Error("USER_CONFIRMATION_REQUIRED")

  const preview = await prepareSaveAccount(principal, params.companyId)

  if (preview.alreadySaved) {
    const guard = await requireSavedAccount(principal, params.companyId)
    const usage = await getWorkspaceUsage(principal.workspaceId)
    return {
      saved: true,
      companyId: preview.companyId,
      companyName: preview.companyName,
      followedAccountId: guard.followedAccountId,
      idempotent: true,
      accountLimit: limitOf(usage),
      blockedReason: null,
      message: `${preview.companyName} ya estaba guardada. No se consumió cupo adicional.`,
    }
  }

  if (!preview.allowed) {
    return {
      saved: false,
      companyId: preview.companyId,
      companyName: preview.companyName,
      followedAccountId: null,
      idempotent: false,
      accountLimit: preview.accountLimit,
      blockedReason: preview.blockedReason,
      message:
        preview.blockedReason ??
        "No hay cupo disponible. Eliminá una cuenta guardada para liberar un lugar o hacé upgrade de plan.",
    }
  }

  // followAccount ya revalida el cap y suscribe al digest al usuario que guarda.
  const result = await followAccount({
    workspaceId: principal.workspaceId,
    companyId: params.companyId,
    userId: principal.userId,
  })

  if ("error" in result) {
    return {
      saved: false,
      companyId: preview.companyId,
      companyName: preview.companyName,
      followedAccountId: null,
      idempotent: false,
      accountLimit: preview.accountLimit,
      blockedReason: result.error,
      message: result.error,
    }
  }

  const usage = await getWorkspaceUsage(principal.workspaceId)
  return {
    saved: true,
    companyId: preview.companyId,
    companyName: preview.companyName,
    followedAccountId: result.followedAccountId,
    idempotent: false,
    accountLimit: limitOf(usage),
    blockedReason: null,
    message: `${preview.companyName} quedó guardada en el workspace. Ya podés investigarla y buscar tomadores de decisión.`,
  }
}

// ─── remove_workspace_account ────────────────────────────────

export interface RemoveAccountResult {
  removed: boolean
  companyId: string
  accountLimit: { used: number; total: number; remaining: number }
  message: string
}

/**
 * Elimina la cuenta del workspace y libera el cupo de inmediato.
 * Es soft delete: la inteligencia global de la empresa (noticias, tech radar,
 * contactos cacheados) no se borra, solo se corta la asociación del workspace.
 */
export async function removeWorkspaceAccount(
  principal: McpPrincipal,
  params: { companyId: string; userConfirmed: boolean }
): Promise<RemoveAccountResult> {
  if (!params.userConfirmed) throw new Error("USER_CONFIRMATION_REQUIRED")

  const result = await unfollowAccount({
    workspaceId: principal.workspaceId,
    companyId: params.companyId,
    userId: principal.userId,
  })
  if (!result.success) throw new Error(result.error ?? "ACCOUNT_REMOVE_FAILED")

  const usage = await getWorkspaceUsage(principal.workspaceId)
  return {
    removed: true,
    companyId: params.companyId,
    accountLimit: limitOf(usage),
    message:
      "La cuenta se quitó del workspace y el cupo quedó libre. La información global de la empresa se conserva; si la volvés a guardar, seguirá disponible.",
  }
}

// ─── list_saved_accounts ─────────────────────────────────────

/**
 * Lista las cuentas guardadas activas con su cupo. Se diferencia de
 * list_workspace_accounts, que devuelve el historial de research jobs.
 */
export async function listSavedAccounts(principal: McpPrincipal, limit = 50) {
  const admin = createAdminClient()

  const [accountsRes, usage] = await Promise.all([
    admin
      .schema("v3")
      .from("followed_accounts")
      .select("id,company_id,created_at,last_refreshed_at,refresh_day")
      .eq("workspace_id", principal.workspaceId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(Math.min(limit, 100)),
    getWorkspaceUsage(principal.workspaceId),
  ])

  const accounts = accountsRes.data ?? []
  if (!accounts.length) return { accountLimit: limitOf(usage), accounts: [] }

  const { data: companies } = await admin
    .from("companies")
    .select("id,name,website,country,industry")
    .in(
      "id",
      accounts.map((row) => row.company_id)
    )
  const companyMap = new Map((companies ?? []).map((row) => [row.id, row]))

  return {
    accountLimit: limitOf(usage),
    accounts: accounts.map((row) => ({
      followedAccountId: row.id,
      companyId: row.company_id,
      company: companyMap.get(row.company_id) ?? null,
      savedAt: row.created_at,
      lastRefreshedAt: row.last_refreshed_at,
      refreshDay: row.refresh_day,
    })),
  }
}

function limitOf(usage: Awaited<ReturnType<typeof getWorkspaceUsage>>) {
  const total = usage.config.followedCap
  return { used: usage.followedCount, total, remaining: Math.max(0, total - usage.followedCount) }
}
