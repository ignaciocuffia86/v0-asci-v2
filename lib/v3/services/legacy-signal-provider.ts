import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

export const LEGACY_SIGNAL_ADAPTER_VERSION = "legacy-signals-v2"

export interface CanonicalLegacySignal {
  id: string
  companyId: string
  type: string
  keyword: string | null
  snippet: string | null
  sourceField: string | null
  sourceUrl: string | null
  contactId: string | null
  jobPostingId: string | null
  occurredAt: string
  createdAt: string
}

export interface LegacySignalResult {
  status: "ready" | "empty" | "failed"
  signals: CanonicalLegacySignal[]
  total: number
  latestAt: string | null
  warning: string | null
}

export async function getLegacySignals(companyId: string, limit = 200): Promise<LegacySignalResult> {
  const admin = createAdminClient()
  const { data, error, count } = await admin
    .from("signals")
    .select(
      "id, company_id, signal_type, keyword_matched, snippet, source_field, source_url, contact_id, job_posting_id, job_posted_at, created_at",
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[v3] Error leyendo señales legacy", { companyId, code: error.code, message: error.message })
    return {
      status: "failed",
      signals: [],
      total: 0,
      latestAt: null,
      warning: "La fuente de señales internas no pudo consultarse; no significa que la cuenta no tenga señales.",
    }
  }

  const signals: CanonicalLegacySignal[] = (data ?? []).map((row) => ({
    id: row.id,
    companyId: row.company_id,
    type: row.signal_type,
    keyword: row.keyword_matched,
    snippet: row.snippet,
    sourceField: row.source_field,
    sourceUrl: row.source_url,
    contactId: row.contact_id,
    jobPostingId: row.job_posting_id,
    occurredAt: row.job_posted_at ?? row.created_at,
    createdAt: row.created_at,
  }))

  return {
    status: signals.length > 0 ? "ready" : "empty",
    signals,
    total: count ?? signals.length,
    latestAt: signals[0]?.occurredAt ?? null,
    warning: null,
  }
}
