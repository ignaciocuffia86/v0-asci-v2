"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireWorkspaceMember } from "@/lib/v3/workspace"
import {
  followAccount,
  unfollowAccount,
  setDigestSubscription,
  listFollowedAccounts,
  type FollowedAccountWithCompany,
} from "@/lib/v3/services/accounts"

// ═══════════════════════════════════════════════════════════
// Server actions de cuentas seguidas (vistas /v3/accounts).
// Autorización: siempre por workspace del usuario autenticado.
// ═══════════════════════════════════════════════════════════

async function getAuthContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")
  const workspace = await requireWorkspaceMember(user.id)
  return { userId: user.id, workspaceId: workspace.id }
}

export async function getFollowedAccounts(): Promise<FollowedAccountWithCompany[]> {
  const { userId, workspaceId } = await getAuthContext()
  return listFollowedAccounts(workspaceId, userId)
}

export async function followAccountAction(
  companyId: string
): Promise<{ success: boolean; error?: string }> {
  const { userId, workspaceId } = await getAuthContext()
  const result = await followAccount({ workspaceId, companyId, userId })
  if ("error" in result) return { success: false, error: result.error }
  revalidatePath("/v3/accounts")
  return { success: true }
}

export async function unfollowAccountAction(
  companyId: string
): Promise<{ success: boolean; error?: string }> {
  const { userId, workspaceId } = await getAuthContext()
  const result = await unfollowAccount({ workspaceId, companyId, userId })
  revalidatePath("/v3/accounts")
  return result
}

export async function toggleDigestSubscription(
  followedAccountId: string,
  subscribed: boolean
): Promise<{ success: boolean }> {
  const { userId, workspaceId } = await getAuthContext()
  const result = await setDigestSubscription({
    followedAccountId,
    workspaceId,
    userId,
    subscribed,
  })
  revalidatePath("/v3/accounts")
  return result
}

// ─── Detalle de cuenta ───────────────────────────────────────

export interface AccountDetail {
  followedAccount: FollowedAccountWithCompany | null
  company: {
    id: string
    name: string
    website: string | null
    country: string | null
    industry: string | null
    logo_url: string | null
    linkedin_url: string | null
  } | null
  scorecard: {
    id: string
    score: number
    fit_score: number
    buying_signals_score: number
    accessibility_score: number
    timing_score: number
    rationale: string | null
    created_at: string
  } | null
  previousScore: number | null
  findings: Array<{
    id: string
    radar_type: string
    category: string
    title: string
    summary: string | null
    url: string | null
    source_name: string | null
    source_date: string | null
    evidence_level: string
    confidence: number | null
    detected_at: string
  }>
  icebreakers: Array<{
    id: string
    contact_name: string
    contact_title: string | null
    contact_country: string | null
    language_register: string
    content: string
    feedback: number | null
    version: number
    created_at: string
  }>
  digests: Array<{
    id: string
    score_before: number | null
    score_after: number | null
    sent_at: string
    recipients: unknown
  }>
}

export async function getAccountDetail(companyId: string): Promise<AccountDetail> {
  const { userId, workspaceId } = await getAuthContext()
  const admin = createAdminClient()

  const [followedList, companyRes, scorecardsRes, findingsRes, icebreakersRes] = await Promise.all([
    listFollowedAccounts(workspaceId, userId),
    admin
      .from("companies")
      .select("id, name, website, country, industry, logo_url, linkedin_url")
      .eq("id", companyId)
      .maybeSingle(),
    admin
      .schema("v3")
      .from("account_scorecards")
      .select("id, score, fit_score, buying_signals_score, accessibility_score, timing_score, rationale, created_at")
      .eq("workspace_id", workspaceId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(2),
    admin
      .from("radar_findings")
      .select(
        "id, radar_type, category, title, summary, url, source_name, source_date, evidence_level, confidence, detected_at"
      )
      .eq("company_id", companyId)
      .order("detected_at", { ascending: false })
      .limit(50),
    admin
      .schema("v3")
      .from("icebreakers")
      .select("id, contact_name, contact_title, contact_country, language_register, content, feedback, version, created_at")
      .eq("workspace_id", workspaceId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(20),
  ])

  const followedAccount = followedList.find((f) => f.company_id === companyId) ?? null

  let digests: AccountDetail["digests"] = []
  if (followedAccount) {
    const { data } = await admin
      .schema("v3")
      .from("digest_log")
      .select("id, score_before, score_after, sent_at, recipients")
      .eq("followed_account_id", followedAccount.id)
      .order("sent_at", { ascending: false })
      .limit(12)
    digests = data ?? []
  }

  const scorecards = scorecardsRes.data ?? []

  return {
    followedAccount,
    company: companyRes.data ?? null,
    scorecard: scorecards[0] ?? null,
    previousScore: scorecards[1]?.score ?? null,
    findings: findingsRes.data ?? [],
    icebreakers: icebreakersRes.data ?? [],
    digests,
  }
}
