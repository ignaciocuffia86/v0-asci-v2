import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

export interface CanonicalCompanyIdentity {
  id: string
  name: string
  domain: string | null
  country: string | null
  industry: string | null
}

export interface NormalizedJobPosting {
  id: string
  title: string
  description: string | null
  location: string | null
  postedAt: string | null
  url: string | null
  provider: "cache-v2" | "apify-linkedin"
  freshness: "recent" | "historical"
}

export interface JobPostingProviderResult {
  postings: NormalizedJobPosting[]
  providerRunId: string | null
  fetchedAt: string
  warnings: string[]
  usage: { items: number; costUsd: number | null }
  dedupeKeys: string[]
  rawReference: string | null
}

export interface JobPostingProvider {
  provider: "cache-v2" | "apify-linkedin"
  fetch(company: CanonicalCompanyIdentity, options: {
    freshnessHours: number
    maxItems: number
    correlationId: string
  }): Promise<JobPostingProviderResult>
}

export const cacheV2JobPostingProvider: JobPostingProvider = {
  provider: "cache-v2",
  async fetch(company, options) {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("job_postings")
      .select("id, title, description, location, posted_at, job_url")
      .eq("company_id", company.id)
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(options.maxItems)

    const recentCutoff = Date.now() - 180 * 24 * 60 * 60 * 1000
    const postings = (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      location: row.location ?? null,
      postedAt: row.posted_at ?? null,
      url: row.job_url ?? null,
      provider: "cache-v2" as const,
      freshness: row.posted_at && new Date(row.posted_at).getTime() >= recentCutoff ? "recent" as const : "historical" as const,
    }))

    return {
      postings,
      providerRunId: null,
      fetchedAt: new Date().toISOString(),
      warnings: error ? ["No se pudieron recuperar las vacantes existentes"] : [],
      usage: { items: postings.length, costUsd: 0 },
      dedupeKeys: postings.map((posting) => posting.url ?? posting.id),
      rawReference: "public.job_postings",
    }
  },
}

// El adapter apify-linkedin se incorporará en la segunda fase. El pipeline ya
// depende de esta interfaz y no de un proveedor concreto.
