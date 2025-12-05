import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
const CACHE_DAYS = 14

function sanitizeDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null

  // Rechazar fechas con placeholders como "XX", "TBD", etc.
  if (/XX|TBD|unknown/i.test(dateStr)) {
    return null
  }

  // Intentar parsear la fecha
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) {
    return null
  }

  // Verificar que sea una fecha razonable (no en el futuro lejano ni muy antigua)
  const now = new Date()
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)

  if (date > now || date < twoYearsAgo) {
    return null
  }

  return date.toISOString().split("T")[0] // Retornar solo YYYY-MM-DD
}

function buildNewsPrompt(context: {
  company_name: string
  industry?: string
  country?: string
}): string {
  const industryText = context.industry ? `(industria: ${context.industry})` : ""
  const countryText = context.country ? `en ${context.country}` : ""

  return `Eres un analista de inteligencia comercial especializado en detectar SEÑALES DE COMPRA y oportunidades de venta B2B.

OBJETIVO: Encontrar noticias que indiquen oportunidades comerciales para equipos de ventas.

SEÑALES DE COMPRA A BUSCAR:
- INVERSIONES: Nuevos proyectos, expansiones, presupuestos aprobados, capex
- TRANSFORMACIÓN: Digitalización, modernización, cambio de sistemas
- CRECIMIENTO: Expansión geográfica, nuevos mercados, adquisiciones
- CAMBIOS EJECUTIVOS: Nuevos CxO, directores, reestructuraciones
- PROBLEMAS/DESAFÍOS: Ineficiencias, multas, crisis que necesiten soluciones
- ALIANZAS: Nuevos partners tecnológicos, integradores, proveedores

EXCLUIR (sin valor comercial):
- Aniversarios, celebraciones, eventos sociales
- Notas de opinión o editoriales genéricas
- RSE o sustentabilidad sin impacto operativo
- Comunicados vacíos sin información concreta
- Rankings o premios sin contexto de negocio

INSTRUCCIONES CRÍTICAS DE FORMATO:
1. Responde ÚNICAMENTE con un objeto JSON válido
2. NO escribas explicaciones, análisis ni texto adicional antes o después del JSON
3. Si no encuentras noticias relevantes, devuelve {"news": []}

INSTRUCCIONES DE CONTENIDO - MUY IMPORTANTE:
4. RESUME cada noticia con TUS PROPIAS PALABRAS - NO copies texto literal de las fuentes
5. El summary debe ser tu ANÁLISIS de por qué la noticia es relevante para ventas B2B
6. Interpreta y sintetiza la información, no la reproduzcas textualmente

INSTRUCCIONES DE URLs - CRÍTICO:
7. COPIA las URLs EXACTAMENTE como aparecen en las fuentes originales
8. NO modifiques, reconstruyas ni inventes URLs
9. Si no tienes la URL exacta, usa el dominio principal del medio (ej: "https://www.df.cl")

FORMATO JSON OBLIGATORIO:
{
  "news": [
    {
      "title": "Título descriptivo de la noticia",
      "summary": "Tu análisis en 2-3 oraciones de qué pasó y por qué es relevante para ventas B2B",
      "source_url": "URL EXACTA de la fuente - NO MODIFICAR",
      "source_name": "Nombre del medio",
      "published_at": "YYYY-MM-DD",
      "category": "inversion|transformacion|crecimiento|ejecutivos|desafios|alianzas"
    }
  ]
}

BÚSQUEDA:
Empresa: "${context.company_name}" ${industryText} ${countryText}
Período: últimos 6 meses
Máximo: 10 noticias relevantes para ventas B2B

Responde SOLO con el JSON, sin texto adicional.`
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

async function getOldCache(supabase: any, companyId: string) {
  const { data: oldCache } = await supabase
    .from("company_news")
    .select("*")
    .eq("company_id", companyId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(10)

  return oldCache
}

async function registerUserInteractions(
  supabase: any,
  userId: string,
  companyId: string,
  newsIds: string[],
  source: "search" | "digest" | "browse" = "search",
) {
  if (newsIds.length === 0) return

  const interactions = newsIds.map((newsId) => ({
    user_id: userId,
    news_id: newsId,
    company_id: companyId,
    source,
    viewed_at: new Date().toISOString(),
  }))

  // Insertar ignorando duplicados (ON CONFLICT DO NOTHING)
  for (const interaction of interactions) {
    await supabase
      .from("user_news_interactions")
      .upsert(interaction, { onConflict: "user_id,news_id", ignoreDuplicates: true })
  }
}

async function getUserViewedNewsIds(supabase: any, userId: string, companyId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("user_news_interactions")
    .select("news_id")
    .eq("user_id", userId)
    .eq("company_id", companyId)

  return new Set(data?.map((r: any) => r.news_id) || [])
}

function extractGroundingUrls(groundingMetadata: any): Map<string, string> {
  const urlMap = new Map<string, string>()

  try {
    // groundingChunks contiene las fuentes reales usadas por Gemini
    const chunks = groundingMetadata?.groundingChunks || []
    for (const chunk of chunks) {
      if (chunk.web?.uri && chunk.web?.title) {
        // Mapear título (o parte de él) a URL real
        const title = chunk.web.title.toLowerCase()
        urlMap.set(title, chunk.web.uri)
      }
    }

    // También revisar groundingSupports que tiene referencias más específicas
    const supports = groundingMetadata?.groundingSupports || []
    for (const support of supports) {
      if (support.groundingChunkIndices) {
        for (const idx of support.groundingChunkIndices) {
          const chunk = chunks[idx]
          if (chunk?.web?.uri) {
            urlMap.set(`chunk_${idx}`, chunk.web.uri)
          }
        }
      }
    }
  } catch (e) {
    console.log("[v0] News: Error extracting grounding URLs:", e)
  }

  return urlMap
}

function findBestUrl(providedUrl: string, groundingUrls: Map<string, string>, sourceName: string): string {
  // Si la URL parece válida (tiene dominio conocido), usarla
  try {
    const url = new URL(providedUrl)
    const domain = url.hostname.replace("www.", "")

    // Buscar en grounding URLs una que coincida con el mismo dominio
    for (const [_, realUrl] of groundingUrls) {
      try {
        const realUrlObj = new URL(realUrl)
        const realDomain = realUrlObj.hostname.replace("www.", "")
        if (realDomain === domain) {
          // Encontramos una URL real del mismo dominio, usarla
          return realUrl
        }
      } catch {}
    }
  } catch {}

  // Si no encontramos match, devolver la URL original
  return providedUrl
}

async function searchWithGemini(
  prompt: string,
): Promise<{ success: boolean; data?: any; error?: string; needsFallback?: boolean; groundingMetadata?: any }> {
  try {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) {
      return { success: false, error: "GOOGLE_GENERATIVE_AI_API_KEY not configured" }
    }

    console.log("[v0] News: Calling Gemini API...")

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        tools: [
          {
            google_search: {},
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 16384,
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] News: Gemini API error:", response.status, errorText)
      return { success: false, error: `Gemini API error: ${response.status} - ${errorText}` }
    }

    const data = await response.json()

    const finishReason = data.candidates?.[0]?.finishReason
    const groundingMetadata = data.candidates?.[0]?.groundingMetadata

    console.log("[v0] News: Gemini response status:", {
      finishReason,
      hasGroundingMetadata: !!groundingMetadata,
      groundingChunksCount: groundingMetadata?.groundingChunks?.length || 0,
    })

    if (finishReason === "MAX_TOKENS") {
      console.error("[v0] News: Gemini ran out of tokens")
      return { success: false, error: "Gemini MAX_TOKENS reached" }
    }

    if (finishReason === "RECITATION") {
      console.log("[v0] News: Gemini RECITATION - will try fallback")
      return { success: false, error: "RECITATION", needsFallback: true }
    }

    if (finishReason === "SAFETY") {
      console.log("[v0] News: Gemini SAFETY - will try fallback")
      return { success: false, error: "SAFETY", needsFallback: true }
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!content) {
      console.error("[v0] News: Gemini no content in response", JSON.stringify(data).substring(0, 500))
      return { success: false, error: "No content from Gemini" }
    }

    console.log("[v0] News: Gemini content received", {
      contentLength: content.length,
      preview: content.substring(0, 200),
    })

    const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*"news"[\s\S]*\}/)
    const jsonContent = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content

    const parsed = JSON.parse(jsonContent)

    if (Array.isArray(parsed)) {
      console.log("[v0] News: Gemini returned direct array with", parsed.length, "items")
      return { success: true, data: { news: parsed }, groundingMetadata }
    }

    return { success: true, data: parsed, groundingMetadata }
  } catch (error) {
    console.error("[v0] News: Gemini error:", error)
    return { success: false, error: String(error) }
  }
}

async function searchWithPerplexity(
  companyName: string,
  industry?: string,
  country?: string,
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const apiKey = process.env.PERPLEXITY_API_KEY
    if (!apiKey) {
      return { success: false, error: "PERPLEXITY_API_KEY not configured" }
    }

    console.log("[v0] News: Calling Perplexity API as fallback...")

    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const dateFilter = `${String(sixMonthsAgo.getMonth() + 1).padStart(2, "0")}/${String(sixMonthsAgo.getDate()).padStart(2, "0")}/${sixMonthsAgo.getFullYear()}`

    const systemPrompt = `Eres un analista de inteligencia comercial. Responde SOLO con un objeto JSON válido.

IMPORTANTE: Resume cada noticia con TUS PROPIAS PALABRAS. NO copies texto literal de las fuentes. Analiza e interpreta la relevancia para ventas B2B.

FORMATO OBLIGATORIO:
{"news":[{"title":"string","summary":"Tu análisis de la noticia y por qué es relevante para ventas","source_url":"string","source_name":"string","published_at":"YYYY-MM-DD","category":"inversion|transformacion|crecimiento|ejecutivos|desafios|alianzas"}]}

Si no encuentras noticias, responde: {"news":[]}`

    const userPrompt = `Busca noticias de los últimos 6 meses sobre "${companyName}"${industry ? ` (industria: ${industry})` : ""}${country ? ` en ${country}` : ""}. Máximo 10 noticias RELEVANTES PARA VENTAS B2B. Resume con tus propias palabras. Responde SOLO JSON.`

    const response = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 4000,
        search_after_date_filter: dateFilter,
        web_search_options: {
          search_context_size: "high",
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] News: Perplexity API error:", response.status, errorText)
      return { success: false, error: `Perplexity API error: ${response.status}` }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      console.error("[v0] News: Perplexity no content in response")
      return { success: false, error: "No content from Perplexity" }
    }

    console.log("[v0] News: Perplexity content received", {
      contentLength: content.length,
      preview: content.substring(0, 200),
    })

    let jsonContent = content.trim()

    if (!jsonContent.startsWith("{") && !jsonContent.startsWith("[")) {
      const jsonMatch = jsonContent.match(/\{[\s\S]*"news"[\s\S]*\}/) || jsonContent.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        jsonContent = jsonMatch[0]
      } else {
        console.error("[v0] News: Perplexity response is not JSON")
        return { success: false, error: "Response is not valid JSON" }
      }
    }

    const parsed = JSON.parse(jsonContent)

    if (Array.isArray(parsed)) {
      return { success: true, data: { news: parsed } }
    }

    return { success: true, data: parsed }
  } catch (error) {
    console.error("[v0] News: Perplexity error:", error)
    return { success: false, error: String(error) }
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
  const { bookmarkId, companyId, companyName, forceRefresh } = body

  console.log("[v0] News: === Starting search ===", { bookmarkId, companyId, companyName, forceRefresh })

  if (!bookmarkId || !companyName) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  if (forceRefresh) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

    if (profile?.role !== "superadmin") {
      return NextResponse.json({ error: "Only superadmins can force refresh" }, { status: 403 })
    }
    console.log("[v0] News: Force refresh requested by superadmin")
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

  if (!forceRefresh) {
    console.log("[v0] News: Step 1 - Checking cache for company:", bookmark.company_id)
    const cachedNews = await getNewsFromCache(supabase, bookmark.company_id)

    if (cachedNews && cachedNews.length > 0) {
      console.log("[v0] News: Cache HIT - Returning", cachedNews.length, "cached news items")

      const newsIds = cachedNews.map((n: any) => n.id)
      await registerUserInteractions(supabase, user.id, bookmark.company_id, newsIds, "search")

      return NextResponse.json({
        success: true,
        count: cachedNews.length,
        message: `Se encontraron ${cachedNews.length} noticias (cache)`,
        news: cachedNews,
        fromCache: true,
      })
    }
    console.log("[v0] News: Cache MISS - No valid cache found, proceeding to AI search")
  } else {
    console.log("[v0] News: Skipping cache due to forceRefresh")
  }

  const { data: company } = await supabase
    .from("companies")
    .select("industry, website, linkedin_url, country")
    .eq("id", companyId)
    .single()

  const promptContext = {
    company_name: companyName,
    industry: company?.industry,
    country: company?.country,
  }

  const prompt = buildNewsPrompt(promptContext)

  console.log("[v0] News: Step 2 - Calling Gemini with context:", promptContext)
  let searchResult = await searchWithGemini(prompt)
  let aiProvider = "gemini"
  let groundingMetadata = searchResult.groundingMetadata

  const geminiNewsCount = searchResult.data?.news?.length || 0
  const needsPerplexityFallback = searchResult.needsFallback || (searchResult.success && geminiNewsCount === 0)

  if (needsPerplexityFallback) {
    console.log("[v0] News: Step 3 - Gemini blocked or empty, trying Perplexity fallback...", {
      reason: searchResult.needsFallback ? searchResult.error : "0 results",
    })
    searchResult = await searchWithPerplexity(companyName, company?.industry, company?.country)
    aiProvider = "perplexity"
    groundingMetadata = null // Perplexity no tiene groundingMetadata
  }

  if (!searchResult.success) {
    console.log("[v0] News: All providers FAILED:", searchResult.error)
    console.log("[v0] News: Step 4 - Checking old cache as last resort...")
    const oldCache = await getOldCache(supabase, bookmark.company_id)

    if (oldCache && oldCache.length > 0) {
      console.log("[v0] News: Found old cache with", oldCache.length, "items")

      const newsIds = oldCache.map((n: any) => n.id)
      await registerUserInteractions(supabase, user.id, bookmark.company_id, newsIds, "search")

      return NextResponse.json({
        success: true,
        count: oldCache.length,
        message: `Se encontraron ${oldCache.length} noticias (cache antiguo)`,
        news: oldCache,
        fromCache: true,
      })
    }

    console.log("[v0] News: No cache available, returning empty")
    return NextResponse.json({
      success: true,
      count: 0,
      message: "No se pudieron encontrar noticias en este momento. Intenta nuevamente más tarde.",
      news: [],
      error: searchResult.error,
    })
  }

  const newsItems = searchResult.data?.news || []
  console.log("[v0] News: SUCCESS - Got", newsItems.length, "results from", aiProvider)

  const groundingUrls = groundingMetadata ? extractGroundingUrls(groundingMetadata) : new Map()
  if (groundingUrls.size > 0) {
    console.log("[v0] News: Extracted", groundingUrls.size, "grounding URLs for validation")
  }

  const newsToInsert = newsItems.map((item: any) => {
    const bestUrl =
      groundingUrls.size > 0 ? findBestUrl(item.source_url, groundingUrls, item.source_name) : item.source_url

    return {
      company_id: bookmark.company_id,
      title: item.title,
      summary: item.summary,
      source_url: bestUrl,
      source_name: item.source_name,
      published_at: sanitizeDate(item.published_at),
      category: item.category || null,
      ai_provider: aiProvider,
    }
  })

  const insertedIds: string[] = []

  if (newsToInsert.length > 0) {
    for (const news of newsToInsert) {
      // Verificar duplicados por source_url
      const { data: existing } = await supabase
        .from("company_news")
        .select("id")
        .eq("company_id", bookmark.company_id)
        .eq("source_url", news.source_url)
        .maybeSingle()

      if (!existing) {
        const { data: inserted } = await supabase.from("company_news").insert(news).select("id").single()

        if (inserted) {
          insertedIds.push(inserted.id)
        }
      } else {
        insertedIds.push(existing.id)
      }
    }
  }

  await registerUserInteractions(supabase, user.id, bookmark.company_id, insertedIds, "search")

  // Actualizar contexto del bookmark
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

  const { data: allNews } = await supabase
    .from("company_news")
    .select("*")
    .eq("company_id", bookmark.company_id)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(10)

  return NextResponse.json({
    success: true,
    count: allNews?.length || newsToInsert.length,
    message:
      newsToInsert.length > 0
        ? `Se encontraron ${newsToInsert.length} noticias`
        : searchResult.data?.search_summary || "No se encontraron noticias verificables",
    news: allNews || [],
  })
}
