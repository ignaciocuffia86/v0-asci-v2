import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
const CACHE_DAYS = 7

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

async function getNewsFromCache(supabase: any, companyId: string) {
  const cacheDate = new Date()
  cacheDate.setDate(cacheDate.getDate() - CACHE_DAYS)

  const { data: cachedNews } = await supabase
    .from("company_news")
    .select("*")
    .eq("company_id", companyId)
    .gte("created_at", cacheDate.toISOString())
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(10)

  return cachedNews
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

  const cachedNews = await getNewsFromCache(supabase, bookmark.company_id)

  if (cachedNews && cachedNews.length > 0) {
    // Devolver noticias del cache
    return NextResponse.json({
      success: true,
      count: cachedNews.length,
      message: `Se encontraron ${cachedNews.length} noticias`,
      news: cachedNews,
    })
  }

  // Si no hay cache, buscar en Perplexity
  const searchContext = bookmark.search_context as {
    filterType?: string
    filtersUsed?: {
      technology?: string[]
      process?: string[]
    }
  } | null

  const bookmarkTechnologies = searchContext?.filtersUsed?.technology || []
  const bookmarkProcesses = searchContext?.filtersUsed?.process || []

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

  try {
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const month = String(sixMonthsAgo.getMonth() + 1).padStart(2, "0")
    const day = String(sixMonthsAgo.getDate()).padStart(2, "0")
    const year = sixMonthsAgo.getFullYear()
    const searchAfterDate = `${month}/${day}/${year}`

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
            content: `Eres un investigador de negocios.

REGLAS IMPORTANTES:
1. SIEMPRE responde en formato JSON válido, sin excepciones.
2. Si no encuentras información, devuelve: {"news": [], "message": "No se encontraron noticias verificables"}
3. NUNCA respondas con texto explicativo fuera del JSON.
4. Solo incluye noticias con fuentes verificables.

Formato de respuesta:
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
  ],
  "message": "Mensaje opcional sobre la búsqueda"
}

Máximo 10 noticias más relevantes.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 4000,
        search_after_date_filter: searchAfterDate,
        web_search_options: {
          search_context_size: "high",
        },
      }),
    })

    if (!perplexityResponse.ok) {
      const error = await perplexityResponse.text()
      console.error("Perplexity error:", error)

      const { data: oldCache } = await supabase
        .from("company_news")
        .select("*")
        .eq("company_id", bookmark.company_id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(10)

      if (oldCache && oldCache.length > 0) {
        return NextResponse.json({
          success: true,
          count: oldCache.length,
          message: `Se encontraron ${oldCache.length} noticias`,
          news: oldCache,
        })
      }

      return NextResponse.json({ error: "Error en búsqueda AI" }, { status: 500 })
    }

    const perplexityData = await perplexityResponse.json()
    const content = perplexityData.choices?.[0]?.message?.content

    if (!content) {
      const { data: oldCache } = await supabase
        .from("company_news")
        .select("*")
        .eq("company_id", bookmark.company_id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(10)

      if (oldCache && oldCache.length > 0) {
        return NextResponse.json({
          success: true,
          count: oldCache.length,
          message: `Se encontraron ${oldCache.length} noticias`,
          news: oldCache,
        })
      }

      return NextResponse.json({ error: "No se encontraron resultados" }, { status: 404 })
    }

    // Verificar si la respuesta empieza con JSON válido
    const trimmedContent = content.trim()
    const startsWithJson =
      trimmedContent.startsWith("{") || trimmedContent.startsWith("[") || trimmedContent.startsWith("```")

    // Frases que indican que Perplexity no pudo acceder a fuentes
    const noAccessPhrases = [
      "no es posible acceder",
      "no puedo acceder",
      "no tengo acceso",
      "currently unable",
      "cannot access",
      "limitaciones actuales",
      "sin acceso operativo",
      "actualmente no es posible",
      "actualmente no",
      "en este momento no",
      "en este momento, no",
      "no se puede garantizar",
      "no es posible verificar",
      "no dispongo de acceso",
      "no cuento con acceso",
      "lo siento",
      "i'm sorry",
      "i cannot",
      "no puedo",
    ]

    const contentLower = content.toLowerCase()
    const isAccessError = !startsWithJson || noAccessPhrases.some((phrase) => contentLower.includes(phrase))

    if (isAccessError && !startsWithJson) {
      // Respuesta no es JSON - intentar devolver cache viejo
      const { data: oldCache } = await supabase
        .from("company_news")
        .select("*")
        .eq("company_id", bookmark.company_id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(10)

      if (oldCache && oldCache.length > 0) {
        return NextResponse.json({
          success: true,
          count: oldCache.length,
          message: `Se encontraron ${oldCache.length} noticias`,
          news: oldCache,
        })
      }

      return NextResponse.json({
        success: true,
        count: 0,
        message: "No se pudieron encontrar noticias verificables en este momento. Intenta nuevamente más tarde.",
        news: [],
      })
    }

    let newsData
    try {
      const jsonMarkdownMatch = content.match(/```json\n?([\s\S]*?)\n?```/)
      if (jsonMarkdownMatch) {
        newsData = JSON.parse(jsonMarkdownMatch[1])
      } else {
        const jsonObjectMatch = content.match(/\{[\s\S]*"news"[\s\S]*\}/)
        if (jsonObjectMatch) {
          newsData = JSON.parse(jsonObjectMatch[0])
        } else {
          newsData = JSON.parse(content)
        }
      }
    } catch (parseError) {
      console.error("Error parsing Perplexity response:", parseError)

      const { data: oldCache } = await supabase
        .from("company_news")
        .select("*")
        .eq("company_id", bookmark.company_id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(10)

      if (oldCache && oldCache.length > 0) {
        return NextResponse.json({
          success: true,
          count: oldCache.length,
          message: `Se encontraron ${oldCache.length} noticias`,
          news: oldCache,
        })
      }

      return NextResponse.json({
        success: true,
        count: 0,
        message: "No se pudieron procesar los resultados. Intenta nuevamente más tarde.",
        news: [],
      })
    }

    const newsItems = newsData.news || []

    const newsToInsert = newsItems.map((item: any) => ({
      bookmark_id: bookmarkId,
      company_id: bookmark.company_id,
      user_id: user.id,
      requested_by: user.id,
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
          .eq("company_id", bookmark.company_id)
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

    const { data: insertedNews } = await supabase
      .from("company_news")
      .select("*")
      .eq("company_id", bookmark.company_id)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(10)

    return NextResponse.json({
      success: true,
      count: insertedNews?.length || newsToInsert.length,
      message:
        newsToInsert.length > 0
          ? `Se encontraron ${newsToInsert.length} noticias`
          : newsData.message || "No se encontraron noticias verificables",
      news: insertedNews || [],
    })
  } catch (error) {
    console.error("Research news error:", error)

    const { data: oldCache } = await supabase
      .from("company_news")
      .select("*")
      .eq("company_id", bookmark.company_id)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(10)

    if (oldCache && oldCache.length > 0) {
      return NextResponse.json({
        success: true,
        count: oldCache.length,
        message: `Se encontraron ${oldCache.length} noticias`,
        news: oldCache,
      })
    }

    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
