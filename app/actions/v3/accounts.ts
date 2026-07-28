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
import { getMicroAgentLabels } from "@/lib/v3/services/radar-agents"
import { runLinkedinJobsActor, companyNameVariants } from "@/lib/v3/services/apify-client"
import { ingestApifyJobPostings, apifyBatchFilenamePrefix } from "@/lib/v3/services/apify-job-ingest"

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

// ─── Cuentas investigadas recientemente (no seguidas) ────────

export interface ResearchedAccount {
  companyId: string
  companyName: string
  logoUrl: string | null
  industry: string | null
  country: string | null
  researchedAt: string
  totalSignals: number
  fitCount: number
  topMatches: string[]
}

/**
 * Empresas con research completado en los últimos 30 días para este
 * workspace que NO están en las cuentas seguidas del usuario.
 * Incluye el resumen de señales/fit del cache (determinístico).
 */
export async function getRecentlyResearchedAccounts(): Promise<ResearchedAccount[]> {
  const { userId, workspaceId } = await getAuthContext()
  const admin = createAdminClient()

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [jobsRes, followedList] = await Promise.all([
    admin
      .schema("v3")
      .from("research_jobs")
      .select("company_id, completed_at, companies:company_id(id, name, logo_url, industry, country)")
      .eq("workspace_id", workspaceId)
      .eq("status", "completed")
      .not("company_id", "is", null)
      .gte("completed_at", since)
      .order("completed_at", { ascending: false })
      .limit(50),
    listFollowedAccounts(workspaceId, userId),
  ])

  const followedIds = new Set(followedList.map((f) => f.company_id))
  const seen = new Set<string>()
  const candidates: { companyId: string; researchedAt: string; company: Record<string, unknown> | null }[] = []

  for (const job of jobsRes.data ?? []) {
    const cid = job.company_id as string
    if (!cid || followedIds.has(cid) || seen.has(cid)) continue
    seen.add(cid)
    // Supabase puede tipar el join como array u objeto según la FK
    const joined = job.companies as unknown
    const company = Array.isArray(joined) ? ((joined[0] as Record<string, unknown>) ?? null) : ((joined as Record<string, unknown>) ?? null)
    candidates.push({
      companyId: cid,
      researchedAt: (job.completed_at as string) ?? since,
      company,
    })
  }

  // Resumen de señales/fit por empresa (en paralelo, máx 12 empresas)
  const { summarizeCachedSignals } = await import("@/lib/v3/services/fit")
  const limited = candidates.slice(0, 12)
  const summaries = await Promise.all(
    limited.map((c) => summarizeCachedSignals(c.companyId, workspaceId).catch(() => null))
  )

  return limited.map((c, i) => ({
    companyId: c.companyId,
    companyName: (c.company?.name as string) ?? "Empresa",
    logoUrl: (c.company?.logo_url as string) ?? null,
    industry: (c.company?.industry as string) ?? null,
    country: (c.company?.country as string) ?? null,
    researchedAt: c.researchedAt,
    totalSignals: summaries[i]?.totalSignals ?? 0,
    fitCount: summaries[i]?.fitCount ?? 0,
    topMatches: summaries[i]?.topMatches ?? [],
  }))
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
    score: number | null
    fit_score: number | null
    buying_signals_score: number | null
    accessibility_score: number | null
    timing_score: number | null
    score_stage: "preliminary" | "final"
    fit_status: "evaluated" | "fit_not_evaluated"
    rationale: string | null
    created_at: string
    signals_snapshot: Record<string, unknown> | null
  } | null
  brief: {
    id: string
    stage: "preliminary" | "final"
    status: "ready" | "partial" | "failed"
    headline: string
    why_now: string | null
    fit_summary: string | null
    evidence: Array<Record<string, unknown>>
    recommended_contacts: Array<Record<string, unknown>>
    next_actions: string[]
    coverage: Record<string, number>
    freshness: Record<string, string | null>
    warnings: string[]
    created_at: string
  } | null
  previousScore: number | null
  findings: Array<{
    id: string
    radar_type: string
    micro_agent: string | null
    category: string
    title: string
    summary: string | null
    url: string | null
    source_name: string | null
    source_date: string | null
    evidence_level: string
    confidence: number | null
    detected_at: string
    supporting_sources: Array<{ url: string; title: string | null; date: string | null }>
    convergent_sources: number
    payload: { technologies?: string[]; processes?: string[] } | null
  }>
  /** Catálogo de micro-agentes (para mostrar el nombre legible del área). */
  agentLabels: Record<string, string>
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

// ─── Tab Señales: fit + personas + decisores recomendados ────

export interface AccountSignalsData {
  hasVendorProfile: boolean
  fitSignals: Array<{
    id: string
    title: string
    category: string | null
    radarType: string | null
    evidenceLevel: string | null
    sourceDate: string | null
    matchedTerms: string[]
    matchSource: ("dictionary" | "vendor-profile")[]
  }>
  topMatches: string[]
  relatedContacts: Array<{
    id: string
    fullName: string
    title: string | null
    seniority: string | null
    email: string | null
    emailStatus: string | null
    linkedinUrl: string | null
    country: string | null
    relatedTerms: string[]
  }>
  recommendedRoles: Array<{
    role: string
    reason: string
    inCache: boolean
    searchedToday: boolean
  }>
}

/** Mapa señal → departamentos/roles decisores típicos. */
const ROLE_RULES: { pattern: RegExp; roles: string[]; deptKeywords: string[] }[] = [
  {
    pattern: /erp|sap|oracle|dynamics|totvs|sistema de gesti[oó]n/i,
    roles: ["CIO", "IT Director", "ERP Manager"],
    deptKeywords: ["information_technology", "engineering", "it", "sistemas", "tecnolog"],
  },
  {
    pattern: /crm|salesforce|hubspot|ventas|comercial/i,
    roles: ["Sales Director", "Commercial Director", "CRM Manager"],
    deptKeywords: ["sales", "business_development", "comercial", "ventas"],
  },
  {
    pattern: /datos|data|bi|anal[ií]tica|warehouse|snowflake|databricks/i,
    roles: ["CDO", "Data Manager", "BI Manager"],
    deptKeywords: ["data", "analytics", "information_technology", "datos"],
  },
  {
    pattern: /finanzas|contab|tesorer|facturaci[oó]n|pagos/i,
    roles: ["CFO", "Finance Director", "Controller"],
    deptKeywords: ["finance", "accounting", "finanzas", "administraci"],
  },
  {
    pattern: /log[ií]stica|supply|distribuci[oó]n|almac[eé]n|wms/i,
    roles: ["Supply Chain Director", "Logistics Manager", "Operations Director"],
    deptKeywords: ["operations", "supply_chain", "log[ií]stica", "operaciones"],
  },
  {
    pattern: /nube|cloud|aws|azure|gcp|infraestructura|ciberseguridad|seguridad inform/i,
    roles: ["CTO", "Infrastructure Manager", "CISO"],
    deptKeywords: ["information_technology", "engineering", "it", "infraestructura"],
  },
  {
    pattern: /rrhh|recursos humanos|n[oó]mina|talento/i,
    roles: ["HR Director", "People Manager"],
    deptKeywords: ["human_resources", "rrhh", "people"],
  },
]

export async function getAccountSignals(companyId: string): Promise<AccountSignalsData> {
  const { workspaceId } = await getAuthContext()
  const admin = createAdminClient()

  const { summarizeCachedSignals } = await import("@/lib/v3/services/fit")
  const { getCompanyCachedContacts } = await import("@/lib/v3/services/contacts")

  const [summary, contacts] = await Promise.all([
    summarizeCachedSignals(companyId, workspaceId),
    getCompanyCachedContacts(companyId, 25),
  ])

  // Roles/departamentos implicados por las señales fit
  const impliedRoles = new Map<string, { reason: string; deptKeywords: string[] }>()
  for (const signal of summary.fitSignals) {
    const text = `${signal.title} ${signal.matchedTerms.join(" ")}`
    for (const rule of ROLE_RULES) {
      if (rule.pattern.test(text)) {
        for (const role of rule.roles) {
          if (!impliedRoles.has(role)) {
            impliedRoles.set(role, {
              reason: signal.matchedTerms.slice(0, 2).join(", ") || signal.title,
              deptKeywords: rule.deptKeywords,
            })
          }
        }
      }
    }
  }

  // Personas del cache relacionadas a las señales (por título/departamento)
  const relatedContacts: AccountSignalsData["relatedContacts"] = []
  for (const c of contacts) {
    const contactText = `${c.title ?? ""} ${(c.departments ?? []).join(" ")}`.toLowerCase()
    const relatedTerms = new Set<string>()
    for (const [role, info] of impliedRoles) {
      const roleMatch = contactText.includes(role.toLowerCase())
      const deptMatch = info.deptKeywords.some((kw) => new RegExp(kw, "i").test(contactText))
      if (roleMatch || deptMatch) relatedTerms.add(info.reason)
    }
    if (relatedTerms.size > 0) {
      relatedContacts.push({
        id: c.id,
        fullName: c.fullName,
        title: c.title,
        seniority: c.seniority,
        email: c.email,
        emailStatus: c.emailStatus,
        linkedinUrl: c.linkedinUrl,
        country: c.country,
        relatedTerms: [...relatedTerms].slice(0, 3),
      })
    }
  }
  // Priorizar por seniority
  const seniorityRank = (s: string | null) => {
    const v = (s ?? "").toLowerCase()
    if (["c_suite", "founder", "owner"].includes(v)) return 0
    if (v === "vp") return 1
    if (["director", "head"].includes(v)) return 2
    return 3
  }
  relatedContacts.sort((a, b) => seniorityRank(a.seniority) - seniorityRank(b.seniority))

  // Roles recomendados que NO están cubiertos por el cache
  const cacheText = contacts.map((c) => `${c.title ?? ""}`).join(" · ").toLowerCase()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const { data: todaySearches } = await admin
    .from("apollo_api_calls")
    .select("id, request_body")
    .eq("company_id", companyId)
    .eq("endpoint", "mixed_people/search")
    .gte("created_at", today.toISOString())
    .limit(30)

  const searchedTitlesToday = new Set<string>()
  for (const call of todaySearches ?? []) {
    const body = call.request_body as { person_titles?: string[] } | null
    for (const t of body?.person_titles ?? []) searchedTitlesToday.add(t.toLowerCase())
  }

  const recommendedRoles: AccountSignalsData["recommendedRoles"] = []
  for (const [role, info] of impliedRoles) {
    const inCache = cacheText.includes(role.toLowerCase())
    recommendedRoles.push({
      role,
      reason: info.reason,
      inCache,
      searchedToday: searchedTitlesToday.has(role.toLowerCase()),
    })
  }
  recommendedRoles.sort((a, b) => Number(a.inCache) - Number(b.inCache))

  return {
    hasVendorProfile: summary.hasVendorProfile,
    fitSignals: summary.fitSignals,
    topMatches: summary.topMatches,
    relatedContacts: relatedContacts.slice(0, 10),
    recommendedRoles: recommendedRoles.slice(0, 6),
  }
}

/**
 * Busca decisores en Apollo por rol para una cuenta (consume créditos).
 * Rate limit: 1 búsqueda por rol por día por cuenta (vía apollo_api_calls).
 */
export async function searchAccountDecisionMakers(
  companyId: string,
  role: string
): Promise<{ success: boolean; found: number; error?: string }> {
  const { userId } = await getAuthContext()
  const admin = createAdminClient()

  const cleanRole = role.trim().slice(0, 60)
  if (!cleanRole) return { success: false, found: 0, error: "Rol inválido" }

  const { data: company } = await admin
    .from("companies")
    .select("id, name, website, country, apollo_organization_id")
    .eq("id", companyId)
    .maybeSingle()

  const { normalizeDomain } = await import("@/lib/apollo/domain")
  const normalized = normalizeDomain(company?.website)
  if (!company || (!normalized && !company.apollo_organization_id)) {
    return { success: false, found: 0, error: "La empresa no tiene dominio registrado para buscar en Apollo" }
  }
  const companyDomain = normalized?.primary ?? null

  // Rate limit: ya se buscó este rol hoy para esta cuenta
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const { data: existing } = await admin
    .from("apollo_api_calls")
    .select("id, request_body")
    .eq("company_id", companyId)
    .eq("endpoint", "mixed_people/search")
    .gte("created_at", today.toISOString())
    .limit(30)
  for (const call of existing ?? []) {
    const body = call.request_body as { person_titles?: string[] } | null
    if ((body?.person_titles ?? []).some((t) => t.toLowerCase() === cleanRole.toLowerCase())) {
      return { success: false, found: 0, error: `Ya buscaste "${cleanRole}" hoy para esta cuenta. Probá mañana.` }
    }
  }

  const { searchPeople } = await import("@/lib/apollo/search")
  const result = await searchPeople({
    organizationId: company.apollo_organization_id ?? null,
    domain: companyDomain,
    jobTitles: [cleanRole],
    country: company.country ?? null,
    userId,
    bookmarkId: null,
    companyId: company.id,
    maxResults: 10,
  })

  if (!result.ok) {
    return { success: false, found: 0, error: `Apollo: ${result.error}` }
  }
  if (result.people.length === 0) {
    return { success: true, found: 0 }
  }

  // Persistir en cache (indexado por company_domain; upsert por apollo_id)
  const rows = result.people.map((p) => ({
    apollo_id: p.apolloId,
    company_domain: companyDomain ?? "",
    full_name: p.fullName || `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
    first_name: p.firstName ?? null,
    last_name: p.lastName ?? null,
    title: p.title ?? null,
    headline: p.headline ?? null,
    email: p.email ?? null,
    email_status: p.emailStatus ?? null,
    linkedin_url: p.linkedinUrl ?? null,
    seniority: p.seniority ?? null,
    departments: p.departments ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    country: p.country ?? null,
    job_titles_searched: [cleanRole],
    updated_at: new Date().toISOString(),
  }))

  const { error: upsertError } = await admin
    .from("apollo_contacts_cache")
    .upsert(rows, { onConflict: "apollo_id", ignoreDuplicates: false })

  if (upsertError) {
    console.error("[v3] Error guardando contactos Apollo:", upsertError.message)
  }

  revalidatePath(`/v3/accounts/${companyId}`)
  return { success: true, found: result.people.length }
}

// ─── Vacantes de LinkedIn vía Apify ──────────────────────────
//
// Espejo por UI de la tool MCP `scrape_company_job_postings`. Comparte servicio
// (`ingestApifyJobPostings`), así que las dos vías entran por el mismo ETL de v2
// y respetan los mismos guardrails de pertenencia y deduplicación.

/**
 * Ventana mínima entre scrapings de la misma cuenta.
 *
 * Cada corrida se paga en Apify y las vacantes de LinkedIn no rotan tan rápido,
 * así que refrescar dos veces el mismo día gasta plata para reingestar las mismas
 * filas. Mismo criterio que la búsqueda en Apollo, que se limita a 1 por día.
 */
const APIFY_REFRESH_COOLDOWN_HOURS = 12

export async function refreshAccountJobPostings(companyId: string): Promise<{
  success: boolean
  batchId?: string | null
  queued?: number
  skippedOtherCompany?: number
  warnings?: string[]
  error?: string
}> {
  const { userId, workspaceId } = await getAuthContext()
  const admin = createAdminClient()

  // Aislamiento multitenant: el scraping escribe en tablas de producción que lee
  // v2, así que solo se permite sobre cuentas que este workspace sigue. Sin esto,
  // cualquier miembro podría gastar cuota sobre una empresa arbitraria del catálogo.
  const { data: followed } = await admin
    .schema("v3")
    .from("followed_accounts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle()

  if (!followed) {
    return { success: false, error: "Esta cuenta no está en las cuentas seguidas de tu workspace." }
  }

  const { data: company } = await admin
    .from("companies")
    .select("name, linkedin_url, country")
    .eq("id", companyId)
    .maybeSingle()

  if (!company) return { success: false, error: "No se encontró la empresa." }

  // Cooldown: se mira el último batch de Apify de ESTA cuenta. Los `failed` no
  // cuentan, para no dejar la cuenta bloqueada 12 horas por un run que se cayó.
  const { data: lastBatch } = await admin
    .from("import_batches")
    .select("created_at, status")
    .like("filename", `${apifyBatchFilenamePrefix(companyId)}%`)
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastBatch?.created_at) {
    const elapsedHours = (Date.now() - new Date(lastBatch.created_at).getTime()) / 3_600_000
    if (elapsedHours < APIFY_REFRESH_COOLDOWN_HOURS) {
      const remaining = Math.ceil(APIFY_REFRESH_COOLDOWN_HOURS - elapsedHours)
      return {
        success: false,
        error: `Ya se refrescaron las vacantes de esta cuenta hace menos de ${APIFY_REFRESH_COOLDOWN_HOURS} h. Probá en ${remaining} h.`,
      }
    }
  }

  try {
    const run = await runLinkedinJobsActor({
      companyNames: companyNameVariants(company.name, company.linkedin_url),
      // `||` y no `??`: hay filas con country = "" (string vacío).
      location: company.country?.trim() || undefined,
    })

    const ingest = await ingestApifyJobPostings({
      companyId,
      userId,
      runId: run.runId,
      items: run.items,
    })

    revalidatePath(`/v3/accounts/${companyId}`)
    return {
      success: true,
      batchId: ingest.batchId,
      queued: ingest.queued,
      skippedOtherCompany: ingest.skippedOtherCompany,
      warnings: ingest.warnings,
    }
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Error desconocido"
    console.error("[v3] Error refrescando vacantes de Apify:", raw)
    // Los códigos internos no le dicen nada al usuario: se traducen a algo accionable.
    if (raw.startsWith("APIFY_TOKEN_MISSING")) {
      return { success: false, error: "Falta configurar APIFY_TOKEN en el proyecto." }
    }
    if (raw.startsWith("APIFY_RUN_")) {
      return { success: false, error: "El scraping de LinkedIn falló o no devolvió resultados. Reintentá más tarde." }
    }
    return { success: false, error: "No se pudieron ingestar las vacantes. Revisá el detalle en /admin/processing." }
  }
}

export async function getAccountDetail(companyId: string): Promise<AccountDetail> {
  const { userId, workspaceId } = await getAuthContext()
  const admin = createAdminClient()

  const [followedList, companyRes, scorecardsRes, findingsRes, icebreakersRes, briefRes] = await Promise.all([
    listFollowedAccounts(workspaceId, userId),
    admin
      .from("companies")
      .select("id, name, website, country, industry, logo_url, linkedin_url")
      .eq("id", companyId)
      .maybeSingle(),
    admin
      .schema("v3")
      .from("account_scorecards")
      .select("id, score, fit_score, buying_signals_score, accessibility_score, timing_score, score_stage, fit_status, rationale, created_at, signals_snapshot")
      .eq("workspace_id", workspaceId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(2),
    admin
      .from("radar_findings")
      .select(
        "id, radar_type, micro_agent, category, title, summary, url, source_name, source_date, evidence_level, confidence, detected_at, supporting_sources, convergent_sources, payload"
      )
      .eq("company_id", companyId)
      .order("detected_at", { ascending: false })
      .limit(80),
    admin
      .schema("v3")
      .from("icebreakers")
      .select("id, contact_name, contact_title, contact_country, language_register, content, feedback, version, created_at")
      .eq("workspace_id", workspaceId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .schema("v3")
      .from("account_briefs")
      .select("id, stage, status, headline, why_now, fit_summary, evidence, recommended_contacts, next_actions, coverage, freshness, warnings, created_at")
      .eq("workspace_id", workspaceId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
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
  const agentLabels = await getMicroAgentLabels()

  return {
    followedAccount,
    company: companyRes.data ?? null,
    scorecard: scorecards[0] ?? null,
    brief: (briefRes.data as AccountDetail["brief"]) ?? null,
    previousScore: scorecards[1]?.score ?? null,
    findings: (findingsRes.data ?? []) as AccountDetail["findings"],
    agentLabels,
    icebreakers: icebreakersRes.data ?? [],
    digests,
  }
}
