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
export async function requestPhoneReveal(
  prospectIds: string[],
): Promise<{ success: boolean; requested: number; error?: string }> {
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

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://asci.bigua.lat"
  const admin = createAdminClient()
  let requested = 0

  for (const p of prospects) {
    try {
      const matchBody: Record<string, unknown> = {
        reveal_phone_number: true,
        webhook_url: `${baseUrl}/api/webhooks/apollo`,
      }
      if (p.apollo_person_id) matchBody.id = p.apollo_person_id
      else if (p.linkedin_url) matchBody.linkedin_url = p.linkedin_url
      else if (p.email) matchBody.email = p.email
      else if (p.first_name && p.last_name) {
        matchBody.first_name = p.first_name
        matchBody.last_name = p.last_name
      } else continue

      const res = await fetch("https://api.apollo.io/api/v1/people/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "Cache-Control": "no-cache",
        },
        body: JSON.stringify(matchBody),
      })

      if (res.ok) {
        const data = await res.json()
        const person = data.person
        const inlineMobile = person?.mobile_phone || null
        const phoneNumbers = person?.phone_numbers as
          | Array<{ type?: string; sanitized_number?: string }>
          | undefined
        const mobileFromArr = phoneNumbers?.find(
          (n) => n.type === "mobile" || n.type === "Mobile",
        )?.sanitized_number
        const workFromArr = phoneNumbers?.find((n) => n.type === "work")?.sanitized_number
        const best = inlineMobile || mobileFromArr || workFromArr || null

        if (best) {
          // Apollo respondió con el teléfono inline
          await admin
            .from("user_company_contacts")
            .update({ mobile_phone: best, phone: best, phone_status: "received" })
            .eq("id", p.id)
        } else if (phoneNumbers !== undefined) {
          // Apollo respondió OK pero sin phone_numbers válidos: no va a llegar por webhook.
          // Marcamos not_available para que la UI deje de mostrar "Solicitando..."
          await admin
            .from("user_company_contacts")
            .update({ phone_status: "not_available" })
            .eq("id", p.id)
        }
        // Si phone_numbers es undefined (Apollo no devolvió el campo), el webhook
        // es quien completará: mantenemos phone_status = "pending".
      } else {
        // Error HTTP de Apollo (429, 5xx, etc): devolvemos el estado a not_requested
        // para que el usuario pueda reintentar sin quedar trabado en "Solicitando...".
        await admin
          .from("user_company_contacts")
          .update({ phone_status: "not_requested" })
          .eq("id", p.id)
      }
      requested++
    } catch (err) {
      console.error("[v0] requestPhoneReveal error for prospect", p.id, err)
      // Error de red: rollback a not_requested
      await admin
        .from("user_company_contacts")
        .update({ phone_status: "not_requested" })
        .eq("id", p.id)
    }
  }

  return { success: true, requested }
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
