import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { resolveCompanyOrganizationId } from "@/lib/apollo/organizations"
import { searchPeople } from "@/lib/apollo/search"
import { enrichMany, type EnrichedPerson } from "@/lib/apollo/enrich"
import { sanitizeTitleList } from "@/lib/apollo/title-validator"
import { normalizeDomain } from "@/lib/apollo/domain"
import { hashSearchParams } from "@/lib/apollo/query-hash"
import { readSearchCache, writeSearchCache } from "@/lib/apollo/search-cache"
import { recordTitleObservations, recordTitleSuccess } from "@/lib/apollo/title-catalog"

/**
 * Búsqueda de decisores en Apollo. ÚNICA en el sistema: la usan el tab de
 * prospectos de v2 y la sección de decisores del bookmark de v3.
 *
 * ── Por qué está acá y no duplicada ──
 * Este flujo es el que está bien resuelto: resuelve la organización antes de
 * buscar (mucho más preciso que el dominio), cachea por `query_hash`
 * determinístico para no repagar la misma búsqueda, enriquece en lotes de 4 y
 * deduplica con una clave fuerte. Copiarlo a v3 habría sido la tercera vez que
 * este repo paga el precio de tener dos implementaciones del mismo pipeline
 * (pasó con las noticias y con el research). v2 quedó como wrapper que resuelve
 * el bookmark; v3 llama derecho con el companyId.
 *
 * ── Nota de deprecación heredada ──
 * El reveal de teléfono fue removido: Apollo consumía créditos (5 por reveal)
 * pero el webhook de entrega asincrónica nunca llegaba, pese a probar todas las
 * variantes documentadas. Sólo se enriquece email + datos básicos.
 */

export type ApolloSearchOptions = {
  revealEmail?: boolean
  useOrganizationLocation?: boolean
  includeSimilarTitles?: boolean
  seniorities?: string[]
  departments?: string[]
  forceRefresh?: boolean
  maxResults?: number
}

export type ApolloSearchStats = {
  queryHash: string
  fromCache: boolean
  apolloCalled: boolean
  totalEntries: number
  apiReturned: number
  enrichedOk: number
  enrichedFailed: number
  saved: number
  skippedDuplicates: number
  organizationNotFound: boolean
  rejectedTitles: Array<{ input: string; reason: string }>
  requestPreview: Record<string, unknown> | null
  warnings: string[]
}

export type DecisionMakerSearchInput = {
  companyId: string
  /** Dueño de las filas en `user_company_contacts`. */
  userId: string
  /** Bookmark de v2 al que atribuir la búsqueda. v3 pasa null. */
  bookmarkId: string | null
  /** `bookmarks.search_context` de v2; v3 no tiene equivalente y pasa null. */
  searchContext?: unknown
  jobTitles: string[]
  customJobTitles?: string[]
  countryFilter?: string | null
  options?: ApolloSearchOptions
}

export type DecisionMakerSearchResult = {
  success: boolean
  count: number
  error?: string
  stats?: ApolloSearchStats
}

function emptyStats(overrides: Partial<ApolloSearchStats> = {}): ApolloSearchStats {
  return {
    queryHash: "",
    fromCache: false,
    apolloCalled: false,
    totalEntries: 0,
    apiReturned: 0,
    enrichedOk: 0,
    enrichedFailed: 0,
    saved: 0,
    skippedDuplicates: 0,
    organizationNotFound: false,
    rejectedTitles: [],
    requestPreview: null,
    warnings: [],
    ...overrides,
  }
}

/**
 * Cache legacy en `apollo_contacts_cache`, indexado por dominio de la empresa.
 *
 * No es sólo compatibilidad: **es la tabla que lee v3** para mostrar los
 * contactos de una cuenta (`getCompanyCachedContacts`). Escribir acá es lo que
 * hace que un decisor encontrado desde cualquiera de los dos mundos aparezca en
 * el bookmark del otro.
 */
async function saveToLegacyCache(
  contacts: EnrichedPerson[],
  companyDomain: string | null,
  companyLinkedIn: string | null,
  jobTitles: string[],
): Promise<void> {
  const supabase = createAdminClient()

  for (const contact of contacts) {
    if (!contact.lastName && !contact.linkedinUrl && !contact.email) continue

    await supabase.from("apollo_contacts_cache").upsert(
      {
        apollo_id: contact.apolloId,
        company_domain: companyDomain,
        company_linkedin_url: companyLinkedIn,
        first_name: contact.firstName,
        last_name: contact.lastName,
        full_name: contact.fullName,
        title: contact.title,
        headline: contact.headline,
        email: contact.email,
        email_status: contact.emailStatus,
        phone: contact.workPhone,
        mobile_phone: contact.mobilePhone,
        linkedin_url: contact.linkedinUrl,
        profile_picture_url: contact.photoUrl,
        city: contact.city,
        state: contact.state,
        country: contact.country,
        seniority: contact.seniority,
        departments: contact.departments,
        organization_name: null,
        job_titles_searched: jobTitles,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "apollo_id" },
    )
  }
}

export async function searchDecisionMakers(
  input: DecisionMakerSearchInput,
): Promise<DecisionMakerSearchResult> {
  const { companyId, userId, bookmarkId, jobTitles, customJobTitles, countryFilter } = input
  const options = input.options ?? {}
  const supabase = createAdminClient()

  const { data: company } = await supabase
    .from("companies")
    .select("id, name, website, linkedin_url")
    .eq("id", companyId)
    .single()

  if (!company) {
    return { success: false, count: 0, error: "Compañía no encontrada" }
  }

  // --- 1. Sanitizar titles
  const rawTitles = customJobTitles?.length ? customJobTitles : jobTitles
  const sanitized = sanitizeTitleList(rawTitles)
  const warnings: string[] = []

  if (sanitized.accepted.length === 0) {
    return {
      success: false,
      count: 0,
      error: "Ningún título de cargo válido. Revisá la selección.",
      stats: emptyStats({ rejectedTitles: sanitized.rejected }),
    }
  }

  if (sanitized.truncated) {
    warnings.push(`Se enviaron los primeros ${sanitized.accepted.length} títulos (máximo soportado).`)
  }

  // --- 2. Resolver organization_id
  const orgResult = await resolveCompanyOrganizationId(company.id, {
    userId,
    bookmarkId,
    forceRefresh: options.forceRefresh,
  })

  let organizationId: string | null = null
  if (orgResult.status === "found") {
    organizationId = orgResult.organizationId
  } else if (orgResult.status === "not_found") {
    warnings.push("Empresa no indexada en Apollo. Buscando por dominio (puede traer resultados menos precisos).")
  } else {
    warnings.push(`No se pudo resolver la empresa en Apollo: ${orgResult.reason}`)
  }

  // --- 3. Fallback de dominio
  const normalized = normalizeDomain(company.website)
  const domain = normalized?.primary || null

  // --- 4. Cache determinístico por query_hash
  const searchParams = {
    organizationId,
    domain,
    jobTitles: sanitized.accepted,
    country: countryFilter ?? null,
    seniorities: options.seniorities,
    departments: options.departments,
    // Default OFF: la UI lo expone como toggle avanzado. Evita falsos positivos.
    includeSimilarTitles: options.includeSimilarTitles === true,
    useOrganizationLocation: options.useOrganizationLocation ?? false,
  }
  const queryHash = hashSearchParams(searchParams)

  let contacts: EnrichedPerson[] = []
  let fromCache = false
  let apolloCalled = false
  let totalEntries = 0
  let apiReturned = 0
  let enrichedOk = 0
  let enrichedFailed = 0
  let requestPreview: Record<string, unknown> | null = null

  const cacheHit = options.forceRefresh ? { hit: false as const } : await readSearchCache(queryHash)

  if (cacheHit.hit) {
    contacts = cacheHit.contacts
    totalEntries = cacheHit.totalEntries
    fromCache = true
  } else {
    apolloCalled = true
    const searchRes = await searchPeople({
      organizationId,
      domain,
      jobTitles: sanitized.accepted,
      country: countryFilter ?? null,
      seniorities: options.seniorities,
      departments: options.departments,
      includeSimilarTitles: options.includeSimilarTitles === true,
      useOrganizationLocation: options.useOrganizationLocation ?? false,
      userId,
      bookmarkId,
      companyId: company.id,
      maxResults: options.maxResults ?? 50,
    })

    if (!searchRes.ok) {
      return {
        success: false,
        count: 0,
        error: `Apollo search falló: ${searchRes.error}`,
        stats: emptyStats({
          queryHash,
          apolloCalled: true,
          organizationNotFound: orgResult.status === "not_found",
          rejectedTitles: sanitized.rejected,
          warnings,
        }),
      }
    }

    totalEntries = searchRes.totalEntries
    apiReturned = searchRes.people.length
    requestPreview = searchRes.requestBody

    // --- 5. Enrichment (solo email + datos basicos; phone reveal deprecado)
    const enriched = await enrichMany(
      searchRes.people,
      {
        userId,
        bookmarkId,
        companyId: company.id,
        revealEmail: options.revealEmail ?? true,
      },
      4,
    )

    for (const p of enriched) {
      if (p.enrichmentStatus === "ok") enrichedOk++
      else enrichedFailed++
    }

    contacts = enriched.filter((p) => p.lastName || p.linkedinUrl || p.email)

    if (contacts.length > 0) {
      await saveToLegacyCache(contacts, domain, company.linkedin_url, sanitized.accepted)
    }

    // Siempre escribir al cache determinístico, incluso con 0 resultados
    // (evita reintentar la misma query durante el TTL).
    await writeSearchCache({
      queryHash,
      params: { ...searchParams, companyId: company.id },
      totalEntries,
      contacts,
    })
  }

  // --- 6. Persist en user_company_contacts con dedup
  let saved = 0
  let skippedDuplicates = 0

  for (const contact of contacts) {
    if (!contact.lastName && !contact.linkedinUrl && !contact.email) continue

    // Dedup prioriza apollo_person_id (key fuerte), luego linkedin_url, luego full_name
    let existingQuery = supabase
      .from("user_company_contacts")
      .select("id")
      .eq("user_id", userId)
      .eq("company_id", company.id)

    if (contact.apolloId) {
      existingQuery = existingQuery.eq("apollo_person_id", contact.apolloId)
    } else if (contact.linkedinUrl) {
      existingQuery = existingQuery.eq("linkedin_url", contact.linkedinUrl)
    } else {
      existingQuery = existingQuery.eq("full_name", contact.fullName)
    }

    const { data: existing } = await existingQuery.maybeSingle()

    if (existing) {
      skippedDuplicates++
      continue
    }

    const { error } = await supabase.from("user_company_contacts").insert({
      user_id: userId,
      company_id: company.id,
      bookmark_id: bookmarkId,
      apollo_person_id: contact.apolloId,
      first_name: contact.firstName,
      last_name: contact.lastName,
      full_name: contact.fullName,
      role: contact.title,
      headline: contact.headline,
      email: contact.email,
      email_status: contact.emailStatus,
      phone: contact.workPhone,
      mobile_phone: contact.mobilePhone,
      // phone_status: queda NULL. La columna se mantiene en la DB para no
      // perder data historica, pero ya no se usa en nuevos flujos.
      linkedin_url: contact.linkedinUrl,
      profile_picture_url: contact.photoUrl,
      city: contact.city,
      country: contact.country,
      seniority: contact.seniority,
      departments: contact.departments,
      source: "apollo",
      status: "new",
      is_decision_maker: true,
      job_titles_searched: sanitized.accepted,
      search_context: input.searchContext ?? null,
      last_verified_at: new Date().toISOString(),
    })

    if (!error) saved++
  }

  // Feedback loop al catálogo: se registran títulos observados y éxito. Va
  // después del save para no bloquear la persistencia, y fire-and-forget porque
  // un problema del catálogo no debe romper una búsqueda que ya se pagó.
  if (contacts.length > 0) {
    const observations = contacts
      .filter((c) => c.title)
      .map((c) => ({
        title: c.title!,
        seniority: c.seniority,
        departments: c.departments,
      }))
    recordTitleObservations(observations).catch(() => {})
    recordTitleSuccess(sanitized.accepted, totalEntries).catch(() => {})
  }

  return {
    success: true,
    count: saved,
    stats: {
      queryHash,
      fromCache,
      apolloCalled,
      totalEntries,
      apiReturned,
      enrichedOk,
      enrichedFailed,
      saved,
      skippedDuplicates,
      organizationNotFound: orgResult.status === "not_found",
      rejectedTitles: sanitized.rejected,
      requestPreview,
      warnings,
    },
  }
}
