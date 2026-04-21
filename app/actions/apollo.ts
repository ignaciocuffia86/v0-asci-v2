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
import { logApolloCall } from "@/lib/apollo/logger"
import { getApolloWebhookUrl } from "@/lib/apollo/webhook-url"

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
  let phoneAwaitingCount = 0
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
    const webhookUrl = getApolloWebhookUrl()

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

    // phone_status: reflejo el estado del teléfono para que la UI sepa qué mostrar
    // - received: vino inline en el enrichment
    // - pending: se pidió a Apollo pero volverá por webhook (o ya pedimos hoy)
    // - not_requested: no se pidió reveal
    const phoneStatus: string = contact.mobilePhone
      ? "received"
      : contact.phoneAwaitingWebhook
        ? "pending"
        : "not_requested"

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
      phone_status: phoneStatus,
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

  // No hacemos revalidatePath aca: el cliente llama loadData() via server action
  // y recarga la lista sin causar un full refresh del RSC (mejor UX).

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

/**
 * Poll liviano del estado de teléfonos.
 * Devuelve SÓLO las filas que cambiaron de estado o tienen teléfono,
 * para que la UI refresque incremental sin recargar todo.
 */
export async function pollPhoneStatus(
  bookmarkId: string,
): Promise<Array<{ id: string; phone_status: string | null; mobile_phone: string | null; phone: string | null }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()
  if (!bookmark) return []

  const { data } = await supabase
    .from("user_company_contacts")
    .select("id, phone_status, mobile_phone, phone")
    .eq("company_id", bookmark.company_id)
    .eq("user_id", user.id)
    .eq("is_decision_maker", true)

  return data || []
}

/**
 * Pide teléfonos a Apollo para prospectos existentes que aún no lo tienen.
 * Útil para filas viejas del cache (pre phone_status) o que quedaron pending.
 * Marca phone_status = 'pending' y dispara la llamada a people/match con webhook.
 */
export type PhoneRevealResult = {
  id: string
  // "received" cuando Apollo devolvio el telefono inline (hay phone)
  // "not_available" cuando Apollo confirmo que no lo tiene (phone=null, message explica)
  // "pending" cuando Apollo va a mandar por webhook
  // "error" cuando hubo un fallo HTTP o de red
  status: "received" | "not_available" | "pending" | "error"
  phone: string | null
  message?: string
}

export async function requestPhoneReveal(
  prospectIds: string[],
): Promise<{
  success: boolean
  requested: number
  error?: string
  results?: PhoneRevealResult[]
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { success: false, requested: 0, error: "No autorizado" }
  if (!prospectIds || prospectIds.length === 0) return { success: true, requested: 0 }

  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) return { success: false, requested: 0, error: "APOLLO_API_KEY no configurado" }

  // Traer prospectos del usuario (seguridad: sólo los suyos)
  const { data: prospects } = await supabase
    .from("user_company_contacts")
    .select("id, apollo_person_id, linkedin_url, first_name, last_name, full_name, email")
    .in("id", prospectIds)
    .eq("user_id", user.id)

  if (!prospects || prospects.length === 0) {
    return { success: false, requested: 0, error: "No se encontraron prospectos" }
  }

  // Marcamos pending inmediatamente para que la UI muestre "Solicitando..."
  await supabase
    .from("user_company_contacts")
    .update({ phone_status: "pending" })
    .in(
      "id",
      prospects.map((p) => p.id),
    )

  const admin = createAdminClient()
  let requested = 0

  // IMPORTANTE: La doc oficial de Apollo muestra que el webhook_url (junto
  // con reveal_phone_number) DEBE pasarse como query param URL-encoded en la
  // URL del POST, NO en el JSON body. Si va en el body, Apollo procesa la
  // llamada pero jamas dispara el webhook.
  // Ejemplo oficial:
  //   POST /api/v1/people/match?reveal_phone_number=true&webhook_url=https%3A%2F%2F...
  //
  // Para debuggear casos donde el webhook no llega, seteá APOLLO_WEBHOOK_URL_OVERRIDE
  // (ej. una URL de webhook.site) para aislar si el problema es Apollo o nuestro handler.
  const webhookUrl = getApolloWebhookUrl()

  // Resultados por prospecto para devolver al cliente y hacer feedback claro
  const results: Array<{
    id: string
    status: "received" | "pending" | "error"
    phone: string | null
    message?: string
  }> = []

  for (const p of prospects) {
    const startedAt = Date.now()
    // En el body SOLO van los identificadores; los flags van como query params.
    const matchBody: Record<string, unknown> = {}
    if (p.apollo_person_id) matchBody.id = p.apollo_person_id
    else if (p.linkedin_url) matchBody.linkedin_url = p.linkedin_url
    else if (p.email) matchBody.email = p.email
    else if (p.first_name && p.last_name) {
      matchBody.first_name = p.first_name
      matchBody.last_name = p.last_name
    } else continue

    // Construir URL con query params URL-encoded como hace la doc oficial.
    // IMPORTANTE: `run_waterfall_phone=true` es REQUERIDO para que Apollo
    // dispare el webhook de delivery asincrono. Sin este flag, el response
    // queda en "pending" pero el webhook nunca llega (confirmado en docs).
    const qs = new URLSearchParams({
      reveal_phone_number: "true",
      run_waterfall_phone: "true",
      webhook_url: webhookUrl,
    }).toString()
    const apolloUrl = `https://api.apollo.io/api/v1/people/match?${qs}`

    try {
      const res = await fetch(apolloUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "Cache-Control": "no-cache",
        },
        body: JSON.stringify(matchBody),
      })

      const latencyMs = Date.now() - startedAt

      if (res.ok) {
        const data = await res.json()
        const person = data.person
        const inlineMobile = person?.mobile_phone || null
        const phoneNumbers = person?.phone_numbers as
          | Array<{ type?: string; sanitized_number?: string; status?: string }>
          | undefined
        const mobileFromArr = phoneNumbers?.find(
          (n) => n.type === "mobile" || n.type === "Mobile",
        )?.sanitized_number
        const workFromArr = phoneNumbers?.find((n) => n.type === "work")?.sanitized_number
        const best = inlineMobile || mobileFromArr || workFromArr || null

        // IMPORTANTE: Apollo devuelve el status real del reveal en `phone_enrichment`,
        // NO en person.phone_numbers. Logs previos confirman top-level keys:
        // ["person", "phone_enrichment", "request_id"].
        // phone_enrichment puede traer: { status, error_message, request_id, ... }
        // Estados comunes que hemos visto documentados:
        //   - "queued" / "pending" / "processing" -> webhook va a llegar
        //   - "success" -> telefono ya esta en person.phone_numbers
        //   - "failed" / "no_data" / "not_found" -> no hay telefono, no habra webhook
        const phoneEnrichment = data.phone_enrichment as
          | { status?: string; error_message?: string; message?: string; request_id?: string; [k: string]: unknown }
          | undefined
        const enrichmentStatus = phoneEnrichment?.status?.toLowerCase() ?? null
        // IMPORTANTE: el request_id util para pollear esta DENTRO de phone_enrichment,
        // no en data.request_id (que es un id de request generico). Ejemplo real del log:
        //   data.request_id: "-1713660131470514000"     <- no sirve para pollear
        //   phone_enrichment.request_id: "69e6dd65ccbea5001df8aaf6"  <- este si
        const requestId = phoneEnrichment?.request_id ?? data.request_id ?? null

        const pendingStatuses = ["queued", "pending", "processing", "requested", "in_progress"]
        const terminalFailStatuses = ["failed", "no_data", "not_found", "unavailable", "error"]

        const isPendingFromEnrichment =
          enrichmentStatus !== null && pendingStatuses.includes(enrichmentStatus)
        const isTerminalFailFromEnrichment =
          enrichmentStatus !== null && terminalFailStatuses.includes(enrichmentStatus)
        const hasPendingReveal =
          isPendingFromEnrichment ||
          !!phoneNumbers?.some(
            (n) => n.status === "pending" || n.status === "requested" || n.status === "processing",
          )

        const warnings = data.warnings || data.warning || null
        const credits = data.credits_used || data.credits_consumed || null

        // Log con TODO el phone_enrichment raw para poder post-mortem
        await logApolloCall({
          endpoint: "people/match:phone",
          userId: user.id,
          // Incluimos la URL completa (con query params) + body para auditoria
          requestBody: { url: apolloUrl, body: matchBody },
          responseStatus: res.status,
          responseCount: phoneNumbers?.length ?? 0,
          latencyMs,
          extraMetadata: {
            prospect_id: p.id,
            apollo_person_id: p.apollo_person_id,
            inline_phone: best,
            phone_numbers_returned: phoneNumbers?.length ?? 0,
            phone_numbers_statuses: phoneNumbers?.map((n) => n.status ?? null) ?? [],
            // Dump del phone_enrichment completo — esto nos dice que paso realmente
            phone_enrichment: phoneEnrichment ?? null,
            enrichment_status: enrichmentStatus,
            enrichment_error: phoneEnrichment?.error_message ?? null,
            apollo_request_id: requestId,
            has_pending_reveal: hasPendingReveal,
            is_terminal_fail: isTerminalFailFromEnrichment,
            warnings,
            credits,
            // Webhook_url ahora va como query param, lo logueamos para auditar
            webhook_url_sent: webhookUrl,
            webhook_url_location: "query_param_encoded",
            response_top_keys: Object.keys(data),
            phone_enrichment_keys: phoneEnrichment ? Object.keys(phoneEnrichment) : [],
          },
        })

        if (best) {
          // Apollo devolvio el telefono inline: guardamos ya
          await admin
            .from("user_company_contacts")
            .update({ mobile_phone: best, phone: best, phone_status: "received" })
            .eq("id", p.id)
          results.push({ id: p.id, status: "received", phone: best })
        } else if (hasPendingReveal) {
          // Apollo va a mandar webhook. Guardamos request_id para poder correlacionar.
          if (requestId) {
            await admin
              .from("user_company_contacts")
              .update({ apollo_request_id: requestId })
              .eq("id", p.id)
          }
          results.push({
            id: p.id,
            status: "pending",
            phone: null,
            message: "Apollo esta procesando el telefono. Puede tardar unos minutos.",
          })
        } else if (isTerminalFailFromEnrichment) {
          // Apollo confirmo explicitamente que no hay telefono para este contacto
          await admin
            .from("user_company_contacts")
            .update({ phone_status: "not_available" })
            .eq("id", p.id)
          results.push({
            id: p.id,
            status: "not_available",
            phone: null,
            message:
              phoneEnrichment?.error_message ||
              `Apollo no tiene telefono (${enrichmentStatus}).`,
          })
        } else {
          // Respuesta ambigua: 200 OK, phone_numbers vacio y enrichment sin status conocido.
          // NO asumimos "no hay" — lo dejamos pending para que el usuario reintente y
          // el admin pueda ver el metadata logueado (response_top_keys, phone_enrichment_keys).
          results.push({
            id: p.id,
            status: "pending",
            phone: null,
            message: `Respuesta sin datos claros de Apollo (status=${enrichmentStatus ?? "null"}). Reintentando si llega webhook.`,
          })
        }
      } else {
        const errorText = await res.text().catch(() => "<could not read body>")
        await logApolloCall({
          endpoint: "people/match:phone",
          userId: user.id,
          requestBody: matchBody,
          responseStatus: res.status,
          latencyMs,
          errorMessage: errorText.slice(0, 500),
          extraMetadata: { prospect_id: p.id, apollo_person_id: p.apollo_person_id },
        })
        // Error HTTP de Apollo: devolvemos a not_requested para reintentar
        await admin
          .from("user_company_contacts")
          .update({ phone_status: "not_requested" })
          .eq("id", p.id)
        results.push({
          id: p.id,
          status: "error",
          phone: null,
          message: `Apollo devolvio error ${res.status}`,
        })
      }
      requested++
    } catch (err) {
      console.error("[v0] requestPhoneReveal error for prospect", p.id, err)
      // Error de red: rollback a not_requested
      await admin
        .from("user_company_contacts")
        .update({ phone_status: "not_requested" })
        .eq("id", p.id)
      results.push({
        id: p.id,
        status: "error",
        phone: null,
        message: err instanceof Error ? err.message : "Error de red al contactar Apollo",
      })
    }
  }

  return { success: true, requested, results }
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
