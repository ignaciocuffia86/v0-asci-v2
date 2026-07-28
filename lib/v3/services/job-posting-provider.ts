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
    /**
     * Ventana, en horas, para rotular una vacante como `recent` o `historical`.
     *
     * NO es un filtro: antes este campo se llamaba `freshnessHours` y el provider
     * de caché lo ignoraba por completo, así que la frescura era decorativa.
     * Tampoco puede ser un filtro duro: en la base real hay cuentas con 117
     * vacantes y 0 en las últimas 24 horas, así que recortar por ventana dejaría
     * la evidencia en cero. Un provider que sí consulta en vivo (Apify) puede
     * usarlo para decidir si vale la pena refrescar.
     */
    recentWindowHours: number
    maxItems: number
    correlationId: string
  }): Promise<JobPostingProviderResult>
}

/** Seis meses: la ventana con la que ya se venía rotulando `recent`. */
export const DEFAULT_RECENT_WINDOW_HOURS = 180 * 24

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

    // Ahora la ventana la decide quien llama, en vez de estar clavada acá.
    const recentCutoff = Date.now() - options.recentWindowHours * 60 * 60 * 1000
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
