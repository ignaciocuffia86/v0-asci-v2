import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"

function replaceVariables(
  prompt: string,
  context: {
    company_name: string
    website?: string
    industry?: string
    linkedin_url?: string
    keywords?: string[]
    vendors?: string[]
    products?: string[]
    processes?: string[]
  },
): string {
  return prompt
    .replace(/{company_name}/g, context.company_name || "")
    .replace(/{website}/g, context.website || "")
    .replace(/{industry}/g, context.industry || "tecnología")
    .replace(/{linkedin_url}/g, context.linkedin_url || "")
    .replace(/{keywords}/g, context.keywords?.join(", ") || "")
    .replace(/{vendors}/g, context.vendors?.join(", ") || "")
    .replace(/{products}/g, context.products?.join(", ") || "")
    .replace(/{processes}/g, context.processes?.join(", ") || "")
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { bookmarkId, companyId, companyName } = body

  if (!bookmarkId || !companyName) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  const { data: bookmark } = await supabase
    .from("bookmarks")
    .select("id, company_id, search_context")
    .eq("id", bookmarkId)
    .eq("user_id", user.id)
    .single()

  if (!bookmark) {
    return NextResponse.json({ error: "Bookmark not found" }, { status: 404 })
  }

  const searchContext = bookmark.search_context as {
    filterType?: string
    filtersUsed?: {
      technology?: string[]
      process?: string[]
    }
  } | null

  // Usar directamente los filtros del bookmark (por qué fue guardado)
  const bookmarkTechnologies = searchContext?.filtersUsed?.technology || []
  const bookmarkProcesses = searchContext?.filtersUsed?.process || []

  console.log("[v0] Bookmark search_context:", searchContext)
  console.log("[v0] Technologies from bookmark:", bookmarkTechnologies)
  console.log("[v0] Processes from bookmark:", bookmarkProcesses)

  const { data: company } = await supabase
    .from("companies")
    .select("industry, website, linkedin_url")
    .eq("id", companyId)
    .single()

  const variableContext = {
    company_name: companyName,
    website: company?.website || "",
    industry: company?.industry || "tecnología",
    linkedin_url: company?.linkedin_url || "",
    keywords: [...bookmarkTechnologies, ...bookmarkProcesses],
    vendors: bookmarkTechnologies,
    products: bookmarkTechnologies,
    processes: bookmarkProcesses,
  }

  console.log("[v0] Variable context for prompt:", variableContext)

  const { data: promptConfig } = await supabase
    .from("admin_prompts")
    .select("prompt_text")
    .eq("prompt_key", "implementations_research")
    .eq("is_active", true)
    .single()

  const basePrompt =
    promptConfig?.prompt_text ||
    "Busca casos de éxito, implementaciones o proyectos tecnológicos realizados EN {company_name}. Busca menciones de proveedores como Accenture, IBM, Deloitte, consultoras o vendors que hayan implementado soluciones."

  const prompt = replaceVariables(basePrompt, variableContext)

  console.log("[v0] Final implementations prompt:", prompt)

  try {
    const perplexityResponse = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: `Eres un investigador de negocios especializado en casos de éxito tecnológicos. Responde SIEMPRE en formato JSON válido con la siguiente estructura:
{
  "implementations": [
    {
      "title": "Título del proyecto o caso de éxito",
      "provider_name": "Nombre del proveedor/consultora que implementó",
      "technology": "Tecnología principal usada (SAP, Oracle, Salesforce, etc.)",
      "summary": "Descripción breve del proyecto (2-3 oraciones)",
      "results": "Resultados obtenidos si se mencionan",
      "source_url": "URL de la fuente",
      "source_name": "Nombre del medio/fuente",
      "published_at": "YYYY-MM-DD o null si no se conoce"
    }
  ]
}
Solo incluye implementaciones verificables con fuente. Máximo 10 casos más relevantes.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 4000,
      }),
    })

    if (!perplexityResponse.ok) {
      const error = await perplexityResponse.text()
      console.error("Perplexity error:", error)
      return NextResponse.json({ error: "Error en búsqueda AI" }, { status: 500 })
    }

    const perplexityData = await perplexityResponse.json()
    const content = perplexityData.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({ error: "No se encontraron resultados" }, { status: 404 })
    }

    let implementationsData
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/)
      const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content
      implementationsData = JSON.parse(jsonStr)
    } catch (parseError) {
      console.error("Error parsing Perplexity response:", parseError, content)
      return NextResponse.json({ error: "Error al procesar resultados" }, { status: 500 })
    }

    const implementations = implementationsData.implementations || []

    const itemsToInsert = implementations.map((item: any) => ({
      bookmark_id: bookmarkId,
      company_id: bookmark.company_id,
      user_id: user.id,
      title: item.title,
      provider_name: item.provider_name,
      technology: item.technology,
      summary: item.summary,
      results: item.results,
      source_url: item.source_url,
      source_name: item.source_name,
      published_at: item.published_at || null,
    }))

    if (itemsToInsert.length > 0) {
      for (const impl of itemsToInsert) {
        const { data: existing } = await supabase
          .from("company_implementations")
          .select("id")
          .eq("bookmark_id", bookmarkId)
          .eq("title", impl.title)
          .maybeSingle()

        if (!existing) {
          await supabase.from("company_implementations").insert(impl)
        }
      }
    }

    const existingContext = bookmark.search_context || {}
    await supabase
      .from("bookmarks")
      .update({
        search_context: {
          ...existingContext,
          last_implementations_search: new Date().toISOString(),
        },
      })
      .eq("id", bookmarkId)

    return NextResponse.json({
      success: true,
      count: itemsToInsert.length,
      message: `Se encontraron ${itemsToInsert.length} implementaciones`,
    })
  } catch (error) {
    console.error("Research implementations error:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
