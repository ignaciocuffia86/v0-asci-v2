"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

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

export async function generateIcebreaker(companyId: string, contactId: string | null, template: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Here we would use the Vercel AI SDK to generate the text
  // For now, mocking the AI response
  const generatedText = `Hola ${contactId ? "Nombre" : "Equipo"}, vi sus recientes avances en transformación digital. Dado su foco en ${template}, me gustaría compartir cómo ayudamos a empresas similares a reducir fricción en sus procesos.`

  await supabase.from("user_icebreakers").insert({
    user_id: user.id,
    company_id: companyId,
    contact_id: contactId,
    generated_text: generatedText,
    template_used: template,
    tone: "professional",
    created_at: new Date().toISOString(),
  })

  revalidatePath(`/bookmarks/${companyId}`)
  return { success: true }
}
