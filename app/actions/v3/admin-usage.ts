"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// ═══════════════════════════════════════════════════════════
// Reportería de uso para super-admins.
// Agrega datos de v3.ai_usage_log + actividad (chats, research,
// icebreakers, cuentas) por período y workspace.
// ═══════════════════════════════════════════════════════════

async function requireSuperAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "No autenticado" }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (profile?.role !== "superadmin") return { error: "No tenés permisos de super administrador" }
  return { userId: user.id }
}

export interface UsageReportFilters {
  /** Días hacia atrás: 7, 30 o 90 */
  periodDays: number
  /** null = todos los workspaces */
  workspaceId: string | null
}

export interface UsageKpis {
  totalCostUsd: number
  totalCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  activeUsers: number
  chatsStarted: number
  researchJobs: number
  icebreakers: number
  accountsFollowed: number
}

export interface DailyPoint {
  date: string // YYYY-MM-DD
  costUsd: number
  calls: number
}

export interface FeatureBreakdown {
  feature: string
  calls: number
  costUsd: number
  inputTokens: number
  outputTokens: number
}

export interface UserUsageRow {
  userId: string
  email: string
  workspaceName: string
  chats: number
  researchJobs: number
  icebreakers: number
  aiCalls: number
  costUsd: number
  lastActivity: string | null
}

export interface WorkspaceOption {
  id: string
  name: string
}

export interface UsageReport {
  kpis: UsageKpis
  daily: DailyPoint[]
  byFeature: FeatureBreakdown[]
  byUser: UserUsageRow[]
  workspaces: WorkspaceOption[]
  error?: string
}

const EMPTY_REPORT: UsageReport = {
  kpis: {
    totalCostUsd: 0,
    totalCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    activeUsers: 0,
    chatsStarted: 0,
    researchJobs: 0,
    icebreakers: 0,
    accountsFollowed: 0,
  },
  daily: [],
  byFeature: [],
  byUser: [],
  workspaces: [],
}

export async function getUsageReport(filters: UsageReportFilters): Promise<UsageReport> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) return { ...EMPTY_REPORT, error: guard.error }

  const periodDays = [7, 30, 90].includes(filters.periodDays) ? filters.periodDays : 30
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString()
  const admin = createAdminClient()

  // ── Fuentes en paralelo ──
  const usageQuery = admin
    .schema("v3")
    .from("ai_usage_log")
    .select("workspace_id, user_id, feature, model, input_tokens, output_tokens, cost_usd, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(20000)

  const chatsQuery = admin
    .schema("v3")
    .from("chat_conversations")
    .select("id, workspace_id, user_id, created_at")
    .gte("created_at", since)

  const researchQuery = admin
    .schema("v3")
    .from("research_jobs")
    .select("id, workspace_id, requested_by, created_at, status")
    .gte("created_at", since)

  const icebreakersQuery = admin
    .schema("v3")
    .from("icebreakers")
    .select("id, workspace_id, created_by, created_at")
    .gte("created_at", since)

  const followedQuery = admin
    .schema("v3")
    .from("followed_accounts")
    .select("id, workspace_id, followed_by, created_at")
    .gte("created_at", since)

  const workspacesQuery = admin.schema("v3").from("workspaces").select("id, name").order("name")

  const membersQuery = admin
    .schema("v3")
    .from("workspace_members")
    .select("user_id, workspace_id")
    .eq("status", "active")

  const [usageRes, chatsRes, researchRes, icebreakersRes, followedRes, workspacesRes, membersRes] =
    await Promise.all([
      usageQuery,
      chatsQuery,
      researchQuery,
      icebreakersQuery,
      followedQuery,
      workspacesQuery,
      membersQuery,
    ])

  const wsFilter = filters.workspaceId
  const inWs = (wsId: string | null | undefined) => !wsFilter || wsId === wsFilter

  const usage = (usageRes.data ?? []).filter((r) => inWs(r.workspace_id))
  const chats = (chatsRes.data ?? []).filter((r) => inWs(r.workspace_id))
  const research = (researchRes.data ?? []).filter((r) => inWs(r.workspace_id))
  const icebreakers = (icebreakersRes.data ?? []).filter((r) => inWs(r.workspace_id))
  const followed = (followedRes.data ?? []).filter((r) => inWs(r.workspace_id))
  const workspaces = (workspacesRes.data ?? []) as WorkspaceOption[]
  const wsNameById = new Map(workspaces.map((w) => [w.id, w.name]))

  // ── KPIs ──
  const activeUserIds = new Set<string>()
  for (const r of usage) if (r.user_id) activeUserIds.add(r.user_id)
  for (const c of chats) if (c.user_id) activeUserIds.add(c.user_id)
  for (const j of research) if (j.requested_by) activeUserIds.add(j.requested_by)
  for (const i of icebreakers) if (i.created_by) activeUserIds.add(i.created_by)

  const kpis: UsageKpis = {
    totalCostUsd: usage.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
    totalCalls: usage.length,
    totalInputTokens: usage.reduce((s, r) => s + (r.input_tokens ?? 0), 0),
    totalOutputTokens: usage.reduce((s, r) => s + (r.output_tokens ?? 0), 0),
    activeUsers: activeUserIds.size,
    chatsStarted: chats.length,
    researchJobs: research.length,
    icebreakers: icebreakers.length,
    accountsFollowed: followed.length,
  }

  // ── Serie diaria (relleno de días sin datos) ──
  const dailyMap = new Map<string, { costUsd: number; calls: number }>()
  for (let i = periodDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    dailyMap.set(d.toISOString().slice(0, 10), { costUsd: 0, calls: 0 })
  }
  for (const r of usage) {
    const day = String(r.created_at).slice(0, 10)
    const bucket = dailyMap.get(day)
    if (bucket) {
      bucket.costUsd += Number(r.cost_usd ?? 0)
      bucket.calls += 1
    }
  }
  const daily: DailyPoint[] = [...dailyMap.entries()].map(([date, v]) => ({
    date,
    costUsd: Math.round(v.costUsd * 10000) / 10000,
    calls: v.calls,
  }))

  // ── Breakdown por feature ──
  const featureMap = new Map<string, FeatureBreakdown>()
  for (const r of usage) {
    const f = featureMap.get(r.feature) ?? {
      feature: r.feature,
      calls: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
    f.calls += 1
    f.costUsd += Number(r.cost_usd ?? 0)
    f.inputTokens += r.input_tokens ?? 0
    f.outputTokens += r.output_tokens ?? 0
    featureMap.set(r.feature, f)
  }
  const byFeature = [...featureMap.values()]
    .map((f) => ({ ...f, costUsd: Math.round(f.costUsd * 10000) / 10000 }))
    .sort((a, b) => b.costUsd - a.costUsd)

  // ── Detalle por usuario ──
  interface UserAgg {
    chats: number
    researchJobs: number
    icebreakers: number
    aiCalls: number
    costUsd: number
    lastActivity: string | null
    workspaceIds: Set<string>
  }
  const userMap = new Map<string, UserAgg>()
  const touch = (userId: string | null | undefined, wsId: string | null | undefined, at: string) => {
    if (!userId) return null
    let agg = userMap.get(userId)
    if (!agg) {
      agg = {
        chats: 0,
        researchJobs: 0,
        icebreakers: 0,
        aiCalls: 0,
        costUsd: 0,
        lastActivity: null,
        workspaceIds: new Set(),
      }
      userMap.set(userId, agg)
    }
    if (wsId) agg.workspaceIds.add(wsId)
    if (!agg.lastActivity || at > agg.lastActivity) agg.lastActivity = at
    return agg
  }

  for (const c of chats) {
    const agg = touch(c.user_id, c.workspace_id, String(c.created_at))
    if (agg) agg.chats += 1
  }
  for (const j of research) {
    const agg = touch(j.requested_by, j.workspace_id, String(j.created_at))
    if (agg) agg.researchJobs += 1
  }
  for (const i of icebreakers) {
    const agg = touch(i.created_by, i.workspace_id, String(i.created_at))
    if (agg) agg.icebreakers += 1
  }
  for (const r of usage) {
    const agg = touch(r.user_id, r.workspace_id, String(r.created_at))
    if (agg) {
      agg.aiCalls += 1
      agg.costUsd += Number(r.cost_usd ?? 0)
    }
  }

  // Fallback de workspace por membresía (para usuarios sin workspace en los registros)
  const memberWsByUser = new Map<string, string>()
  for (const m of membersRes.data ?? []) {
    if (!memberWsByUser.has(m.user_id)) memberWsByUser.set(m.user_id, m.workspace_id)
  }

  // Resolver emails (lote, tolerante a fallos)
  const userIds = [...userMap.keys()]
  const emails = new Map<string, string>()
  await Promise.all(
    userIds.slice(0, 100).map(async (id) => {
      try {
        const { data } = await admin.auth.admin.getUserById(id)
        if (data?.user?.email) emails.set(id, data.user.email)
      } catch {
        // ignorar
      }
    }),
  )

  const byUser: UserUsageRow[] = userIds
    .map((userId) => {
      const agg = userMap.get(userId)!
      const wsId = [...agg.workspaceIds][0] ?? memberWsByUser.get(userId) ?? null
      return {
        userId,
        email: emails.get(userId) ?? `${userId.slice(0, 8)}…`,
        workspaceName: wsId ? (wsNameById.get(wsId) ?? "—") : "—",
        chats: agg.chats,
        researchJobs: agg.researchJobs,
        icebreakers: agg.icebreakers,
        aiCalls: agg.aiCalls,
        costUsd: Math.round(agg.costUsd * 10000) / 10000,
        lastActivity: agg.lastActivity,
      }
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.chats - a.chats)

  return {
    kpis: {
      ...kpis,
      totalCostUsd: Math.round(kpis.totalCostUsd * 10000) / 10000,
    },
    daily,
    byFeature,
    byUser,
    workspaces,
  }
}
