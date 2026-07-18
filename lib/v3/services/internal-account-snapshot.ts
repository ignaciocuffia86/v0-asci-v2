import "server-only"

import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadDictionary, matchTextAgainstDictionary } from "./dictionary"
import { getCanonicalContacts, type CanonicalContact } from "./contact-provider"
import { cacheV2JobPostingProvider, type CanonicalCompanyIdentity, type NormalizedJobPosting } from "./job-posting-provider"
import { getWorkspaceFitProfile } from "./workspace-fit-profile"
import { getLegacySignals, LEGACY_SIGNAL_ADAPTER_VERSION } from "./legacy-signal-provider"

export interface InternalEvidenceItem {
  id: string
  type: "technology" | "process"
  termId: string
  term: string
  count: number
  latestAt: string | null
  sources: Array<{ kind: "contact-signal" | "job-posting"; title: string; snippet: string | null; date: string | null; url: string | null }>
}

export interface InternalAccountSnapshot {
  version: 1
  id: string
  snapshotVersion: string
  profileVersion: string | null
  company: CanonicalCompanyIdentity
  generatedAt: string
  freshness: { signalsLatestAt: string | null; jobsLatestAt: string | null; contactsLatestAt: string | null }
  coverage: { signals: number; signalsMaterialized: number; technologies: number; processes: number; jobPostings: number; contacts: number }
  technologies: InternalEvidenceItem[]
  processes: InternalEvidenceItem[]
  jobPostings: NormalizedJobPosting[]
  contacts: CanonicalContact[]
  warnings: string[]
}

const latest = (values: Array<string | null | undefined>) => values.filter(Boolean).sort().at(-1) ?? null
const text = (value: unknown) => typeof value === "string" ? value : value ? JSON.stringify(value) : ""

export async function buildInternalAccountSnapshot(params: {
  workspaceId: string
  company: CanonicalCompanyIdentity
  researchJobId: string
}): Promise<InternalAccountSnapshot> {
  const admin = createAdminClient()
  const generatedAt = new Date().toISOString()
  const profile = await getWorkspaceFitProfile(params.workspaceId)

  const [signalResult, dictionary, jobsResult, contactsResult] = await Promise.all([
    getLegacySignals(params.company.id, 200),
    loadDictionary(),
    cacheV2JobPostingProvider.fetch(params.company, { freshnessHours: 24, maxItems: 50, correlationId: params.researchJobId }),
    getCanonicalContacts({ companyId: params.company.id, recommendedTitles: profile.recommendedJobTitles, limit: 8 }),
  ])

  const warnings = [...jobsResult.warnings, ...contactsResult.warnings]
  if (signalResult.warning) warnings.push(signalResult.warning)
  const signals = signalResult.signals
  const evidence = new Map<string, InternalEvidenceItem>()

  const add = (match: { id: string; name: string; type: "product" | "process" }, source: InternalEvidenceItem["sources"][number]) => {
    const type = match.type === "product" ? "technology" : "process"
    const key = `${type}:${match.id}`
    const existing = evidence.get(key) ?? { id: key, type, termId: match.id, term: match.name, count: 0, latestAt: null, sources: [] }
    existing.count += 1
    existing.latestAt = latest([existing.latestAt, source.date])
    if (existing.sources.length < 3) existing.sources.push(source)
    evidence.set(key, existing)
  }

  for (const signal of signals) {
    const combined = [signal.keyword, signal.snippet, signal.sourceField].filter(Boolean).join(" · ")
    for (const match of matchTextAgainstDictionary(combined, dictionary)) {
      add(match, {
        kind: "contact-signal",
        title: signal.keyword ?? signal.type,
        snippet: signal.snippet?.slice(0, 280) ?? (combined.slice(0, 280) || null),
        date: signal.occurredAt,
        url: signal.sourceUrl,
      })
    }
  }

  for (const posting of jobsResult.postings) {
    const combined = `${posting.title}\n${posting.description ?? ""}`
    for (const match of matchTextAgainstDictionary(combined, dictionary)) {
      add(match, { kind: "job-posting", title: posting.title, snippet: posting.description?.slice(0, 280) ?? null, date: posting.postedAt, url: posting.url })
    }
  }

  const ranked = [...evidence.values()].sort((a, b) => b.count - a.count || (b.latestAt ?? "").localeCompare(a.latestAt ?? ""))
  const technologies = ranked.filter((item) => item.type === "technology").slice(0, 15)
  const processes = ranked.filter((item) => item.type === "process").slice(0, 15)
  const snapshotVersion = createHash("sha256").update(JSON.stringify({
    adapter: LEGACY_SIGNAL_ADAPTER_VERSION,
    companyId: params.company.id,
    signals: signals.map((item) => [item.id, item.occurredAt]),
    jobs: jobsResult.dedupeKeys,
    contacts: contactsResult.contacts.map((item) => item.id),
  })).digest("hex").slice(0, 20)

  const payload = {
    workspace_id: params.workspaceId,
    company_id: params.company.id,
    research_job_id: params.researchJobId,
    snapshot_version: snapshotVersion,
    profile_version: profile.version,
    status: warnings.length ? "partial" : "ready",
    coverage: {
      signals: signalResult.total,
      signalsMaterialized: signals.length,
      technologies: technologies.length,
      processes: processes.length,
      jobPostings: jobsResult.postings.length,
      contacts: contactsResult.contacts.length,
    },
    freshness: { signalsLatestAt: signalResult.latestAt, jobsLatestAt: latest(jobsResult.postings.map((item) => item.postedAt)), contactsLatestAt: latest(contactsResult.contacts.map((item) => item.freshness)) },
    evidence: {
      sourceStatus: { legacySignals: signalResult.status },
      adapterVersion: LEGACY_SIGNAL_ADAPTER_VERSION,
      canonicalCompanyId: params.company.id,
      technologies,
      processes,
      jobPostings: jobsResult.postings,
    },
    contacts: contactsResult.contacts,
    warnings,
    generated_at: generatedAt,
  }

  const { data, error } = await admin.schema("v3").from("account_internal_snapshots").upsert(payload, { onConflict: "workspace_id,company_id,snapshot_version,profile_version" }).select("id").single()
  if (error) throw new Error(`No se pudo persistir el snapshot interno: ${error.message}`)

  return { version: 1, id: data.id, snapshotVersion, profileVersion: profile.version, company: params.company, generatedAt, freshness: payload.freshness, coverage: payload.coverage, technologies, processes, jobPostings: jobsResult.postings, contacts: contactsResult.contacts, warnings }
}
