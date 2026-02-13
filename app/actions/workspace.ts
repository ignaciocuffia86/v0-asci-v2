"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { debugAIConfiguration, generateGeminiContent, generatePerplexityContent } from "@/lib/ai-service"

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
    .eq("bookmark_id", bookmarkId)
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
        Prioriza: Fusiones, adquisiciones, nuevas inversiones, cambios directivos o gerenciales, reportes financieros recientes, eventos en los que participa, expone o es sponsor.
        Fecha de consulta: ${new Date().toISOString().split("T")[0]}
      `
      signalType = "news"
    } else if (query === "success_story") {
      searchPrompt = `
        Busca casos de éxito, testimonios o notas de prensa donde tanto "${companyName}" o como su proveedor hable sobre implementación de tecnología, transformación digital o mejoras de procesos.
        Intenta identificar qué software o proveedores han contratado recientemente y qué procesos se vieron afectados.
        Fecha de consulta: ${new Date().toISOString().split("T")[0]}
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
      
      Retorna ÚNICAMENTE un JSON válido (sin markdown) con una lista de 5 a 7 resultados más relevantes.
      El formato debe ser exactamente este array de objetos:
      [
        {
          "title": "Título breve de la señal",
          "content": "Resumen de 2 lineas sobre qué pasó y por qué es relevante",
          "source_url": "URL de la fuente (si la tienes, sino deja vacío)",
          "source_name": "Nombre del medio o fuente",
          "signal_type": "${signalType}",
          "published_at": "YYYY-MM-DD (fecha de publicación de la noticia, si no la sabes pon null)"
        }
      ]
    `

    debugAIConfiguration()

    const text = await generatePerplexityContent(prompt)

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
      const baseData = {
        company_id: bookmark.company_id,
        title: result.title || "Señal detectada",
        content: result.content || "",
        source_url: result.source_url || "",
        source_name: result.source_name || "Web Search",
        published_at: result.published_at || null,
        requested_at: new Date().toISOString(),
        requested_by: user.id,
      }

      // Guardar en tabla específica según tipo
      if (signalType === "news") {
        await supabase.from("company_news").insert(baseData)
      } else if (signalType === "success_story") {
        await supabase.from("company_implementations").insert(baseData)
      }

      // También guardar en user_company_signals para mantener compatibilidad
      await supabase.from("user_company_signals").insert({
        user_id: user.id,
        company_id: bookmark.company_id,
        bookmark_id: bookmarkId,
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

  // Resolve company_id from bookmark so contacts survive bookmark deletion
  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()
  if (!bookmark) return []

  const { data } = await supabase
    .from("user_company_contacts")
    .select("*")
    .eq("company_id", bookmark.company_id)
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

  const { data: icebreakers } = await supabase
    .from("user_icebreakers")
    .select("*")
    .eq("bookmark_id", bookmarkId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  if (!icebreakers || icebreakers.length === 0) return []

  // Obtener los contact_ids únicos
  const contactIds = [...new Set(icebreakers.map((ib) => ib.contact_id).filter(Boolean))]

  const contactsMap: Record<string, any> = {}
  if (contactIds.length > 0) {
    // 1. Buscar en tabla contacts (señales públicas)
    const { data: publicContacts } = await supabase
      .from("contacts")
      .select(
        "id, full_name, first_name, headline, current_position_title, profile_picture_url, linkedin_url, email1, email1_status, phone1",
      )
      .in("id", contactIds)

    if (publicContacts) {
      for (const contact of publicContacts) {
        contactsMap[contact.id] = contact
      }
    }

    // 2. Buscar en user_company_contacts (DMs de Apollo) para los IDs que no se encontraron
    const foundIds = Object.keys(contactsMap)
    const missingIds = contactIds.filter((id) => !foundIds.includes(id))

    if (missingIds.length > 0) {
      const { data: privateContacts } = await supabase
        .from("user_company_contacts")
        .select(
          "id, full_name, first_name, last_name, role, headline, profile_picture_url, linkedin_url, email, email_status, phone",
        )
        .in("id", missingIds)
        .eq("user_id", user.id)

      if (privateContacts) {
        for (const contact of privateContacts) {
          // Mapear los campos de user_company_contacts al formato esperado
          contactsMap[contact.id] = {
            id: contact.id,
            full_name: contact.full_name,
            first_name: contact.first_name,
            headline: contact.headline,
            current_position_title: contact.role || contact.headline,
            profile_picture_url: contact.profile_picture_url,
            linkedin_url: contact.linkedin_url,
            email1: contact.email,
            email1_status: contact.email_status,
            phone1: contact.phone,
          }
        }
      }
    }
  }

  // Combinar icebreakers con datos de contacto y limpiar tags
  return icebreakers.map((ib) => ({
    ...ib,
    contact: ib.contact_id ? contactsMap[ib.contact_id] || null : null,
    generated_text: ib.generated_text
      ?.replace(/---LINKEDIN---\s*/gi, "")
      ?.replace(/---EMAIL---\s*/gi, "")
      ?.replace(/\[LINKEDIN\]\s*/gi, "")
      ?.replace(/\[EMAIL\]\s*/gi, "")
      ?.trim(),
  }))
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
      .select("name, industry, website, description")
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
      supabase.from("profiles").select("company, value_proposition").eq("id", user.id).single(),
    ])
    strategyData = strategyResult.data
    profileData = profileResult.data
  }

  const userCompanyName = profileData?.company || "nuestra empresa"
  const valueProposition =
    strategyData?.sender_context_override || profileData?.value_proposition || "soluciones tecnológicas"

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
    company_description: company?.description || "",
    company_website: company?.website || "",
    industry: company?.industry || "su industria",
    contact_name: contact?.full_name || "",
    contact_first_name: contact?.first_name || "",
    contact_last_name: contact?.last_name || "",
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
    user_company_name: userCompanyName,
  }

  const promptTemplate = templateData.prompt_template || ""

  let contextSections = ""

  if (contextOptions.includes("contact")) {
    contextSections += `
👤 CONTACTO:
- Nombre completo: ${variables.contact_name || "NO DISPONIBLE"}
- Nombre de pila: ${variables.contact_first_name || "NO DISPONIBLE"}
- Apellido: ${variables.contact_last_name || "NO DISPONIBLE"}
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
- Descripción: ${variables.company_description || "NO DISPONIBLE"}
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
- NO empieces con "Claro", "Aquí está", "Aquí tienes", "Por supuesto", "El mensaje es", "Mensaje:", "Icebreaker:", etc.
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
    generatedText = await generateGeminiContent(finalPrompt, "gemini-2.5-flash", 0.7, 0)

    // Limpiar respuesta de preámbulos comunes
    generatedText = generatedText
      .replace(/^(Claro|Aquí está|Aquí tienes|Por supuesto|El mensaje es|Mensaje:|Icebreaker:)[\s,:]*/gi, "")
      .replace(/^["']|["']$/g, "")
      .trim()
  } catch (error: any) {
    console.error("AI Generation failed (Gemini 2.5 Flash)", error)

    try {
      console.log("[v0] Attempting fallback to Gemini 2.0 Flash...")
      generatedText = await generateGeminiContent(finalPrompt, "gemini-2.0-flash", 0.7)
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
    message_type: "single",
    created_at: new Date().toISOString(),
  })

  revalidatePath(`/bookmarks/${bookmarkId}`)
  return { success: true }
}

export async function getContactsForIcebreaker(bookmarkId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data: bookmark } = await supabase
    .from("bookmarks")
    .select("company_id, search_context")
    .eq("id", bookmarkId)
    .single()

  if (!bookmark) {
    return []
  }

  const searchContext = bookmark.search_context as {
    filterType?: string
    filtersUsed?: string[]
    filterSignalIds?: string[]
  } | null
  const filterSignalIds = searchContext?.filterSignalIds || null

  // 1. Obtener señales de la empresa con contactos (only current employees for icebreakers)
  let signalQuery = supabase
    .from("signals")
    .select(`
      contact_id,
      signal_id,
      keyword_matched,
      is_current_employee,
      signal_type,
      contacts!inner (
        id,
        full_name,
        first_name,
        headline,
        current_position_title,
        current_position_description,
        profile_picture_url
      )
    `)
    .eq("company_id", bookmark.company_id)
    .eq("is_current_employee", true)

  if (filterSignalIds && filterSignalIds.length > 0) {
    signalQuery = signalQuery.in("signal_id", filterSignalIds)
  }

  const { data: signalContacts, error: signalError } = await signalQuery

  // 2. Obtener nombres de productos Y procesos para los signal_ids únicos
  const signalIds = [...new Set((signalContacts || []).map((s) => s.signal_id).filter(Boolean))]
  const techSignalIds = (signalContacts || [])
    .filter((s) => s.signal_type === "technology")
    .map((s) => s.signal_id)
    .filter(Boolean)
  const processSignalIds = (signalContacts || [])
    .filter((s) => s.signal_type === "process")
    .map((s) => s.signal_id)
    .filter(Boolean)

  const productMap = new Map<string, string>()
  const processMap = new Map<string, string>()

  if (techSignalIds.length > 0) {
    const { data: products } = await supabase
      .from("dictionary_products")
      .select("id, name")
      .in("id", [...new Set(techSignalIds)])
    for (const product of products || []) {
      productMap.set(product.id, product.name)
    }
  }

  if (processSignalIds.length > 0) {
    const { data: processes } = await supabase
      .from("dictionary_processes")
      .select("id, name")
      .in("id", [...new Set(processSignalIds)])
    for (const process of processes || []) {
      processMap.set(process.id, process.name)
    }
  }

  // 3. Agrupar por contacto y juntar productos/procesos
  const contactMap = new Map<string, any>()

  for (const signal of signalContacts || []) {
    const contact = signal.contacts as any
    if (!contact?.id) continue

    if (!contactMap.has(contact.id)) {
      contactMap.set(contact.id, {
        id: contact.id,
        full_name: contact.full_name,
        first_name: contact.first_name,
        headline: contact.headline,
        profile_picture_url: contact.profile_picture_url,
        current_position_title: contact.current_position_title,
        current_position_description: contact.current_position_description,
        products: [] as string[],
        source: "signal" as const,
      })
    }

    const existingProducts = contactMap.get(contact.id).products
    const signalName =
      signal.signal_type === "technology" ? productMap.get(signal.signal_id) : processMap.get(signal.signal_id)

    if (signalName && !existingProducts.includes(signalName)) {
      existingProducts.push(signalName)
    } else if (signal.keyword_matched && !existingProducts.includes(signal.keyword_matched)) {
      existingProducts.push(signal.keyword_matched)
    }
  }

  // 4. Obtener contactos privados (decision makers agregados manualmente)
  // Use company_id so contacts survive bookmark deletion and are reusable
  const { data: privateContacts } = await supabase
    .from("user_company_contacts")
    .select("id, full_name, first_name, role")
    .eq("company_id", bookmark.company_id)
    .eq("user_id", user.id)

  // Agregar contactos privados que no estén ya en el map
  for (const pc of privateContacts || []) {
    if (!contactMap.has(pc.id)) {
      contactMap.set(pc.id, {
        id: pc.id,
        full_name: pc.full_name,
        first_name: pc.first_name,
        role: pc.role,
        profile_picture_url: null,
        source: "private" as const,
        has_signal: false,
        is_current: true, // Private contacts are assumed to be current
        products: [],
        keywords_matched: [],
      })
    }
  }

  return Array.from(contactMap.values())
}

export async function getContactsForIcebreakerFromContacts(bookmarkId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  // Obtener el company_id del bookmark
  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()

  if (!bookmark) return []

  // Obtener contactos de la compañía (de la tabla contacts)
  const { data: contacts } = await supabase
    .from("contacts")
    .select(
      "id, full_name, first_name, headline, current_position_title, linkedin_url, email1, email1_status, phone1, profile_picture_url",
    )
    .eq("current_company_id", bookmark.company_id)
    .limit(50)

  return contacts || []
}

export async function generateSimplifiedIcebreaker(bookmarkId: string, contactId: string, contactSource: string, templateId?: string) {
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

  const searchContext = bookmark.search_context as {
    filterType?: string
    filtersUsed?: string[]
    filterSignalIds?: string[]
  } | null

  const filterSignalIds = searchContext?.filterSignalIds || []
  const filterType = searchContext?.filterType || "general"
  const filtersUsed = searchContext?.filtersUsed || []

  let filterContextName = ""
  if (filterSignalIds.length > 0) {
    if (filterType === "process") {
      const { data: processes } = await supabase.from("dictionary_processes").select("name").in("id", filterSignalIds)
      filterContextName = processes?.map((p) => p.name).join(", ") || filtersUsed.join(", ")
    } else if (filterType === "technology") {
      const { data: products } = await supabase.from("dictionary_products").select("name").in("id", filterSignalIds)
      filterContextName = products?.map((p) => p.name).join(", ") || filtersUsed.join(", ")
    }
  }

  // Obtener nombre de empresa en query separada
  const { data: company } = await supabase.from("companies").select("name").eq("id", bookmark.company_id).single()

  let contactData: any = null
  let signalInfo: any[] = []
  let isSignalContact = false

  if (contactSource === "signal") {
    // Es un contacto de señales públicas - buscar en tabla contacts
    const { data: publicContact } = await supabase
      .from("contacts")
      .select("id, full_name, first_name, headline, current_position_title, current_position_description")
      .eq("id", contactId)
      .single()

    if (publicContact) {
      contactData = {
        id: publicContact.id,
        full_name: publicContact.full_name,
        first_name: publicContact.first_name,
        role: publicContact.current_position_title || publicContact.headline,
        headline: publicContact.headline,
        current_position_description: publicContact.current_position_description,
      }
      isSignalContact = true

      let signalsQuery = supabase
        .from("signals")
        .select("signal_id, keyword_matched, snippet, source_field, signal_type")
        .eq("contact_id", contactId)
        .eq("company_id", bookmark.company_id)

      // Filtrar por tipo de señal según el filterType del contexto
      if (filterType === "process") {
        signalsQuery = signalsQuery.eq("signal_type", "process")
      } else if (filterType === "technology") {
        signalsQuery = signalsQuery.eq("signal_type", "technology")
      }
      // Si es "general", no filtramos por tipo

      // Filtrar por IDs específicos si existen
      if (filterSignalIds.length > 0) {
        signalsQuery = signalsQuery.in("signal_id", filterSignalIds)
      }

      const { data: signals } = await signalsQuery.limit(10)

      if (signals && signals.length > 0) {
        const signalIds = [...new Set(signals.map((s) => s.signal_id).filter(Boolean))]

        if (signalIds.length > 0) {
          let namesMap = new Map<string, string>()

          if (filterType === "process") {
            const { data: processes } = await supabase
              .from("dictionary_processes")
              .select("id, name")
              .in("id", signalIds)
            namesMap = new Map(processes?.map((p) => [p.id, p.name]) || [])
          } else {
            const { data: products } = await supabase.from("dictionary_products").select("id, name").in("id", signalIds)
            namesMap = new Map(products?.map((p) => [p.id, p.name]) || [])
          }

          signalInfo = signals.map((s) => ({
            ...s,
            signal_name: s.signal_id ? namesMap.get(s.signal_id) || undefined : undefined,
          }))
        } else {
          signalInfo = signals
        }
      }
    }
  } else {
    // Es un contacto privado (decision maker) - buscar en user_company_contacts
    const { data: privateContact } = await supabase
      .from("user_company_contacts")
      .select("id, full_name, first_name, role, headline")
      .eq("id", contactId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (privateContact) {
      contactData = privateContact
      isSignalContact = false

      let companySignalsQuery = supabase
        .from("signals")
        .select("signal_id, keyword_matched, signal_type")
        .eq("company_id", bookmark.company_id)
        .eq("is_current_employee", true)

      if (filterType === "process") {
        companySignalsQuery = companySignalsQuery.eq("signal_type", "process")
      } else if (filterType === "technology") {
        companySignalsQuery = companySignalsQuery.eq("signal_type", "technology")
      }

      if (filterSignalIds.length > 0) {
        companySignalsQuery = companySignalsQuery.in("signal_id", filterSignalIds)
      }

      const { data: companySignals } = await companySignalsQuery.limit(10)

      if (companySignals && companySignals.length > 0) {
        const signalIds = [...new Set(companySignals.map((s) => s.signal_id).filter(Boolean))]

        if (signalIds.length > 0) {
          let namesMap = new Map<string, string>()

          if (filterType === "process") {
            const { data: processes } = await supabase
              .from("dictionary_processes")
              .select("id, name")
              .in("id", signalIds)
            namesMap = new Map(processes?.map((p) => [p.id, p.name]) || [])
          } else {
            const { data: products } = await supabase.from("dictionary_products").select("id, name").in("id", signalIds)
            namesMap = new Map(products?.map((p) => [p.id, p.name]) || [])
          }

          const uniqueNames = new Set<string>()
          for (const s of companySignals) {
            const name = s.signal_id ? namesMap.get(s.signal_id) || null : null
            if (name) uniqueNames.add(name)
          }

          signalInfo = Array.from(uniqueNames).map((name) => ({ signal_name: name }))
        }
      }
    }
  }

  if (!contactData) throw new Error("Contact not found")

  const [strategyResult, profileResult] = await Promise.all([
    supabase
      .from("user_company_strategies")
      .select("sender_context_override, recommended_pitch")
      .eq("bookmark_id", bookmarkId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("profiles").select("company, value_proposition").eq("id", user.id).single(),
  ])

  const userCompanyName = profileResult.data?.company || "nuestra empresa"
  const valueProposition = strategyResult.data?.sender_context_override || profileResult.data?.value_proposition || ""

  // Load selected template (or default to first active)
  let templateInstructions = ""
  let templateName = "Default"
  let templateTone = "industry_insight"
  if (templateId) {
    const { data: template } = await supabase
      .from("icebreaker_templates")
      .select("name, tone, prompt_template")
      .eq("id", templateId)
      .single()
    if (template) {
      templateInstructions = template.prompt_template
      templateName = template.name
      templateTone = template.tone
    }
  }
  if (!templateInstructions) {
    const { data: defaultTemplate } = await supabase
      .from("icebreaker_templates")
      .select("name, tone, prompt_template")
      .eq("is_active", true)
      .order("name")
      .limit(1)
      .single()
    if (defaultTemplate) {
      templateInstructions = defaultTemplate.prompt_template
      templateName = defaultTemplate.name
      templateTone = defaultTemplate.tone
    }
  }

  // Load relevant DOCs (user_documents with ai_summary) for context injection
  // Select up to 3 most relevant based on keyword matching with company/industry/signals
  const searchKeywords = [
    filterContextName,
    company?.name,
    contactData.role,
    ...signalInfo.map((s: any) => s.signal_name).filter(Boolean),
  ].filter(Boolean).join(" ").toLowerCase()

  let relevantDocs = ""
  const { data: allDocs } = await supabase
    .from("user_documents")
    .select("title, ai_summary")
    .eq("user_id", user.id)
    .not("ai_summary", "is", null)

  if (allDocs && allDocs.length > 0) {
    // Score each doc by keyword overlap
    const scored = allDocs.map((doc) => {
      const text = `${doc.title} ${doc.ai_summary}`.toLowerCase()
      const words = searchKeywords.split(/\s+/)
      const score = words.filter((w) => w.length > 3 && text.includes(w)).length
      return { ...doc, score }
    })
    const topDocs = scored.sort((a, b) => b.score - a.score).slice(0, 3).filter((d) => d.score > 0)
    if (topDocs.length > 0) {
      relevantDocs = topDocs.map((d) => `- ${d.title}: ${d.ai_summary}`).join("\n")
    }
  }

  // Load user value profile for richer company context
  const { data: valueProfile } = await supabase
    .from("user_value_profiles")
    .select("profile_summary")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const profileSummary = valueProfile?.profile_summary || ""

  // Construir contexto para el prompt
  const firstName = contactData.first_name || contactData.full_name?.split(" ")[0] || ""
  const companyName = company?.name || "la empresa"

  let signalContext = ""
  let filterDescription = ""

  if (filterType === "process" && filterContextName) {
    filterDescription = `PROCESO DE NEGOCIO FILTRADO: ${filterContextName}`
  } else if (filterType === "technology" && filterContextName) {
    filterDescription = `TECNOLOGÍA/PRODUCTO FILTRADO: ${filterContextName}`
  }

  if (isSignalContact && signalInfo.length > 0) {
    const signalsList = signalInfo
      .map((s) => s.signal_name)
      .filter(Boolean)
      .slice(0, 5)
      .join(", ")

    const snippets = signalInfo
      .filter((s) => s.snippet)
      .map((s) => `- ${s.snippet}`)
      .slice(0, 3)
      .join("\n")

    signalContext = `
TIPO DE CONTACTO: Persona con señal detectada
${filterDescription ? filterDescription + "\n" : ""}${filterType === "process" ? "PROCESOS" : "TECNOLOGÍAS"} DETECTADAS EN SU PERFIL: ${signalsList || "No especificadas"}
HEADLINE: ${contactData.headline || "No disponible"}
DESCRIPCIÓN DEL PUESTO ACTUAL:
${contactData.current_position_description || "No disponible"}

FRAGMENTOS RELEVANTES DEL PERFIL:
${snippets || "No hay snippets disponibles"}
`
  } else {
    const signalsList = signalInfo
      .map((s) => s.signal_name)
      .filter(Boolean)
      .join(", ")
    signalContext = `
TIPO DE CONTACTO: Tomador de decisiones (sin señal directa)
${filterDescription ? filterDescription + "\n" : ""}CARGO: ${contactData.role || "No especificado"}
${filterType === "process" ? "PROCESOS" : "TECNOLOGÍAS"} USADAS EN LA EMPRESA: ${signalsList || "No especificadas"}
`
  }

  const signalTypeLabel = filterType === "process" ? "proceso" : "tecnología/producto"
  const signalTypePlural = filterType === "process" ? "procesos" : "tecnologías"

  const snippetsList = signalInfo
    .filter((s) => s.snippet)
    .map((s) => `- ${s.snippet}`)
    .slice(0, 3)
    .join("\n")

  const signalsList = signalInfo
    .map((s) => s.signal_name)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ")

  const prompt = `Eres un experto en ventas B2B consultivas. Escribis mensajes de prospección personalizados, conversacionales y humanos. NUNCA escribas mensajes que suenen a template o a pitch de ventas.

REGLAS GENERALES:
- Idioma: Español rioplatense (vos/sos/tenes), informal pero profesional
- NO uses frases genéricas como "optimizar sus operaciones" o "potenciar sus procesos"
- NO cierres con "Cual consideras seria el camino correcto para ser tenidos en cuenta"
- Cada mensaje debe ser UNICO para esta persona. Extrae algo concreto de su perfil o contexto.
- Usa el nombre de pila (${firstName}), nunca el apellido solo.

═══════════════════════════════════════════════════════════════
DATOS DEL PROSPECTO
═══════════════════════════════════════════════════════════════
Nombre: ${firstName}
Empresa: ${companyName}
Cargo: ${contactData.role || contactData.current_position_title || "No especificado"}
Headline: ${contactData.headline || "No disponible"}
Descripcion del puesto: ${contactData.current_position_description || "No disponible"}
${filterType === "process" ? "Proceso" : "Tecnologia"} detectada: ${filterContextName || signalsList || "No especificada"}
${snippetsList ? `\nFragmentos del perfil:\n${snippetsList}` : ""}

═══════════════════════════════════════════════════════════════
MI EMPRESA (${userCompanyName})
═══════════════════════════════════════════════════════════════
${profileSummary ? `Perfil: ${profileSummary}\n` : ""}Propuesta de valor: ${valueProposition}
${relevantDocs ? `\nCASOS DE EXITO Y EXPERIENCIA RELEVANTE:\n${relevantDocs}` : ""}

═══════════════════════════════════════════════════════════════
INSTRUCCIONES DE TONO Y ENFOQUE
═══════════════════════════════════════════════════════════════
${templateInstructions}

═══════════════════════════════════════════════════════════════
FORMATO DE RESPUESTA
═══════════════════════════════════════════════════════════════
---LINKEDIN---
(mensaje de LinkedIn aqui)

---EMAIL---
(email de seguimiento aqui)

IMPORTANTE: Los mensajes deben sonar como si los escribiera una persona real, no una IA. Evita estructuras rigidas. Se conversacional.`

  // Generar con IA
  let generatedText = ""
  try {
    console.log("[v0] Sending request to Gemini (gemini-2.5-flash)...")
    generatedText = await generateGeminiContent(prompt, "gemini-2.5-flash", 0.7, 0)
    console.log("[v0] Raw generated text:", generatedText)
  } catch (error: any) {
    console.error("AI Generation failed (Gemini 2.5 Flash)", error)

    try {
      console.log("[v0] Attempting fallback to Gemini 2.0 Flash...")
      generatedText = await generateGeminiContent(prompt, "gemini-2.0-flash", 0.7)
    } catch (fallbackError: any) {
      console.error("Fallback AI Generation failed", fallbackError)
      generatedText = `---LINKEDIN---\nHola ${firstName}, vi que en ${companyName} trabajan con ${filterContextName || signalTypeLabel}. Me genera curiosidad como lo estan abordando. Estarias abierto a intercambiar perspectivas?\n\n---EMAIL---\nHola ${firstName}, te escribi por LinkedIn hace unos dias. Queria compartirte algo que puede ser relevante dado tu rol en ${companyName}. Si te interesa, feliz de charlarlo.`
    }
  }

  // Parsear respuesta
  const linkedinMatch =
    generatedText.match(/---LINKEDIN---\s*([\s\S]*?)(?=---EMAIL---|$)/i) ||
    generatedText.match(/\[LINKEDIN\]\s*([\s\S]*?)(?=\[EMAIL\]|---EMAIL---|$)/i)
  const emailMatch =
    generatedText.match(/---EMAIL---\s*([\s\S]*?)$/i) || generatedText.match(/\[EMAIL\]\s*([\s\S]*?)$/i)

  let linkedinMessage = ""
  let emailMessage = ""

  // Limpiar respuesta de preámbulos comunes
  generatedText = generatedText
    .replace(/^(Claro|Aquí está|Aquí tienes|Por supuesto|El mensaje es|Mensaje:|Icebreaker:)[\s,:]*/gi, "")
    .trim()

  if (linkedinMatch && linkedinMatch[1]) {
    linkedinMessage = linkedinMatch[1]
      .trim()
      .replace(/^\[LINKEDIN\]\s*/i, "")
      .replace(/^---LINKEDIN---\s*/i, "")
  }

  if (emailMatch && emailMatch[1]) {
    emailMessage = emailMatch[1]
      .trim()
      .replace(/^\[EMAIL\]\s*/i, "")
      .replace(/^---EMAIL---\s*/i, "")
  }

  // Fallback si el parsing fails
  if (!linkedinMessage && !emailMessage) {
    const parts = generatedText.split(/\n\n+/)
    if (parts.length >= 2) {
      linkedinMessage = parts[0]
        .replace(/^\[LINKEDIN\]\s*/i, "")
        .replace(/^---LINKEDIN---\s*/i, "")
        .trim()
      emailMessage = parts
        .slice(1)
        .join("\n\n")
        .replace(/^\[EMAIL\]\s*/i, "")
        .replace(/^---EMAIL---\s*/i, "")
        .trim()
    } else {
      linkedinMessage = generatedText
        .replace(/^\[LINKEDIN\]\s*/i, "")
        .replace(/^---LINKEDIN---\s*/i, "")
        .trim()
      emailMessage = `Hola ${firstName}, te escribí por LinkedIn hace unos días. ¿Cuál consideras sería el camino correcto para ser tenidos en cuenta ante futuros requerimientos?`
    }
  }

  // Asegurar que el email siempre tenga contenido
  if (!emailMessage || emailMessage.length < 20) {
    emailMessage = `Hola ${firstName}, te escribi por LinkedIn hace unos dias. Queria retomar la conversacion - vi que en ${companyName} trabajan con ${filterContextName || signalTypeLabel} y me parecio relevante compartirte nuestra experiencia en el tema. Si te sirve, feliz de charlarlo sin compromiso.`
  }

  console.log("[v0] Final LinkedIn message:", linkedinMessage)
  console.log("[v0] Final Email message:", emailMessage)

  // Guardar resultados con contexto expandido
  await supabase.from("user_icebreakers").insert({
    user_id: user.id,
    company_id: bookmark.company_id,
    bookmark_id: bookmarkId,
    contact_id: contactId,
    generated_text: linkedinMessage,
    template_used: templateName,
    context_used: JSON.stringify({
      template_name: templateName,
      template_tone: templateTone,
      context_options: ["contact", "company", "search_context", "signals", "strategy", "docs"],
      company_name: companyName,
      contact_name: contactData.full_name || "",
      contact_role: contactData.role || "",
      contact_headline: contactData.headline || "",
      filter_type: filterType,
      filter_context_name: filterContextName,
      signals_list: signalInfo.map((s: any) => s.signal_name).filter(Boolean).join(", "),
      docs_injected: relevantDocs ? true : false,
      strategy: valueProposition,
      user_company_name: userCompanyName,
      signals_count: signalInfo.length,
    }),
    tone: templateTone,
    message_type: "linkedin",
    created_at: new Date().toISOString(),
  })

  await supabase.from("user_icebreakers").insert({
    user_id: user.id,
    company_id: bookmark.company_id,
    bookmark_id: bookmarkId,
    contact_id: contactId,
    generated_text: emailMessage,
    template_used: templateName,
    context_used: JSON.stringify({
      template_name: templateName,
      template_tone: templateTone,
      context_options: ["contact", "company", "search_context", "signals", "strategy", "docs"],
      company_name: companyName,
      contact_name: contactData.full_name || "",
      contact_role: contactData.role || "",
      filter_type: filterType,
      filter_context_name: filterContextName,
      signals_list: signalInfo.map((s: any) => s.signal_name).filter(Boolean).join(", "),
      docs_injected: relevantDocs ? true : false,
      strategy: valueProposition,
      user_company_name: userCompanyName,
      signals_count: signalInfo.length,
    }),
    tone: templateTone,
    message_type: "email",
    created_at: new Date().toISOString(),
  })

  revalidatePath(`/bookmarks/${bookmarkId}`)

  return {
    linkedin: linkedinMessage,
    email: emailMessage,
  }
}

export async function searchWeb(bookmarkId: string, query: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "No autorizado" }

  const { data: bookmark } = await supabase.from("user_bookmarks").select("company_id").eq("id", bookmarkId).single()
  if (!bookmark) return { success: false, error: "Bookmark no encontrado" }

  const { data: company } = await supabase.from("companies").select("name").eq("id", bookmark.company_id).single()
  const companyName = company?.name || "la empresa"

  const currentDate = new Date().toISOString().split("T")[0]

  try {
    let searchPrompt = ""
    let signalType = "generic"

    if (query === "news") {
      searchPrompt = `
        Investiga noticias recientes de negocios, finanzas y cambios corporativos sobre la empresa "${companyName}".
        Prioriza: Fusiones, adquisiciones, nuevas inversiones, cambios directivos o gerenciales, reportes financieros recientes, eventos en los que participa, expone o es sponsor.
        Fecha de hoy: ${currentDate}
      `
      signalType = "news"
    } else if (query === "success_story") {
      searchPrompt = `
        Busca casos de éxito, testimonios o notas de prensa donde tanto "${companyName}" como su proveedor hable sobre implementación de tecnología, transformación digital o mejoras de procesos.
        Intenta identificar qué software o proveedores han contratado recientemente y qué procesos se vieron afectados.
        Fecha de hoy: ${currentDate}
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
      
      Retorna ÚNICAMENTE un JSON válido (sin markdown) con una lista de 5 a 7 resultados más relevantes.
      El formato debe ser exactamente este array de objetos:
      [
        {
          "title": "Título breve de la señal",
          "content": "Resumen de 2 lineas sobre qué pasó y por qué es relevante",
          "source_url": "URL de la fuente (si la tienes, sino deja vacío)",
          "source_name": "Nombre del medio o fuente",
          "signal_type": "${signalType}",
          "published_at": "YYYY-MM-DD (fecha aproximada de publicación de la noticia, si no la sabes usa la fecha de hoy)"
        }
      ]
    `

    debugAIConfiguration()

    const text = await generatePerplexityContent(prompt)

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

    const requestedAt = new Date().toISOString()

    for (const result of results) {
      // Always save to user_company_signals for the user's view
      await supabase.from("user_company_signals").insert({
        user_id: user.id,
        company_id: bookmark.company_id,
        bookmark_id: bookmarkId,
        title: result.title || "Señal detectada",
        content: result.content || "",
        source_url: result.source_url || "",
        source_name: result.source_name || "Web Search",
        signal_type: result.signal_type || "generic",
        created_at: requestedAt,
      })

      // Also save to company_news or company_implementations for digest system
      if (signalType === "news") {
        await supabase.from("company_news").insert({
          company_id: bookmark.company_id,
          title: result.title || "Noticia detectada",
          content: result.content || "",
          source_url: result.source_url || "",
          source_name: result.source_name || "Web Search",
          published_at: result.published_at || currentDate,
          requested_at: requestedAt,
          requested_by: user.id,
        })
      } else if (signalType === "success_story") {
        await supabase.from("company_implementations").insert({
          company_id: bookmark.company_id,
          title: result.title || "Implementación detectada",
          content: result.content || "",
          source_url: result.source_url || "",
          source_name: result.source_name || "Web Search",
          published_at: result.published_at || currentDate,
          requested_at: requestedAt,
          requested_by: user.id,
        })
      }
    }

    revalidatePath(`/bookmarks/${bookmarkId}`)
    return { success: true, count: results.length }
  } catch (error: any) {
    console.error("Web Search failed", error)
    return { success: false, error: "Error al realizar la búsqueda web. Verifique su API Key de Perplexity." }
  }
}

// --- SMART CONTEXT ---

export async function getBookmarkSmartContext(bookmarkId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Obtener bookmark con search_context
  const { data: bookmark } = await supabase
    .from("bookmarks")
    .select("company_id, search_context")
    .eq("id", bookmarkId)
    .single()

  if (!bookmark) return null

  const searchContext = bookmark.search_context || {}
  const filtersUsed = searchContext.filtersUsed || {}
  const filterSignalIds = searchContext.filterSignalIds || []

  // Determinar tipo de filtro usado
  let filterType: "process" | "technology" | "general" = "general"
  let logicUsed = "Todas las señales disponibles"

  if (filtersUsed.process && filtersUsed.process.length > 0) {
    filterType = "process"
    logicUsed = `Proceso: ${filtersUsed.process.join(", ")}`
  } else if (filtersUsed.technology && filtersUsed.technology.length > 0) {
    filterType = "technology"
    logicUsed = `Tecnología: ${filtersUsed.technology.join(", ")}`
  }

  let signalsQuery = supabase
    .from("signals")
    .select(`
      id,
      contact_id,
      signal_id,
      signal_type,
      keyword_matched,
      is_current_employee,
      contacts!inner (
        id,
        full_name,
        current_position_title,
        profile_picture_url,
        linkedin_url,
        email1,
        email1_status,
        email1_type,
        email2,
        email2_status,
        email2_type,
        phone1,
        phone1_type,
        phone2,
        phone2_type
      )
    `)
    .eq("company_id", bookmark.company_id)

  if (filterSignalIds.length > 0) {
    signalsQuery = signalsQuery.in("signal_id", filterSignalIds)
  }

  const { data: signals } = await signalsQuery

  if (!signals || signals.length === 0) {
    return {
      filterType,
      totalSignals: 0,
      currentEmployees: [],
      alumni: [],
      logicUsed,
    }
  }

  // Obtener nombres de productos y procesos
  const techSignalIds = [
    ...new Set(
      signals
        .filter((s) => s.signal_type === "technology")
        .map((s) => s.signal_id)
        .filter(Boolean),
    ),
  ]
  const processSignalIds = [
    ...new Set(
      signals
        .filter((s) => s.signal_type === "process")
        .map((s) => s.signal_id)
        .filter(Boolean),
    ),
  ]

  const productMap = new Map<string, string>()
  const processMap = new Map<string, string>()

  if (techSignalIds.length > 0) {
    const { data: products } = await supabase.from("dictionary_products").select("id, name").in("id", techSignalIds)
    for (const p of products || []) {
      productMap.set(p.id, p.name)
    }
  }

  if (processSignalIds.length > 0) {
    const { data: processes } = await supabase
      .from("dictionary_processes")
      .select("id, name")
      .in("id", processSignalIds)
    for (const p of processes || []) {
      processMap.set(p.id, p.name)
    }
  }

  // Agrupar por contacto
  const contactMap = new Map<
    string,
    {
      contactId: string
      contactName: string
      contactRole: string
      contactPhoto: string | null
      isCurrent: boolean
      keywords: string[]
      linkedinUrl: string | null
      email: string | null
      emailStatus: string | null
      emailType: string | null
      phone: string | null
      phoneType: string | null
    }
  >()

  for (const signal of signals) {
    const contact = signal.contacts as any
    if (!contact?.id) continue

    if (!contactMap.has(contact.id)) {
      const bestEmail = contact.email1 || contact.email2 || null
      const bestEmailStatus = contact.email1 ? contact.email1_status : contact.email2_status
      const bestEmailType = contact.email1 ? contact.email1_type : contact.email2_type
      const bestPhone = contact.phone1 || contact.phone2 || null
      const bestPhoneType = contact.phone1 ? contact.phone1_type : contact.phone2_type

      contactMap.set(contact.id, {
        contactId: contact.id,
        contactName: contact.full_name || "Sin nombre",
        contactRole: contact.current_position_title || "",
        contactPhoto: contact.profile_picture_url,
        isCurrent: signal.is_current_employee,
        keywords: [],
        linkedinUrl: contact.linkedin_url || null,
        email: bestEmail,
        emailStatus: bestEmailStatus || null,
        emailType: bestEmailType || null,
        phone: bestPhone,
        phoneType: bestPhoneType || null,
      })
    }

    const existing = contactMap.get(contact.id)!

    // Actualizar is_current si alguna señal lo indica
    if (signal.is_current_employee) {
      existing.isCurrent = true
    }

    // Agregar keyword
    let keywordName =
      signal.signal_type === "technology" ? productMap.get(signal.signal_id) : processMap.get(signal.signal_id)

    if (!keywordName) keywordName = signal.keyword_matched

    if (keywordName && !existing.keywords.includes(keywordName)) {
      existing.keywords.push(keywordName)
    }
  }

  // Separar empleados actuales y alumni
  const allContacts = Array.from(contactMap.values())
  const currentEmployees = allContacts.filter((c) => c.isCurrent)
  const alumni = allContacts.filter((c) => !c.isCurrent)

  return {
    filterType,
    totalSignals: signals.length,
    currentEmployees,
    alumni,
    logicUsed,
  }
}

export async function getStrategy(bookmarkId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Obtener estrategia específica del bookmark
  const { data: strategy } = await supabase
    .from("user_company_strategies")
    .select("*")
    .eq("bookmark_id", bookmarkId)
    .eq("user_id", user.id)
    .maybeSingle()

  // Obtener contexto por defecto del perfil
  const { data: profile } = await supabase.from("profiles").select("value_proposition").eq("id", user.id).single()

  return {
    strategy,
    defaultContext: profile?.value_proposition || "",
  }
}

export async function saveSenderContext(bookmarkId: string, senderContext: string, saveAsDefault: boolean) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Obtener bookmark para company_id
  const { data: bookmark } = await supabase.from("bookmarks").select("company_id").eq("id", bookmarkId).single()

  if (!bookmark) throw new Error("Bookmark not found")

  // Upsert estrategia del bookmark
  const { error: strategyError } = await supabase.from("user_company_strategies").upsert(
    {
      user_id: user.id,
      company_id: bookmark.company_id,
      bookmark_id: bookmarkId,
      sender_context_override: senderContext,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "bookmark_id,user_id",
    },
  )

  if (strategyError) {
    console.error("Error saving strategy:", strategyError)
    throw new Error("Error al guardar la estrategia")
  }

  // Si saveAsDefault, actualizar también el perfil
  if (saveAsDefault) {
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ value_proposition: senderContext })
      .eq("id", user.id)

    if (profileError) {
      console.error("Error updating profile:", profileError)
    }
  }

  revalidatePath(`/bookmarks/${bookmarkId}`)
  return { success: true }
}
