"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { generateText } from "ai"
import { google } from "@ai-sdk/google"

// --- SIGNALS ---

export async function getPrivateSignals(companyId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from("user_company_signals")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  return data || []
}

export async function searchWebSignals(companyId: string, query: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Mocking a web search - In real production this would call Perplexity or similar
  // We simulate finding 2 results
  const mockResults = [
    {
      title: `Caso de Éxito: ${query} en Finanzas`,
      content: "La implementación logró reducir tiempos de respuesta en un 40%...",
      source_url: "https://example.com/case-study",
      source_name: "TechCrunch",
      signal_type: "success_story",
    },
    {
      title: `Nueva regulación impacta a ${query}`,
      content: "Los directivos deben adaptarse a las nuevas normas de cumplimiento...",
      source_url: "https://example.com/news",
      source_name: "Financial Times",
      signal_type: "news",
    },
  ]

  for (const result of mockResults) {
    await supabase.from("user_company_signals").insert({
      user_id: user.id,
      company_id: companyId,
      ...result,
      created_at: new Date().toISOString(),
    })
  }

  revalidatePath(`/bookmarks/${companyId}`)
  return { success: true }
}

// --- CONTACTS ---

export async function getPrivateContacts(companyId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from("user_company_contacts")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  return data || []
}

export async function searchDecisionMakers(companyId: string, role: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

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
      company_id: companyId,
      ...contact,
      status: "new",
    })
  }

  revalidatePath(`/bookmarks/${companyId}`)
  return { success: true }
}

// --- ICEBREAKERS ---

export async function getIcebreakers(companyId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from("user_icebreakers")
    .select("*, contact:contact_id(full_name, role)")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  return data || []
}

export async function generateIcebreaker(companyId: string, contactId: string | null, templateId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // 1. Obtener el template real desde la base de datos
  const { data: templateData, error: templateError } = await supabase
    .from("icebreaker_templates")
    .select("*")
    .eq("id", templateId)
    .single()

  if (templateError || !templateData) {
    throw new Error("Template no encontrado")
  }

  // 2. Obtener contexto: Compañía
  const { data: company } = await supabase.from("companies").select("name, industry").eq("id", companyId).single()

  // 3. Obtener contexto: Contacto (si aplica)
  let contact = null
  if (contactId) {
    const { data: contactData } = await supabase
      .from("user_company_contacts")
      .select("full_name, role")
      .eq("id", contactId)
      .single()
    contact = contactData
  }

  // 4. Obtener contexto: Señales recientes (privadas)
  const { data: signals } = await supabase
    .from("user_company_signals")
    .select("title, content")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .limit(3)

  // 5. Preparar variables para el prompt
  const variables = {
    company_name: company?.name || "la empresa",
    industry: company?.industry || "su industria",
    contact_name: contact?.full_name || "Equipo",
    contact_role: contact?.role || "Líder",
    signal: signals && signals.length > 0 ? signals[0].title : "sus recientes iniciativas",
    tone: templateData.tone,
  }

  // 6. Construir el prompt final reemplazando variables
  let finalPrompt = templateData.prompt_template
  Object.entries(variables).forEach(([key, value]) => {
    finalPrompt = finalPrompt.replace(new RegExp(`{{${key}}}`, "g"), value)
  })

  // 7. Generar con IA (Usando Gemini Pro)
  let generatedText = ""
  try {
    const { text } = await generateText({
      model: google("models/gemini-1.5-pro-latest"),
      prompt: finalPrompt,
      temperature: 0.7,
    })
    generatedText = text
  } catch (error) {
    console.error("AI Generation failed, using fallback", error)
    // Fallback simple si falla la IA
    generatedText = `[Fallo de IA, usando fallback] Hola ${variables.contact_name}, me gustaría conectar respecto a ${variables.company_name} y cómo podemos colaborar.`
  }

  // 8. Guardar resultado
  await supabase.from("user_icebreakers").insert({
    user_id: user.id,
    company_id: companyId,
    contact_id: contactId,
    generated_text: generatedText,
    template_used: templateId, // Guardamos el ID del template para referencia
    context_used: JSON.stringify({ template_name: templateData.name, ...variables }), // Guardamos qué variables se usaron
    tone: templateData.tone,
    created_at: new Date().toISOString(),
  })

  revalidatePath(`/bookmarks/${companyId}`)
  return { success: true }
}

// --- STRATEGY ---

export async function getStrategy(companyId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from("user_company_strategies")
    .select("*")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle()

  return data
}

export async function saveSenderContext(companyId: string, senderContext: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Check if record exists to decide on insert or update (upsert)
  const { data: existing } = await supabase
    .from("user_company_strategies")
    .select("id")
    .eq("company_id", companyId)
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
      company_id: companyId,
      sender_context_override: senderContext,
    })
  }

  revalidatePath(`/bookmarks/${companyId}`)
  return { success: true }
}

export async function analyzeStrategy(companyId: string, website: string, senderContext: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // 1. Simular Scraping (En producción usaríamos Puppeteer/Firecrawl)
  // Aquí usamos la IA para "alucinar" un análisis basado en el dominio, lo cual es muy efectivo con modelos grandes
  // O idealmente le pasamos el contenido real si lo tuviéramos.

  const prompt = `
    Eres un experto Estratega de Ventas B2B.
    
    Analiza la siguiente empresa basada en su sitio web: ${website}
    
    Y este es mi contexto (lo que yo vendo): ${senderContext}
    
    Genera un JSON con estos dos campos:
    1. "target_summary": Un resumen ejecutivo de 2 oraciones sobre qué hace realmente esta empresa y cómo gana dinero.
    2. "recommended_pitch": Una propuesta de valor única (1 párrafo) de cómo MI producto/servicio puede ayudar específicamente a ESTA empresa. Sé específico, no genérico.
  `

  let analysis = { target_summary: "", recommended_pitch: "" }

  try {
    const { text } = await generateText({
      model: google("models/gemini-1.5-pro-latest"),
      prompt: prompt,
      temperature: 0.7,
    })

    // Intentar limpiar el JSON si viene con markdown
    const cleanText = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim()
    analysis = JSON.parse(cleanText)
  } catch (error) {
    console.error("AI Strategy Analysis failed", error)
    return { success: false, error: "Fallo al generar estrategia" }
  }

  // 2. Guardar en DB (Upsert)
  const { data: existing } = await supabase
    .from("user_company_strategies")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle()

  const payload = {
    user_id: user.id,
    company_id: companyId,
    target_summary: analysis.target_summary,
    recommended_pitch: analysis.recommended_pitch,
    updated_at: new Date().toISOString(),
    // Preserve context if it exists, or update it if passed (though saveSenderContext handles that usually)
    sender_context_override: senderContext,
  }

  if (existing) {
    await supabase.from("user_company_strategies").update(payload).eq("id", existing.id)
  } else {
    await supabase.from("user_company_strategies").insert(payload)
  }

  revalidatePath(`/bookmarks/${companyId}`)
  return { success: true, data: payload }
}
