import { createAdminClient } from "@/lib/supabase/admin"
import type { FollowedAccount } from "./types"

// ═══════════════════════════════════════════════════════════
// Cuentas seguidas por workspace:
//  - follow/unfollow (histórico preservado con is_active=false)
//  - suscriptores por cuenta (quién recibe el digest mensual)
//  - refresh_day distribuye la carga del cron a lo largo del mes
// ═══════════════════════════════════════════════════════════

/** Sigue una cuenta para el workspace. Idempotente: reactiva si existía. */
export async function followAccount(params: {
  workspaceId: string
  companyId: string
  userId: string
}): Promise<{ followedAccountId: string } | { error: string }> {
  const admin = createAdminClient()

  const { data: existing } = await admin
    .schema("v3")
    .from("followed_accounts")
    .select("id, is_active")
    .eq("workspace_id", params.workspaceId)
    .eq("company_id", params.companyId)
    .maybeSingle()

  let followedAccountId: string

  if (existing) {
    if (!existing.is_active) {
      await admin
        .schema("v3")
        .from("followed_accounts")
        .update({
          is_active: true,
          followed_by: params.userId,
          unfollowed_at: null,
          unfollowed_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
    }
    followedAccountId = existing.id
  } else {
    // refresh_day pseudo-aleatorio (1-28) para distribuir el cron mensual
    const refreshDay = (Math.floor(Math.random() * 28) + 1) as number
    const { data, error } = await admin
      .schema("v3")
      .from("followed_accounts")
      .insert({
        workspace_id: params.workspaceId,
        company_id: params.companyId,
        followed_by: params.userId,
        refresh_day: refreshDay,
      })
      .select("id")
      .single()
    if (error || !data) {
      console.error("[v3] Error siguiendo cuenta:", error?.message)
      return { error: "No se pudo seguir la cuenta" }
    }
    followedAccountId = data.id
  }

  // El usuario que sigue queda suscripto al digest por defecto
  await admin
    .schema("v3")
    .from("followed_account_subscribers")
    .upsert(
      {
        followed_account_id: followedAccountId,
        workspace_id: params.workspaceId,
        user_id: params.userId,
        subscribed: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "followed_account_id,user_id" }
    )

  return { followedAccountId }
}

/** Deja de seguir una cuenta (soft: preserva histórico). */
export async function unfollowAccount(params: {
  workspaceId: string
  companyId: string
  userId: string
}): Promise<{ success: boolean; error?: string }> {
  const admin = createAdminClient()
  const { error } = await admin
    .schema("v3")
    .from("followed_accounts")
    .update({
      is_active: false,
      unfollowed_at: new Date().toISOString(),
      unfollowed_by: params.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", params.workspaceId)
    .eq("company_id", params.companyId)
    .eq("is_active", true)

  if (error) return { success: false, error: "No se pudo dejar de seguir la cuenta" }
  return { success: true }
}

/** Suscribe o desuscribe a un usuario del digest de una cuenta. */
export async function setDigestSubscription(params: {
  followedAccountId: string
  workspaceId: string
  userId: string
  subscribed: boolean
}): Promise<{ success: boolean }> {
  const admin = createAdminClient()
  const { error } = await admin
    .schema("v3")
    .from("followed_account_subscribers")
    .upsert(
      {
        followed_account_id: params.followedAccountId,
        workspace_id: params.workspaceId,
        user_id: params.userId,
        subscribed: params.subscribed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "followed_account_id,user_id" }
    )
  return { success: !error }
}

export interface FollowedAccountWithCompany extends FollowedAccount {
  company: {
    id: string
    name: string
    website: string | null
    country: string | null
    industry: string | null
    logo_url: string | null
  } | null
  latestScore: number | null
  subscriberCount: number
  isSubscribed: boolean
}

/** Lista las cuentas seguidas activas del workspace con score y empresa. */
export async function listFollowedAccounts(
  workspaceId: string,
  userId: string
): Promise<FollowedAccountWithCompany[]> {
  const admin = createAdminClient()

  const { data: accounts } = await admin
    .schema("v3")
    .from("followed_accounts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })

  if (!accounts || accounts.length === 0) return []

  const companyIds = accounts.map((a) => a.company_id)
  const accountIds = accounts.map((a) => a.id)

  const [companiesRes, scoresRes, subsRes] = await Promise.all([
    admin
      .from("companies")
      .select("id, name, website, country, industry, logo_url")
      .in("id", companyIds),
    admin
      .schema("v3")
      .from("account_scorecards")
      .select("company_id, score, created_at")
      .eq("workspace_id", workspaceId)
      .in("company_id", companyIds)
      .order("created_at", { ascending: false }),
    admin
      .schema("v3")
      .from("followed_account_subscribers")
      .select("followed_account_id, user_id, subscribed")
      .in("followed_account_id", accountIds)
      .eq("subscribed", true),
  ])

  const companyMap = new Map((companiesRes.data ?? []).map((c) => [c.id, c]))
  // Último score por empresa (los resultados vienen ordenados desc)
  const scoreMap = new Map<string, number>()
  for (const s of scoresRes.data ?? []) {
    if (!scoreMap.has(s.company_id)) scoreMap.set(s.company_id, s.score)
  }
  const subsByAccount = new Map<string, { count: number; mine: boolean }>()
  for (const sub of subsRes.data ?? []) {
    const entry = subsByAccount.get(sub.followed_account_id) ?? { count: 0, mine: false }
    entry.count++
    if (sub.user_id === userId) entry.mine = true
    subsByAccount.set(sub.followed_account_id, entry)
  }

  return accounts.map((a) => ({
    ...(a as FollowedAccount),
    company: companyMap.get(a.company_id) ?? null,
    latestScore: scoreMap.get(a.company_id) ?? null,
    subscriberCount: subsByAccount.get(a.id)?.count ?? 0,
    isSubscribed: subsByAccount.get(a.id)?.mine ?? false,
  }))
}
