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

// ═══════════════════════════════════════════════════════════
// Listado para la UI (card "Vacantes de LinkedIn" de la cuenta)
// ═══════════════════════════════════════════════════════════

export interface UiJobPosting {
  id: string
  title: string
  location: string | null
  postedAt: string | null
  url: string | null
  /** Área funcional según LinkedIn (ej. "Project Management"). */
  area: string | null
  /** Tipo de contrato (ej. "Full-time"). */
  contractType: string | null
  /** Seniority (ej. "Mid-Senior level"). */
  experienceLevel: string | null
  /** Postulantes, ya traducido (ej. "159 postulantes", "+200 postulantes"). */
  applicants: string | null
  /** Extracto de la descripción; el texto completo vive en LinkedIn (url). */
  descriptionExcerpt: string | null
}

/** Tope de descripción que viaja a la UI: las reales miden 3-6k chars. */
const DESCRIPTION_EXCERPT_CHARS = 1200

function translateApplicants(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const over = value.match(/over\s+(\d+)/i)
  if (over) return `+${over[1]} postulantes`
  const plain = value.match(/(\d+)/)
  return plain ? `${plain[1]} postulantes` : null
}

function excerpt(text: string | null): string | null {
  if (!text?.trim()) return null
  const clean = text.replace(/\r/g, "").trim()
  if (clean.length <= DESCRIPTION_EXCERPT_CHARS) return clean
  // Corta en el último espacio antes del tope para no partir una palabra.
  const cut = clean.slice(0, DESCRIPTION_EXCERPT_CHARS)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), DESCRIPTION_EXCERPT_CHARS - 40))}…`
}

/**
 * Vacantes de una cuenta en la forma que muestra la card de la pestaña
 * Señales. Lee de `job_postings` (el cache global que alimentan el CSV, el
 * botón de refresh y el cron): a diferencia de las señales fit, esto NO
 * depende de que la cuenta tenga research corrido — es el feedback inmediato
 * de que el scraping funcionó.
 *
 * Los metadatos (área, contrato, seniority, postulantes) vienen del
 * `source_data` del actor ya como texto legible; se pasan tal cual.
 */
export async function listAccountJobPostings(
  companyId: string,
  limit = 100,
): Promise<{ postings: UiJobPosting[]; total: number }> {
  const admin = createAdminClient()

  const [{ data, error }, { count }] = await Promise.all([
    admin
      .from("job_postings")
      .select("id, title, description, location, posted_at, job_url, source_data")
      .eq("company_id", companyId)
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(limit),
    admin
      .from("job_postings")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId),
  ])

  if (error) {
    console.error("[v3] Error listando vacantes para la UI:", error.message)
    return { postings: [], total: 0 }
  }

  const postings: UiJobPosting[] = (data ?? []).map((row) => {
    const source = (row.source_data ?? {}) as Record<string, unknown>
    const str = (key: string): string | null => {
      const value = source[key]
      return typeof value === "string" && value.trim() ? value.trim() : null
    }
    return {
      id: row.id,
      title: row.title,
      location: row.location ?? null,
      postedAt: row.posted_at ?? null,
      url: row.job_url ?? null,
      area: str("workType") ?? str("work_mode"),
      contractType: str("contractType") ?? str("job_type"),
      experienceLevel: str("experienceLevel") ?? str("experience_level"),
      applicants: translateApplicants(source["applicationsCount"] ?? source["applications_count"]),
      descriptionExcerpt: excerpt(row.description),
    }
  })

  return { postings, total: count ?? postings.length }
}
