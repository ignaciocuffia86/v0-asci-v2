import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { getLegacySignals } from "./services/legacy-signal-provider"
import type { McpPrincipal } from "./mcp-usage"

/**
 * Busca empresas en el catálogo global.
 *
 * El catálogo v2 tiene muchas entidades homónimas por empresa (plantas,
 * distribuidores oficiales, filiales y variantes de razón social). Para "arcor"
 * hay más de 90 registros y solo uno concentra la evidencia real. La búsqueda
 * devolvía las primeras coincidencias sin orden ni contexto, así que era fácil
 * guardar una entidad degradada —sin dominio ni señales— y ocupar un lugar del
 * plan con una cuenta vacía.
 *
 * Por eso se traen más candidatas de las pedidas, se anota la evidencia de cada
 * una y se ordena por evidencia antes de recortar.
 */
export async function searchCompanies(query: string, limit = 10) {
  const admin = createAdminClient()
  const normalized = query.trim().replaceAll(",", "")
  const { data, error } = await admin.from("companies")
    .select("id,name,normalized_name,website,country,industry")
    .or(`name.ilike.%${normalized}%,website.ilike.%${normalized}%`)
    .limit(Math.min(limit * 5, 100))
  if (error) throw new Error(`COMPANY_SEARCH_FAILED:${error.message}`)
  const candidates = data ?? []
  if (!candidates.length) return { totalMatches: 0, companies: [] }

  // head:true trae solo el count, sin filas: barato incluso para las empresas
  // con miles de señales.
  const counted = await Promise.all(
    candidates.map(async (company) => {
      const [{ count: signals }, { count: jobPostings }] = await Promise.all([
        admin.from("signals").select("id", { count: "exact", head: true }).eq("company_id", company.id),
        admin.from("job_postings").select("id", { count: "exact", head: true }).eq("company_id", company.id),
      ])
      return {
        ...company,
        evidence: { signals: signals ?? 0, jobPostings: jobPostings ?? 0, hasWebsite: Boolean(company.website) },
      }
    })
  )

  const ranked = counted.sort(
    (a, b) =>
      b.evidence.signals - a.evidence.signals ||
      b.evidence.jobPostings - a.evidence.jobPostings ||
      Number(b.evidence.hasWebsite) - Number(a.evidence.hasWebsite)
  )
  const companies = ranked.slice(0, limit)
  const best = companies[0]?.evidence.signals ?? 0

  return {
    totalMatches: candidates.length,
    // El modelo necesita saber que hay homónimos para confirmar la entidad con el
    // usuario antes de gastar un lugar del plan en la equivocada.
    duplicateWarning:
      candidates.length > 1
        ? `Hay ${candidates.length} entidades que coinciden con "${normalized}" (plantas, filiales y distribuidores se cargan por separado). Están ordenadas por evidencia disponible. Confirmá con el usuario cuál es la correcta antes de guardarla: las que tienen 0 señales y sin dominio suelen ser registros degradados.`
        : null,
    companies: companies.map((company) => ({
      ...company,
      // Señal explícita para el modelo: guardar una cuenta sin evidencia no
      // habilita ningún research útil y consume cupo igual.
      likelyCanonical: company.evidence.signals > 0 && company.evidence.signals >= best,
    })),
  }
}

export async function getCompanyProfile(companyId: string) {
  const admin = createAdminClient()
  const [{ data: company, error }, signals] = await Promise.all([
    admin.from("companies").select("id,name,normalized_name,website,country,industry,description").eq("id", companyId).maybeSingle(),
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
