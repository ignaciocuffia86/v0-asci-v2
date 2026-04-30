"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateGeminiContent } from "@/lib/ai-service"
import { resolveCompanyOrganizationId } from "@/lib/apollo/organizations"
import { searchPeople } from "@/lib/apollo/search"
import { enrichMany, type EnrichedPerson } from "@/lib/apollo/enrich"
import { sanitizeTitleList } from "@/lib/apollo/title-validator"
import { normalizeDomain } from "@/lib/apollo/domain"
import { hashSearchParams } from "@/lib/apollo/query-hash"
import { readSearchCache, writeSearchCache } from "@/lib/apollo/search-cache"
import { recordTitleObservations, recordTitleSuccess } from "@/lib/apollo/title-catalog"
import { apolloRequest } from "@/lib/apollo/client"

// ---------------------------------------------------------------------------
// Tipos expuestos a la UI
// ---------------------------------------------------------------------------

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

export type ApolloSearchOptions = {
  revealEmail?: boolean
  useOrganizationLocation?: boolean
  includeSimilarTitles?: boolean
  seniorities?: string[]
  departments?: string[]
  forceRefresh?: boolean
  maxResults?: number
}

// ---------------------------------------------------------------------------
// inferJobTitles (intacto, misma firma)
// ---------------------------------------------------------------------------

export async function inferJobTitles(
  technologies: string[],
  processes: string[],
  valueProfile?: {
    profileSummary: string
    targetTechnologies: string[]
    targetProcesses: string[]
  } | null,
): Promise<{ jobTitles: string[]; reasoning: string }> {
  const isGeneralBookmark = technologies.length === 0 && processes.length === 0

  const valueProfileSection = valueProfile
    ? `\n=== PROPUESTA DE VALOR DEL VENDEDOR ===
Lo que vendo/ofrezco: ${valueProfile.profileSummary || "No definido"}
Tecnologias que manejo: ${valueProfile.targetTechnologies.join(", ") || "No definidas"}
Procesos que resuelvo: ${valueProfile.targetProcesses.join(", ") || "No definidos"}

IMPORTANTE: Usa esta informacion para recomendar job titles que sean COMPRADORES de lo que el vendedor ofrece.
Por ejemplo: si el vendedor implementa SAP y la empresa tiene senales de SAP, recomienda roles que deciden sobre SAP (Director de Sistemas, Gerente de ERP, etc.).
Si el vendedor ofrece automatizacion de procesos financieros, recomienda CFO, Controller, Director de Finanzas, etc.`
    : ""

  const prompt = `Eres un experto en estructuras organizacionales B2B en empresas de Latinoamerica.
Dado el contexto de busqueda (tecnologias y/o procesos de la empresa target) y la propuesta de valor del vendedor, devuelve los job titles mas relevantes de tomadores de decision.

=== SENALES DE LA EMPRESA TARGET ===
- Tecnologias detectadas: ${technologies.length > 0 ? technologies.join(", ") : "No especificadas"}
- Procesos detectados: ${processes.length > 0 ? processes.join(", ") : "No especificados"}
- Tipo de busqueda: ${isGeneralBookmark ? "BUSQUEDA GENERAL (sin filtros especificos)" : "Busqueda filtrada"}
${valueProfileSection}

=== REGLAS CRITICAS ===

1. Los job titles DEBEN estar en el formato que las personas usan en LinkedIn en Latinoamerica. Incluir SIEMPRE variantes en espanol Y en ingles porque en LATAM se usan ambos indistintamente:
   - Para TI: "Director de TI", "Director de Sistemas", "Director de IT", "IT Manager", "Gerente de Sistemas", "Jefe de Sistemas", "CTO"
   - Para Finanzas: "Director de Finanzas", "CFO", "Gerente de Finanzas", "Controller", "Contralor"
   - Para Operaciones: "Director de Operaciones", "COO", "Gerente de Operaciones", "VP Operaciones"
   - Para RRHH: "Director de RRHH", "Director de Recursos Humanos", "CHRO", "Gerente de Capital Humano", "VP People"
   - Para Compras: "Director de Compras", "Procurement Manager", "Gerente de Abastecimiento"
   - Para Comercial: "Director Comercial", "VP Sales", "Gerente Comercial", "Chief Revenue Officer"

2. SI HAY PROPUESTA DE VALOR DEL VENDEDOR: Prioriza roles que COMPRAN lo que el vendedor ofrece, no solo roles relacionados con la tecnologia detectada.

3. SI ES BUSQUEDA GENERAL: Incluir C-Level y Directores principales en espanol e ingles.

4. Incluir variantes como las personas realmente ponen en LinkedIn (abreviaciones, mezcla de idiomas, cargo con "de" o sin "de").

5. IMPORTANTE: Los job titles deben tener entre 2 y 4 palabras. NUNCA uses titulos largos como "Director de Tecnologia y Transformacion Digital" — esos strings no estan indexados en Apollo y devuelven 0 resultados. Usa la forma corta ("IT Director", "Director de TI").

6. Maximo 12 job titles, ordenados por relevancia para la venta.

Devuelve SOLO un JSON valido con este formato exacto:
{
  "jobTitles": ["Director de TI", "IT Manager", "CTO", "Gerente de Sistemas", "..."],
  "reasoning": "Breve explicacion de por que estos roles son los compradores mas relevantes (1-2 oraciones en espanol)"
}`

  try {
    const text = await generateGeminiContent(prompt, "gemini-2.5-flash", 0.5)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      const sanitized = sanitizeTitleList(parsed.jobTitles || [])
      return {
        jobTitles: sanitized.accepted,
        reasoning: parsed.reasoning || "",
      }
    }
  } catch (error) {
    console.error("Error inferring job titles with Gemini:", error)
    try {
      const text = await generateGeminiContent(prompt, "gemini-2.0-flash", 0.5)
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        const sanitized = sanitizeTitleList(parsed.jobTitles || [])
        return {
          jobTitles: sanitized.accepted,
          reasoning: parsed.reasoning || "",
        }
      }
    } catch (fallbackError) {
      console.error("Fallback Gemini also failed:", fallbackError)
    }
  }

  if (isGeneralBookmark) {
    return {
      jobTitles: ["CEO", "Director General", "COO", "Director de Operaciones", "CFO", "Director de Finanzas", "CTO", "Director de TI"],
      reasoning: "Job titles de C-Level y directivos por defecto para busqueda general (espanol e ingles)",
    }
  }

  return {
    jobTitles: ["CTO", "Director de TI", "IT Manager", "Gerente de Sistemas"],
    reasoning: "Job titles genericos por defecto en formato LATAM",
  }
}

// ---------------------------------------------------------------------------
// getBookmarkSearchContext
// DEPRECATED: usar getProspectsTabData que consolida en 1 round-trip.
// Se mantiene por si algún consumer aislado lo usa. No llamar desde código nuevo.
// ---------------------------------------------------------------------------

export async function getBookmarkSearchContext(bookmarkId: string): Promise<{
  technologies: string[]
  processes: string[]
  company: { name: string; website?: string; linkedin_url?: string } | null
}> {
  const supabase = await createClient()

  const { data: bookmark } = await supabase
    .from("bookmarks")
    .select("company_id, search_context")
    .eq("id", bookmarkId)
    .single()

  if (!bookmark) {
    return { technologies: [], processes: [], company: null }
  }

  const { data: company } = await supabase
    .from("companies")
    .select("name, website, linkedin_url")
    .eq("id", bookmark.company_id)
    .single()

  const searchContext = bookmark.search_context as {
    filterType?: string
    filtersUsed?: string[]
    filterSignalIds?: string[]
  } | null

  const filterSignalIds = searchContext?.filterSignalIds || []
  const filterType = searchContext?.filterType || "general"
  const filtersUsed = searchContext?.filtersUsed || []

  let technologies: string[] = []
  let processes: string[] = []

  if (filterSignalIds.length > 0) {
    if (filterType === "process") {
      const { data: procs } = await supabase.from("dictionary_processes").select("name").in("id", filterSignalIds)
      processes = procs?.map((p) => p.name) || filtersUsed
    } else if (filterType === "technology") {
      const { data: products } = await supabase.from("dictionary_products").select("name").in("id", filterSignalIds)
      technologies = products?.map((p) => p.name) || filtersUsed
    }
  } else if (filtersUsed.length > 0) {
    if (filterType === "process") {
      processes = filtersUsed
    } else if (filterType === "technology") {
      technologies = filtersUsed
    }
  }

  return {
    technologies,
    processes,
    company: company || null,
  }
}

// ---------------------------------------------------------------------------
// Persistencia legacy en apollo_contacts_cache (sólo para compatibilidad con
// otras queries existentes). La lectura del cache se hace ahora por query_hash.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// searchApolloProspects — orquestador principal
//
// DEPRECATION NOTE: phone reveal fue removido. Apollo consumia creditos
// (5 por reveal) pero el webhook de delivery asincrono nunca llegaba pese
// a probar todas las variantes documentadas. Solo se sigue haciendo
// enrichment de email + datos basicos.
// ---------------------------------------------------------------------------

export async function searchApolloProspects(
  bookmarkId: string,
  jobTitles: string[],
  customJobTitles?: string[],
  countryFilter?: string | null,
  options: ApolloSearchOptions = {},
): Promise<{ success: boolean; count: number; error?: string; stats?: ApolloSearchStats }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, count: 0, error: "No autorizado" }
  }

  const { data: bookmark } = await supabase
    .from("bookmarks")
    .select("company_id, search_context")
    .eq("id", bookmarkId)
    .single()

  if (!bookmark) {
    return { success: false, count: 0, error: "Bookmark no encontrado" }
  }

  const { data: company } = await supabase
    .from("companies")
    .select("id, name, website, linkedin_url")
    .eq("id", bookmark.company_id)
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
      stats: {
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
        rejectedTitles: sanitized.rejected,
        requestPreview: null,
        warnings: [],
      },
    }
  }

  if (sanitized.truncated) {
    warnings.push(`Se enviaron los primeros ${sanitized.accepted.length} títulos (máximo soportado).`)
  }

  // --- 2. Resolver organization_id
  const orgResult = await resolveCompanyOrganizationId(company.id, {
    userId: user.id,
    bookmarkId,
    forceRefresh: options.forceRefresh,
  })

  let organizationId: string | null = null
  if (orgResult.status === "found") {
    organizationId = orgResult.organizationId
  } else if (orgResult.status === "not_found") {
    warnings.push(
      "Empresa no indexada en Apollo. Buscando por dominio (puede traer resultados menos precisos).",
    )
  } else {
    warnings.push(`No se pudo resolver la empresa en Apollo: ${orgResult.reason}`)
  }

  // --- 3. Fallback de dominio
  const normalized = normalizeDomain(company.website)
  const domain = normalized?.primary || null

  // --- 4. Cache determinístico por query_hash (Fase 2)
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
      userId: user.id,
      bookmarkId,
      companyId: company.id,
      maxResults: options.maxResults ?? 50,
    })

    if (!searchRes.ok) {
      return {
        success: false,
        count: 0,
        error: `Apollo search falló: ${searchRes.error}`,
        stats: {
          queryHash,
          fromCache: false,
          apolloCalled: true,
          totalEntries: 0,
          apiReturned: 0,
          enrichedOk: 0,
          enrichedFailed: 0,
          saved: 0,
          skippedDuplicates: 0,
          organizationNotFound: orgResult.status === "not_found",
          rejectedTitles: sanitized.rejected,
          requestPreview: null,
          warnings,
        },
      }
    }

    totalEntries = searchRes.totalEntries
    apiReturned = searchRes.people.length
    requestPreview = searchRes.requestBody

    // --- 6. Enrichment (solo email + datos basicos; phone reveal deprecado)
    const enriched = await enrichMany(
      searchRes.people,
      {
        userId: user.id,
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

    // Persist a cache legacy (compatibilidad) y cache determinístico (Fase 2)
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

  // --- 7. Persist en user_company_contacts con dedup
  let saved = 0
  let skippedDuplicates = 0

  for (const contact of contacts) {
    if (!contact.lastName && !contact.linkedinUrl && !contact.email) continue

    // Dedup prioriza apollo_person_id (key fuerte), luego linkedin_url, luego full_name
    let existingQuery = supabase
      .from("user_company_contacts")
      .select("id")
      .eq("user_id", user.id)
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
      user_id: user.id,
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
      search_context: bookmark.search_context,
      last_verified_at: new Date().toISOString(),
    })

    if (!error) saved++
  }

  // Feedback loop al catálogo (Fase 4): registramos títulos observados y éxito
  // Se hace después del save para no bloquear la persistencia.
  if (contacts.length > 0) {
    const observations = contacts
      .filter((c) => c.title)
      .map((c) => ({
        title: c.title!,
        seniority: c.seniority,
        departments: c.departments,
      }))
    // Fire-and-forget: no esperamos al catálogo, no debe romper el flujo
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

// ---------------------------------------------------------------------------
// Getters y accions de prospectos (intactos)
// ---------------------------------------------------------------------------

export async function getProspects(bookmarkId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()
  if (!bookmark) return []

  const { data } = await supabase
    .from("user_company_contacts")
    .select("*")
    .eq("company_id", bookmark.company_id)
    .eq("user_id", user.id)
    .eq("is_decision_maker", true)
    .neq("status", "removed")
    .order("created_at", { ascending: false })

  return data || []
}

export async function removeProspect(prospectId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { success: false, error: "No autorizado" }

  const { error } = await supabase
    .from("user_company_contacts")
    .update({ status: "removed" })
    .eq("id", prospectId)
    .eq("user_id", user.id)

  if (error) {
    console.error("Error removing prospect:", error)
    return { success: false, error: error.message }
  }
  return { success: true }
}

export async function restoreProspect(prospectId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { success: false, error: "No autorizado" }

  const { error } = await supabase
    .from("user_company_contacts")
    .update({ status: "active" })
    .eq("id", prospectId)
    .eq("user_id", user.id)

  if (error) {
    console.error("Error restoring prospect:", error)
    return { success: false, error: error.message }
  }
  return { success: true }
}

export async function getRemovedProspects(bookmarkId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()
  if (!bookmark) return []

  const { data } = await supabase
    .from("user_company_contacts")
    .select("*")
    .eq("company_id", bookmark.company_id)
    .eq("user_id", user.id)
    .eq("is_decision_maker", true)
    .eq("status", "removed")
    .order("created_at", { ascending: false })

  return data || []
}

export async function getContactsForIcebreaker(bookmarkId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { contacts: [], prospects: [] }

  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()
  if (!bookmark) return { contacts: [], prospects: [] }

  const { data: contacts } = await supabase
    .from("contacts")
    .select(
      "id, full_name, first_name, headline, current_position_title, linkedin_url, email1, email1_status, phone1, profile_picture_url",
    )
    .eq("current_company_id", bookmark.company_id)
    .limit(50)

  const { data: prospects } = await supabase
    .from("user_company_contacts")
    .select("*")
    .eq("company_id", bookmark.company_id)
    .eq("user_id", user.id)
    .eq("is_decision_maker", true)

  return {
    contacts: contacts || [],
    prospects: (prospects || []).map((p) => ({
      ...p,
      current_position_title: p.role,
      email1: p.email,
      email1_status: p.email_status,
      phone1: p.mobile_phone || p.phone,
    })),
  }
}

// ---------------------------------------------------------------------------
// getProspectsTabData — carga optimizada para el tab de Prospectos.
//
// Reemplaza las 3 llamadas secuenciales (getBookmarkSearchContext + getProspects
// + getRemovedProspects) por 1 sola server action que:
//   1. Hace UN solo auth.getUser()
//   2. Resuelve bookmark + company en paralelo con user_company_contacts
//   3. Trae activos y removidos en un ÚNICO query a user_company_contacts
//      (filtrando por company + user + is_decision_maker y particionando
//      en memoria por status — mismo shape de datos, sin round-trip extra)
//   4. Resuelve los nombres del diccionario (processes/products) en paralelo
//
// Resultado: de ~8 queries seriadas a ~3 queries en 2 batches paralelos.
// ---------------------------------------------------------------------------

export type ProspectsTabData = {
  context: {
    technologies: string[]
    processes: string[]
    company: { name: string; website?: string; linkedin_url?: string } | null
  }
  active: Array<Record<string, unknown>>
  removed: Array<Record<string, unknown>>
}

export async function getProspectsTabData(bookmarkId: string): Promise<ProspectsTabData> {
  const emptyResponse: ProspectsTabData = {
    context: { technologies: [], processes: [], company: null },
    active: [],
    removed: [],
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return emptyResponse

  // Primera consulta: necesitamos company_id y search_context del bookmark
  // antes de poder pedir todo lo demás (el resto depende de company_id).
  const { data: bookmark } = await supabase
    .from("bookmarks")
    .select("company_id, search_context")
    .eq("id", bookmarkId)
    .single()

  if (!bookmark) return emptyResponse

  const searchContext = bookmark.search_context as {
    filterType?: string
    filtersUsed?: string[]
    filterSignalIds?: string[]
  } | null

  const filterSignalIds = searchContext?.filterSignalIds || []
  const filterType = searchContext?.filterType || "general"
  const filtersUsed = searchContext?.filtersUsed || []

  // Dos fetches absolutamente paralelos (no dependen uno del otro):
  //   - company info
  //   - user_company_contacts (trae activos + removidos en una sola pasada)
  // Si hay filter signals, pedimos también el diccionario en paralelo.
  const needsDictionary =
    filterSignalIds.length > 0 &&
    (filterType === "process" || filterType === "technology")

  const dictionaryTable =
    filterType === "process" ? "dictionary_processes" : "dictionary_products"

  const [companyResult, contactsResult, dictionaryResult] = await Promise.all([
    supabase
      .from("companies")
      .select("name, website, linkedin_url")
      .eq("id", bookmark.company_id)
      .single(),
    supabase
      .from("user_company_contacts")
      .select("*")
      .eq("company_id", bookmark.company_id)
      .eq("user_id", user.id)
      .eq("is_decision_maker", true)
      .order("created_at", { ascending: false }),
    needsDictionary
      ? supabase.from(dictionaryTable).select("name").in("id", filterSignalIds)
      : Promise.resolve({ data: null as { name: string }[] | null }),
  ])

  // Construir listas de technologies/processes desde el diccionario (o fallback a filtersUsed)
  let technologies: string[] = []
  let processes: string[] = []

  if (needsDictionary) {
    const names = (dictionaryResult.data || []).map((p) => p.name)
    if (filterType === "process") processes = names.length > 0 ? names : filtersUsed
    else if (filterType === "technology")
      technologies = names.length > 0 ? names : filtersUsed
  } else if (filtersUsed.length > 0) {
    if (filterType === "process") processes = filtersUsed
    else if (filterType === "technology") technologies = filtersUsed
  }

  // Particionar activos vs removidos en memoria — una sola query, 0 round-trips extra.
  const allContacts = (contactsResult.data || []) as Array<Record<string, unknown> & { status?: string | null }>
  const active: Array<Record<string, unknown>> = []
  const removed: Array<Record<string, unknown>> = []
  for (const row of allContacts) {
    if (row.status === "removed") removed.push(row)
    else active.push(row)
  }

  return {
    context: {
      technologies,
      processes,
      company: companyResult.data || null,
    },
    active,
    removed,
  }
}

// ---------------------------------------------------------------------------
// revealProspectPhone — reveal on-demand de telefono para 1 prospecto
// ---------------------------------------------------------------------------

export type RevealPhoneResult =
  | {
      ok: true
      status: "received"
      phone: string
      isMobile: boolean
    }
  | {
      ok: true
      status: "pending"
      message: string
      requestId?: string | null
    }
  | {
      ok: true
      status: "not_available"
      message: string
    }
  | {
      ok: false
      status:
        | "not_found"
        | "no_apollo_id"
        | "already_received"
        | "cooldown"
        | "config_error"
        | "apollo_error"
      message: string
      retryAfter?: string // ISO timestamp si es cooldown
    }

const PHONE_COOLDOWN_DAYS = 7

type ApolloPhoneNumber = {
  raw_number?: string | null
  sanitized_number?: string | null
  type?: string | null
  status?: string | null
}

function pickBestPhone(
  phones: ApolloPhoneNumber[],
): { value: string | null; isMobile: boolean } {
  if (!Array.isArray(phones) || phones.length === 0) {
    return { value: null, isMobile: false }
  }
  const score = (p: ApolloPhoneNumber) => {
    let s = 0
    const t = (p.type ?? "").toLowerCase()
    const st = (p.status ?? "").toLowerCase()
    if (t.includes("mobile")) s += 100
    if (t.includes("work")) s += 50
    if (st.includes("verif")) s += 10
    return s
  }
  const sorted = [...phones].sort((a, b) => score(b) - score(a))
  const best = sorted[0]
  const value = best.sanitized_number ?? best.raw_number ?? null
  const isMobile = (best.type ?? "").toLowerCase().includes("mobile")
  return { value: value && value.length > 0 ? value : null, isMobile }
}

/**
 * Pide a Apollo el telefono de un prospecto puntual. Costo: 5 creditos.
 *
 * Flujo:
 *   1. Verifica que el contacto sea del usuario autenticado.
 *   2. Verifica cooldown (7 dias desde ultimo intento).
 *   3. Marca phone_status='pending' y phone_requested_at=now().
 *   4. Llama a /people/match con reveal_phone_number=true&webhook_url=... como
 *      query params (formato que Apollo requiere para el reveal de phone).
 *   5. Si Apollo devuelve telefono inline -> persiste y devuelve 'received'.
 *   6. Si no -> deja 'pending' y espera al webhook async (UI hara polling).
 */
export async function revealProspectPhone(
  prospectId: string,
): Promise<RevealPhoneResult> {
  const supabase = await createClient()

  const { data: authData } = await supabase.auth.getUser()
  const user = authData?.user
  if (!user) {
    return { ok: false, status: "not_found", message: "No autenticado" }
  }

  // 1) Cargamos el contacto y verificamos pertenencia.
  //    Traemos TODOS los identificadores que Apollo soporta. Para waterfall
  //    enrichment, mientras mas identifiers pasemos en query params mejor
  //    es el match contra los 3rd party data sources (Prospeo, Icypeas, etc).
  const { data: contact, error: contactError } = await supabase
    .from("user_company_contacts")
    .select(
      "id, user_id, apollo_person_id, email, linkedin_url, first_name, last_name, phone, mobile_phone, phone_status, phone_requested_at, bookmark_id, company_id",
    )
    .eq("id", prospectId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (contactError || !contact) {
    return {
      ok: false,
      status: "not_found",
      message: "Prospecto no encontrado",
    }
  }

  // 2) Si ya tenemos telefono y status received, no hace falta gastar creditos
  if (
    contact.phone_status === "received" &&
    (contact.mobile_phone || contact.phone)
  ) {
    return {
      ok: false,
      status: "already_received",
      message: "Ya tenemos el telefono de este contacto",
    }
  }

  // 3) Cooldown: 7 dias desde el ultimo intento (sea pending, received o not_available)
  if (contact.phone_requested_at) {
    const last = new Date(contact.phone_requested_at).getTime()
    const cooldownMs = PHONE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
    const elapsed = Date.now() - last
    if (elapsed < cooldownMs) {
      const retryAfter = new Date(last + cooldownMs).toISOString()
      const daysLeft = Math.ceil((cooldownMs - elapsed) / (24 * 60 * 60 * 1000))
      return {
        ok: false,
        status: "cooldown",
        message: `Reintentar en ${daysLeft} dia${daysLeft === 1 ? "" : "s"} (cooldown de ${PHONE_COOLDOWN_DAYS} dias)`,
        retryAfter,
      }
    }
  }

  // 4) Necesitamos identificadores. Para waterfall enrichment Apollo recomienda:
  //    first_name + last_name + linkedin_url + email (cuanto mas, mejor match).
  //    Como minimo necesitamos al menos uno de: email, linkedin_url, o
  //    (first_name + last_name + organization).
  const c = contact as typeof contact & {
    email?: string | null
    first_name?: string | null
    last_name?: string | null
  }
  const hasName = !!(c.first_name && c.last_name)
  if (!c.email && !c.linkedin_url && !hasName) {
    return {
      ok: false,
      status: "no_apollo_id",
      message:
        "Este contacto no tiene identificadores suficientes (email, linkedin_url, o nombre+apellido)",
    }
  }

  // 5) Construimos webhook URL. Si no hay SITE_URL configurada, abortamos
  //    antes de gastar creditos.
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
  const webhookSecret = process.env.APOLLO_WEBHOOK_SECRET

  if (!siteUrl || !webhookSecret) {
    console.error("[v0][reveal-phone] missing config:", {
      siteUrl: !!siteUrl,
      webhookSecret: !!webhookSecret,
    })
    return {
      ok: false,
      status: "config_error",
      message:
        "Falta configurar NEXT_PUBLIC_SITE_URL o APOLLO_WEBHOOK_SECRET en el servidor",
    }
  }

  const webhookUrl = `${siteUrl.replace(/\/$/, "")}/api/webhooks/apollo/${webhookSecret}`

  // 6) Marcamos pending ANTES de llamar a Apollo (evita races con doble click)
  const admin = createAdminClient()
  const { error: pendingError } = await admin
    .from("user_company_contacts")
    .update({
      phone_status: "pending",
      phone_requested_at: new Date().toISOString(),
    })
    .eq("id", contact.id)

  if (pendingError) {
    console.error("[v0][reveal-phone] mark pending failed:", pendingError)
    return {
      ok: false,
      status: "apollo_error",
      message: "Error interno marcando pending",
    }
  }

  // 7) Llamamos a Apollo en modo WATERFALL ENRICHMENT.
  //    Esto es CRITICO: con `reveal_phone_number=true` solo, Apollo busca en su
  //    DB propia y si no lo tiene devuelve `phone_enrichment.request_id` que
  //    exige polling (Apollo NO manda webhook en ese modo). Con `run_waterfall_phone=true`,
  //    Apollo consulta third-party data sources (Prospeo, Icypeas, etc.) y SI
  //    entrega via webhook a webhook_url. Confirmado en docs.apollo.io/docs/enrich-phone-and-email-using-data-waterfall
  //
  //    TODOS los parametros van como QUERY PARAMS (body vacio). Pasamos todos
  //    los identifiers que tenemos para mejor match en los data sources.
  const queryParams: Record<string, string | number | boolean> = {
    run_waterfall_phone: true,
    webhook_url: webhookUrl,
  }
  const identifiersIncluded: string[] = []
  if (c.email) {
    queryParams.email = c.email
    identifiersIncluded.push("email")
  }
  if (c.linkedin_url) {
    queryParams.linkedin_url = c.linkedin_url
    identifiersIncluded.push("linkedin_url")
  }
  if (c.first_name) {
    queryParams.first_name = c.first_name
    identifiersIncluded.push("first_name")
  }
  if (c.last_name) {
    queryParams.last_name = c.last_name
    identifiersIncluded.push("last_name")
  }
  if (c.apollo_person_id) {
    queryParams.id = c.apollo_person_id
    identifiersIncluded.push("apollo_person_id")
  }

  const result = await apolloRequest<{
    person?: any
    waterfall?: {
      status?: "accepted" | "failed" | "partial_accepted"
      message?: string
      unprocessed_attributes?: unknown[]
    } | null
    request_id?: string | number
  }>({
    endpoint: "people/match:phone",
    method: "POST",
    requestBody: {}, // VACIO — todo va por query params
    queryParams,
    userId: user.id,
    bookmarkId: contact.bookmark_id ?? undefined,
    companyId: contact.company_id ?? undefined,
    creditsEstimated: 5,
    extraMetadata: {
      phone_revealed: true,
      waterfall_mode: true,
      contact_id: contact.id,
      identifiers_included: identifiersIncluded,
      // Loggeamos el webhook_url para poder verificar despues si Apollo lo
      // podia alcanzar (puede pasar que NEXT_PUBLIC_SITE_URL apunte a un
      // deployment de Vercel con auth de preview activa).
      webhook_url_sent: webhookUrl,
      site_url_source: process.env.NEXT_PUBLIC_SITE_URL
        ? "NEXT_PUBLIC_SITE_URL"
        : process.env.VERCEL_URL
          ? "VERCEL_URL"
          : "none",
    },
  })

  if (!result.ok) {
    console.error("[v0][reveal-phone] apollo error:", result.error)
    // Restauramos el status anterior (not_requested) si Apollo erroreo
    await admin
      .from("user_company_contacts")
      .update({ phone_status: "not_requested" })
      .eq("id", contact.id)
    return {
      ok: false,
      status: "apollo_error",
      message: `Apollo respondio ${result.status}: ${result.error.slice(0, 120)}`,
    }
  }

  // 8) Procesamos el response del modo waterfall. Casos posibles:
  //    a) waterfall.status === 'accepted'        -> webhook llegara con datos
  //    b) waterfall.status === 'partial_accepted' -> webhook llegara, parcial
  //    c) waterfall.status === 'failed'           -> error claro al usuario
  //    d) `person.phone_numbers` ya vacio sin waterfall -> Apollo no acepto el match
  //
  //    apolloRequest ya guardo el response completo en apollo_api_calls.response_body
  //    con `endpoint: "people/match:phone"` para diagnostico.
  const responseData = result.data as {
    person?: any
    waterfall?: {
      status?: "accepted" | "failed" | "partial_accepted"
      message?: string
    } | null
    request_id?: string | number
  }
  const person = responseData?.person ?? {}
  const waterfall = responseData?.waterfall ?? null

  // Backfill apollo_person_id si la respuesta lo trae (util para que el webhook
  // matchee por id en vez de linkedin_url).
  if (
    !contact.apollo_person_id &&
    typeof person.id === "string" &&
    person.id.length > 0
  ) {
    await admin
      .from("user_company_contacts")
      .update({ apollo_person_id: person.id })
      .eq("id", contact.id)
  }

  // Caso (a) y (b): waterfall accepted o partial_accepted -> esperar webhook
  if (
    waterfall?.status === "accepted" ||
    waterfall?.status === "partial_accepted"
  ) {
    return {
      ok: true,
      status: "pending",
      message:
        waterfall.message ??
        "Apollo esta consultando data sources externos. El telefono llegara via webhook en unos minutos.",
      requestId:
        responseData.request_id != null
          ? String(responseData.request_id)
          : null,
    }
  }

  // Caso (c): waterfall failed -> error explicito (no quemar 7d de cooldown)
  if (waterfall?.status === "failed") {
    const failMsg = waterfall.message ?? "Waterfall enrichment fallo"
    const isPermissionError = /permission|not have/i.test(failMsg)

    // Si es error de permisos, restauramos a not_requested para que pueda
    // reintentar cuando se arregle el plan. Si es otra falla, marcamos
    // not_available para respetar el cooldown.
    await admin
      .from("user_company_contacts")
      .update({
        phone_status: isPermissionError ? "not_requested" : "not_available",
      })
      .eq("id", contact.id)

    console.error("[v0][reveal-phone] waterfall failed:", {
      contactId: contact.id,
      identifiers: identifiersIncluded,
      message: failMsg,
    })

    return {
      ok: false,
      status: isPermissionError ? "config_error" : "apollo_error",
      message: isPermissionError
        ? "Tu plan de Apollo no tiene habilitado Waterfall Enrichment. Contactar soporte de Apollo para activarlo."
        : `Apollo rechazo el waterfall: ${failMsg.slice(0, 160)}`,
    }
  }

  // Caso (d): no hay bloque waterfall en el response. Esto puede pasar si
  // Apollo aceptamos cierto contrato pero el endpoint cambio. Marcamos
  // not_available y loggeamos para diagnostico.
  await admin
    .from("user_company_contacts")
    .update({ phone_status: "not_available" })
    .eq("id", contact.id)

  console.log("[v0][reveal-phone] response sin waterfall block", {
    contactId: contact.id,
    identifiers: identifiersIncluded,
    personIdReturned: person.id ?? null,
    responseTopKeys: Object.keys(responseData ?? {}),
  })

  return {
    ok: true,
    status: "not_available",
    message:
      "Apollo no proceso el waterfall enrichment. Revisar logs en apollo_api_calls.response_body.",
  }
}

/**
 * Lee el estado actual del telefono de un prospecto. Lo usa la UI para hacer
 * polling cuando el reveal quedo en 'pending' (esperando webhook async).
 */
export async function getProspectPhoneStatus(prospectId: string): Promise<{
  ok: boolean
  phone_status: string | null
  phone: string | null
  mobile_phone: string | null
}> {
  const supabase = await createClient()

  const { data: authData } = await supabase.auth.getUser()
  const user = authData?.user
  if (!user) {
    return { ok: false, phone_status: null, phone: null, mobile_phone: null }
  }

  const { data, error } = await supabase
    .from("user_company_contacts")
    .select("phone_status, phone, mobile_phone")
    .eq("id", prospectId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (error || !data) {
    return { ok: false, phone_status: null, phone: null, mobile_phone: null }
  }
  return {
    ok: true,
    phone_status: data.phone_status ?? null,
    phone: data.phone ?? null,
    mobile_phone: data.mobile_phone ?? null,
  }
}

/**
 * Marca el telefono de un prospecto como `not_available` por timeout: lo
 * usa la UI cuando el polling se queda en pending demasiado tiempo (Apollo
 * no entrego webhook a pesar de aceptar el waterfall enrichment). Solo
 * actualiza si el estado actual sigue siendo 'pending' (no pisa un received
 * que llego justo en la transicion).
 */
export async function markPhoneTimedOut(prospectId: string): Promise<{
  ok: boolean
  changed: boolean
}> {
  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()
  const user = authData?.user
  if (!user) return { ok: false, changed: false }

  const admin = createAdminClient()
  // Solo cambiamos si todavia esta en pending (evita race con webhook que
  // llega justo cuando expira el timeout).
  const { data, error } = await admin
    .from("user_company_contacts")
    .update({ phone_status: "not_available" })
    .eq("id", prospectId)
    .eq("user_id", user.id)
    .eq("phone_status", "pending")
    .select("id")

  if (error) {
    console.error("[v0][markPhoneTimedOut] update failed:", error)
    return { ok: false, changed: false }
  }

  return { ok: true, changed: (data ?? []).length > 0 }
}
