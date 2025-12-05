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
  const threeYearsAgo = new Date()
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3)

  if (date > now || date < threeYearsAgo) {
    return null
  }

  return date.toISOString().split("T")[0] // Retornar solo YYYY-MM-DD
}

const IMPLEMENTATIONS_SYSTEM_PROMPT = `Eres un buscador de implementaciones tecnológicas. Tu ÚNICA tarea es buscar casos de éxito e implementaciones y devolverlas en formato JSON.

INSTRUCCIONES CRÍTICAS DE FORMATO:
1. Responde ÚNICAMENTE con un objeto JSON válido
2. NO escribas explicaciones, análisis ni texto adicional
3. NO uses markdown, solo JSON puro
4. Si no encuentras implementaciones, devuelve {"implementations": []}

INSTRUCCIONES DE CONTENIDO - MUY IMPORTANTE:
5. RESUME cada implementación con TUS PROPIAS PALABRAS - NO copies texto literal de las fuentes
6. Analiza e interpreta la información, sintetiza los puntos clave
7. El summary debe ser tu descripción del caso, no una cita textual

Busca implementaciones de los últimos 24 meses:
- ERP/Core: SAP, Oracle, Microsoft Dynamics
- CRM: Salesforce, HubSpot, Zoho
- Cloud: AWS, Azure, Google Cloud
- Analytics: Tableau, Power BI, Looker
- Ciberseguridad: firewalls, SOC, identity
- Automatización: RPA, BPM
- eCommerce: plataformas online
- HR: Workday, SuccessFactors

Niveles de evidencia:
- strong: Caso de éxito oficial, comunicado de prensa
- medium: Artículo con fuentes nombradas
- weak: Inferencia indirecta

FORMATO JSON OBLIGATORIO:
{
  "implementations": [
    {
      "title": "Título descriptivo del caso",
      "provider_name": "Nombre del proveedor/implementador",
      "technology": "Tecnología implementada",
      "area": "finanzas|ventas|logistica|rrhh|it|ciberseguridad|ecommerce|operaciones",
      "summary": "Tu descripción del caso en 2-3 oraciones",
      "results": "Resultados obtenidos si están disponibles, o null",
      "evidence_level": "strong|medium|weak",
      "source_url": "URL de la fuente",
      "source_name": "Nombre del medio/sitio",
      "published_at": "YYYY-MM-DD o null"
    }
  ]
}`

function buildImplementationsUserPrompt(context: {
  company_name: string
  industry?: string
  country?: string
  website?: string
  keywords?: string[]
}): string {
  const keywordsText = context.keywords?.length
    ? `\n**Tecnologías/procesos de interés**: ${context.keywords.join(", ")}`
    : ""

  return `Busca implementaciones tecnológicas y casos de éxito realizados EN la siguiente organización (últimos 24 meses):

**Organización**: ${context.company_name}
**Industria**: ${context.industry || "No especificada"}
**País principal**: ${context.country || "No especificado"}
**Sitio web**: ${context.website || "No disponible"}${keywordsText}

Busca en:
1. Secciones de "casos de éxito" o "clientes" de consultoras grandes (Accenture, IBM, Deloitte, etc.)
2. Notas de prensa del vendor o la organización
3. Artículos en medios de tecnología y negocios

Devuelve máximo 10 implementaciones ordenadas por nivel de evidencia (strong primero).`
}

async function getImplementationsFromCache(supabase: any, companyId: string) {
  const cacheDate = new Date()
  cacheDate.setDate(cacheDate.getDate() - CACHE_DAYS)

  const { data: cached } = await supabase
    .from("company_implementations")
    .select("*")
    .eq("company_id", companyId)
    .gte("created_at", cacheDate.toISOString())
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(10)

  return cached
}

async function getOldCache(supabase: any, companyId: string) {
  const { data: oldCache } = await supabase
    .from("company_implementations")
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
  implementationIds: string[],
  source: "search" | "digest" | "browse" = "search",
) {
  if (implementationIds.length === 0) return

  const interactions = implementationIds.map((implId) => ({
    user_id: userId,
    implementation_id: implId,
    company_id: companyId,
    source,
    viewed_at: new Date().toISOString(),
  }))

  for (const interaction of interactions) {
    await supabase
      .from("user_implementation_interactions")
      .upsert(interaction, { onConflict: "user_id,implementation_id", ignoreDuplicates: true })
  }
}

function extractGroundingUrls(groundingMetadata: any): Map<string, string> {
  const urlMap = new Map<string, string>()

  try {
    const chunks = groundingMetadata?.groundingChunks || []
    for (const chunk of chunks) {
      if (chunk.web?.uri && chunk.web?.title) {
        const title = chunk.web.title.toLowerCase()
        urlMap.set(title, chunk.web.uri)
      }
    }

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
    console.log("[v0] Implementations: Error extracting grounding URLs:", e)
  }

  return urlMap
}

function findBestUrl(providedUrl: string, groundingUrls: Map<string, string>, sourceName: string): string {
  try {
    const url = new URL(providedUrl)
    const domain = url.hostname.replace("www.", "")

    for (const [_, realUrl] of groundingUrls) {
      try {
        const realUrlObj = new URL(realUrl)
        const realDomain = realUrlObj.hostname.replace("www.", "")
        if (realDomain === domain) {
          return realUrl
        }
      } catch {}
    }
  } catch {}

  return providedUrl
}

async function searchWithGemini(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ success: boolean; data?: any; error?: string; needsFallback?: boolean; groundingMetadata?: any }> {
  try {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
    if (!apiKey) {
      return { success: false, error: "GOOGLE_GENERATIVE_AI_API_KEY not configured" }
    }

    console.log("[v0] Implementations: Calling Gemini API...")

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
      console.error("[v0] Implementations: Gemini API error:", response.status, errorText)
      return { success: false, error: `Gemini API error: ${response.status} - ${errorText}` }
    }

    const data = await response.json()

    const finishReason = data.candidates?.[0]?.finishReason
    const groundingMetadata = data.candidates?.[0]?.groundingMetadata

    console.log("[v0] Implementations: Gemini response status:", {
      finishReason,
      hasGroundingMetadata: !!groundingMetadata,
      groundingChunksCount: groundingMetadata?.groundingChunks?.length || 0,
    })

    if (finishReason === "MAX_TOKENS") {
      console.error("[v0] Implementations: Gemini ran out of tokens")
      return { success: false, error: "Gemini MAX_TOKENS reached" }
    }

    if (finishReason === "RECITATION") {
      console.log("[v0] Implementations: Gemini RECITATION - will try fallback")
      return { success: false, error: "RECITATION", needsFallback: true }
    }

    if (finishReason === "SAFETY") {
      console.log("[v0] Implementations: Gemini SAFETY - will try fallback")
      return { success: false, error: "SAFETY", needsFallback: true }
    }

    const content = data.candidates?.[0]?.content?.parts?.[0]?.text

    if (!content) {
      console.error("[v0] Implementations: Gemini no content in response", JSON.stringify(data).substring(0, 500))
      return { success: false, error: "No content from Gemini" }
    }

    console.log("[v0] Implementations: Gemini content received", {
      contentLength: content.length,
      preview: content.substring(0, 200),
    })

    const jsonMatch =
      content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*"implementations"[\s\S]*\}/)
    const jsonContent = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content

    const parsed = JSON.parse(jsonContent)

    if (Array.isArray(parsed)) {
      console.log("[v0] Implementations: Gemini returned direct array with", parsed.length, "items")
      return { success: true, data: { implementations: parsed }, groundingMetadata }
    }

    return { success: true, data: parsed, groundingMetadata }
  } catch (error) {
    console.error("[v0] Implementations: Gemini error:", error)
    return { success: false, error: String(error) }
  }
}

async function searchWithPerplexity(
  companyName: string,
  industry?: string,
  country?: string,
  keywords?: string[],
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const apiKey = process.env.PERPLEXITY_API_KEY
    if (!apiKey) {
      return { success: false, error: "PERPLEXITY_API_KEY not configured" }
    }

    console.log("[v0] Implementations: Calling Perplexity API as fallback...")

    const twentyFourMonthsAgo = new Date()
    twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24)
    const dateFilter = `${String(twentyFourMonthsAgo.getMonth() + 1).padStart(2, "0")}/${String(twentyFourMonthsAgo.getDate()).padStart(2, "0")}/${twentyFourMonthsAgo.getFullYear()}`

    const systemPrompt = `Eres un buscador de implementaciones tecnológicas. Responde SOLO con un objeto JSON válido.

IMPORTANTE: Resume cada implementación con TUS PROPIAS PALABRAS. NO copies texto literal de las fuentes. Describe y analiza el caso.

FORMATO OBLIGATORIO:
{"implementations":[{"title":"string","provider_name":"string","technology":"string","area":"finanzas|ventas|logistica|rrhh|it|ciberseguridad|ecommerce|operaciones","summary":"Tu descripción del caso","results":"string o null","evidence_level":"strong|medium|weak","source_url":"string","source_name":"string","published_at":"YYYY-MM-DD"}]}

Si no encuentras implementaciones, responde: {"implementations":[]}`

    const keywordsText = keywords?.length ? ` Tecnologías de interés: ${keywords.join(", ")}.` : ""
    const userPrompt = `Busca implementaciones tecnológicas y casos de éxito realizados EN "${companyName}"${industry ? ` (industria: ${industry})` : ""}${country ? ` en ${country}` : ""}.${keywordsText} Máximo 10 resultados. Resume con tus propias palabras. Responde SOLO JSON.`

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
      console.error("[v0] Implementations: Perplexity API error:", response.status, errorText)
      return { success: false, error: `Perplexity API error: ${response.status}` }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      console.error("[v0] Implementations: Perplexity no content in response")
      return { success: false, error: "No content from Perplexity" }
    }

    console.log("[v0] Implementations: Perplexity content received", {
      contentLength: content.length,
      preview: content.substring(0, 200),
    })

    let jsonContent = content.trim()

    if (!jsonContent.startsWith("{") && !jsonContent.startsWith("[")) {
      const jsonMatch = jsonContent.match(/\{[\s\S]*"implementations"[\s\S]*\}/) || jsonContent.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        jsonContent = jsonMatch[0]
      } else {
        console.error("[v0] Implementations: Perplexity response is not JSON")
        return { success: false, error: "Response is not valid JSON" }
      }
    }

    const parsed = JSON.parse(jsonContent)

    if (Array.isArray(parsed)) {
      return { success: true, data: { implementations: parsed } }
    }

    return { success: true, data: parsed }
  } catch (error) {
    console.error("[v0] Implementations: Perplexity error:", error)
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

  console.log("[v0] Implementations: === Starting search ===", { bookmarkId, companyId, companyName, forceRefresh })

  if (!bookmarkId || !companyName) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
  }

  if (forceRefresh) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

    if (profile?.role !== "superadmin") {
      return NextResponse.json({ error: "Only superadmins can force refresh" }, { status: 403 })
    }
    console.log("[v0] Implementations: Force refresh requested by superadmin")
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
    console.log("[v0] Implementations: Step 1 - Checking cache for company:", bookmark.company_id)
    const cached = await getImplementationsFromCache(supabase, bookmark.company_id)

    if (cached && cached.length > 0) {
      console.log("[v0] Implementations: Cache HIT - Returning", cached.length, "cached items")

      const implIds = cached.map((impl: any) => impl.id)
      await registerUserInteractions(supabase, user.id, bookmark.company_id, implIds, "search")

      return NextResponse.json({
        success: true,
        count: cached.length,
        message: `Se encontraron ${cached.length} implementaciones (cache)`,
        implementations: cached,
        fromCache: true,
      })
    }
    console.log("[v0] Implementations: Cache MISS - No valid cache found, proceeding to AI search")
  } else {
    console.log("[v0] Implementations: Skipping cache due to forceRefresh")
  }

  const { data: company } = await supabase
    .from("companies")
    .select("industry, website, linkedin_url, country")
    .eq("id", companyId)
    .single()

  const searchContext = bookmark.search_context as {
    filtersUsed?: { technology?: string[]; process?: string[] }
  } | null

  const keywords = [...(searchContext?.filtersUsed?.technology || []), ...(searchContext?.filtersUsed?.process || [])]

  const promptContext = {
    company_name: companyName,
    industry: company?.industry,
    country: company?.country,
    website: company?.website,
    keywords,
  }

  const userPrompt = buildImplementationsUserPrompt(promptContext)

  console.log("[v0] Implementations: Step 2 - Calling Gemini with context:", promptContext)
  let searchResult = await searchWithGemini(IMPLEMENTATIONS_SYSTEM_PROMPT, userPrompt)
  let aiProvider = "gemini"
  let groundingMetadata = searchResult.groundingMetadata

  const geminiImplCount = searchResult.data?.implementations?.length || 0
  const needsPerplexityFallback = searchResult.needsFallback || (searchResult.success && geminiImplCount === 0)

  if (needsPerplexityFallback) {
    console.log("[v0] Implementations: Step 3 - Gemini blocked or empty, trying Perplexity fallback...", {
      reason: searchResult.needsFallback ? searchResult.error : "0 results",
    })
    searchResult = await searchWithPerplexity(companyName, company?.industry, company?.country, keywords)
    aiProvider = "perplexity"
    groundingMetadata = null // Perplexity no tiene groundingMetadata
  }

  if (!searchResult.success) {
    console.log("[v0] Implementations: All providers FAILED:", searchResult.error)
    console.log("[v0] Implementations: Step 4 - Checking old cache as last resort...")
    const oldCache = await getOldCache(supabase, bookmark.company_id)

    if (oldCache && oldCache.length > 0) {
      console.log("[v0] Implementations: Found old cache with", oldCache.length, "items")

      const implIds = oldCache.map((impl: any) => impl.id)
      await registerUserInteractions(supabase, user.id, bookmark.company_id, implIds, "search")

      return NextResponse.json({
        success: true,
        count: oldCache.length,
        message: `Se encontraron ${oldCache.length} implementaciones (cache antiguo)`,
        implementations: oldCache,
        fromCache: true,
      })
    }

    console.log("[v0] Implementations: No cache available, returning empty")
    return NextResponse.json({
      success: true,
      count: 0,
      message: "No se pudieron encontrar implementaciones en este momento. Intenta nuevamente más tarde.",
      implementations: [],
      error: searchResult.error,
    })
  }

  const items = searchResult.data?.implementations || []
  console.log("[v0] Implementations: SUCCESS - Got", items.length, "results from", aiProvider)

  const groundingUrls = groundingMetadata ? extractGroundingUrls(groundingMetadata) : new Map()
  if (groundingUrls.size > 0) {
    console.log("[v0] Implementations: Extracted", groundingUrls.size, "grounding URLs for validation")
  }

  const itemsToInsert = items.map((item: any) => {
    const bestUrl =
      groundingUrls.size > 0 ? findBestUrl(item.source_url, groundingUrls, item.source_name) : item.source_url

    return {
      company_id: bookmark.company_id,
      title: item.title,
      provider_name: item.provider_name,
      technology: item.technology,
      area: item.area || null,
      summary: item.summary,
      results: item.results || null,
      evidence_level: item.evidence_level || null,
      source_url: bestUrl,
      source_name: item.source_name,
      published_at: sanitizeDate(item.published_at),
      ai_provider: aiProvider,
    }
  })

  const insertedIds: string[] = []

  if (itemsToInsert.length > 0) {
    for (const impl of itemsToInsert) {
      const { data: existing } = await supabase
        .from("company_implementations")
        .select("id")
        .eq("company_id", bookmark.company_id)
        .eq("source_url", impl.source_url)
        .maybeSingle()

      if (!existing) {
        const { data: inserted } = await supabase.from("company_implementations").insert(impl).select("id").single()

        if (inserted) {
          insertedIds.push(inserted.id)
        }
      } else {
        insertedIds.push(existing.id)
      }
    }
  }

  await registerUserInteractions(supabase, user.id, bookmark.company_id, insertedIds, "search")

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

  const { data: allImpl } = await supabase
    .from("company_implementations")
    .select("*")
    .eq("company_id", bookmark.company_id)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(10)

  return NextResponse.json({
    success: true,
    count: allImpl?.length || itemsToInsert.length,
    message:
      itemsToInsert.length > 0
        ? `Se encontraron ${itemsToInsert.length} implementaciones`
        : searchResult.data?.search_summary || "No se encontraron implementaciones verificables",
    implementations: allImpl || [],
  })
}
