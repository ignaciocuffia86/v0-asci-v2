import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

const GENERIC_TOKENS = new Set(["banco", "bank", "argentina", "grupo", "group", "sa", "srl", "inc", "the", "de", "del", "y"])
const MAX_ALIASES = 15
const MAX_SIGNALS = 100
const MAX_IMPLEMENTATIONS = 30
const MAX_JOBS = 30

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function identityTokens(value: string) {
  const normalized = normalize(value)
  const tokens = normalized.split(" ").filter((token) => token.length > 2 && !GENERIC_TOKENS.has(token))
  // BBVA Argentina es la identidad actual de BBVA Banco Francés en los datos legacy.
  if (normalized.includes("bbva") && normalized.includes("argentina")) tokens.push("frances")
  if (normalized.includes("frances")) tokens.push("bbva")
  return [...new Set(tokens)]
}

function aliasScore(canonicalName: string, candidateName: string, canonicalWebsite: string | null, candidateWebsite: string | null) {
  const canonical = new Set(identityTokens(canonicalName))
  const candidate = new Set(identityTokens(candidateName))
  const shared = [...canonical].filter((token) => candidate.has(token))
  const nameScore = canonical.size ? shared.length / canonical.size : 0
  const canonicalDomain = canonicalWebsite?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null
  const candidateDomain = candidateWebsite?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null
  const domainMatch = Boolean(canonicalDomain && candidateDomain && canonicalDomain === candidateDomain)
  return { score: domainMatch ? 1 : nameScore, sharedTokens: shared, domainMatch }
}

function groupSignals(rows: Array<Record<string, unknown>>) {
  const grouped = new Map<string, { label: string; count: number; evidence: unknown[] }>()
  for (const row of rows) {
    const label = String(row.keyword_matched || row.signal_id || "Sin clasificar")
    const key = `${row.signal_type}:${normalize(label)}`
    const current = grouped.get(key) ?? { label, count: 0, evidence: [] }
    current.count += 1
    if (current.evidence.length < 3) current.evidence.push({ signalId: row.id, companyId: row.company_id, companyName: row.company_name, sourceField: row.source_field, jobPostingId: row.job_posting_id, snippet: row.snippet, sourceUrl: row.source_url, occurredAt: row.job_posted_at || row.created_at })
    grouped.set(key, current)
  }
  return [...grouped.entries()].map(([key, value]) => ({ type: key.split(":")[0], ...value })).sort((a, b) => b.count - a.count)
}

export async function getCompanySignalSummary(companyId: string) {
  const admin = createAdminClient()
  const { data: canonical, error: companyError } = await admin.from("companies").select("id,name,normalized_name,website,country,industry").eq("id", companyId).maybeSingle()
  if (companyError) throw new Error(`COMPANY_READ_FAILED:${companyError.message}`)
  if (!canonical) throw new Error("COMPANY_NOT_FOUND")

  const tokens = identityTokens(canonical.name)
  const searchTokens = tokens.length ? tokens.slice(0, 3) : normalize(canonical.name).split(" ").slice(0, 1)
  const filters = searchTokens.map((token) => `name.ilike.%${token.replaceAll(",", "")}%`).join(",")
  const { data: candidates, error: aliasError } = await admin.from("companies").select("id,name,website,country,industry").or(filters).limit(100)
  if (aliasError) throw new Error(`COMPANY_ALIAS_SEARCH_FAILED:${aliasError.message}`)

  const aliases = (candidates ?? [])
    .map((candidate) => ({ ...candidate, ...aliasScore(canonical.name, candidate.name, canonical.website, candidate.website) }))
    .filter((candidate) => candidate.id === canonical.id || candidate.domainMatch || candidate.score >= 0.6)
    .sort((a, b) => (a.id === canonical.id ? -1 : b.score - a.score))
    .slice(0, MAX_ALIASES)
  if (!aliases.some((alias) => alias.id === canonical.id)) aliases.unshift({ ...canonical, score: 1, sharedTokens: tokens, domainMatch: false })
  const companyIds = aliases.map((alias) => alias.id)
  const aliasNames = new Map(aliases.map((alias) => [alias.id, alias.name]))

  const [signalsResult, implementationsResult, jobsResult] = await Promise.all([
    admin.from("signals").select("id,company_id,signal_type,signal_id,keyword_matched,source_field,snippet,source_url,job_posting_id,job_posted_at,created_at").in("company_id", companyIds).order("created_at", { ascending: false }).limit(MAX_SIGNALS),
    admin.from("company_implementations").select("id,company_id,title,provider_name,technology,summary,area,evidence_level,relevance_snippet,source_url,source_name,published_at,created_at").in("company_id", companyIds).order("created_at", { ascending: false }).limit(MAX_IMPLEMENTATIONS),
    admin.from("job_postings").select("id,company_id,title,description,location,posted_at,is_active,job_url,created_at").in("company_id", companyIds).order("posted_at", { ascending: false, nullsFirst: false }).limit(MAX_JOBS),
  ])
  if (signalsResult.error) throw new Error(`SIGNALS_READ_FAILED:${signalsResult.error.message}`)
  if (implementationsResult.error) throw new Error(`IMPLEMENTATIONS_READ_FAILED:${implementationsResult.error.message}`)
  if (jobsResult.error) throw new Error(`JOBS_READ_FAILED:${jobsResult.error.message}`)

  const signals = (signalsResult.data ?? []).map((row) => ({ ...row, company_name: aliasNames.get(row.company_id) }))
  const linkedSignalIds = new Map<string, string[]>()
  for (const signal of signals) if (signal.job_posting_id) linkedSignalIds.set(signal.job_posting_id, [...(linkedSignalIds.get(signal.job_posting_id) ?? []), signal.id])
  const jobs = (jobsResult.data ?? []).map((job) => ({ id: job.id, companyId: job.company_id, companyName: aliasNames.get(job.company_id), title: job.title, location: job.location, postedAt: job.posted_at ?? job.created_at, isActive: job.is_active, jobUrl: job.job_url, descriptionSnippet: job.description?.slice(0, 500) ?? null, linkedSignalIds: linkedSignalIds.get(job.id) ?? [], interpretationStatus: linkedSignalIds.has(job.id) ? "classified_signal_available" : "raw_evidence_only" }))
  const grouped = groupSignals(signals)

  return {
    company: canonical,
    aliasResolution: { strategy: "conservative_name_or_domain_overlap", aliases: aliases.map(({ id, name, website, score, sharedTokens, domainMatch }) => ({ companyId: id, name, website, confidence: Number(score.toFixed(2)), sharedTokens, domainMatch })), warning: aliases.length > 1 ? "Se consolidaron entidades v2 relacionadas. Cada evidencia conserva companyId y companyName de origen." : null },
    summary: { status: signals.length || implementationsResult.data?.length || jobs.length ? "evidence_available" : "empty", technologies: grouped.filter((item) => item.type === "technology"), processes: grouped.filter((item) => item.type === "process"), signalCount: signals.length, implementationCount: implementationsResult.data?.length ?? 0, jobPostingCount: jobs.length },
    implementations: (implementationsResult.data ?? []).map((item) => ({ ...item, companyName: aliasNames.get(item.company_id) })),
    jobPostings: jobs,
    interpretationGuidance: "Resume solo lo observado. Distingue señales clasificadas, implementaciones y evidencia cruda de vacantes. Una vacante sin linkedSignalIds es indicio, no confirmación de tecnología o proceso implementado.",
    limits: { aliases: MAX_ALIASES, signals: MAX_SIGNALS, implementations: MAX_IMPLEMENTATIONS, jobPostings: MAX_JOBS },
  }
}
