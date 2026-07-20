import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { getLegacySignals } from "./services/legacy-signal-provider"
import type { McpPrincipal } from "./mcp-usage"

export async function searchCompanies(query: string, limit = 10) {
  const admin = createAdminClient()
  const normalized = query.trim()
  const { data, error } = await admin.from("companies")
    .select("id,name,normalized_name,website,country,industry")
    .or(`name.ilike.%${normalized.replaceAll(",", "")}%,website.ilike.%${normalized.replaceAll(",", "")}%`)
    .limit(limit)
  if (error) throw new Error(`COMPANY_SEARCH_FAILED:${error.message}`)
  return data ?? []
}

export async function getCompanyProfile(companyId: string) {
  const admin = createAdminClient()
  const [{ data: company, error }, signals] = await Promise.all([
    admin.from("companies").select("id,name,normalized_name,website,country,industry,description,employee_count").eq("id", companyId).maybeSingle(),
    getLegacySignals(companyId, 1),
  ])
  if (error) throw new Error(`COMPANY_READ_FAILED:${error.message}`)
  if (!company) throw new Error("COMPANY_NOT_FOUND")
  return { ...company, signalCoverage: { total: signals.total, latestAt: signals.latestAt, status: signals.status } }
}

export async function getCompanySignals(companyId: string, limit = 50) {
  return getLegacySignals(companyId, Math.min(limit, 100))
}

async function assertWorkspaceAccount(principal: McpPrincipal, companyId: string) {
  const admin = createAdminClient()
  const [{ count: jobs }, { count: followed }] = await Promise.all([
    admin.schema("v3").from("research_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", principal.workspaceId).eq("company_id", companyId),
    admin.schema("v3").from("followed_accounts").select("id", { count: "exact", head: true }).eq("workspace_id", principal.workspaceId).eq("company_id", companyId).eq("is_active", true),
  ])
  if (!(jobs || followed)) throw new Error("ACCOUNT_NOT_AVAILABLE_IN_WORKSPACE")
}

export async function listWorkspaceAccounts(principal: McpPrincipal, limit = 50) {
  const admin = createAdminClient()
  const { data, error } = await admin.schema("v3").from("research_jobs")
    .select("company_id,company_input,status,progress,created_at,finished_at")
    .eq("workspace_id", principal.workspaceId)
    .not("company_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 100))
  if (error) throw new Error(`WORKSPACE_ACCOUNTS_FAILED:${error.message}`)
  return data ?? []
}

export async function getAccountIntelligence(principal: McpPrincipal, companyId: string) {
  await assertWorkspaceAccount(principal, companyId)
  const admin = createAdminClient()
  const [snapshot, scorecard, brief, icebreakers] = await Promise.all([
    admin.schema("v3").from("account_internal_snapshots").select("*").eq("workspace_id", principal.workspaceId).eq("company_id", companyId).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    admin.schema("v3").from("account_scorecards").select("*").eq("workspace_id", principal.workspaceId).eq("company_id", companyId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.schema("v3").from("account_briefs").select("*").eq("workspace_id", principal.workspaceId).eq("company_id", companyId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.schema("v3").from("icebreakers").select("*").eq("workspace_id", principal.workspaceId).eq("company_id", companyId).order("created_at", { ascending: false }).limit(20),
  ])
  return { snapshot: snapshot.data, scorecard: scorecard.data, brief: brief.data, icebreakers: icebreakers.data ?? [] }
}

export async function getResearchStatus(principal: McpPrincipal, batchId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.schema("v3").from("research_jobs")
    .select("id,batch_id,company_id,company_input,status,phase,current_step,progress,error_code,error,created_at,finished_at")
    .eq("workspace_id", principal.workspaceId).eq("batch_id", batchId).order("created_at")
  if (error) throw new Error(`RESEARCH_STATUS_FAILED:${error.message}`)
  if (!data?.length) throw new Error("RESEARCH_NOT_FOUND")
  return { batchId, jobs: data }
}
