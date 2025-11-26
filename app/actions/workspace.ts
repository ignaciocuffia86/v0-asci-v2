"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { generateText } from "ai"
import { getPerplexityModel, debugAIConfiguration, generateGeminiContent } from "@/lib/ai-service"

const perplexity = getPerplexityModel()

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

    debugAIConfiguration()

    const { text } = await generateText({
      model: perplexity,
      prompt: prompt,
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
  } catch (error: any) {
    console.error("Web Search failed", error)
    return { success: false, error: "Error al realizar la búsqueda web. Verifique su API Key de Perplexity." }
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

export async function generateIcebreaker(
  bookmarkId: string,
  contactId: string | null,
  templateId: string,
  contextOptions: string[] = ["contact", "company", "search_context", "signals", "strategy"],
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: bookmark } = await supabase
    .from("bookmarks")
    .select("company_id, search_context")
    .eq("id", bookmarkId)
    .single()
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

  // 2. Obtener contexto: Compañía (solo si está habilitado)
  let company = null
  if (contextOptions.includes("company")) {
    const { data: companyData } = await supabase
      .from("companies")
      .select("name, industry, website")
      .eq("id", bookmark.company_id)
      .single()
    company = companyData
  }

  // 3. Obtener contexto: Contacto (solo si está habilitado)
  let contact = null
  if (contactId && contextOptions.includes("contact")) {
    const { data: contactData } = await supabase
      .from("user_company_contacts")
      .select("full_name, first_name, last_name, role, linkedin_url")
      .eq("id", contactId)
      .single()
    contact = contactData
  }

  const [signalsResult, newsResult, implementationsResult, snippetsResult] = await Promise.all([
    // Señales privadas del bookmark
    contextOptions.includes("signals")
      ? supabase
          .from("user_company_signals")
          .select("title, content, signal_type")
          .eq("bookmark_id", bookmarkId)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [] }),
    // Noticias de la empresa
    contextOptions.includes("news")
      ? supabase
          .from("company_news")
          .select("title, summary, source_url")
          .eq("bookmark_id", bookmarkId)
          .order("published_at", { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [] }),
    // Implementaciones/Casos de éxito
    contextOptions.includes("implementations")
      ? supabase
          .from("company_implementations")
          .select("title, summary, source_url")
          .eq("bookmark_id", bookmarkId)
          .order("created_at", { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [] }),
    // Snippets (señales tipo snippet o success_story)
    contextOptions.includes("snippets")
      ? supabase
          .from("user_company_signals")
          .select("title, content")
          .eq("bookmark_id", bookmarkId)
          .eq("user_id", user.id)
          .in("signal_type", ["success_story", "snippet"])
          .limit(2)
      : Promise.resolve({ data: [] }),
  ])

  const signals = signalsResult.data || []
  const news = newsResult.data || []
  const implementations = implementationsResult.data || []
  const snippets = snippetsResult.data || []

  let technologies: string[] = []
  let processes: string[] = []
  if (contextOptions.includes("search_context")) {
    const searchContext = bookmark.search_context || {}
    technologies = searchContext.filtersUsed?.technology || []
    processes = searchContext.filtersUsed?.process || []
  }

  let strategyData = null
  let profileData = null
  if (contextOptions.includes("strategy")) {
    const [strategyResult, profileResult] = await Promise.all([
      supabase
        .from("user_company_strategies")
        .select("sender_context_override, recommended_pitch")
        .eq("bookmark_id", bookmarkId)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.from("profiles").select("value_proposition").eq("id", user.id).single(),
    ])
    strategyData = strategyResult.data
    profileData = profileResult.data
  }

  const valueProposition = contextOptions.includes("strategy")
    ? strategyData?.sender_context_override ||
      profileData?.value_proposition ||
      "una propuesta de valor centrada en mejorar la eficiencia"
    : ""

  const formatNews =
    news.length > 0
      ? news.map((n) => `- ${n.title}: ${n.summary || ""}`).join("\n")
      : "No hay noticias recientes disponibles"

  const formatImplementations =
    implementations.length > 0
      ? implementations.map((i) => `- ${i.title}: ${i.summary || ""}`).join("\n")
      : "No hay casos de éxito disponibles"

  const formatSnippets =
    snippets.length > 0
      ? snippets.map((s) => `- ${s.title}: ${s.content || ""}`).join("\n")
      : "No hay snippets disponibles"

  const formatSignals =
    signals.length > 0
      ? signals.map((s) => `- [${s.signal_type}] ${s.title}: ${s.content || ""}`).join("\n")
      : "No hay señales detectadas"

  // Preparar variables con valores seguros
  const variables = {
    company_name: company?.name || "la empresa",
    company_website: company?.website || "",
    industry: company?.industry || "su industria",
    contact_name: contact?.full_name || "",
    contact_first_name: contact?.first_name || "",
    contact_role: contact?.role || "",
    contact_linkedin: contact?.linkedin_url || "",
    technology: technologies.length > 0 ? technologies.join(", ") : "",
    process: processes.length > 0 ? processes.join(", ") : "",
    signal: signals.length > 0 ? signals[0].title : "",
    signals_list: formatSignals,
    news: formatNews,
    implementations: formatImplementations,
    snippets: formatSnippets,
    strategy: valueProposition,
    recommended_pitch: strategyData?.recommended_pitch || "",
    tone: templateData.tone || "profesional",
  }

  const promptTemplate = templateData.prompt_template || ""

  let contextSections = ""

  if (contextOptions.includes("contact")) {
    contextSections += `
👤 CONTACTO:
- Nombre completo: ${variables.contact_name || "NO DISPONIBLE"}
- Nombre de pila: ${variables.contact_first_name || "NO DISPONIBLE"}
- Cargo/Rol: ${variables.contact_role || "NO DISPONIBLE"}
- LinkedIn: ${variables.contact_linkedin || "NO DISPONIBLE"}
`
  }

  if (contextOptions.includes("company")) {
    contextSections += `
🏢 EMPRESA:
- Nombre: ${variables.company_name}
- Industria: ${variables.industry}
- Website: ${variables.company_website || "NO DISPONIBLE"}
`
  }

  if (contextOptions.includes("search_context")) {
    contextSections += `
🎯 CONTEXTO DE BÚSQUEDA (por qué nos interesa):
- Tecnología detectada: ${variables.technology || "NO ESPECIFICADA"}
- Proceso de negocio: ${variables.process || "NO ESPECIFICADO"}
`
  }

  if (contextOptions.includes("news")) {
    contextSections += `
📰 NOTICIAS RECIENTES DE LA EMPRESA:
${variables.news}
`
  }

  if (contextOptions.includes("implementations")) {
    contextSections += `
🏆 CASOS DE ÉXITO / IMPLEMENTACIONES:
${variables.implementations}
`
  }

  if (contextOptions.includes("snippets")) {
    contextSections += `
📝 SNIPPETS Y NOTAS:
${variables.snippets}
`
  }

  if (contextOptions.includes("signals")) {
    contextSections += `
🔍 SEÑALES DETECTADAS:
${variables.signals_list}
`
  }

  if (contextOptions.includes("strategy")) {
    contextSections += `
💼 MI PROPUESTA DE VALOR:
${variables.strategy}
${variables.recommended_pitch ? `\n📋 PITCH RECOMENDADO:\n${variables.recommended_pitch}` : ""}
`
  }

  const finalPrompt = `Eres un experto en ventas B2B generando mensajes de prospección personalizados.

INSTRUCCIONES ESTRICTAS:
- Genera UN SOLO mensaje de icebreaker siguiendo el template proporcionado
- Entrega ÚNICAMENTE el mensaje final listo para enviar
- NO incluyas explicaciones, preámbulos, alternativas ni comentarios
- NO empieces con "Claro", "Aquí está", "El mensaje es", etc.
- El mensaje debe sonar natural, personalizado y usar los datos del contexto
- Si una variable no está disponible, adapta el mensaje naturalmente sin mencionarla

TEMPLATE Y REGLAS A SEGUIR:
${promptTemplate}

═══════════════════════════════════════
CONTEXTO DEL PROSPECTO:
═══════════════════════════════════════
${contextSections}
═══════════════════════════════════════

TONO DEL MENSAJE: ${variables.tone}

Ahora genera el mensaje de icebreaker (SOLO el mensaje, nada más):`

  console.log("[v0] Generating Icebreaker with context options:", contextOptions)

  // Generar con IA
  let generatedText = ""
  try {
    generatedText = await generateGeminiContent(finalPrompt, "gemini-2.0-flash", 0.7)

    // Limpiar respuesta de preámbulos comunes
    generatedText = generatedText
      .replace(/^(Claro|Aquí está|Aquí tienes|Por supuesto|El mensaje es|Mensaje:|Icebreaker:)[\s,:]*/gi, "")
      .replace(/^["']|["']$/g, "")
      .trim()
  } catch (error: any) {
    console.error("AI Generation failed (Gemini 2.0 Direct)", error)

    try {
      console.log("[v0] Attempting fallback to Gemini 1.5 Pro...")
      generatedText = await generateGeminiContent(finalPrompt, "gemini-1.5-pro", 0.7)
      generatedText = generatedText
        .replace(/^(Claro|Aquí está|Aquí tienes|Por supuesto|El mensaje es|Mensaje:|Icebreaker:)[\s,:]*/gi, "")
        .replace(/^["']|["']$/g, "")
        .trim()
    } catch (fallbackError: any) {
      console.error("Fallback AI Generation failed", fallbackError)
      generatedText = `[Error de IA] Hola ${variables.contact_first_name || "Equipo"}, me gustaría conectar respecto a ${variables.company_name}. (Detalle: ${error.message})`
    }
  }

  // Guardar resultado con contexto expandido
  await supabase.from("user_icebreakers").insert({
    user_id: user.id,
    company_id: bookmark.company_id,
    bookmark_id: bookmarkId,
    contact_id: contactId,
    generated_text: generatedText,
    template_used: templateId,
    context_used: JSON.stringify({
      template_name: templateData.name,
      context_options: contextOptions,
      ...variables,
      news_count: news.length,
      implementations_count: implementations.length,
      snippets_count: snippets.length,
      signals_count: signals.length,
    }),
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

  debugAIConfiguration()

  try {
    const text = await generateGeminiContent(prompt, "gemini-2.0-flash", 0.7)

    const cleanText = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim()
    analysis = JSON.parse(cleanText)
  } catch (error: any) {
    console.error("AI Strategy Analysis failed", error)
    return { success: false, error: "Fallo al generar estrategia. Verifique su Google API Key." }
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

  if (!bookmark) return null

  const searchContext = bookmark.search_context || {}
  const { filterType, filterSignalIds } = searchContext

  const isGeneralBookmark = !filterType || !filterSignalIds || filterSignalIds.length === 0

  let query = supabase
    .from("signals")
    .select(`
      keyword_matched, 
      is_current_employee,
      contact_id,
      job_posting_id,
      contacts:contact_id (
        full_name,
        first_name,
        last_name,
        profile_picture_url,
        current_position_title,
        headline
      )
    `)
    .eq("company_id", bookmark.company_id)
    .not("contact_id", "is", null) // Only get signals with contacts (not job postings)

  if (!isGeneralBookmark && filterSignalIds.length > 0) {
    query = query.in("signal_id", filterSignalIds)
  }

  if (filterType === "process") {
    query = query.eq("is_current_employee", true)
  }

  query = query.limit(20)

  const { data: signals, error } = await query

  if (error) {
    console.error("[v0] Error fetching smart context signals:", error)
    return null
  }

  if (!signals || signals.length === 0) return null

  const enrichedSignals = signals.map((s: any) => {
    const contact = s.contacts
    let contactName = "Unknown"
    let contactRole = "Unknown Role"

    if (contact) {
      // Try full_name first, then build from first/last name
      if (contact.full_name && contact.full_name.trim()) {
        contactName = contact.full_name
      } else if (contact.first_name || contact.last_name) {
        contactName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unknown"
      }

      // Try current_position_title first, then headline
      if (contact.current_position_title && contact.current_position_title.trim()) {
        contactRole = contact.current_position_title
      } else if (contact.headline && contact.headline.trim()) {
        contactRole = contact.headline
      }
    }

    return {
      keyword: s.keyword_matched,
      contactName,
      contactRole,
      contactPhoto: contact?.profile_picture_url || null,
      isCurrent: s.is_current_employee,
    }
  })

  return {
    filterType: isGeneralBookmark ? "general" : filterType,
    totalSignals: signals.length,
    detailedSignals: enrichedSignals,
    logicUsed: isGeneralBookmark
      ? "Todas las señales disponibles"
      : filterType === "technology"
        ? "Incluye Alumni y Actuales"
        : "Solo Empleados Actuales",
  }
}
