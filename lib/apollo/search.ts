/**
 * Búsqueda de personas en Apollo.
 *
 * Usa `/mixed_people/search` (endpoint estándar, el que usa la UI) en lugar
 * de `api_search`. Prefiere `organization_ids` sobre `q_organization_name`
 * para lograr paridad con la UI.
 *
 * Pagina automáticamente hasta `maxResults` (default 50).
 */

import { apolloRequest } from "./client"
import { parseSearchResponse, type ApolloPersonNormalized } from "./parsers"
import { hashSearchParams, type SearchParams } from "./query-hash"

const PER_PAGE = 25
const DEFAULT_MAX = 50

export type SearchPeopleOpts = SearchParams & {
  userId: string | null
  bookmarkId: string | null
  companyId: string | null
  maxResults?: number
}

export type SearchPeopleResult =
  | {
      ok: true
      people: ApolloPersonNormalized[]
      totalEntries: number
      pagesFetched: number
      queryHash: string
      requestBody: Record<string, unknown>
    }
  | { ok: false; error: string; status: number; queryHash: string }

export async function searchPeople(opts: SearchPeopleOpts): Promise<SearchPeopleResult> {
  const queryHash = hashSearchParams(opts)
  const maxResults = opts.maxResults ?? DEFAULT_MAX

  // Construir payload base. Preferir organization_ids sobre domain/name.
  const base: Record<string, unknown> = {
    per_page: PER_PAGE,
    page: 1,
  }

  if (opts.organizationId) {
    base.organization_ids = [opts.organizationId]
  } else if (opts.domain) {
    // Fallback: lista de dominios (parametro plural, preferido por Apollo)
    base.q_organization_domains_list = [opts.domain]
  }

  if (opts.jobTitles.length > 0) {
    base.person_titles = opts.jobTitles
    base.include_similar_titles = opts.includeSimilarTitles ?? true
  }

  if (opts.seniorities && opts.seniorities.length > 0) {
    base.person_seniorities = opts.seniorities
  }

  if (opts.departments && opts.departments.length > 0) {
    base.person_departments = opts.departments
  }

  if (opts.country) {
    const key = opts.useOrganizationLocation ? "organization_locations" : "person_locations"
    base[key] = [opts.country]
  }

  const allPeople: ApolloPersonNormalized[] = []
  let totalEntries = 0
  let page = 1
  let pagesFetched = 0
  let firstRequestBody: Record<string, unknown> = base

  while (allPeople.length < maxResults) {
    const requestBody = { ...base, page }
    if (page === 1) firstRequestBody = requestBody

    const res = await apolloRequest<unknown>({
      endpoint: "mixed_people/search",
      method: "POST",
      userId: opts.userId,
      bookmarkId: opts.bookmarkId,
      companyId: opts.companyId,
      requestBody,
      queryHash,
      creditsEstimated: 0, // search no consume credits por persona; cobra enrichment
      extraMetadata: { page },
    })

    if (!res.ok) {
      return { ok: false, error: res.error, status: res.status, queryHash }
    }

    const parsed = parseSearchResponse(res.data)
    pagesFetched++
    totalEntries = parsed.totalEntries

    if (parsed.people.length === 0) break

    for (const p of parsed.people) {
      if (allPeople.length >= maxResults) break
      allPeople.push(p)
    }

    if (allPeople.length >= totalEntries) break
    if (parsed.people.length < PER_PAGE) break // última página
    page++
    if (page > 10) break // safety: máx 250 resultados
  }

  return {
    ok: true,
    people: allPeople,
    totalEntries,
    pagesFetched,
    queryHash,
    requestBody: firstRequestBody,
  }
}
