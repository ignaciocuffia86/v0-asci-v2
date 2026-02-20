"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { generateGeminiContent } from "@/lib/ai-service"

// Tipos para Apollo API
interface ApolloPersonSearchResult {
  id: string
  first_name: string
  last_name: string
  name: string
  title: string
  headline?: string
  email?: string
  email_status?: string
  phone_numbers?: { raw_number: string; sanitized_number?: string; type: string }[]
  sanitized_phone?: string
  linkedin_url?: string
  photo_url?: string
  city?: string
  state?: string
  country?: string
  seniority?: string
  departments?: string[]
  employment_history?: any[]
  organization?: {
    name: string
    website_url?: string
    linkedin_url?: string
    industry?: string
  }
}

interface ApolloSearchResponse {
  people: ApolloPersonSearchResult[]
  pagination: {
    page: number
    per_page: number
    total_entries: number
    total_pages: number
  }
}

// Inferir job titles usando IA según el contexto de búsqueda
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

5. Maximo 12 job titles, ordenados por relevancia para la venta.

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
      return {
        jobTitles: parsed.jobTitles || [],
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
        return {
          jobTitles: parsed.jobTitles || [],
          reasoning: parsed.reasoning || "",
        }
      }
    } catch (fallbackError) {
      console.error("Fallback Gemini 1.5 Pro also failed:", fallbackError)
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

// Obtener contexto de búsqueda del bookmark (tecnologías y procesos)
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

// Buscar en cache de Apollo antes de llamar a la API
async function searchApolloCache(
  companyDomain: string | null,
  companyLinkedIn: string | null,
  jobTitles: string[],
): Promise<ApolloPersonSearchResult[]> {
  const supabase = await createClient()

  let query = supabase.from("apollo_contacts_cache").select("*")

  if (companyDomain) {
    query = query.eq("company_domain", companyDomain)
  } else if (companyLinkedIn) {
    query = query.eq("company_linkedin_url", companyLinkedIn)
  } else {
    return []
  }

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  query = query.gte("created_at", thirtyDaysAgo.toISOString())

  const { data: cached } = await query

  if (!cached || cached.length === 0) return []

  const normalizedJobTitles = jobTitles.map((jt) => jt.toLowerCase())

  return cached
    .filter((c) => {
      // Quality check: skip un-enriched entries (no last_name = not enriched)
      if (!c.last_name && !c.linkedin_url && !c.email) return false
      const cachedTitle = (c.title || "").toLowerCase()
      return normalizedJobTitles.some((jt) => cachedTitle.includes(jt) || jt.includes(cachedTitle.split(",")[0]))
    })
    .map((c) => ({
      id: c.apollo_id || c.id,
      first_name: c.first_name || "",
      last_name: c.last_name || "",
      name: c.full_name || "",
      title: c.title || "",
      headline: c.headline,
      email: c.email,
      email_status: c.email_status,
      phone_numbers: c.mobile_phone
        ? [{ raw_number: c.mobile_phone, type: "mobile" }]
        : c.phone
          ? [{ raw_number: c.phone, type: "work" }]
          : [],
      linkedin_url: c.linkedin_url,
      photo_url: c.profile_picture_url,
      city: c.city,
      state: c.state,
      country: c.country,
      seniority: c.seniority,
      departments: c.departments,
      organization: {
        name: c.organization_name || "",
        website_url: c.organization_website,
        linkedin_url: c.organization_linkedin_url,
        industry: c.organization_industry,
      },
    }))
}

// Llamar a Apollo API para buscar personas
async function callApolloAPI(
  companyDomain: string | null,
  companyName: string,
  jobTitles: string[],
  limit = 10,
): Promise<ApolloPersonSearchResult[]> {
  const apiKey = process.env.APOLLO_API_KEY

  if (!apiKey) {
    console.error("APOLLO_API_KEY not configured")
    return []
  }

  try {
    const requestBody: Record<string, any> = {
      per_page: limit,
      page: 1,
      person_titles: jobTitles,
    }

    if (companyDomain) {
      requestBody.q_organization_domains = companyDomain
    } else {
      requestBody.q_organization_name = companyName
    }

    const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000), // 30s timeout
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Apollo API error:", response.status, errorText)
      return []
    }

    const data: ApolloSearchResponse = await response.json()

    if (data.people && data.people.length > 0) {
      // api_search returns minimal data (first_name, title, id only)
      // Enrich each person via people/match with their id to get full data
      const enrichedPeople = await enrichApolloContacts(data.people, apiKey)
      return enrichedPeople.length > 0 ? enrichedPeople : data.people
    }

    return data.people || []
  } catch (error) {
    console.error("Error calling Apollo API:", error)
    return []
  }
}

// Enrich contacts using people/match (singular) with the person's Apollo ID.
// api_search only returns first_name, title, id. people/match with id returns
// full data: last_name, email, linkedin_url, photo_url, seniority, etc.
// Each call consumes 1 credit. We process sequentially with small delays.
async function enrichApolloContacts(
  people: ApolloPersonSearchResult[],
  apiKey: string,
): Promise<ApolloPersonSearchResult[]> {
  const enriched: ApolloPersonSearchResult[] = []

  for (const person of people) {
    try {
      const response = await fetch("https://api.apollo.io/api/v1/people/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          id: person.id,
          reveal_personal_emails: true,
        }),
      })

      if (!response.ok) {
        // If enrichment fails for one person, keep the search data
        enriched.push(person)
        continue
      }

      const data = await response.json()
      if (data.person) {
        enriched.push(data.person)

        // Request phone number asynchronously via webhook (Apollo requires this)
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://asci.bigua.lat"
        try {
          await fetch("https://api.apollo.io/api/v1/people/match", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
            },
            body: JSON.stringify({
              id: person.id,
              reveal_phone_number: true,
              webhook_url: `${baseUrl}/api/webhooks/apollo`,
            }),
          })
        } catch {
          // Phone reveal is best-effort, don't break the flow
        }
      } else {
        enriched.push(person)
      }

      // Small delay between calls to respect rate limits
      if (people.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    } catch (error) {
      enriched.push(person)
    }
  }

  return enriched
}

// Guardar contactos en cache global
async function saveToApolloCache(
  contacts: ApolloPersonSearchResult[],
  companyDomain: string | null,
  companyLinkedIn: string | null,
  jobTitles: string[],
) {
  const supabase = await createClient()

  for (const contact of contacts) {
    // Only cache enriched contacts (must have at least last_name or linkedin_url)
    if (!contact.last_name && !contact.linkedin_url && !contact.email) continue

    const mobileEntry = contact.phone_numbers?.find((p) => p.type === "mobile")
    const workEntry = contact.phone_numbers?.find((p) => p.type === "work")
    const anyEntry = contact.phone_numbers?.[0]
    const phoneNumber = mobileEntry?.raw_number || mobileEntry?.sanitized_number || contact.sanitized_phone || null
    const workPhone = workEntry?.raw_number || workEntry?.sanitized_number || anyEntry?.raw_number || anyEntry?.sanitized_number || null

    await supabase.from("apollo_contacts_cache").upsert(
      {
        apollo_id: contact.id,
        company_domain: companyDomain,
        company_linkedin_url: companyLinkedIn,
        first_name: contact.first_name || null,
        last_name: contact.last_name || null,
        full_name: contact.name || [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Sin nombre",
        title: contact.title,
        headline: contact.headline,
        email: contact.email,
        email_status: contact.email_status,
        phone: workPhone,
        mobile_phone: phoneNumber,
        linkedin_url: contact.linkedin_url,
        profile_picture_url: contact.photo_url,
        city: contact.city,
        state: contact.state,
        country: contact.country,
        seniority: contact.seniority,
        departments: contact.departments,
        employment_history: contact.employment_history,
        organization_name: contact.organization?.name,
        organization_website: contact.organization?.website_url,
        organization_linkedin_url: contact.organization?.linkedin_url,
        organization_industry: contact.organization?.industry,
        job_titles_searched: jobTitles,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "apollo_id" },
    )
  }
}

// Función principal: buscar prospectos en Apollo
export async function searchApolloProspects(
  bookmarkId: string,
  jobTitles: string[],
  customJobTitles?: string[],
): Promise<{ success: boolean; count: number; error?: string }> {
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

  let companyDomain: string | null = null
  if (company.website) {
    try {
      const url = new URL(company.website.startsWith("http") ? company.website : `https://${company.website}`)
      companyDomain = url.hostname.replace("www.", "")
    } catch {
      companyDomain = company.website.replace("www.", "")
    }
  }

  const finalJobTitles = customJobTitles?.length ? customJobTitles : jobTitles

  let contacts = await searchApolloCache(companyDomain, company.linkedin_url, finalJobTitles)

  if (contacts.length < 3) {
    const apiContacts = await callApolloAPI(companyDomain, company.name, finalJobTitles, 10)

    if (apiContacts.length > 0) {
      await saveToApolloCache(apiContacts, companyDomain, company.linkedin_url, finalJobTitles)
      contacts = apiContacts
    }
  }

  let savedCount = 0
  for (const contact of contacts) {
    // Skip un-enriched contacts (only have first_name from search, nothing useful)
    if (!contact.last_name && !contact.linkedin_url && !contact.email) continue

    const mobileEntry = contact.phone_numbers?.find((p) => p.type === "mobile")
    const workEntry = contact.phone_numbers?.find((p) => p.type === "work")
    const anyEntry = contact.phone_numbers?.[0]
    const phoneNumber = mobileEntry?.raw_number || mobileEntry?.sanitized_number || contact.sanitized_phone || null
    const workPhone = workEntry?.raw_number || workEntry?.sanitized_number || anyEntry?.raw_number || anyEntry?.sanitized_number || null

    // Check for duplicate: by linkedin_url if available, otherwise by name
    const firstName = contact.first_name || ""
    const lastName = contact.last_name || ""
    const fullName = contact.name || [firstName, lastName].filter(Boolean).join(" ") || "Sin nombre"

    let existingQuery = supabase
      .from("user_company_contacts")
      .select("id")
      .eq("user_id", user.id)
      .eq("company_id", company.id)

    if (contact.linkedin_url) {
      existingQuery = existingQuery.eq("linkedin_url", contact.linkedin_url)
    } else {
      existingQuery = existingQuery.eq("full_name", fullName)
    }

    const { data: existing } = await existingQuery.maybeSingle()

    if (!existing) {
      const { error } = await supabase.from("user_company_contacts").insert({
        user_id: user.id,
        company_id: company.id,
        bookmark_id: bookmarkId,
        first_name: firstName || null,
        last_name: lastName || null,
        full_name: fullName,
        role: contact.title,
        headline: contact.headline,
        email: contact.email,
        email_status: contact.email_status,
        phone: workPhone,
        mobile_phone: phoneNumber,
        linkedin_url: contact.linkedin_url,
        profile_picture_url: contact.photo_url,
        city: contact.city,
        country: contact.country,
        seniority: contact.seniority,
        departments: contact.departments,
        source: "apollo",
        status: "new",
        is_decision_maker: true,
        job_titles_searched: finalJobTitles,
        search_context: bookmark.search_context,
      })

      if (!error) savedCount++
    }
  }

  revalidatePath(`/bookmarks/${bookmarkId}`)

  return { success: true, count: savedCount }
}

// Obtener prospectos (DMs) guardados - busca por company_id para reutilizar entre bookmarks
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

  if (!user) {
    return { success: false, error: "No autorizado" }
  }

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

  if (!user) {
    return { success: false, error: "No autorizado" }
  }

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

// Obtener todos los contactos para icebreakers (incluyendo DMs)
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
