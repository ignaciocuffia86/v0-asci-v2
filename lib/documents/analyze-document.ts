import { generateGeminiContent } from "@/lib/ai-service"
import { createClient as createServerClient } from "@/lib/supabase/server"

export interface DocumentAnalysis {
  summary: string
  tags: {
    type: "industry" | "technology" | "process"
    value: string
    reference_id: string | null
    confidence: number
  }[]
}

/**
 * Analyze document text with Gemini to extract summary and tags
 * Tags are matched against existing dictionaries (dictionary_products, dictionary_processes)
 * and known industries from the companies table.
 */
export async function analyzeDocument(extractedText: string): Promise<DocumentAnalysis> {
  const supabase = await createServerClient()

  // Fetch dictionaries for matching
  const [{ data: products }, { data: processes }, { data: industries }] = await Promise.all([
    supabase.from("dictionary_products").select("id, name").limit(500),
    supabase.from("dictionary_processes").select("id, name").limit(500),
    supabase.rpc("get_distinct_industries"),
  ])

  const productList = (products || []).map((p: any) => p.name).join(", ")
  const processList = (processes || []).map((p: any) => p.name).join(", ")

  // Get distinct industries - fallback to manual query if RPC doesn't exist
  let industryList = ""
  if (industries) {
    industryList = industries.map((i: any) => i.industry).filter(Boolean).join(", ")
  } else {
    const { data: companiesData } = await supabase
      .from("companies")
      .select("industry")
      .not("industry", "is", null)
      .limit(1000)
    const uniqueIndustries = [...new Set((companiesData || []).map((c: any) => c.industry).filter(Boolean))]
    industryList = uniqueIndustries.join(", ")
  }

  const prompt = `Analiza el siguiente texto de un documento comercial de una empresa de tecnologia / servicios / consultoría. 
Tu objetivo es entender QUE VENDE o QUE OFRECE esta empresa, y extraer información estructurada.

TEXTO DEL DOCUMENTO:
---
${extractedText.slice(0, 15000)}
---

DICCIONARIO DE TECNOLOGIAS CONOCIDAS (matchea contra estos nombres exactos cuando sea posible):
${productList}

DICCIONARIO DE PROCESOS DE NEGOCIO CONOCIDOS (matchea contra estos nombres exactos cuando sea posible):
${processList}

INDUSTRIAS CONOCIDAS EN NUESTRA BASE:
${industryList}

Responde en formato JSON estricto (sin markdown, sin backticks):
{
  "summary": "Resumen conciso (2-4 oraciones) de que ofrece/vende la empresa segun este documento. Enfocate en la propuesta de valor, no en describir el documento.",
  "industries": [
    {"name": "nombre exacto de la industria de la lista", "confidence": 0.9}
  ],
  "technologies": [
    {"name": "nombre exacto del diccionario", "confidence": 0.85}
  ],
  "processes": [
    {"name": "nombre exacto del diccionario", "confidence": 0.8}
  ]
}

REGLAS:
- Para industries, technologies y processes: usa SOLO nombres que existan en los diccionarios proporcionados arriba. Si no hay match exacto, no lo incluyas.
- Confidence: 0.9-1.0 si se menciona explicitamente, 0.7-0.89 si se infiere del contexto, 0.5-0.69 si es una referencia indirecta.
- Devuelve arrays vacios si no hay coincidencias claras.
- El summary debe ser en español.
- Si el documento es un caso de exito, extrae la industria del CLIENTE (no del vendor).`

  const responseText = await generateGeminiContent(prompt, "gemini-2.0-flash", 0.2)

  // Parse JSON response
  let parsed: any
  try {
    // Try to extract JSON from possible markdown code blocks
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("No JSON found in response")
    parsed = JSON.parse(jsonMatch[0])
  } catch (err) {
    console.error("[v0] Failed to parse Gemini analysis response:", responseText.slice(0, 500))
    return { summary: "", tags: [] }
  }

  // Build tag array with reference IDs
  const tags: DocumentAnalysis["tags"] = []

  // Match industries
  for (const ind of parsed.industries || []) {
    tags.push({
      type: "industry",
      value: ind.name,
      reference_id: null, // industries don't have a dictionary table
      confidence: ind.confidence || 0.7,
    })
  }

  // Match technologies against dictionary_products
  for (const tech of parsed.technologies || []) {
    const match = (products || []).find(
      (p: any) => p.name.toLowerCase() === tech.name.toLowerCase()
    )
    if (match) {
      tags.push({
        type: "technology",
        value: match.name,
        reference_id: match.id,
        confidence: tech.confidence || 0.7,
      })
    }
  }

  // Match processes against dictionary_processes
  for (const proc of parsed.processes || []) {
    const match = (processes || []).find(
      (p: any) => p.name.toLowerCase() === proc.name.toLowerCase()
    )
    if (match) {
      tags.push({
        type: "process",
        value: match.name,
        reference_id: match.id,
        confidence: proc.confidence || 0.7,
      })
    }
  }

  return {
    summary: parsed.summary || "",
    tags,
  }
}
