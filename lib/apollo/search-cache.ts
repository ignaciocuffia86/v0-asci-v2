/**
 * Cache determinístico de búsquedas Apollo por query_hash (Fase 2).
 *
 * Reemplaza al cache legacy `apollo_contacts_cache` + `job_titles_searched`
 * que no era determinístico respecto a la query.
 *
 * Tablas:
 *   - apollo_search_queries: una fila por query_hash con TTL y stats.
 *   - apollo_search_results: join N:M entre query y contactos cacheados.
 *   - apollo_contacts_cache: datos de los contactos (ya existía).
 *
 * Regla de cache: hit binario (ALL or nothing) — mismo query_hash dentro
 * del TTL → servir todo lo cacheado. Sin criterios fuzzy.
 */

import { createAdminClient } from "@/lib/supabase/admin"
import type { EnrichedPerson } from "./enrich"
import type { SearchParams } from "./query-hash"

const DEFAULT_TTL_DAYS = 14

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type SearchCacheHit = {
  hit: true
  fetchedAt: Date
  totalEntries: number
  contacts: EnrichedPerson[]
}

export type SearchCacheMiss = { hit: false }

export async function readSearchCache(
  queryHash: string,
  ttlDays: number = DEFAULT_TTL_DAYS,
): Promise<SearchCacheHit | SearchCacheMiss> {
  const supabase = createAdminClient()

  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString()

  const { data: query } = await supabase
    .from("apollo_search_queries")
    .select("last_fetched_at, total_entries, result_count")
    .eq("query_hash", queryHash)
    .gte("last_fetched_at", cutoff)
    .maybeSingle()

  if (!query) return { hit: false }

  // Traer los apollo_ids asociados a esta query
  const { data: resultRows } = await supabase
    .from("apollo_search_results")
    .select("apollo_person_id")
    .eq("query_hash", queryHash)

  if (!resultRows || resultRows.length === 0) {
    // Miss "con 0 resultados" válido: la query fue ejecutada, total_entries == 0.
    // Devolvemos hit vacío para evitar reintentar.
    if (query.total_entries === 0) {
      return {
        hit: true,
        fetchedAt: new Date(query.last_fetched_at),
        totalEntries: 0,
        contacts: [],
      }
    }
    return { hit: false }
  }

  const apolloIds = resultRows.map((r) => r.apollo_person_id)

  const { data: contacts } = await supabase
    .from("apollo_contacts_cache")
    .select("*")
    .in("apollo_id", apolloIds)

  if (!contacts) return { hit: false }

  return {
    hit: true,
    fetchedAt: new Date(query.last_fetched_at),
    totalEntries: query.total_entries ?? contacts.length,
    contacts: contacts.map(contactRowToEnriched),
  }
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export async function writeSearchCache(opts: {
  queryHash: string
  params: SearchParams & { companyId: string | null }
  totalEntries: number
  contacts: EnrichedPerson[]
}): Promise<void> {
  const supabase = createAdminClient()
  const now = new Date().toISOString()

  // 1) Upsert de la fila principal
  await supabase.from("apollo_search_queries").upsert(
    {
      query_hash: opts.queryHash,
      company_id: opts.params.companyId,
      organization_id: opts.params.organizationId,
      domain: opts.params.domain,
      job_titles: opts.params.jobTitles,
      country: opts.params.country,
      seniorities: opts.params.seniorities ?? [],
      departments: opts.params.departments ?? [],
      use_organization_location: opts.params.useOrganizationLocation ?? false,
      include_similar_titles: opts.params.includeSimilarTitles ?? true,
      total_entries: opts.totalEntries,
      result_count: opts.contacts.length,
      last_fetched_at: now,
      updated_at: now,
    },
    { onConflict: "query_hash" },
  )

  // 2) Limpiar resultados previos de esta query y escribir los nuevos
  await supabase.from("apollo_search_results").delete().eq("query_hash", opts.queryHash)

  if (opts.contacts.length === 0) return

  const rows = opts.contacts
    .filter((c) => c.apolloId)
    .map((c, i) => ({
      query_hash: opts.queryHash,
      apollo_person_id: c.apolloId,
      rank: i,
    }))

  if (rows.length > 0) {
    await supabase.from("apollo_search_results").insert(rows)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function contactRowToEnriched(c: Record<string, unknown>): EnrichedPerson {
  return {
    apolloId: (c.apollo_id as string) || (c.id as string),
    firstName: (c.first_name as string) || null,
    lastName: (c.last_name as string) || null,
    fullName:
      (c.full_name as string) ||
      [c.first_name, c.last_name].filter(Boolean).join(" ") ||
      "Sin nombre",
    title: (c.title as string) || null,
    headline: (c.headline as string) || null,
    email: (c.email as string) || null,
    emailStatus: (c.email_status as string) || null,
    linkedinUrl: (c.linkedin_url as string) || null,
    photoUrl: (c.profile_picture_url as string) || null,
    city: (c.city as string) || null,
    state: (c.state as string) || null,
    country: (c.country as string) || null,
    seniority: (c.seniority as string) || null,
    departments: (c.departments as string[]) || [],
    mobilePhone: (c.mobile_phone as string) || null,
    workPhone: (c.phone as string) || null,
    organizationId: null,
    enrichmentStatus: "ok",
  }
}
