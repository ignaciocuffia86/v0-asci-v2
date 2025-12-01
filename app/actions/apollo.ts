"use server"

import { createClient } from "@/lib/supabase/server"
import { generateText } from "ai"
import { revalidatePath } from "next/cache"

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
  phone_numbers?: { raw_number: string; type: string }[]
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
): Promise<{ jobTitles: string[]; reasoning: string }> {
  const prompt = `Eres un experto en estructuras organizacionales B2B.
Dado el contexto de búsqueda (tecnologías y/o procesos), devuelve los job titles más relevantes de tomadores de decisión.

Contexto de búsqueda:
- Tecnologías: ${technologies.length > 0 ? technologies.join(", ") : "No especificadas"}
- Procesos: ${processes.length > 0 ? processes.join(", ") : "No especificados"}

Reglas:
1. Si son tecnologías de cloud/infraestructura (AWS, Azure, GCP, Kubernetes, Docker) → incluir CTO, VP Engineering, Cloud Architect, DevOps Manager, IT Director
2. Si son tecnologías de datos (Snowflake, Databricks, BigQuery) → incluir CDO, Data Engineering Manager, Analytics Director, Head of Data
3. Si son tecnologías de software/desarrollo → incluir CTO, VP Engineering, Engineering Manager, Software Architect
4. Si son tecnologías de seguridad → incluir CISO, Security Director, VP Security
5. Si son procesos de transformación digital → incluir COO, Digital Transformation Lead, Chief Digital Officer
6. Si son procesos de RRHH → incluir CHRO, VP People, HR Director
7. Si son procesos financieros → incluir CFO, VP Finance, Controller
8. Siempre incluir variantes y sinónimos comunes (IT Manager = Technology Manager = Systems Manager)
9. Máximo 8 job titles, ordenados por relevancia

Devuelve SOLO un JSON válido con este formato exacto:
{
  "jobTitles": ["CTO", "VP Engineering", "..."],
  "reasoning": "Breve explicación de por qué estos roles (1-2 oraciones)"
}`

  try {
    const { text } = await generateText({
      model: "openai/gpt-4o-mini",
      prompt,
    })

    // Parsear respuesta JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        jobTitles: parsed.jobTitles || [],
        reasoning: parsed.reasoning || "",
      }
    }
  } catch (error) {
    console.error("Error inferring job titles:", error)
  }

  // Fallback genérico si falla la IA
  return {
    jobTitles: ["CTO", "VP Engineering", "IT Director", "Technology Manager"],
    reasoning: "Job titles genéricos por defecto",
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

  // Obtener datos de la compañía
  const { data: company } = await supabase
    .from("companies")
    .select("name, website, linkedin_url")
    .eq("id", bookmark.company_id)
    .single()

  const searchContext = bookmark.search_context || {}
  const filtersUsed = searchContext.filtersUsed || {}

  // Si hay filtros de tecnología/proceso guardados, obtener sus nombres
  let technologies: string[] = []
  let processes: string[] = []

  if (filtersUsed.technology?.length > 0) {
    const { data: products } = await supabase
      .from("dictionary_products")
      .select("name")
      .in("id", filtersUsed.technology)
    technologies = products?.map((p) => p.name) || []
  }

  if (filtersUsed.process?.length > 0) {
    const { data: procs } = await supabase.from("dictionary_processes").select("name").in("id", filtersUsed.process)
    processes = procs?.map((p) => p.name) || []
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

  // Filtrar por compañía
  if (companyDomain) {
    query = query.eq("company_domain", companyDomain)
  } else if (companyLinkedIn) {
    query = query.eq("company_linkedin_url", companyLinkedIn)
  } else {
    return [] // Sin identificador de compañía no podemos buscar en cache
  }

  // Verificar que no sea muy viejo (30 días)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  query = query.gte("created_at", thirtyDaysAgo.toISOString())

  const { data: cached } = await query

  if (!cached || cached.length === 0) return []

  // Filtrar por job titles (al menos uno debe coincidir parcialmente)
  const normalizedJobTitles = jobTitles.map((jt) => jt.toLowerCase())

  return cached
    .filter((c) => {
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
    // Construir parámetros de búsqueda
    const params = new URLSearchParams()

    // Filtrar por compañía usando dominio o nombre
    if (companyDomain) {
      params.append("q_organization_domains", companyDomain)
    } else {
      params.append("q_organization_name", companyName)
    }

    // Agregar job titles
    jobTitles.forEach((title) => {
      params.append("person_titles[]", title)
    })

    params.append("per_page", String(limit))
    params.append("page", "1")

    const response = await fetch(`https://api.apollo.io/api/v1/mixed_people/search?${params.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "x-api-key": apiKey,
      },
    })

    if (!response.ok) {
      console.error("Apollo API error:", response.status, await response.text())
      return []
    }

    const data: ApolloSearchResponse = await response.json()

    // Ahora enriquecemos los contactos con people/bulk_match para obtener emails y teléfonos
    if (data.people && data.people.length > 0) {
      const personIds = data.people.map((p) => p.id)
      const enrichedPeople = await enrichApolloContacts(personIds, apiKey)
      return enrichedPeople
    }

    return data.people || []
  } catch (error) {
    console.error("Error calling Apollo API:", error)
    return []
  }
}

// Enriquecer contactos con datos completos (email, teléfono)
async function enrichApolloContacts(personIds: string[], apiKey: string): Promise<ApolloPersonSearchResult[]> {
  try {
    const response = await fetch("https://api.apollo.io/api/v1/people/bulk_match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        details: personIds.map((id) => ({ id })),
        reveal_personal_emails: true,
        reveal_phone_number: true,
      }),
    })

    if (!response.ok) {
      console.error("Apollo bulk_match error:", response.status)
      return []
    }

    const data = await response.json()
    return data.matches || data.people || []
  } catch (error) {
    console.error("Error enriching Apollo contacts:", error)
    return []
  }
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
    const phoneNumber = contact.phone_numbers?.find((p) => p.type === "mobile")?.raw_number
    const workPhone = contact.phone_numbers?.find((p) => p.type === "work")?.raw_number

    await supabase.from("apollo_contacts_cache").upsert(
      {
        apollo_id: contact.id,
        company_domain: companyDomain,
        company_linkedin_url: companyLinkedIn,
        first_name: contact.first_name,
        last_name: contact.last_name,
        full_name: contact.name || `${contact.first_name} ${contact.last_name}`,
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

  // Obtener bookmark y compañía
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

  // Extraer dominio del website
  let companyDomain: string | null = null
  if (company.website) {
    try {
      const url = new URL(company.website.startsWith("http") ? company.website : `https://${company.website}`)
      companyDomain = url.hostname.replace("www.", "")
    } catch {
      // Si no es URL válida, intentar usarlo como dominio directo
      companyDomain = company.website.replace("www.", "")
    }
  }

  const finalJobTitles = customJobTitles?.length ? customJobTitles : jobTitles

  // 1. Primero buscar en cache
  let contacts = await searchApolloCache(companyDomain, company.linkedin_url, finalJobTitles)

  // 2. Si no hay suficientes en cache, llamar a Apollo API
  if (contacts.length < 3) {
    const apiContacts = await callApolloAPI(companyDomain, company.name, finalJobTitles, 10)

    if (apiContacts.length > 0) {
      // Guardar en cache para futuros usuarios
      await saveToApolloCache(apiContacts, companyDomain, company.linkedin_url, finalJobTitles)
      contacts = apiContacts
    }
  }

  // 3. Guardar en user_company_contacts para este usuario
  let savedCount = 0
  for (const contact of contacts) {
    const phoneNumber = contact.phone_numbers?.find((p) => p.type === "mobile")?.raw_number
    const workPhone = contact.phone_numbers?.find((p) => p.type === "work")?.raw_number

    // Verificar si ya existe este contacto para este usuario/bookmark
    const { data: existing } = await supabase
      .from("user_company_contacts")
      .select("id")
      .eq("user_id", user.id)
      .eq("bookmark_id", bookmarkId)
      .eq("linkedin_url", contact.linkedin_url)
      .maybeSingle()

    if (!existing) {
      const { error } = await supabase.from("user_company_contacts").insert({
        user_id: user.id,
        company_id: company.id,
        bookmark_id: bookmarkId,
        first_name: contact.first_name,
        last_name: contact.last_name,
        full_name: contact.name || `${contact.first_name} ${contact.last_name}`,
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

// Obtener prospectos (DMs) guardados
export async function getProspects(bookmarkId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  const { data } = await supabase
    .from("user_company_contacts")
    .select("*")
    .eq("bookmark_id", bookmarkId)
    .eq("user_id", user.id)
    .eq("is_decision_maker", true)
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

  // Obtener el company_id del bookmark
  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()

  if (!bookmark) return { contacts: [], prospects: [] }

  // Obtener contactos normales de la compañía (de la tabla contacts)
  const { data: contacts } = await supabase
    .from("contacts")
    .select(
      "id, full_name, first_name, headline, current_position_title, linkedin_url, email1, email1_status, phone1, profile_picture_url",
    )
    .eq("current_company_id", bookmark.company_id)
    .limit(50)

  // Obtener prospectos (DMs) del usuario
  const { data: prospects } = await supabase
    .from("user_company_contacts")
    .select("*")
    .eq("bookmark_id", bookmarkId)
    .eq("user_id", user.id)
    .eq("is_decision_maker", true)

  return {
    contacts: contacts || [],
    prospects: (prospects || []).map((p) => ({
      ...p,
      // Normalizar campos para compatibilidad con UI
      current_position_title: p.role,
      email1: p.email,
      email1_status: p.email_status,
      phone1: p.mobile_phone || p.phone,
    })),
  }
}
