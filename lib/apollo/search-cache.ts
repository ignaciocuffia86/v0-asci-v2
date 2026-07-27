/**
 * Cache determinístico de búsquedas Apollo por query_hash (Fase 2).
 *
 * ⚠️ CORRECCIÓN (auditoría Fase 3): esta capa NUNCA funcionó.
 *
 * El código anterior escribía y leía columnas que no existen en las tablas reales:
 *
 *   escribía            → tabla real
 *   company_id          → (no existe)
 *   domain              → (no existe)
 *   job_titles          → person_titles
 *   country             → person_locations / organization_locations
 *   seniorities         → person_seniorities
 *   departments         → person_departments
 *   last_fetched_at     → fetched_at
 *   updated_at          → (no existe; hay expires_at)
 *   use_organization_location → (no existe)
 *
 * Y en apollo_search_results escribía `query_hash / apollo_person_id / rank`
 * cuando la tabla real usa `query_id / contact_cache_id / position`.
 *
 * Como el cliente de Supabase no lanza excepción ante error (devuelve `{ error }`)
 * y estas llamadas no chequeaban el resultado, todos los writes fallaban en
 * silencio y todos los reads devolvían miss. Evidencia en producción:
 * apollo_search_queries = 0 filas y apollo_search_results = 0 filas, contra
 * 4.389 contactos en apollo_contacts_cache. Es decir: cada búsqueda repetida
 * volvía a pagarle a Apollo.
 *
 * Esta versión mapea las columnas reales y valida los errores en lugar de
 * tragarlos.
 *
 * Tablas:
 *   - apollo_search_queries: una fila por query_hash con TTL y stats.
 *   - apollo_search_results: join N:M (query_id → contact_cache_id).
 *   - apollo_contacts_cache: datos de los contactos.
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
  const nowIso = new Date().toISOString()

  // Se exige TTL del caller (fetched_at) Y el TTL propio de la fila (expires_at).
  // El más restrictivo gana: nunca servimos datos que la DB ya declaró vencidos.
  const { data: query, error: queryError } = await supabase
    .from("apollo_search_queries")
    .select("id, fetched_at, total_entries, result_count")
    .eq("query_hash", queryHash)
    .gte("fetched_at", cutoff)
    .gt("expires_at", nowIso)
    .maybeSingle()

  if (queryError) {
    console.log("[v0] readSearchCache: error leyendo query", queryError.message)
    return { hit: false }
  }
  if (!query) return { hit: false }

  const { data: resultRows, error: resultsError } = await supabase
    .from("apollo_search_results")
    .select("contact_cache_id, position")
    .eq("query_id", query.id)
    .order("position", { ascending: true })

  if (resultsError) {
    console.log("[v0] readSearchCache: error leyendo results", resultsError.message)
    return { hit: false }
  }

  if (!resultRows || resultRows.length === 0) {
    // Miss "con 0 resultados" válido: la query fue ejecutada, total_entries == 0.
    // Devolvemos hit vacío para evitar reintentar y volver a pagar.
    if (query.total_entries === 0) {
      return {
        hit: true,
        fetchedAt: new Date(query.fetched_at),
        totalEntries: 0,
        contacts: [],
      }
    }
    return { hit: false }
  }

  const cacheIds = resultRows.map((r) => r.contact_cache_id)

  const { data: contacts, error: contactsError } = await supabase
    .from("apollo_contacts_cache")
    .select("*")
    .in("id", cacheIds)

  if (contactsError || !contacts) return { hit: false }

  // Respetar el orden original de Apollo (position).
  const byId = new Map(contacts.map((c) => [c.id as string, c]))
  const ordered = resultRows
    .map((r) => byId.get(r.contact_cache_id))
    .filter((c): c is Record<string, unknown> => Boolean(c))

  return {
    hit: true,
    fetchedAt: new Date(query.fetched_at),
    totalEntries: query.total_entries ?? ordered.length,
    contacts: ordered.map(contactRowToEnriched),
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
  pagesFetched?: number
  fetchedBy?: string | null
}): Promise<void> {
  const supabase = createAdminClient()
  const now = new Date()
  const ttlMs = DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000

  // El país va a person_locations u organization_locations según cómo se filtró.
  const locations = opts.params.country ? [opts.params.country] : []
  const useOrgLocation = opts.params.useOrganizationLocation === true

  // 1) Upsert de la fila principal (query_hash es UNIQUE).
  const { data: queryRow, error: queryError } = await supabase
    .from("apollo_search_queries")
    .upsert(
      {
        query_hash: opts.queryHash,
        organization_id: opts.params.organizationId,
        person_titles: opts.params.jobTitles ?? [],
        person_locations: useOrgLocation ? [] : locations,
        organization_locations: useOrgLocation ? locations : [],
        person_seniorities: opts.params.seniorities ?? [],
        person_departments: opts.params.departments ?? [],
        // `=== true` para reflejar el request real: search.ts solo envía el flag
        // cuando es true. Un `?? true` registraría auditoría incorrecta.
        include_similar_titles: opts.params.includeSimilarTitles === true,
        reveal_email: opts.params.revealEmail === true,
        reveal_phone: opts.params.revealPhone === true,
        total_entries: opts.totalEntries,
        result_count: opts.contacts.length,
        pages_fetched: opts.pagesFetched ?? 1,
        fetched_at: now.toISOString(),
        fetched_by: opts.fetchedBy ?? null,
        expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      },
      { onConflict: "query_hash" },
    )
    .select("id")
    .single()

  if (queryError || !queryRow) {
    // Antes esto se tragaba en silencio y el caché quedaba vacío para siempre.
    console.log("[v0] writeSearchCache: no se pudo guardar la query", queryError?.message)
    return
  }

  // 2) Limpiar resultados previos de esta query.
  await supabase.from("apollo_search_results").delete().eq("query_id", queryRow.id)

  if (opts.contacts.length === 0) return

  // 3) Resolver el contact_cache_id de cada persona.
  //
  // Solo se INSERTAN los contactos que falten. Nunca se actualizan los
  // existentes: apollo_contacts_cache es compartida con v2 y tiene columnas
  // propias de ese flujo (job_titles_searched, company_domain) que no debemos
  // sobrescribir desde acá.
  const apolloIds = opts.contacts.map((c) => c.apolloId).filter(Boolean)
  if (apolloIds.length === 0) return

  const { data: existing } = await supabase
    .from("apollo_contacts_cache")
    .select("id, apollo_id")
    .in("apollo_id", apolloIds)

  const idByApolloId = new Map((existing ?? []).map((r) => [r.apollo_id as string, r.id as string]))

  const missing = opts.contacts.filter((c) => c.apolloId && !idByApolloId.has(c.apolloId))
  if (missing.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from("apollo_contacts_cache")
      .upsert(
        missing.map((c) => ({
          apollo_id: c.apolloId,
          first_name: c.firstName,
          last_name: c.lastName,
          full_name: c.fullName,
          title: c.title,
          headline: c.headline,
          email: c.email,
          email_status: c.emailStatus,
          phone: c.workPhone,
          mobile_phone: c.mobilePhone,
          linkedin_url: c.linkedinUrl,
          profile_picture_url: c.photoUrl,
          city: c.city,
          state: c.state,
          country: c.country,
          seniority: c.seniority,
          departments: c.departments ?? [],
        })),
        { onConflict: "apollo_id", ignoreDuplicates: true },
      )
      .select("id, apollo_id")

    if (insertError) {
      console.log("[v0] writeSearchCache: error insertando contactos", insertError.message)
    }
    for (const row of inserted ?? []) {
      idByApolloId.set(row.apollo_id as string, row.id as string)
    }

    // `ignoreDuplicates` no devuelve las filas que ya existían por carrera
    // concurrente: releemos los que sigan sin id.
    const stillMissing = missing.map((c) => c.apolloId).filter((id) => !idByApolloId.has(id))
    if (stillMissing.length > 0) {
      const { data: refetched } = await supabase
        .from("apollo_contacts_cache")
        .select("id, apollo_id")
        .in("apollo_id", stillMissing)
      for (const row of refetched ?? []) {
        idByApolloId.set(row.apollo_id as string, row.id as string)
      }
    }
  }

  const rows = opts.contacts
    .map((c, i) => {
      const cacheId = idByApolloId.get(c.apolloId)
      return cacheId ? { query_id: queryRow.id, contact_cache_id: cacheId, position: i } : null
    })
    .filter((r): r is { query_id: string; contact_cache_id: string; position: number } => r !== null)

  if (rows.length > 0) {
    const { error: linkError } = await supabase
      .from("apollo_search_results")
      .upsert(rows, { onConflict: "query_id,contact_cache_id" })
    if (linkError) {
      console.log("[v0] writeSearchCache: error vinculando resultados", linkError.message)
    }
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
