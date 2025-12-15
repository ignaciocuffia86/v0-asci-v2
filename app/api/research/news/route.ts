import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

const TAVILY_API_URL = "https://api.tavily.com/search"
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

function getIndustryTranslations(industry: string | undefined): string[] {
  if (!industry) return ["negocios", "empresas", "corporativo"]

  const translations: Record<string, string[]> = {
    banking: ["banca", "sector bancario", "servicios financieros"],
    insurance: ["seguros", "aseguradoras", "sector asegurador"],
    technology: ["tecnología", "TI", "tecnologías de la información", "tech"],
    retail: ["comercio minorista", "retail", "ventas al detalle"],
    healthcare: ["salud", "sector sanitario", "atención médica"],
    manufacturing: ["manufactura", "industria manufacturera", "fabricación"],
    telecommunications: ["telecomunicaciones", "telcos", "telefonía"],
    energy: ["energía", "sector energético", "utilities"],
    "real estate": ["inmobiliario", "bienes raíces", "real estate"],
    education: ["educación", "sector educativo", "instituciones educativas"],
    logistics: ["logística", "transporte y logística", "supply chain"],
    consulting: ["consultoría", "servicios profesionales", "asesoría"],
    fintech: ["fintech", "tecnología financiera", "servicios financieros digitales"],
    automotive: ["automotriz", "sector automotor", "industria del automóvil"],
    pharmaceuticals: ["farmacéutico", "industria farmacéutica", "farma"],
    construction: ["construcción", "sector constructivo", "infraestructura"],
    hospitality: ["hotelería", "turismo", "hospitalidad"],
    agriculture: ["agricultura", "agroindustria", "sector agropecuario"],
    mining: ["minería", "sector minero", "extractivo"],
  }

  const industryLower = industry.toLowerCase()
  return translations[industryLower] || [industry, `sector ${industry}`, `industria ${industry}`]
}

function buildPerplexityPrompt(context: {
  company_name: string
  industry?: string
  country?: string
  website?: string
  description?: string
}): { system: string; user: string } {
  const system = `Eres un analista de inteligencia comercial B2B especializado en detectar SEÑALES DE COMPRA para equipos de ventas.

IMPORTANTE:
1. Responde ÚNICAMENTE con un objeto JSON válido
2. Resume con TUS PROPIAS PALABRAS - NO copies texto literal
3. NO incluyas "source_url" en el JSON (se extraerá de tus citations)
4. Máximo 15 noticias (prioriza calidad sobre cantidad)

FORMATO JSON OBLIGATORIO:
{
  "news": [
    {
      "title": "string",
      "summary": "Tu análisis de por qué es relevante para ventas B2B (150-250 caracteres)",
      "source_name": "string (nombre del medio)",
      "published_at": "YYYY-MM-DD",
      "category": "inversion|transformacion|crecimiento|ejecutivos|desafios|alianzas|regulatorio|ma|innovacion"
    }
  ]
}

Si no encuentras noticias, responde: {"news":[]}`

  const industryTerms = getIndustryTranslations(context.industry)
  const industryText = industryTerms.join(" OR ")
  const countryText = context.country || "global"

  const user = `Busca noticias de los últimos 6 meses sobre "${context.company_name}" (industria: ${industryText}) en ${countryText}.

🎯 SEÑALES DE COMPRA PRIORITARIAS:

1. **INVERSIONES Y PRESUPUESTOS**
   - Inversiones en tecnología, infraestructura, transformación digital
   - Anuncios de presupuestos o CAPEX
   - Adquisición de nuevos sistemas o plataformas
   - Proyectos de modernización o renovación

2. **TRANSFORMACIÓN E INNOVACIÓN**
   - Transformación digital en curso
   - Modernización de sistemas legacy
   - Innovación en productos, servicios o procesos
   - Adopción de nuevas tecnologías (AI, cloud, IoT, blockchain, automatización)
   - Programas de innovación abierta

3. **EXPANSIÓN Y CRECIMIENTO**
   - Apertura de nuevas oficinas, sucursales o centros
   - Entrada a nuevos mercados o países
   - Lanzamiento de nuevos productos o servicios
   - Aumento de capacidad operativa
   - Planes de contratación masiva

4. **CAMBIOS DE LIDERAZGO**
   - Nuevos ejecutivos nivel C (CEO, CTO, CFO, CIO, CISO, CDO, COO)
   - Nuevos directores o VPs de áreas clave
   - Cambios en el board o junta directiva

5. **DESAFÍOS Y NECESIDADES**
   - Problemas operativos o de sistemas
   - Brechas de seguridad o ciberseguridad
   - Multas o sanciones regulatorias
   - Desafíos de compliance o auditoría

6. **ALIANZAS Y PARTNERSHIPS**
   - Nuevos partnerships estratégicos
   - Acuerdos con proveedores tecnológicos
   - Joint ventures o colaboraciones

7. **REGULATORIO Y COMPLIANCE**
   - Nuevas regulaciones en ${industryText}
   - Cambios normativos que afectan a la empresa
   - Requisitos de compliance nuevos
   - Adaptación a nuevas leyes o normas del sector

8. **FUSIONES Y ADQUISICIONES (M&A)**
   - Adquisiciones realizadas o planeadas
   - Fusiones con otras empresas
   - Desinversiones o venta de unidades
   - Integraciones post-fusión

❌ EXCLUIR:
- Aniversarios, celebraciones institucionales
- Eventos sociales, deportivos
- RSE genérica sin impacto operativo
- Premios sin contexto de negocio
- Noticias de empleados no ejecutivos

⚠️ CALIDAD SOBRE CANTIDAD:
- Solo noticias que indiquen oportunidad de venta
- Cada noticia debe responder: "¿Por qué un vendedor B2B querría saber esto?"

Responde SOLO con el JSON. Máximo 15 noticias de alta calidad.`

  return { system, user }
}

function buildTavilyQuery(context: {
  company_name: string
  industry?: string
  country?: string
  website?: string
  description?: string
}): string {
  const industryTerms = getIndustryTranslations(context.industry)
  const industryText = industryTerms.join(" OR ")
  const countryText = context.country || ""

  // Query optimizada para Tavily con keywords específicas de señales de compra
  return `${context.company_name} (${industryText}) ${countryText} (inversión OR transformación digital OR innovación OR fusiones OR adquisiciones OR regulación OR cambios ejecutivos OR modernización OR automatización OR alianza OR partnership OR expansión OR crecimiento)`.trim()
}

function categorizeNews(text: string): string {
  const lowerText = text.toLowerCase()

  if (lowerText.match(/inversión|capex|presupuesto|financiamiento/)) return "inversion"
  if (lowerText.match(/fusión|adquisición|m&a|compra|merger/)) return "ma"
  if (lowerText.match(/regulación|normativa|compliance|ley|regulatorio/)) return "regulatorio"
  if (lowerText.match(/ceo|cto|cfo|cio|ciso|cdo|ejecutivo|director/)) return "ejecutivos"
  if (lowerText.match(/transformación|modernización|innovación|digital|automatización/)) return "transformacion"
  if (lowerText.match(/expansión|crecimiento|apertura|nuevo mercado/)) return "crecimiento"
  if (lowerText.match(/alianza|partnership|acuerdo|colaboración/)) return "alianzas"
  if (lowerText.match(/problema|desafío|multa|sanción/)) return "desafios"

  return "innovacion" // Default
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
        const uri = chunk.web.uri

        // Filtrar URLs internas de Google/Vertex AI
        if (uri.includes("vertexaisearch.cloud.google.com") || uri.includes("grounding-api-redirect")) {
          continue // Skip internal Google URLs
        }

        // Mapear título (o parte de él) a URL real
        const title = chunk.web.title.toLowerCase()
        urlMap.set(title, uri)
      }
    }

    // También revisar groundingSupports que tiene referencias más específicas
    const supports = groundingMetadata?.groundingSupports || []
    for (const support of supports) {
      if (support.groundingChunkIndices) {
        for (const idx of support.groundingChunkIndices) {
          const chunk = chunks[idx]
          if (chunk?.web?.uri) {
            const uri = chunk.web.uri

            // Filtrar URLs internas de Google/Vertex AI
            if (uri.includes("vertexaisearch.cloud.google.com") || uri.includes("grounding-api-redirect")) {
              continue
            }

            urlMap.set(`chunk_${idx}`, uri)
          }
        }
      }
    }
  } catch (e) {
    console.log("[v0] News: Error extracting grounding URLs:", e)
  }

  return urlMap
}

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace("www.", "")
  } catch {
    return url
  }
}

function mapNewsToCitations(newsItems: any[], citations: string[]): any[] {
  return newsItems.map((item, index) => {
    // Estrategia 1: Usar citation por índice
    let bestCitation = citations[index] || null

    // Estrategia 2: Si no hay citation por índice, buscar por dominio en source_name
    if (!bestCitation && item.source_name && citations.length > 0) {
      const sourceDomain = item.source_name.toLowerCase()
      bestCitation =
        citations.find((url) => {
          const citationDomain = extractDomain(url).toLowerCase()
          return sourceDomain.includes(citationDomain) || citationDomain.includes(sourceDomain)
        }) || null
    }

    // Estrategia 3: Si aún no hay match y hay citations disponibles, usar la primera no usada
    if (!bestCitation && citations.length > 0) {
      bestCitation = citations[0]
    }

    // Estrategia 4: Si no hay citations, construir URL del dominio
    if (!bestCitation && item.source_name) {
      const cleanName = item.source_name.toLowerCase().replace(/\s+/g, "")
      bestCitation = `https://www.${cleanName}.com`
    }

    return {
      ...item,
      source_url: bestCitation || "https://example.com",
    }
  })
}

function parsePerplexityJson(content: string): any {
  let jsonContent = content.trim()

  // Paso 1: Remover markdown code blocks si existen
  if (jsonContent.startsWith("```")) {
    jsonContent = jsonContent.replace(/```json?\n?/g, "").replace(/```$/g, "")
  }

  // Paso 2: Extraer JSON si viene con texto adicional
  if (!jsonContent.startsWith("{") && !jsonContent.startsWith("[")) {
    const jsonMatch = jsonContent.match(/\{[\s\S]*?"news"[\s\S]*?\}/) || jsonContent.match(/\[[\s\S]*?\]/)
    if (jsonMatch) {
      jsonContent = jsonMatch[0]
    } else {
      throw new Error("No JSON found in response")
    }
  }

  // Paso 3: Intentar parsear JSON directamente
  try {
    return JSON.parse(jsonContent)
  } catch (firstError) {
    console.log("[v0] News: First JSON parse failed, attempting cleanup...")

    // Paso 4: Limpiar caracteres problemáticos
    try {
      // Remover trailing commas
      jsonContent = jsonContent.replace(/,(\s*[}\]])/g, "$1")

      // Escapar comillas sin escapar dentro de strings
      // Esto es complejo, así que vamos a intentar un approach diferente

      return JSON.parse(jsonContent)
    } catch (secondError) {
      console.log("[v0] News: Second JSON parse failed, attempting regex extraction...")

      // Paso 5: Extraer campos manualmente con regex
      try {
        const newsArray: any[] = []
        const newsRegex =
          /"title"\s*:\s*"([^"]+)"[\s\S]*?"summary"\s*:\s*"([^"]+)"[\s\S]*?"source_name"\s*:\s*"([^"]+)"[\s\S]*?"published_at"\s*:\s*"([^"]+)"[\s\S]*?"category"\s*:\s*"([^"]+)"/g

        let match
        while ((match = newsRegex.exec(content)) !== null) {
          newsArray.push({
            title: match[1],
            summary: match[2],
            source_name: match[3],
            published_at: match[4],
            category: match[5],
          })
        }

        if (newsArray.length > 0) {
          console.log("[v0] News: Regex extraction successful -", newsArray.length, "items")
          return { news: newsArray }
        }
      } catch (regexError) {
        console.error("[v0] News: Regex extraction failed:", regexError)
      }

      // Si todo falla, lanzar error original
      throw new Error(`JSON parsing failed: ${firstError.message}`)
    }
  }
}

async function searchWithPerplexity(context: {
  company_name: string
  industry?: string
  country?: string
  website?: string
  description?: string
}): Promise<{ success: boolean; data?: any; error?: string; citations?: string[] }> {
  try {
    const apiKey = process.env.PERPLEXITY_API_KEY
    if (!apiKey) {
      return { success: false, error: "PERPLEXITY_API_KEY not configured" }
    }

    console.log("[v0] News: Calling Perplexity API as PRIMARY...")

    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const dateFilter = `${String(sixMonthsAgo.getMonth() + 1).padStart(2, "0")}/${String(sixMonthsAgo.getDate()).padStart(2, "0")}/${sixMonthsAgo.getFullYear()}`

    const prompts = buildPerplexityPrompt(context)

    const response = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          { role: "system", content: prompts.system },
          { role: "user", content: prompts.user },
        ],
        temperature: 0.1,
        max_tokens: 4000,
        return_citations: true,
        search_recency_filter: "month",
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] News: Perplexity API error:", response.status, errorText)
      return { success: false, error: `Perplexity API error: ${response.status}` }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    const citations = data.citations || []

    console.log("[v0] News: Perplexity response received", {
      contentLength: content?.length || 0,
      citationsCount: citations.length,
      citationsPreview: citations.slice(0, 3),
    })

    if (!content) {
      console.error("[v0] News: Perplexity no content in response")
      return { success: false, error: "No content from Perplexity" }
    }

    const parsed = parsePerplexityJson(content)
    let newsItems = []

    if (Array.isArray(parsed)) {
      newsItems = parsed
    } else if (parsed.news && Array.isArray(parsed.news)) {
      newsItems = parsed.news
    }

    console.log("[v0] News: Perplexity SUCCESS - Got", newsItems.length, "news items")

    // Mapear noticias a citations
    const newsWithUrls = mapNewsToCitations(newsItems, citations)

    return {
      success: true,
      data: { news: newsWithUrls },
      citations,
    }
  } catch (error) {
    console.error("[v0] News: Perplexity error:", error)
    return { success: false, error: String(error) }
  }
}

async function validateUrl(url: string): Promise<boolean> {
  try {
    // No validar URLs internas de Google
    if (url.includes("vertexaisearch.cloud.google.com") || url.includes("grounding-api-redirect")) {
      return false
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    console.log("[v0] News: Validating URL:", url)

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    })

    clearTimeout(timeout)
    const isValid = response.ok

    if (!isValid) {
      console.log("[v0] News: URL returned non-OK status (expected, will fallback to domain):", response.status)
    }

    return isValid
  } catch (error) {
    console.log("[v0] News: URL validation failed (expected, will fallback to domain)")
    return false
  }
}

async function mapToGroundingUrls(newsItems: any[], groundingUrls: Map<string, string>): Promise<any[]> {
  return Promise.all(
    newsItems.map(async (item) => {
      let finalUrl = item.source_url
      let fromGrounding = false

      // 1. Buscar por título en groundingUrls
      const titleLower = item.title?.toLowerCase() || ""
      for (const [groundingTitle, groundingUrl] of groundingUrls.entries()) {
        if (titleLower.includes(groundingTitle) || groundingTitle.includes(titleLower)) {
          finalUrl = groundingUrl
          fromGrounding = true
          break
        }
      }

      // 2. Si no hay match por título, buscar por dominio
      if (!fromGrounding && finalUrl) {
        const providedDomain = extractDomain(finalUrl)
        for (const [_, groundingUrl] of groundingUrls.entries()) {
          if (extractDomain(groundingUrl) === providedDomain) {
            finalUrl = groundingUrl
            fromGrounding = true
            break
          }
        }
      }

      // 3. Solo validar si NO viene de grounding y NO es URL interna de Google
      if (!fromGrounding && finalUrl && !finalUrl.includes("vertexaisearch.cloud.google.com")) {
        const isValid = await validateUrl(finalUrl)
        if (!isValid) {
          console.log("[v0] News: URL validation failed, using domain:", extractDomain(finalUrl))
          // Fallback a dominio principal
          const domain = extractDomain(finalUrl)
          finalUrl = domain ? `https://${domain}` : finalUrl
        }
      }

      // 4. Si la URL es interna de Google, usar el dominio del source_name
      if (finalUrl?.includes("vertexaisearch.cloud.google.com")) {
        const sourceName = item.source_name || ""
        // Intentar extraer dominio del nombre de la fuente
        const domainMatch = sourceName.match(/([a-z0-9-]+\.(com|net|org|io|ar|cl|pe|mx|co))/i)
        if (domainMatch) {
          finalUrl = `https://${domainMatch[0]}`
        } else {
          // Si no podemos inferir, dejar sin URL
          finalUrl = "#"
        }
      }

      return {
        ...item,
        source_url: finalUrl,
      }
    }),
  )
}

async function searchWithTavily(context: {
  company_name: string
  industry?: string
  country?: string
  website?: string
  description?: string
}): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) {
      return { success: false, error: "TAVILY_API_KEY not configured" }
    }

    console.log("[v0] News: Calling Tavily API as FALLBACK...")

    // Calcular fecha de hace 6 meses
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const startDate = sixMonthsAgo.toISOString().split("T")[0]

    const tavilyQuery = buildTavilyQuery(context)

    const response = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: tavilyQuery,
        topic: "news",
        start_date: startDate,
        max_results: 15,
        search_depth: "advanced",
        include_raw_content: false,
        include_images: false,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] News: Tavily API error:", response.status, errorText)
      return { success: false, error: `Tavily API error: ${response.status}` }
    }

    const data = await response.json()
    const results = data.results || []

    console.log("[v0] News: Tavily response received", {
      resultsCount: results.length,
    })

    if (results.length === 0) {
      console.log("[v0] News: Tavily returned 0 results")
      return { success: false, error: "No results from Tavily" }
    }

    // Mapear resultados de Tavily a nuestro formato
    const newsItems = results.map((result: any) => ({
      title: result.title,
      summary: result.content?.substring(0, 250) || result.title, // Primeros 250 chars o título como fallback
      source_url: result.url, // URL real garantizada
      source_name: extractDomain(result.url),
      published_at: result.published_date || new Date().toISOString().split("T")[0],
      category: categorizeNews(result.title + " " + (result.content || "")),
      relevance_score: result.score || 0,
    }))

    // Filtrar por score mínimo de relevancia
    const filteredNews = newsItems.filter((item: any) => item.relevance_score > 0.5)

    console.log("[v0] News: Tavily SUCCESS - Got", filteredNews.length, "news items (filtered by relevance > 0.5)")

    return {
      success: true,
      data: { news: filteredNews },
    }
  } catch (error) {
    console.error("[v0] News: Tavily error:", error)
    return { success: false, error: String(error) }
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { companyId, companyName, forceRefresh } = await req.json()

    if (!companyId || !companyName) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    if (forceRefresh) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

      if (profile?.role !== "superadmin") {
        return NextResponse.json({ error: "Unauthorized: Only superadmins can force refresh" }, { status: 403 })
      }
    }

    if (!forceRefresh) {
      const cachedNews = await getNewsFromCache(supabase, companyId)
      if (cachedNews && cachedNews.length > 0) {
        console.log("[v0] News: Using cache -", cachedNews.length, "items")
        await registerUserInteractions(
          supabase,
          user.id,
          companyId,
          cachedNews.map((n: any) => n.id),
        )
        return NextResponse.json({ success: true, news: cachedNews, source: "cache" })
      }
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
      website: company?.website,
      description: company?.linkedin_url,
    }

    let newsItems: any[] = []
    let usedProvider = "none"

    // 1. Intentar Perplexity primero
    const perplexityResult = await searchWithPerplexity(promptContext)
    if (perplexityResult.success && perplexityResult.data?.news?.length > 0) {
      newsItems = perplexityResult.data.news
      usedProvider = "perplexity"
      console.log("[v0] News: Using Perplexity results -", newsItems.length, "items")
    } else {
      console.log("[v0] News: Perplexity failed or returned 0 results, trying Tavily fallback...")

      // 2. Fallback a Tavily
      const tavilyResult = await searchWithTavily(promptContext)
      if (tavilyResult.success && tavilyResult.data?.news?.length > 0) {
        newsItems = tavilyResult.data.news
        usedProvider = "tavily"
        console.log("[v0] News: Using Tavily results -", newsItems.length, "items")
      } else {
        console.log("[v0] News: Tavily also failed, returning old cache if available")

        // 3. Si ambos fallan, intentar cache viejo
        const oldCache = await getOldCache(supabase, companyId)
        if (oldCache && oldCache.length > 0) {
          console.log("[v0] News: Using old cache -", oldCache.length, "items")
          await registerUserInteractions(
            supabase,
            user.id,
            companyId,
            oldCache.map((n: any) => n.id),
          )
          return NextResponse.json({ success: true, news: oldCache, source: "old_cache" })
        }

        // 4. Si no hay nada, retornar vacío
        return NextResponse.json({ success: true, news: [], source: "none" })
      }
    }

    const seenUrls = new Set<string>()
    const uniqueNewsItems = newsItems.filter((item) => {
      if (seenUrls.has(item.source_url)) {
        return false
      }
      seenUrls.add(item.source_url)
      return true
    })

    // Obtener URLs de noticias existentes para esta empresa
    const { data: existingNews } = await supabase.from("company_news").select("source_url").eq("company_id", companyId)

    const existingUrls = new Set(existingNews?.map((n) => n.source_url) || [])

    // Filtrar solo noticias nuevas que no existen en la DB
    const newNewsToInsert = uniqueNewsItems
      .filter((item) => !existingUrls.has(item.source_url))
      .map((item) => ({
        company_id: companyId,
        title: item.title,
        summary: item.summary,
        source_url: item.source_url,
        source_name: item.source_name,
        published_at: sanitizeDate(item.published_at),
        category: item.category,
        ai_provider: usedProvider,
      }))

    console.log(
      `[v0] News: Inserting ${newNewsToInsert.length} new items (${uniqueNewsItems.length - newNewsToInsert.length} duplicates skipped)`,
    )

    let savedNews = []

    // Solo insertar si hay noticias nuevas
    if (newNewsToInsert.length > 0) {
      const { data: insertedNews, error: insertError } = await supabase
        .from("company_news")
        .insert(newNewsToInsert)
        .select()

      if (insertError) {
        console.error("[v0] News: Error inserting news:", insertError)
        return NextResponse.json({ error: "Failed to save news" }, { status: 500 })
      }

      savedNews = insertedNews || []
    }

    // Obtener todas las noticias de esta empresa (incluyendo las que ya existían)
    const { data: allCompanyNews } = await supabase
      .from("company_news")
      .select("*")
      .eq("company_id", companyId)
      .order("published_at", { ascending: false })
      .limit(15)

    const finalNews = allCompanyNews || savedNews

    await registerUserInteractions(
      supabase,
      user.id,
      companyId,
      finalNews.map((n: any) => n.id),
    )

    return NextResponse.json({
      success: true,
      news: finalNews,
      source: usedProvider,
    })
  } catch (error) {
    console.error("[v0] News: Error in POST handler:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
