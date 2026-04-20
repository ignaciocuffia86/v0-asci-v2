"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { generateGeminiContent } from "@/lib/ai-service"
import { resolveCompanyOrganizationId } from "@/lib/apollo/organizations"
import { searchPeople } from "@/lib/apollo/search"
import { enrichMany, type EnrichedPerson } from "@/lib/apollo/enrich"
import { sanitizeTitleList } from "@/lib/apollo/title-validator"
import { normalizeDomain } from "@/lib/apollo/domain"
import { hashSearchParams } from "@/lib/apollo/query-hash"

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
  phoneAwaitingWebhook: number
  saved: number
  skippedDuplicates: number
  organizationNotFound: boolean
  rejectedTitles: Array<{ input: string; reason: string }>
  requestPreview: Record<string, unknown> | null
  warnings: string[]
}

export type ApolloSearchOptions = {
  revealPhone?: boolean
  revealEmail?: boolean
  useOrganizationLocation?: boolean
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
// getBookmarkSearchContext (intacto)
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
// Helpers de cache legacy (apollo_contacts_cache)
// ---------------------------------------------------------------------------

async function readLegacyCache(
  companyDomain: string | null,
  companyLinkedIn: string | null,
): Promise<EnrichedPerson[]> {
  const supabase = await createClient()

  let query = supabase.from("apollo_contacts_cache").select("*")
  if (companyDomain) query = query.eq("company_domain", companyDomain)
  else if (companyLinkedIn) query = query.eq("company_linkedin_url", companyLinkedIn)
  else return []

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  query = query.gte("created_at", thirtyDaysAgo.toISOString())

  const { data: cached } = await query
  if (!cached) return []

  return cached
    .filter((c) => c.last_name || c.linkedin_url || c.email)
    .map((c) => ({
      apolloId: c.apollo_id || c.id,
      firstName: c.first_name || null,
      lastName: c.last_name || null,
      fullName: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(" ") || "Sin nombre",
      title: c.title || null,
      headline: c.headline || null,
      email: c.email || null,
      emailStatus: c.email_status || null,
      linkedinUrl: c.linkedin_url || null,
      photoUrl: c.profile_picture_url || null,
      city: c.city || null,
      state: c.state || null,
      country: c.country || null,
      seniority: c.seniority || null,
      departments: c.departments || [],
      mobilePhone: c.mobile_phone || null,
      workPhone: c.phone || null,
      organizationId: null,
      enrichmentStatus: "ok" as const,
      phoneAwaitingWebhook: false,
    }))
}

function filterCacheByTitles(cache: EnrichedPerson[], titles: string[]): EnrichedPerson[] {
  if (titles.length === 0) return cache
  const lowered = titles.map((t) => t.toLowerCase())
  return cache.filter((c) => {
    const cachedTitle = (c.title || "").toLowerCase()
    if (!cachedTitle) return false
    return lowered.some((jt) => cachedTitle.includes(jt) || jt.includes(cachedTitle.split(",")[0]))
  })
}

async function saveToLegacyCache(
  contacts: EnrichedPerson[],
  companyDomain: string | null,
  companyLinkedIn: string | null,
  jobTitles: string[],
): Promise<void> {
  const supabase = createServiceRoleClient()

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
        phoneAwaitingWebhook: 0,
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

  // --- 4. Cache legacy hit
  const fullCache = await readLegacyCache(domain, company.linkedin_url)
  const cacheForTitles = filterCacheByTitles(fullCache, sanitized.accepted)
  const queryHash = hashSearchParams({
    organizationId,
    domain,
    jobTitles: sanitized.accepted,
    country: countryFilter ?? null,
    seniorities: options.seniorities,
    departments: options.departments,
    includeSimilarTitles: true,
    useOrganizationLocation: options.useOrganizationLocation ?? false,
  })

  let contacts: EnrichedPerson[] = []
  let fromCache = false
  let apolloCalled = false
  let totalEntries = 0
  let apiReturned = 0
  let enrichedOk = 0
  let enrichedFailed = 0
  let phoneAwaitingCount = 0
  let requestPreview: Record<string, unknown> | null = null

  // --- 5. Llamar Apollo si es necesario
  //     Usamos cache solo si: (a) hay 3+ resultados relevantes, (b) no se pidio forceRefresh
  if (!options.forceRefresh && cacheForTitles.length >= 3) {
    contacts = cacheForTitles
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
      includeSimilarTitles: true,
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
          phoneAwaitingWebhook: 0,
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

    // --- 6. Enrichment con opt-in de reveals
    const webhookUrl = (() => {
      const base =
        process.env.NEXT_PUBLIC_APP_URL ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
        "https://asci.bigua.lat"
      return `${base.replace(/\/$/, "")}/api/webhooks/apollo`
    })()

    const enriched = await enrichMany(
      searchRes.people,
      {
        userId: user.id,
        bookmarkId,
        companyId: company.id,
        revealEmail: options.revealEmail ?? true,
        revealPhone: options.revealPhone ?? false,
        webhookUrl,
      },
      4,
    )

    for (const p of enriched) {
      if (p.enrichmentStatus === "ok") enrichedOk++
      else enrichedFailed++
      if (p.phoneAwaitingWebhook) phoneAwaitingCount++
    }

    contacts = enriched.filter((p) => p.lastName || p.linkedinUrl || p.email)

    // Persist a cache legacy (compatibilidad)
    if (contacts.length > 0) {
      await saveToLegacyCache(contacts, domain, company.linkedin_url, sanitized.accepted)
    }
  }

  // --- 7. Persist en user_company_contacts con dedup
  let saved = 0
  let skippedDuplicates = 0

  for (const contact of contacts) {
    if (!contact.lastName && !contact.linkedinUrl && !contact.email) continue

    let existingQuery = supabase
      .from("user_company_contacts")
      .select("id")
      .eq("user_id", user.id)
      .eq("company_id", company.id)

    if (contact.linkedinUrl) {
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
      first_name: contact.firstName,
      last_name: contact.lastName,
      full_name: contact.fullName,
      role: contact.title,
      headline: contact.headline,
      email: contact.email,
      email_status: contact.emailStatus,
      phone: contact.workPhone,
      mobile_phone: contact.mobilePhone,
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
    })

    if (!error) saved++
  }

  revalidatePath(`/bookmarks/${bookmarkId}`)

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
      phoneAwaitingWebhook: phoneAwaitingCount,
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
