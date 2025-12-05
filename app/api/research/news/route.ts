import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
const CACHE_DAYS = 14

const NEWS_SYSTEM_PROMPT = `Eres un analista de inteligencia comercial especializado en detectar SEÑALES DE COMPRA y oportunidades de venta B2B.

Tu objetivo es encontrar noticias que indiquen:
- INVERSIONES: Nuevos proyectos, expansiones, presupuestos aprobados, capex
- TRANSFORMACIÓN: Digitalización, modernización, cambio de sistemas
- CRECIMIENTO: Expansión geográfica, nuevos mercados, adquisiciones
- CAMBIOS EJECUTIVOS: Nuevos CxO, directores, reestructuraciones
- PROBLEMAS/DESAFÍOS: Ineficiencias, multas, crisis que necesiten soluciones
- ALIANZAS: Nuevos partners tecnológicos, integradores, proveedores

EXCLUIR (no tienen valor comercial):
- Aniversarios, celebraciones, eventos sociales
- Notas de opinión o editoriales genéricas
- Noticias de RSE o sustentabilidad sin impacto operativo
- Comunicados de prensa vacíos sin información concreta
- Rankings o premios sin contexto de negocio

INSTRUCCIONES CRÍTICAS:
1. Tu respuesta debe ser ÚNICAMENTE un objeto JSON válido
2. NO escribas explicaciones, análisis ni texto adicional
3. Si no encuentras noticias relevantes, devuelve {"news": []}

FORMATO DE RESPUESTA (JSON OBLIGATORIO):
{"news":[{"title":"string","summary":"string con contexto de por qué es relevante para ventas","source_url":"string","source_name":"string","published_at":"YYYY-MM-DD","category":"inversion|transformacion|crecimiento|ejecutivos|desafios|alianzas","relevance_snippet":"fragmento textual de la fuente"}]}`

function buildNewsUserPrompt(context: {
  company_name: string
  industry?: string
  country?: string
  website?: string
}): string {
  return `Busca noticias de los últimos 6 meses sobre "${context.company_name}"${context.industry ? ` (industria: ${context.industry})` : ""}${context.country ? ` en ${context.country}` : ""}.

ENFOQUE: Señales de compra, inversiones, transformación digital, cambios ejecutivos, expansiones, desafíos operativos.
IGNORAR: Aniversarios, eventos sociales, RSE genérico, premios sin contexto.

Devuelve máximo 10 noticias RELEVANTES PARA VENTAS B2B en JSON. SOLO JSON, sin texto adicional.`
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

async function searchWithGemini(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ success: boolean; data?: any; error?: string; needsFallback?: boolean }> {
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
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
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
    console.log("[v0] News: Gemini response status:", { finishReason })

    if (finishReason === "MAX_TOKENS") {
      console.error("[v0] News: Gemini ran out of tokens")
      return { success: false, error: "Gemini MAX_TOKENS reached" }
    }

    if (finishReason === "RECITATION") {
      console.error("[v0] News: Gemini RECITATION - trying fallback")
      return { success: false, error: "RECITATION", needsFallback: true }
    }

    if (finishReason === "SAFETY") {
      console.error("[v0] News: Gemini SAFETY - trying fallback")
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
      return { success: true, data: { news: parsed } }
    }

    return { success: true, data: parsed }
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

    const systemPrompt = `Eres un analista de inteligencia comercial especializado en detectar SEÑALES DE COMPRA y oportunidades de venta B2B. Responde SOLO con un objeto JSON válido, sin explicaciones ni texto adicional.

FORMATO OBLIGATORIO:
{"news":[{"title":"string","summary":"string con contexto de por qué es relevante para ventas","source_url":"string","source_name":"string","published_at":"YYYY-MM-DD","category":"inversion|transformacion|crecimiento|ejecutivos|desafios|alianzas","relevance_snippet":"fragmento textual de la fuente"}]}

Categorías válidas: inversion, transformacion, crecimiento, ejecutivos, desafios, alianzas

Si no encuentras noticias relevantes, responde: {"news":[]}`

    const userPrompt = `Busca noticias de los últimos 6 meses sobre "${companyName}"${industry ? ` (industria: ${industry})` : ""}${country ? ` en ${country}` : ""}. Máximo 10 noticias RELEVANTES PARA VENTAS B2B. Responde SOLO JSON.`

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
  const { bookmarkId, companyId, companyName } = body

  console.log("[v0] News: === Starting search ===", { bookmarkId, companyId, companyName })

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

  const { data: company } = await supabase
    .from("companies")
    .select("industry, website, linkedin_url, country")
    .eq("id", companyId)
    .single()

  const promptContext = {
    company_name: companyName,
    industry: company?.industry,
    country: company?.country,
    website: company?.website,
  }

  const userPrompt = buildNewsUserPrompt(promptContext)

  console.log("[v0] News: Step 2 - Calling Gemini with context:", promptContext)
  let searchResult = await searchWithGemini(NEWS_SYSTEM_PROMPT, userPrompt)
  let aiProvider = "gemini"

  const geminiNewsCount = searchResult.data?.news?.length || 0
  const needsPerplexityFallback = searchResult.needsFallback || (searchResult.success && geminiNewsCount === 0)

  if (needsPerplexityFallback) {
    console.log("[v0] News: Step 3 - Gemini blocked or empty, trying Perplexity fallback...", {
      reason: searchResult.needsFallback ? searchResult.error : "0 results",
    })
    searchResult = await searchWithPerplexity(companyName, company?.industry, company?.country)
    aiProvider = "perplexity"
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

  const newsToInsert = newsItems.map((item: any) => ({
    company_id: bookmark.company_id,
    title: item.title,
    summary: item.summary,
    source_url: item.source_url,
    source_name: item.source_name,
    published_at: item.published_at || null,
    category: item.category || null,
    relevance_snippet: item.relevance_snippet || null,
    ai_provider: aiProvider,
  }))

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
