import { generateGeminiContent } from "@/lib/ai-service"
import { createClient } from "@/lib/supabase/server"
import type { UserValueProfile } from "@/app/actions/documents"

/**
 * Generate or regenerate the consolidated value profile for a user
 * by analyzing all their ready documents and their tags.
 */
export async function generateValueProfile(userId: string): Promise<UserValueProfile | null> {
  const supabase = await createClient()

  // Fetch all ready documents with their summaries
  const { data: documents } = await supabase
    .from("user_documents")
    .select("id, title, type, ai_summary, extracted_text")
    .eq("user_id", userId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })

  if (!documents || documents.length === 0) return null

  // Fetch all tags for this user
  const { data: allTags } = await supabase
    .from("document_tags")
    .select("tag_type, tag_value, confidence")
    .eq("user_id", userId)
    .order("confidence", { ascending: false })

  // Deduplicate and rank tags
  const tagsByType: Record<string, Map<string, number>> = {
    industry: new Map(),
    technology: new Map(),
    process: new Map(),
  }

  for (const tag of allTags || []) {
    const existing = tagsByType[tag.tag_type]?.get(tag.tag_value) || 0
    tagsByType[tag.tag_type]?.set(tag.tag_value, Math.max(existing, tag.confidence))
  }

  const sortedIndustries = [...(tagsByType.industry?.entries() || [])].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  const sortedTechnologies = [...(tagsByType.technology?.entries() || [])].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  const sortedProcesses = [...(tagsByType.process?.entries() || [])].sort((a, b) => b[1] - a[1]).map(([name]) => name)

  // Build context from document summaries
  const docSummaries = documents
    .map((d) => `[${d.type.toUpperCase()}] ${d.title}: ${d.ai_summary || "(sin resumen)"}`)
    .join("\n")

  const prompt = `Sos un analista de negocios B2B. Analiza los siguientes documentos de un vendedor de tecnologia/servicios/consultoría y genera un perfil consolidado de su propuesta de valor.

DOCUMENTOS DEL VENDEDOR:
${docSummaries}

TAGS DETECTADOS:
- Industrias target: ${sortedIndustries.join(", ") || "ninguna detectada"}
- Tecnologias: ${sortedTechnologies.join(", ") || "ninguna detectada"}
- Procesos: ${sortedProcesses.join(", ") || "ninguno detectado"}

Genera un resumen consolidado (3-5 oraciones en español) que responda:
1. Que vende o que ofrece esta empresa/vendedor
2. En que industrias tiene experiencia demostrada
3. Con que tecnologias trabaja o tiene expertise
4. Cual es su propuesta de valor diferenciada

Responde SOLO con el texto del resumen, sin formateo markdown ni titulos. Sé específico y concreto basándote en la evidencia de los documentos.`

  const profileSummary = await generateGeminiContent(prompt, "gemini-2.0-flash", 0.3)

  // Upsert value profile
  const { data: existing } = await supabase
    .from("user_value_profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle()

  const profileData = {
    user_id: userId,
    profile_summary: profileSummary.trim(),
    target_industries: sortedIndustries,
    target_technologies: sortedTechnologies,
    target_processes: sortedProcesses,
    raw_analysis: {
      document_count: documents.length,
      tag_counts: {
        industry: sortedIndustries.length,
        technology: sortedTechnologies.length,
        process: sortedProcesses.length,
      },
    },
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  let result: any

  if (existing) {
    const { data, error } = await supabase
      .from("user_value_profiles")
      .update(profileData)
      .eq("id", existing.id)
      .select()
      .single()
    if (error) throw error
    result = data
  } else {
    const { data, error } = await supabase
      .from("user_value_profiles")
      .insert(profileData)
      .select()
      .single()
    if (error) throw error
    result = data
  }

  return result as UserValueProfile
}
