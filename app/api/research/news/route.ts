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

function mapKeywordsToDictionary(
  keywords: string[],
  vendorsList: Array<{ id: string; name: string }> | null,
  productMappings: Array<{ name: string; keywords: string[] | null; vendor_id: string }> | null,
  processMappings: Array<{ name: string; keywords: string[] | null }> | null,
) {
  const vendors = new Set<string>()
  const products = new Set<string>()
  const processes = new Set<string>()

  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase().trim()

    // 1. Buscar en productos - match exacto o parcial en keywords
    productMappings?.forEach((p) => {
      const productKeywords = Array.isArray(p.keywords) ? p.keywords : []
      const productNameLower = p.name.toLowerCase()

      // Match exacto en nombre o keywords
      const exactMatch =
        productNameLower === lowerKeyword || productKeywords.some((k: string) => k.toLowerCase() === lowerKeyword)

      // Match parcial - el keyword está contenido en algún keyword del producto o viceversa
      const partialMatch =
        productKeywords.some(
          (k: string) => k.toLowerCase().includes(lowerKeyword) || lowerKeyword.includes(k.toLowerCase()),
        ) ||
        productNameLower.includes(lowerKeyword) ||
        lowerKeyword.includes(productNameLower)

      if (exactMatch || partialMatch) {
        products.add(p.name)
        // Encontrar el vendor asociado
        const vendor = vendorsList?.find((v) => v.id === p.vendor_id)
        if (vendor) {
          vendors.add(vendor.name.trim())
        }
      }
    })

    // 2. Buscar en procesos - match exacto o parcial
    processMappings?.forEach((p) => {
      const processKeywords = Array.isArray(p.keywords) ? p.keywords : []
      const processNameLower = p.name.toLowerCase()

      const exactMatch =
        processNameLower === lowerKeyword || processKeywords.some((k: string) => k.toLowerCase() === lowerKeyword)

      const partialMatch =
        processKeywords.some(
          (k: string) => k.toLowerCase().includes(lowerKeyword) || lowerKeyword.includes(k.toLowerCase()),
        ) ||
        processNameLower.includes(lowerKeyword) ||
        lowerKeyword.includes(processNameLower)

      if (exactMatch || partialMatch) {
        processes.add(p.name)
      }
    })

    // 3. Buscar directamente en vendors por nombre
    vendorsList?.forEach((v) => {
      const vendorNameLower = v.name.toLowerCase().trim()
      if (
        vendorNameLower === lowerKeyword ||
        vendorNameLower.includes(lowerKeyword) ||
        lowerKeyword.includes(vendorNameLower)
      ) {
        vendors.add(v.name.trim())
      }
    })
  }

  return {
    vendors: Array.from(vendors),
    products: Array.from(products),
    processes: Array.from(processes),
  }
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
    vendors: bookmarkTechnologies, // Las tecnologías son los vendors/productos
    products: bookmarkTechnologies,
    processes: bookmarkProcesses,
  }

  console.log("[v0] Variable context for prompt:", variableContext)

  // Obtener el prompt configurado
  const { data: promptConfig } = await supabase
    .from("admin_prompts")
    .select("prompt_text")
    .eq("prompt_key", "news_research")
    .eq("is_active", true)
    .single()

  const basePrompt =
    promptConfig?.prompt_text ||
    "Busca noticias recientes (últimos 6 meses) sobre {company_name} en {industry}. Enfócate en: expansión, nuevos productos/servicios, partnerships, inversiones tecnológicas, cambios de liderazgo, premios/reconocimientos."

  const prompt = replaceVariables(basePrompt, variableContext)

  console.log("[v0] Final prompt to Perplexity:", prompt)

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
            content: `Eres un investigador de negocios. Responde SIEMPRE en formato JSON válido con la siguiente estructura:
{
  "news": [
    {
      "title": "Título de la noticia",
      "summary": "Resumen de 2-3 oraciones",
      "source_url": "URL de la fuente",
      "source_name": "Nombre del medio",
      "published_at": "YYYY-MM-DD",
      "relevance_tags": ["expansion", "new_product", "partnership", "hiring", "funding", "award", "technology", "leadership"]
    }
  ]
}
Solo incluye noticias verificables con fuente. Máximo 10 noticias más relevantes.`,
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

    // Parsear el JSON de la respuesta
    let newsData
    try {
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/)
      const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content
      newsData = JSON.parse(jsonStr)
    } catch (parseError) {
      console.error("Error parsing Perplexity response:", parseError, content)
      return NextResponse.json({ error: "Error al procesar resultados" }, { status: 500 })
    }

    const newsItems = newsData.news || []

    // Insertar las noticias en la base de datos
    const newsToInsert = newsItems.map((item: any) => ({
      bookmark_id: bookmarkId,
      company_id: bookmark.company_id,
      user_id: user.id,
      title: item.title,
      summary: item.summary,
      source_url: item.source_url,
      source_name: item.source_name,
      published_at: item.published_at || null,
      relevance_tags: item.relevance_tags || [],
    }))

    if (newsToInsert.length > 0) {
      for (const news of newsToInsert) {
        const { data: existing } = await supabase
          .from("company_news")
          .select("id")
          .eq("bookmark_id", bookmarkId)
          .eq("title", news.title)
          .maybeSingle()

        if (!existing) {
          await supabase.from("company_news").insert(news)
        }
      }
    }

    const existingContext = bookmark.search_context || {}
    await supabase
      .from("bookmarks")
      .update({
        search_context: {
          ...existingContext,
          last_news_search: new Date().toISOString(),
        },
      })
      .eq("id", bookmarkId)

    return NextResponse.json({
      success: true,
      count: newsToInsert.length,
      message: `Se encontraron ${newsToInsert.length} noticias`,
    })
  } catch (error) {
    console.error("Research news error:", error)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
