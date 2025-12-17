import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

const SERPAPI_URL = "https://serpapi.com/search"
const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
const CACHE_DAYS = 14

const SERPAPI_TOPIC_TOKENS = {
  technology: "CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB",
  business: "CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB",
}

const SERPAPI_COUNTRY_CODES = ["ar", "es", "mx", "cl", "co", "pe", "us"]

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
  const sixYearsAgo = new Date()
  sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6)

  if (date > now || date < sixYearsAgo) {
    console.log("[v0] News: Date sanitization:", { raw: dateStr, sanitized: null, rejected: true })
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
4. MÍNIMO 3 noticias, máximo 15 (prioriza calidad sobre cantidad)
5. Si hay pocas noticias disponibles, devuelve las que encuentres (NO devuelvas array vacío)

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
}`

  const industryTerms = getIndustryTranslations(context.industry)
  const industryText = industryTerms.join(" OR ")
  const countryText = context.country || "global"

  const user = `Busca noticias sobre "${context.company_name}" (industria: ${industryText}) en ${countryText}.

⏰ RANGO TEMPORAL:
- Prioriza ESPECIALMENTE noticias de los últimos 2-3 meses (MÁS RELEVANTES)
- Incluye también eventos importantes de hace 6-12 meses si son relevantes
- Ignora noticias que sean obvias repeticiones o anniversarios

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

Responde SOLO con el JSON. Mínimo 3, máximo 15 noticias de alta calidad.`

  return { system, user }
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
    .order("created_at", { ascending: false })
    .limit(15)

  return cachedNews
}

async function getOldCache(supabase: any, companyId: string) {
  const { data: oldCache } = await supabase
    .from("company_news")
    .select("*")
    .eq("company_id", companyId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(15)

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
  const usedCitationIndices = new Set<number>()

  return newsItems
    .map((item, itemIndex) => {
      let bestCitation = null

      // Estrategia 1: Si el item tiene URL, validar que esté en las citations
      if (item.source_url && citations.length > 0) {
        const itemDomain = extractDomain(item.source_url).toLowerCase()
        const matchingCitationIndex = citations.findIndex((url) => {
          const citationDomain = extractDomain(url).toLowerCase()
          return itemDomain === citationDomain
        })

        if (matchingCitationIndex !== -1) {
          bestCitation = citations[matchingCitationIndex]
          usedCitationIndices.add(matchingCitationIndex)
        }
      }

      // Estrategia 2: Si no hay match, buscar por dominio en source_name
      if (!bestCitation && item.source_name && citations.length > 0) {
        const sourceDomain = item.source_name.toLowerCase()
        const matchingCitationIndex = citations.findIndex((url, idx) => {
          if (usedCitationIndices.has(idx)) return false
          const citationDomain = extractDomain(url).toLowerCase()
          return sourceDomain.includes(citationDomain) || citationDomain.includes(sourceDomain)
        })

        if (matchingCitationIndex !== -1) {
          bestCitation = citations[matchingCitationIndex]
          usedCitationIndices.add(matchingCitationIndex)
        }
      }

      // Estrategia 3: Usar citation por índice (preferencia a no usadas)
      if (!bestCitation && itemIndex < citations.length) {
        const indexCitation = citations[itemIndex]
        if (!usedCitationIndices.has(itemIndex)) {
          bestCitation = indexCitation
          usedCitationIndices.add(itemIndex)
        }
      }

      // Estrategia 4: Si aún no hay match, usar primera citation disponible
      if (!bestCitation && citations.length > 0) {
        const firstUnused = citations.findIndex((_, idx) => !usedCitationIndices.has(idx))
        if (firstUnused !== -1) {
          bestCitation = citations[firstUnused]
          usedCitationIndices.add(firstUnused)
        }
      }

      return bestCitation
        ? {
            ...item,
            source_url: bestCitation,
          }
        : null
    })
    .filter((item) => item !== null) // Filter out items without valid citations
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
        temperature: 0.2,
        max_tokens: 4000,
        return_citations: true,
        search_recency_filter: "year",
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

    if (newsItems.length === 0) {
      console.warn("[v0] News: Perplexity returned empty result, will fallback to SerpAPI")
      return { success: false, error: "No news found by Perplexity" }
    }

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

function parseRelativeDate(relativeDate: string): string {
  const now = new Date()
  const lowerDate = relativeDate.toLowerCase()

  // Parsear español: "hace X horas", "hace X días", etc.
  const horasMatch = lowerDate.match(/(\d+)\s*(hora|horas)/)
  const diasMatch = lowerDate.match(/(\d+)\s*(día|días|dia|dias)/)
  const semanasMatch = lowerDate.match(/(\d+)\s*(semana|semanas)/)
  const mesesMatch = lowerDate.match(/(\d+)\s*(mes|meses)/)

  // Parsear inglés: "X hours ago", "X days ago", etc.
  const hoursMatch = lowerDate.match(/(\d+)\s*hour/)
  const daysMatch = lowerDate.match(/(\d+)\s*day/)
  const weeksMatch = lowerDate.match(/(\d+)\s*week/)
  const monthsMatch = lowerDate.match(/(\d+)\s*month/)

  if (horasMatch || hoursMatch) {
    const hours = Number.parseInt((horasMatch || hoursMatch)?.[1] || "0")
    now.setHours(now.getHours() - hours)
  } else if (diasMatch || daysMatch) {
    const days = Number.parseInt((diasMatch || daysMatch)?.[1] || "0")
    now.setDate(now.getDate() - days)
  } else if (semanasMatch || weeksMatch) {
    const weeks = Number.parseInt((semanasMatch || weeksMatch)?.[1] || "0")
    now.setDate(now.getDate() - weeks * 7)
  } else if (mesesMatch || monthsMatch) {
    const months = Number.parseInt((mesesMatch || monthsMatch)?.[1] || "0")

    const year = now.getFullYear()
    const month = now.getMonth()
    const day = now.getDate()

    let targetYear = year
    let targetMonth = month - months

    while (targetMonth < 0) {
      targetMonth += 12
      targetYear -= 1
    }

    const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate()
    const targetDay = Math.min(day, lastDayOfTargetMonth)

    now.setFullYear(targetYear)
    now.setMonth(targetMonth)
    now.setDate(targetDay)
  }

  return now.toISOString().split("T")[0]
}

async function searchWithSerpAPINews(context: {
  company_name: string
  industry?: string
  country?: string
  website?: string
}): Promise<any[]> {
  try {
    const prioritizedCountries = prioritizeCountries(context.country)
    console.log("[v0] News: SerpAPI prioritized countries:", prioritizedCountries)

    const excludeTerms = [
      "-memoria",
      "-anual",
      '-"annual report"',
      '-"reporte anual"',
      "-productos",
      "-servicios",
      "-beneficios",
      "-planes",
      "-tarifas",
      "-cuenta",
      "-tarjeta",
      "-crédito",
      "-préstamo",
      "-seguros",
      "-hipotecario",
      "-fraude",
      "-estafa",
      "-robo",
      "-sanción",
      "-multa",
      "-cobro indebido",
      "-acreencias",
      "-demanda",
      "-judicial",
      "-investigación penal",
      "-editorial",
      "-opinión",
      "-columna",
      "-accionista",
      "-junta",
    ].join(" ")

    const companyDomain = context.company_name
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9]/g, "")
    const excludeSite = `-site:${companyDomain}.com -site:${companyDomain}.cl -site:${companyDomain}.mx -site:${companyDomain}.ar`

    const newsKeywords = [
      "inversión",
      "tecnología",
      "transformación digital",
      "innovación",
      "adquisición",
      "alianza estratégica",
      "fusión",
      "asociación",
    ].join(" OR ")

    const domainFilter = "(site:.ar OR site:.mx OR site:.co OR site:.cl OR site:.pe OR site:.ec OR site:.uy)"
    const query = `"${context.company_name}" (${newsKeywords}) ${domainFilter} ${excludeSite} ${excludeTerms}`.trim()

    const results: any[] = []

    const searchPromises = prioritizedCountries.map(async (countryCode) => {
      try {
        const params = new URLSearchParams({
          engine: "google_news_light",
          q: query,
          gl: countryCode,
          hl: "es",
          lr: "lang_es",
          num: "10",
          tbs: "qdr:y",
          sort: "date",
        })

        const url = `${SERPAPI_URL}?${params.toString()}&api_key=${process.env.SERPAPI_API_KEY}`

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000)

        const response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)

        if (!response.ok) {
          console.error(`[v0] News: SerpAPI error for ${countryCode}:`, response.statusText)
          return
        }

        const data = await response.json()
        console.log(`[v0] News: SerpAPI response for ${countryCode} - Got ${data.news_results?.length || 0} results`)

        if (data.news_results && Array.isArray(data.news_results)) {
          const filteredResults = data.news_results.filter((result: any) => {
            const title = result.title?.toLowerCase() || ""
            const snippet = result.snippet?.toLowerCase() || ""

            const irrelevantTerms = [
              "fraude",
              "estafa",
              "robo",
              "sanción",
              "multa",
              "cobro indebido",
              "acreencias",
              "demanda",
              "judicial",
              "diputad",
              "senador",
              "ministro",
              "gobierno",
              "ley",
              "regulación",
              "cliente afectado",
              "consumidor",
            ]

            const hasIrrelevantTerm = irrelevantTerms.some((term) => title.includes(term) || snippet.includes(term))

            if (hasIrrelevantTerm) {
              console.log(`[v0] News: Filtering out irrelevant: "${result.title}"`)
              return false
            }

            return true
          })

          const newsItems = filteredResults.map((result: any) => {
            const date = result.date || result.iso_date
            const rawDate = result.iso_date
              ? new Date(result.iso_date).toISOString().split("T")[0]
              : date
                ? parseRelativeDate(date)
                : null

            const sourceName = result.source?.name || result.source || context.company_name || "Desconocido"

            return {
              title: result.title || "Sin título",
              url: result.link || result.url || "",
              snippet: result.snippet || "",
              published_at: rawDate,
              source: sourceName,
            }
          })

          results.push(...newsItems)
        }
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.error(`[v0] News: SerpAPI timeout for ${countryCode}`)
        } else {
          console.error(`[v0] News: SerpAPI error for ${countryCode}:`, error)
        }
      }
    })

    await Promise.all(searchPromises)

    const uniqueResults = Array.from(new Map(results.map((item) => [item.url, item])).values())

    console.log(`[v0] News: SerpAPI SUCCESS - Got ${uniqueResults.length} unique news items`)

    return {
      success: true,
      data: {
        news: uniqueResults.map((item) => ({
          ...item,
          source_url: item.url,
          source_name: item.source,
          summary: item.snippet,
        })),
      },
    }
  } catch (error: any) {
    console.error("[v0] News: SerpAPI FAILED -", error.message)
    return {
      success: false,
      error: error.message,
    }
  }
}

function prioritizeCountries(companyCountry?: string): string[] {
  const countryMap: Record<string, string> = {
    Argentina: "ar",
    España: "es",
    Spain: "es",
    México: "mx",
    Mexico: "mx",
    Chile: "cl",
    Colombia: "co",
    Perú: "pe",
    Peru: "pe",
    "Estados Unidos": "us",
    "United States": "us",
    USA: "us",
  }

  const companyCode = companyCountry ? countryMap[companyCountry] : null
  const priorityCountries: string[] = []

  // 1. Agregar país de origen primero
  if (companyCode) {
    priorityCountries.push(companyCode)
  }

  // 2. Si el país es Colombia o Chile, agregar Argentina segundo
  if (companyCode === "co" || companyCode === "cl") {
    priorityCountries.push("ar")
  }

  // 3. Agregar Colombia y Chile (si no son el país de origen)
  if (companyCode !== "co") priorityCountries.push("co")
  if (companyCode !== "cl") priorityCountries.push("cl")

  // 4. Si no llegamos a 3 países, completar con otros
  const otherCountries = ["ar", "es", "mx", "pe"].filter((c) => !priorityCountries.includes(c))
  priorityCountries.push(...otherCountries)

  // Retornar solo los primeros 3
  return priorityCountries.slice(0, 3)
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { companyId, companyName, forceRefresh } = await request.json()

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
    let usedProvider: "perplexity" | "serpapi" = "perplexity"

    // 1. Intentar con Perplexity primero
    const perplexityResult = await searchWithPerplexity(promptContext)

    if (perplexityResult.success && perplexityResult.data?.news?.length > 0) {
      // Verificar duplicados ANTES de decidir si usar el resultado
      const perplexityNews = perplexityResult.data.news

      // Obtener URLs existentes
      const { data: existingNews } = await supabase
        .from("company_news")
        .select("source_url")
        .eq("company_id", companyId)

      const existingUrls = new Set(existingNews?.map((n) => n.source_url) || [])

      // Filtrar duplicados
      const newPerplexityItems = perplexityNews.filter((item: any) => !existingUrls.has(item.source_url))

      console.log(
        "[v0] News: Perplexity returned",
        perplexityNews.length,
        "items,",
        newPerplexityItems.length,
        "are new (not in DB)",
      )

      // Solo usar Perplexity si hay al menos 1 item nuevo
      if (newPerplexityItems.length > 0) {
        newsItems = perplexityNews
        usedProvider = "perplexity"
        console.log("[v0] News: Using Perplexity results -", newsItems.length, "items")
      } else {
        console.log("[v0] News: Perplexity returned only duplicates, trying SerpAPI fallback...")

        // Fallback a SerpAPI
        const serpApiResult = await searchWithSerpAPINews(promptContext)
        if (serpApiResult.success && serpApiResult.data?.news?.length > 0) {
          newsItems = serpApiResult.data.news
          usedProvider = "serpapi"
          console.log("[v0] News: Using SerpAPI results -", newsItems.length, "items")
        } else {
          console.log("[v0] News: SerpAPI also failed, returning old cache if available")
        }
      }
    } else {
      console.log("[v0] News: Perplexity failed or returned 0 results, trying SerpAPI fallback...")

      // 2. Fallback a SerpAPI
      const serpApiResult = await searchWithSerpAPINews(promptContext)
      if (serpApiResult.success && serpApiResult.data?.news?.length > 0) {
        newsItems = serpApiResult.data.news
        usedProvider = "serpapi"
        console.log("[v0] News: Using SerpAPI results -", newsItems.length, "items")
      } else {
        console.log("[v0] News: SerpAPI also failed, returning old cache if available")
      }
    }

    // Si no hay noticias de ningún proveedor, retornar cache
    if (newsItems.length === 0) {
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

      // Si no hay nada, retornar vacío
      return NextResponse.json({ success: true, news: [], source: "none" })
    }

    // Eliminar duplicados dentro del resultado actual
    const seenUrls = new Set<string>()
    const uniqueNewsItems = newsItems.filter((item) => {
      if (seenUrls.has(item.source_url)) {
        return false
      }
      seenUrls.add(item.source_url)
      return true
    })

    // Obtener URLs de noticias existentes para esta empresa (nueva consulta por si acaso)
    const { data: existingNews } = await supabase.from("company_news").select("source_url").eq("company_id", companyId)

    const existingUrls = new Set(existingNews?.map((n) => n.source_url) || [])

    // Filtrar solo noticias nuevas que no existen en la DB y que tienen fecha válida
    const newNewsToInsert = uniqueNewsItems
      .filter((item) => !existingUrls.has(item.source_url))
      .filter((item) => {
        const sanitizedDate = sanitizeDate(item.published_at)
        return sanitizedDate !== null // Rechaza noticias sin fecha válida
      })
      .map((item) => {
        const rawPublishedAt = item.published_at
        const sanitizedDate = sanitizeDate(rawPublishedAt)

        return {
          company_id: companyId,
          title: item.title,
          summary: item.summary,
          source_url: item.source_url,
          source_name: item.source_name,
          published_at: sanitizedDate, // Ahora garantizado no-null
          category: categorizeNews(item.title + " " + item.summary),
          ai_provider: usedProvider,
        }
      })

    console.log(
      `[v0] News: Inserting ${newNewsToInsert.length} new items (${uniqueNewsItems.length - newNewsToInsert.length} duplicates skipped)`,
    )

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

      newsItems = insertedNews || []
    }

    // Obtener todas las noticias de esta empresa (incluyendo las que ya existían)
    const { data: allCompanyNews } = await supabase
      .from("company_news")
      .select("*")
      .eq("company_id", companyId)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(15)

    const finalNews = allCompanyNews || []

    console.log(
      "[v0] News: Final news count:",
      finalNews.length,
      "items with published_at:",
      finalNews.filter((n: any) => n.published_at).length,
    )

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
