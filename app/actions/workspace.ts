"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { generateText } from "ai"
import { google } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"

// Configuración de Perplexity (vía OpenAI compatible)
const perplexity = createOpenAI({
  name: "perplexity",
  apiKey: process.env.PERPLEXITY_API_KEY ?? "",
  baseURL: "https://api.perplexity.ai/",
})

// --- SIGNALS ---

export async function getPrivateSignals(bookmarkId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from("user_company_signals")
    .select("*")
    .eq("bookmark_id", bookmarkId) // Filter by bookmark_id
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  return data || []
}

export async function searchWebSignals(bookmarkId: string, query: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Get bookmark to get company_id
  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()
  if (!bookmark) throw new Error("Bookmark not found")

  // 1. Obtener datos de la empresa para contextualizar la búsqueda
  const { data: company } = await supabase
    .from("companies")
    .select("name, industry")
    .eq("id", bookmark.company_id)
    .single()
  const companyName = company?.name || "la empresa"

  try {
    let searchPrompt = ""
    let signalType = "generic"

    if (query === "news") {
      searchPrompt = `
        Investiga noticias recientes de negocios, finanzas y cambios corporativos sobre la empresa "${companyName}".
        Prioriza: Fusiones, adquisiciones, nuevas inversiones, cambios directivos, reportes financieros recientes.
      `
      signalType = "news"
    } else if (query === "success_story") {
      searchPrompt = `
        Busca casos de éxito, testimonios o notas de prensa donde "${companyName}" hable sobre implementación de tecnología, transformación digital o mejoras de procesos.
        Intenta identificar qué software o proveedores han contratado recientemente.
      `
      signalType = "success_story"
    } else if (query === "job_posting") {
      searchPrompt = `
        Busca ofertas de empleo actuales (Job Postings) de "${companyName}" en portales como LinkedIn, Indeed o su sitio de carreras.
        Enfócate en roles de tecnología, operaciones o liderazgo.
        Extrae qué tecnologías mencionan como requisitos (ej: SAP, AWS, Salesforce, Python).
      `
      signalType = "job_posting"
    } else {
      searchPrompt = `
        Investiga en la web sobre: "${query}" relacionado con la empresa "${companyName}".
      `
      signalType = "generic"
    }

    const prompt = `
      ${searchPrompt}
      
      Retorna ÚNICAMENTE un JSON válido (sin markdown) con una lista de 3 a 5 resultados más relevantes.
      El formato debe ser exactamente este array de objetos:
      [
        {
          "title": "Título breve de la señal",
          "content": "Resumen de 2 lineas sobre qué pasó y por qué es relevante",
          "source_url": "URL de la fuente (si la tienes, sino deja vacío)",
          "source_name": "Nombre del medio o fuente",
          "signal_type": "${signalType}" 
        }
      ]
    `

    const { text } = await generateText({
      model: perplexity("sonar-pro"),
      prompt: prompt,
      temperature: 0.1,
    })

    let results = []
    try {
      const cleanJson = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim()
      results = JSON.parse(cleanJson)
    } catch (e) {
      console.error("Error parsing Perplexity JSON", e)
      throw new Error("Error al procesar los resultados de búsqueda")
    }

    for (const result of results) {
      await supabase.from("user_company_signals").insert({
        user_id: user.id,
        company_id: bookmark.company_id, // Still need company_id for reference
        bookmark_id: bookmarkId, // IMPORTANT: Link to bookmark
        title: result.title || "Señal detectada",
        content: result.content || "",
        source_url: result.source_url || "",
        source_name: result.source_name || "Web Search",
        signal_type: result.signal_type || "generic",
        created_at: new Date().toISOString(),
      })
    }

    revalidatePath(`/bookmarks/${bookmarkId}`)
    return { success: true, count: results.length }
  } catch (error) {
    console.error("Web Search failed", error)
    return { success: false, error: "Error al realizar la búsqueda web" }
  }
}

// --- CONTACTS ---

export async function getPrivateContacts(bookmarkId: string) {
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
    .order("created_at", { ascending: false })

  return data || []
}

export async function searchDecisionMakers(bookmarkId: string, role: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Get bookmark to get company_id
  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()
  if (!bookmark) throw new Error("Bookmark not found")

  // Mocking Apollo.io search
  const mockContacts = [
    {
      first_name: "Ana",
      last_name: "García",
      full_name: "Ana García",
      role: role || "Director of Operations",
      email: "ana.garcia@example.com",
      linkedin_url: "https://linkedin.com/in/ana-garcia-mock",
      source: "apollo",
    },
    {
      first_name: "Carlos",
      last_name: "Ruiz",
      full_name: "Carlos Ruiz",
      role: "VP of Technology",
      email: "carlos.ruiz@example.com",
      linkedin_url: "https://linkedin.com/in/carlos-ruiz-mock",
      source: "apollo",
    },
  ]

  for (const contact of mockContacts) {
    await supabase.from("user_company_contacts").insert({
      user_id: user.id,
      company_id: bookmark.company_id,
      bookmark_id: bookmarkId,
      ...contact,
      status: "new",
    })
  }

  revalidatePath(`/bookmarks/${bookmarkId}`)
  return { success: true }
}

// --- ICEBREAKERS ---

export async function getIcebreakers(bookmarkId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from("user_icebreakers")
    .select("*, contact:contact_id(full_name, role)")
    .eq("bookmark_id", bookmarkId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  return data || []
}

export async function generateIcebreaker(bookmarkId: string, contactId: string | null, templateId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()
  if (!bookmark) throw new Error("Bookmark not found")

  // 1. Obtener el template real
  const { data: templateData, error: templateError } = await supabase
    .from("icebreaker_templates")
    .select("*")
    .eq("id", templateId)
    .single()

  if (templateError || !templateData) {
    throw new Error("Template no encontrado")
  }

  // 2. Obtener contexto: Compañía
  const { data: company } = await supabase
    .from("companies")
    .select("name, industry")
    .eq("id", bookmark.company_id)
    .single()

  // 3. Obtener contexto: Contacto
  let contact = null
  if (contactId) {
    const { data: contactData } = await supabase
      .from("user_company_contacts")
      .select("full_name, role")
      .eq("id", contactId)
      .single()
    contact = contactData
  }

  // 4. Obtener contexto: Señales recientes (privadas) del bookmark específico
  const { data: signals } = await supabase
    .from("user_company_signals")
    .select("title, content")
    .eq("bookmark_id", bookmarkId)
    .eq("user_id", user.id)
    .limit(3)

  // 5. Preparar variables
  const variables = {
    company_name: company?.name || "la empresa",
    industry: company?.industry || "su industria",
    contact_name: contact?.full_name || "Equipo",
    contact_role: contact?.role || "Líder",
    signal: signals && signals.length > 0 ? signals[0].title : "sus recientes iniciativas",
    tone: templateData.tone,
  }

  // 6. Prompt
  let finalPrompt = templateData.prompt_template
  Object.entries(variables).forEach(([key, value]) => {
    finalPrompt = finalPrompt.replace(new RegExp(`{{${key}}}`, "g"), value)
  })

  // 7. Generar con IA
  let generatedText = ""
  try {
    const { text } = await generateText({
      model: google("gemini-1.5-flash"), // Reverting to gemini-1.5-flash
      prompt: finalPrompt,
      temperature: 0.7,
    })
    generatedText = text
  } catch (error) {
    console.error("AI Generation failed, using fallback", error)
    generatedText = `[Fallo de IA, usando fallback] Hola ${variables.contact_name}, me gustaría conectar respecto a ${variables.company_name} y cómo podemos colaborar.`
  }

  // 8. Guardar resultado
  await supabase.from("user_icebreakers").insert({
    user_id: user.id,
    company_id: bookmark.company_id,
    bookmark_id: bookmarkId,
    contact_id: contactId,
    generated_text: generatedText,
    template_used: templateId,
    context_used: JSON.stringify({ template_name: templateData.name, ...variables }),
    tone: templateData.tone,
    created_at: new Date().toISOString(),
  })

  revalidatePath(`/bookmarks/${bookmarkId}`)
  return { success: true }
}

// --- STRATEGY ---

export async function getStrategy(bookmarkId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const [strategyResult, profileResult] = await Promise.all([
    supabase
      .from("user_company_strategies")
      .select("*")
      .eq("bookmark_id", bookmarkId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("profiles").select("value_proposition").eq("id", user.id).single(),
  ])

  return {
    strategy: strategyResult.data,
    defaultContext: profileResult.data?.value_proposition || "",
  }
}

export async function saveSenderContext(bookmarkId: string, senderContext: string, saveAsDefault = false) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()
  if (!bookmark) throw new Error("Bookmark not found")

  if (saveAsDefault) {
    // First check if profile exists to avoid errors (though it should exist)
    const { error } = await supabase.from("profiles").update({ value_proposition: senderContext }).eq("id", user.id)

    // If profile doesn't exist, we might need to insert, but usually auth triggers handle this.
    // We'll assume profile exists or update fails gracefully.
    if (error) {
      console.error("Error updating profile default:", error)
    }
  }

  // Upsert strategy using bookmark_id
  const { data: existing } = await supabase
    .from("user_company_strategies")
    .select("id")
    .eq("bookmark_id", bookmarkId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (existing) {
    await supabase
      .from("user_company_strategies")
      .update({ sender_context_override: senderContext, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
  } else {
    await supabase.from("user_company_strategies").insert({
      user_id: user.id,
      company_id: bookmark.company_id,
      bookmark_id: bookmarkId,
      sender_context_override: senderContext,
    })
  }

  revalidatePath(`/bookmarks/${bookmarkId}`)
  return { success: true }
}

export async function analyzeStrategy(bookmarkId: string, website: string, senderContext: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()
  if (!bookmark) throw new Error("Bookmark not found")

  const { data: signals } = await supabase
    .from("user_company_signals")
    .select("title, content, signal_type")
    .eq("bookmark_id", bookmarkId) // Filter by bookmark specific signals
    .eq("user_id", user.id)
    .limit(10)

  let signalsContext = "No hay señales adicionales."
  if (signals && signals.length > 0) {
    signalsContext = signals.map((s) => `- [${s.signal_type}] ${s.title}: ${s.content}`).join("\n")
  }

  const prompt = `
    Eres un experto Estratega de Ventas B2B.
    
    Analiza la siguiente empresa basada en su sitio web: ${website}
    
    Y este es mi contexto (lo que yo vendo): ${senderContext}

    Adicionalmente, he recopilado estas señales clave sobre la empresa que debes considerar en tu análisis:
    ${signalsContext}
    
    Genera un JSON con estos dos campos:
    1. "target_summary": Un resumen ejecutivo de 2 oraciones sobre qué hace realmente esta empresa y cómo gana dinero.
    2. "recommended_pitch": Una propuesta de valor única (1 párrafo) de cómo MI producto/servicio puede ayudar específicamente a ESTA empresa, conectando mi oferta con las señales encontradas (si son relevantes) o su modelo de negocio. Sé específico, no genérico.
  `

  let analysis = { target_summary: "", recommended_pitch: "" }

  try {
    const { text } = await generateText({
      model: google("gemini-1.5-flash"), // Reverting to gemini-1.5-flash
      prompt: prompt,
      temperature: 0.7,
    })

    const cleanText = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim()
    analysis = JSON.parse(cleanText)
  } catch (error) {
    console.error("AI Strategy Analysis failed", error)
    return { success: false, error: "Fallo al generar estrategia" }
  }

  // Upsert
  const { data: existing } = await supabase
    .from("user_company_strategies")
    .select("id")
    .eq("bookmark_id", bookmarkId)
    .eq("user_id", user.id)
    .maybeSingle()

  const payload = {
    user_id: user.id,
    company_id: bookmark.company_id,
    bookmark_id: bookmarkId, // IMPORTANT
    target_summary: analysis.target_summary,
    recommended_pitch: analysis.recommended_pitch,
    updated_at: new Date().toISOString(),
    sender_context_override: senderContext,
  }

  if (existing) {
    await supabase.from("user_company_strategies").update(payload).eq("id", existing.id)
  } else {
    await supabase.from("user_company_strategies").insert(payload)
  }

  revalidatePath(`/bookmarks/${bookmarkId}`)
  return { success: true, data: payload }
}

// --- BOOKMARK CONTEXT & SMART SIGNALS ---

export async function getBookmarkSmartContext(bookmarkId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // 1. Fetch Bookmark Context by bookmarkId
  const { data: bookmark } = await supabase
    .from("bookmarks")
    .select("search_context, company_id")
    .eq("id", bookmarkId)
    .eq("user_id", user.id)
    .single()

  if (!bookmark || !bookmark.search_context) return null

  const { filterType, filterSignalIds } = bookmark.search_context
  if (!filterType || !filterSignalIds || filterSignalIds.length === 0) return null

  // 2. Build Query for Smart Signals (Fetching from global signals table based on company)
  // Smart signals are from the GLOBAL ASCI database, so we query by company_id, not bookmark_id
  let query = supabase
    .from("signals")
    .select(`
      keyword_matched, 
      is_current_employee, 
      contacts:contact_id (
        full_name,
        profile_picture_url,
        current_position_title
      )
    `)
    .eq("company_id", bookmark.company_id)

  if (filterSignalIds.length > 0) {
    query = query.in("signal_id", filterSignalIds)
  }

  if (filterType === "process") {
    query = query.eq("is_current_employee", true)
  }

  const { data: signals } = await query

  if (!signals) return null

  const enrichedSignals = signals.map((s: any) => ({
    keyword: s.keyword_matched,
    contactName: s.contacts?.full_name || "Unknown",
    contactRole: s.contacts?.current_position_title || "Unknown Role",
    contactPhoto: s.contacts?.profile_picture_url,
    isCurrent: s.is_current_employee,
  }))

  return {
    filterType,
    totalSignals: signals.length,
    detailedSignals: enrichedSignals,
    logicUsed: filterType === "technology" ? "Incluye Alumni y Actuales" : "Solo Empleados Actuales",
  }
}
