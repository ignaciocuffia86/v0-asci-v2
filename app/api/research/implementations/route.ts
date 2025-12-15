import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

const TAVILY_API_URL = "https://api.tavily.com/search"
const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
const CACHE_DAYS = 14

const PARTNER_NETWORK_DOMAINS = [
  // AWS
  "aws.amazon.com/partners",
  "aws.amazon.com/solutions/case-studies",
  "aws.amazon.com/es/solutions/case-studies",

  // Microsoft
  "microsoft.com/es-es/partner",
  "customers.microsoft.com",
  "azure.microsoft.com/es-es/case-studies",
  "azure.microsoft.com/en-us/resources/customer-stories",

  // Google Cloud
  "cloud.google.com/customers",
  "cloud.google.com/partners",

  // SAP
  "sap.com/latinamerica",
  "news.sap.com/latinamerica",
  "sap.com/about/customer-stories",

  // Oracle
  "oracle.com/customers",
  "oracle.com/es/customer-success",
  "oracle.com/corporate/features",

  // Salesforce
  "salesforce.com/customer-success-stories",
  "salesforce.com/stories",

  // IBM
  "ibm.com/case-studies",
  "ibm.com/es-es/case-studies",

  // Cisco
  "cisco.com/c/es_mx/customer-references",
  "cisco.com/c/en/us/about/case-studies-customer-success-stories",

  // Otros vendors principales
  "servicenow.com/customers",
  "workday.com/en-us/customer-success.html",
  "adobe.com/customer-success-stories",
  "hubspot.com/case-studies",
  "zendesk.com/customer",

  // Consultoras globales
  "accenture.com/us-en/case-studies",
  "deloitte.com/insights/case-studies",
  "pwc.com/gx/en/services/consulting/case-studies.html",
  "ey.com/en_gl/case-studies",
  "kpmg.com/xx/en/home/insights/2019/09/client-stories.html",

  // Consultoras LATAM
  "globant.com/success-stories",
  "globant.com/es/casos-de-exito",
]

const VENDOR_DOMAINS = [
  // Vendors de Tecnología
  "microsoft.com",
  "salesforce.com",
  "oracle.com",
  "sap.com",
  "ibm.com",
  "aws.amazon.com",
  "cloud.google.com",
  "servicenow.com",
  "workday.com",
  "adobe.com",
  "hubspot.com",
  "zendesk.com",
  "atlassian.com",
  "tableau.com",
  "snowflake.com",
  "databricks.com",
  "twilio.com",
  "stripe.com",
  "segment.com",
  "mulesoft.com",
  "redhat.com",
  "vmware.com",
  "citrix.com",
  "paloaltonetworks.com",
  "okta.com",
  "zoom.us",
  "slack.com",
  "asana.com",
  "dropbox.com",

  // Consultoras Globales
  "accenture.com",
  "deloitte.com",
  "pwc.com",
  "ey.com",
  "kpmg.com",
  "mckinsey.com",
  "bain.com",
  "bcg.com",
  "capgemini.com",
  "cognizant.com",
  "infosys.com",
  "tcs.com",
  "wipro.com",
  "atos.net",
  "dxc.com",

  // Consultoras/Tech Regionales (LATAM)
  "globant.com",
  "mercadolibre.com",
  "despegar.com",
]

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

function buildPerplexityPrompt(context: {
  company_name: string
  industry?: string
  country?: string
  keywords?: string[]
}): { system: string; user: string } {
  const industryTerms = getIndustryTranslations(context.industry)
  const industryText = industryTerms.join(", ")
  const countryText = context.country || "Latinoamérica"

  const system = `Eres un buscador de implementaciones tecnológicas y casos de éxito B2B especializado en LATAM.

IMPORTANTE:
1. Responde ÚNICAMENTE con un objeto JSON válido
2. Resume con TUS PROPIAS PALABRAS - NO copies texto literal
3. NO incluyas "source_url" en el JSON (se extraerá de tus citations automáticamente)

FUENTES PRIORITARIAS (busca en orden):
- AWS Partner Network y casos de éxito de AWS
- Microsoft Partner Portal y Customer Stories
- Google Cloud casos de clientes
- SAP News Latinoamérica y Customer Stories
- Oracle Customer Success
- Salesforce Success Stories
- Cisco Customer References
- Blogs de consultoras (Accenture, Deloitte, Globant, etc.)

FORMATO JSON OBLIGATORIO:
{
  "implementations": [
    {
      "title": "string",
      "provider_name": "string (nombre del vendor/consultora)",
      "technology": "string (tecnología implementada)",
      "area": "finanzas|ventas|logistica|rrhh|it|ciberseguridad|ecommerce|operaciones",
      "summary": "Tu descripción del caso (2-3 oraciones)",
      "results": "string o null (resultados obtenidos)",
      "evidence_level": "strong|medium|weak",
      "source_name": "string",
      "published_at": "YYYY-MM-DD"
    }
  ]
}

Si no encuentras implementaciones, responde: {"implementations":[]}`

  const keywordsText = context.keywords?.length ? ` Tecnologías de interés: ${context.keywords.join(", ")}.` : ""

  const user = `Busca implementaciones tecnológicas, casos de éxito y proyectos de "${context.company_name}" (industria: ${industryText}) en ${countryText}.${keywordsText}

TÉRMINOS CLAVE EN ESPAÑOL:
"${context.company_name}" AND (
  "caso de éxito" OR "implementación" OR "migración" OR
  "cliente de" OR "selecciona" OR "elige" OR "adopta" OR
  "proyecto" OR "despliegue" OR "transformación"
)

VENDORS PRINCIPALES A CRUZAR:
SAP, Oracle, Microsoft, AWS, IBM, Google Cloud, Cisco, Salesforce,
Workday, ServiceNow, Adobe, Tableau, Snowflake, HubSpot

EXCLUIR:
- Páginas institucionales o corporativas de ${context.company_name}
- Solo incluye casos publicados por VENDORS o CONSULTORAS
- Prioriza fuentes en español de LATAM

Últimos 24 meses. Máximo 10 implementaciones. Responde SOLO JSON.`

  return { system, user }
}

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
        const uri = chunk.web.uri

        if (uri.includes("vertexaisearch.cloud.google.com") || uri.includes("grounding-api-redirect")) {
          continue // Skip internal Google URLs
        }

        const title = chunk.web.title.toLowerCase()
        urlMap.set(title, uri)
      }
    }

    const supports = groundingMetadata?.groundingSupports || []
    for (const support of supports) {
      if (support.groundingChunkIndices) {
        for (const idx of support.groundingChunkIndices) {
          const chunk = chunks[idx]
          if (chunk?.web?.uri) {
            const uri = chunk.web.uri

            if (uri.includes("vertexaisearch.cloud.google.com") || uri.includes("grounding-api-redirect")) {
              continue
            }

            urlMap.set(`chunk_${idx}`, uri)
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

function getCompanyDomain(companyName: string, website?: string): string {
  if (website) {
    try {
      const urlObj = new URL(website.startsWith("http") ? website : `https://${website}`)
      return urlObj.hostname.replace("www.", "")
    } catch {}
  }

  // Fallback: nombre de empresa en minúsculas sin espacios
  return companyName.toLowerCase().replace(/\s+/g, "")
}

const INSTITUTIONAL_KEYWORDS = [
  "memoria anual",
  "annual report",
  "reporte anual",
  "informe anual",
  "investor relations",
  "relación con inversores",
  "sustainability report",
  "reporte de sostenibilidad",
  "financial results",
  "resultados financieros",
  "earnings report",
  "quarterly report",
]

const OTHER_COMPANY_INDICATORS = ["caso de éxito:", "case study:", "customer story:", "cliente:", "historia de"]

async function searchWithTavilyMultiQuery(context: {
  company_name: string
  industry?: string
  country?: string
  keywords?: string[]
  website?: string // Agregado website
}): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) {
      return { success: false, error: "TAVILY_API_KEY not configured" }
    }

    console.log("[v0] Implementations: Calling Tavily with improved filters as FALLBACK...")

    const twentyFourMonthsAgo = new Date()
    twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24)
    const startDate = twentyFourMonthsAgo.toISOString().split("T")[0]

    const industryTerms = getIndustryTranslations(context.industry)
    const industryText = industryTerms[0] || "" // Solo el primero para ser más específico
    const countryText = context.country || ""

    const companyDomain = getCompanyDomain(context.company_name, context.website)
    const companyNameLower = context.company_name.toLowerCase()

    const specificQuery = `
      "${context.company_name}" ${countryText}
      (implementa OR elige OR selecciona OR migra OR despliega OR adopta OR adquiere)
      (SAP OR Oracle OR Microsoft OR AWS OR Salesforce OR IBM OR Cisco OR "Google Cloud")
      -"memoria anual" -"annual report" -"reporte anual"
    `
      .trim()
      .replace(/\s+/g, " ")

    console.log("[v0] Implementations: Tavily Query:", specificQuery)

    const response = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: specificQuery,
        topic: "general",
        start_date: startDate,
        max_results: 20, // Aumentado para compensar filtrado agresivo
        search_depth: "advanced",
        include_raw_content: false,
        include_images: false,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Implementations: Tavily API error:", response.status, errorText)
      return { success: false, error: `Tavily API error: ${response.status}` }
    }

    const data = await response.json()
    const results = data.results || []

    console.log("[v0] Implementations: Tavily raw results:", results.length)

    if (results.length === 0) {
      return { success: false, error: "No results from Tavily" }
    }

    const filteredResults = results.filter((result: any) => {
      const titleLower = result.title.toLowerCase()
      const contentLower = (result.content || "").toLowerCase()
      const urlLower = result.url.toLowerCase()
      const combined = titleLower + " " + contentLower

      // FILTRO 1: NO debe ser dominio de la empresa
      if (urlLower.includes(companyDomain)) {
        console.log("[v0] Implementations: Filtered out (company domain):", result.title)
        return false
      }

      // FILTRO 2: DEBE mencionar la empresa en título O primeros 200 chars del contenido
      const mentionsCompanyInTitle = titleLower.includes(companyNameLower)
      const mentionsCompanyEarly = contentLower.substring(0, 200).includes(companyNameLower)

      if (!mentionsCompanyInTitle && !mentionsCompanyEarly) {
        console.log("[v0] Implementations: Filtered out (company not prominent):", result.title)
        return false
      }

      // FILTRO 3: NO debe ser documento institucional
      const isInstitutional = INSTITUTIONAL_KEYWORDS.some((keyword) => combined.includes(keyword))

      if (isInstitutional) {
        console.log("[v0] Implementations: Filtered out (institutional doc):", result.title)
        return false
      }

      // FILTRO 4: Si el título tiene ":" después de keywords de caso de éxito,
      // verificar que el nombre después del ":" sea nuestra empresa
      for (const indicator of OTHER_COMPANY_INDICATORS) {
        if (titleLower.includes(indicator)) {
          const afterColon = titleLower.split(indicator)[1]
          if (afterColon && !afterColon.includes(companyNameLower.split(" ")[0])) {
            console.log("[v0] Implementations: Filtered out (case study of other company):", result.title)
            return false
          }
        }
      }

      // FILTRO 5: DEBE mencionar un vendor/tecnología
      const mentionsVendor = combined.match(
        /\b(sap|oracle|microsoft|aws|salesforce|google cloud|ibm|cisco|servicenow|workday|adobe)\b/i,
      )

      if (!mentionsVendor) {
        console.log("[v0] Implementations: Filtered out (no vendor mentioned):", result.title)
        return false
      }

      // FILTRO 6: Score mínimo de 0.7 (más restrictivo)
      if ((result.score || 0) < 0.7) {
        console.log("[v0] Implementations: Filtered out (low score):", result.score, result.title)
        return false
      }

      // FILTRO 7: Contenido debe tener longitud mínima (evitar snippets vacíos)
      if ((result.content || "").length < 100) {
        console.log("[v0] Implementations: Filtered out (too short):", result.title)
        return false
      }

      return true
    })

    console.log("[v0] Implementations: After aggressive filtering:", filteredResults.length, "results remaining")

    if (filteredResults.length === 0) {
      return { success: false, error: "All results filtered out (low quality)" }
    }

    // Mapear resultados filtrados
    const implementations = filteredResults.map((result: any) => ({
      title: result.title,
      provider_name: extractProviderFromDomain(result.url) || extractProviderFromContent(result.content),
      technology: inferTechnologyFromContent(result.title + " " + (result.content || "")),
      area: categorizeImplementation(result.title + " " + (result.content || "")),
      summary: result.content?.substring(0, 250) || result.title,
      results: null,
      evidence_level: inferEvidenceLevel(result.content || result.title),
      source_url: result.url,
      source_name: extractDomain(result.url),
      published_at: result.published_date || new Date().toISOString().split("T")[0],
      relevance_score: result.score || 0,
    }))

    // Ordenar por score y tomar top 10
    const topImplementations = implementations
      .sort((a: any, b: any) => b.relevance_score - a.relevance_score)
      .slice(0, 10)

    console.log("[v0] Implementations: Tavily SUCCESS - Returning", topImplementations.length, "high-quality items")

    return {
      success: true,
      data: { implementations: topImplementations },
    }
  } catch (error) {
    console.error("[v0] Implementations: Tavily error:", error)
    return { success: false, error: String(error) }
  }
}

function extractProviderFromContent(content: string): string {
  if (!content) return "N/A"

  const lowerContent = content.toLowerCase()

  const providers: Record<string, string> = {
    sap: "SAP",
    oracle: "Oracle",
    microsoft: "Microsoft",
    salesforce: "Salesforce",
    aws: "AWS",
    "amazon web services": "AWS",
    "google cloud": "Google Cloud",
    ibm: "IBM",
    cisco: "Cisco",
    servicenow: "ServiceNow",
    workday: "Workday",
    accenture: "Accenture",
    deloitte: "Deloitte",
    globant: "Globant",
  }

  for (const [keyword, name] of Object.entries(providers)) {
    if (lowerContent.includes(keyword)) {
      return name
    }
  }

  return "N/A"
}

function categorizeImplementation(text: string): string {
  const lowerText = text.toLowerCase()

  if (lowerText.match(/finanzas|contabilidad|erp|sap|oracle|facturación/)) return "finanzas"
  if (lowerText.match(/ventas|crm|salesforce|hubspot|comercial/)) return "ventas"
  if (lowerText.match(/logística|transporte|supply chain|cadena de suministro/)) return "logistica"
  if (lowerText.match(/recursos humanos|rrhh|workday|talento|nómina/)) return "rrhh"
  if (lowerText.match(/ciberseguridad|seguridad|firewall|soc|identity/)) return "ciberseguridad"
  if (lowerText.match(/ecommerce|comercio electrónico|tienda online/)) return "ecommerce"
  if (lowerText.match(/infraestructura|cloud|aws|azure|google cloud|servidores/)) return "it"

  return "operaciones" // Default
}

function inferEvidenceLevel(text: string): "strong" | "medium" | "weak" {
  const lowerText = text.toLowerCase()

  if (lowerText.match(/caso de éxito|comunicado de prensa|implementó exitosamente/)) return "strong"
  if (lowerText.match(/según fuentes|reporta|informó/)) return "medium"

  return "weak"
}

async function searchWithTavily(context: {
  company_name: string
  industry?: string
  country?: string
  keywords?: string[]
}): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) {
      return { success: false, error: "TAVILY_API_KEY not configured" }
    }

    console.log("[v0] Implementations: Calling Tavily API as FALLBACK...")

    // Calcular fecha de hace 24 meses
    const twentyFourMonthsAgo = new Date()
    twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24)
    const startDate = twentyFourMonthsAgo.toISOString().split("T")[0]

    const tavilyQuery = buildTavilyQuery(context)

    const response = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: tavilyQuery,
        topic: "general", // Cambiado de "news" a "general" para captar blogs de vendors
        start_date: startDate,
        max_results: 15, // Aumentado de 10 a 15
        search_depth: "advanced",
        include_domains: VENDOR_DOMAINS, // Solo buscar en sitios de vendors/consultoras
        include_raw_content: false,
        include_images: false,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Implementations: Tavily API error:", response.status, errorText)
      return { success: false, error: `Tavily API error: ${response.status}` }
    }

    const data = await response.json()
    const results = data.results || []

    console.log("[v0] Implementations: Tavily response received", {
      resultsCount: results.length,
    })

    if (results.length === 0) {
      console.log("[v0] Implementations: Tavily returned 0 results")
      return { success: false, error: "No results from Tavily" }
    }

    // Mapear resultados de Tavily a nuestro formato
    const implementations = results.map((result: any) => ({
      title: result.title,
      provider_name: extractProviderFromDomain(result.url) || "N/A",
      technology: inferTechnologyFromContent(result.title + " " + (result.content || "")),
      area: categorizeImplementation(result.title + " " + (result.content || "")),
      summary: result.content?.substring(0, 250) || result.title,
      results: null,
      evidence_level: inferEvidenceLevel(result.content || result.title),
      source_url: result.url, // URL real garantizada
      source_name: extractDomain(result.url),
      published_at: result.published_date || new Date().toISOString().split("T")[0],
      relevance_score: result.score || 0,
    }))

    // Filtrar por score mínimo de relevancia
    const filteredImplementations = implementations.filter((item: any) => item.relevance_score > 0.5)

    console.log(
      "[v0] Implementations: Tavily SUCCESS - Got",
      filteredImplementations.length,
      "items (filtered by relevance > 0.5)",
    )

    return {
      success: true,
      data: { implementations: filteredImplementations },
    }
  } catch (error) {
    console.error("[v0] Implementations: Tavily error:", error)
    return { success: false, error: String(error) }
  }
}

function buildTavilyQuery(context: {
  company_name: string
  industry?: string
  country?: string
  keywords?: string[]
}): string {
  const industryTerms = getIndustryTranslations(context.industry)
  const industryText = industryTerms.join(" ")
  const countryText = context.country || ""

  // Query optimizada enfocada en casos de éxito con verbos de acción
  return `"${context.company_name}" ${countryText} (implementa OR adopta OR migra OR despliega OR selecciona OR elige OR adquiere) (caso de éxito OR case study OR customer story OR historia de éxito OR testimonial OR referencia) ${industryText}`.trim()
}

function extractProviderFromDomain(url: string): string | null {
  try {
    const domain = extractDomain(url).toLowerCase()

    // Mapeo de dominios conocidos a nombres de proveedores
    const providerMap: Record<string, string> = {
      "microsoft.com": "Microsoft",
      "salesforce.com": "Salesforce",
      "oracle.com": "Oracle",
      "sap.com": "SAP",
      "ibm.com": "IBM",
      "aws.amazon.com": "AWS",
      "cloud.google.com": "Google Cloud",
      "servicenow.com": "ServiceNow",
      "workday.com": "Workday",
      "adobe.com": "Adobe",
      "accenture.com": "Accenture",
      "deloitte.com": "Deloitte",
      "pwc.com": "PwC",
      "ey.com": "EY",
      "kpmg.com": "KPMG",
      "globant.com": "Globant",
    }

    return providerMap[domain] || null
  } catch {
    return null
  }
}

function inferTechnologyFromContent(text: string): string {
  const lowerText = text.toLowerCase()

  if (lowerText.match(/\bsap\b|s\/4hana|erp/)) return "SAP ERP"
  if (lowerText.match(/salesforce|crm|service cloud|marketing cloud/)) return "Salesforce CRM"
  if (lowerText.match(/microsoft dynamics|dynamics 365/)) return "Microsoft Dynamics"
  if (lowerText.match(/oracle\s+(cloud|erp|netsuite)/)) return "Oracle Cloud"
  if (lowerText.match(/\baws\b|amazon web services/)) return "AWS Cloud"
  if (lowerText.match(/azure|microsoft cloud/)) return "Microsoft Azure"
  if (lowerText.match(/google cloud|gcp/)) return "Google Cloud"
  if (lowerText.match(/servicenow/)) return "ServiceNow"
  if (lowerText.match(/workday/)) return "Workday HCM"
  if (lowerText.match(/tableau|power\s*bi|looker/)) return "Business Intelligence"

  return "Tecnología"
}

async function searchWithPerplexity(context: {
  company_name: string
  industry?: string
  country?: string
  keywords?: string[]
}): Promise<{ success: boolean; data?: any; error?: string; citations?: string[] }> {
  try {
    const apiKey = process.env.PERPLEXITY_API_KEY
    if (!apiKey) {
      return { success: false, error: "PERPLEXITY_API_KEY not configured" }
    }

    console.log("[v0] Implementations: Calling Perplexity API as PRIMARY...")

    const twentyFourMonthsAgo = new Date()
    twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24)
    const dateFilter = `${String(twentyFourMonthsAgo.getMonth() + 1).padStart(2, "0")}/${String(twentyFourMonthsAgo.getDate()).padStart(2, "0")}/${twentyFourMonthsAgo.getFullYear()}`

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
        search_recency_filter: "year",
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[v0] Implementations: Perplexity API error:", response.status, errorText)
      return { success: false, error: `Perplexity API error: ${response.status}` }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    const citations = data.citations || []

    console.log("[v0] Implementations: Perplexity response received", {
      contentLength: content?.length || 0,
      citationsCount: citations.length,
      citationsPreview: citations.slice(0, 3),
    })

    if (!content) {
      console.error("[v0] Implementations: Perplexity no content in response")
      return { success: false, error: "No content from Perplexity" }
    }

    const parsed = parsePerplexityJson(content)
    let items = []

    if (Array.isArray(parsed)) {
      items = parsed
    } else if (parsed.implementations && Array.isArray(parsed.implementations)) {
      items = parsed.implementations
    }

    console.log("[v0] Implementations: Perplexity SUCCESS - Got", items.length, "items")

    const itemsWithUrls = mapImplementationsToCitations(items, citations, context.company_name)

    return {
      success: true,
      data: { implementations: itemsWithUrls },
      citations,
    }
  } catch (error) {
    console.error("[v0] Implementations: Perplexity error:", error)
    return { success: false, error: String(error) }
  }
}

function parsePerplexityJson(content: string): any {
  let jsonContent = content.trim()

  // Paso 1: Remover markdown code blocks si existen
  if (jsonContent.startsWith("```")) {
    jsonContent = jsonContent.replace(/```json?\n?/g, "").replace(/```$/g, "")
  }

  // Paso 2: Extraer JSON si viene con texto adicional
  if (!jsonContent.startsWith("{") && !jsonContent.startsWith("[")) {
    const jsonMatch = jsonContent.match(/\{[\s\S]*?"implementations"[\s\S]*?\}/) || jsonContent.match(/\[[\s\S]*?\]/)
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
    console.log("[v0] Implementations: First JSON parse failed, attempting cleanup...")

    // Paso 4: Limpiar caracteres problemáticos
    try {
      // Remover trailing commas
      jsonContent = jsonContent.replace(/,(\s*[}\]])/g, "$1")

      return JSON.parse(jsonContent)
    } catch (secondError) {
      console.log("[v0] Implementations: Second JSON parse failed, attempting regex extraction...")

      // Paso 5: Extraer campos manualmente con regex
      try {
        const implementationsArray: any[] = []
        const implRegex =
          /"title"\s*:\s*"([^"]+)"[\s\S]*?"provider_name"\s*:\s*"([^"]+)"[\s\S]*?"technology"\s*:\s*"([^"]+)"[\s\S]*?"area"\s*:\s*"([^"]+)"[\s\S]*?"summary"\s*:\s*"([^"]+)"[\s\S]*?"evidence_level"\s*:\s*"([^"]+)"/g

        let match
        while ((match = implRegex.exec(content)) !== null) {
          implementationsArray.push({
            title: match[1],
            provider_name: match[2],
            technology: match[3],
            area: match[4],
            summary: match[5],
            evidence_level: match[6],
            results: null,
            source_name: "",
            published_at: null,
          })
        }

        if (implementationsArray.length > 0) {
          console.log("[v0] Implementations: Regex extraction successful -", implementationsArray.length, "items")
          return { implementations: implementationsArray }
        }
      } catch (regexError) {
        console.error("[v0] Implementations: Regex extraction failed:", regexError)
      }

      // Si todo falla, lanzar error original
      throw new Error(`JSON parsing failed: ${firstError.message}`)
    }
  }
}

function mapImplementationsToCitations(items: any[], citations: string[], company_name: string): any[] {
  return items.map((item, index) => {
    let bestCitation = citations[index] || null

    if (!bestCitation && item.source_name && citations.length > 0) {
      const sourceDomain = item.source_name.toLowerCase()
      bestCitation =
        citations.find((url) => {
          const citationDomain = extractDomain(url).toLowerCase()
          return sourceDomain.includes(citationDomain) || citationDomain.includes(sourceDomain)
        }) || null
    }

    if (!bestCitation && citations.length > 0) {
      bestCitation = citations[0]
    }

    if (!bestCitation && item.source_name) {
      const cleanName = item.source_name.toLowerCase().replace(/\s+/g, "")
      bestCitation = `https://www.${cleanName}.com`
    }

    // Si no hay una cita clara, intentamos buscar una URL que contenga el nombre de la empresa
    if (!bestCitation && company_name) {
      const companyNameLower = company_name.toLowerCase().replace(/\s/g, "")
      bestCitation = citations.find((url) => url.toLowerCase().includes(companyNameLower)) || null
    }

    return {
      ...item,
      source_url: bestCitation || "https://example.com",
    }
  })
}

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace("www.", "")
  } catch {
    return url
  }
}

async function mapToGroundingUrls(items: any[], groundingUrls: Map<string, string>): Promise<any[]> {
  const results = await Promise.all(
    items.map(async (item) => {
      let finalUrl = item.source_url
      let fromGrounding = false

      // Buscar por título
      const titleLower = item.title.toLowerCase()
      for (const [groundingTitle, realUrl] of groundingUrls) {
        if (titleLower.includes(groundingTitle.substring(0, 30).toLowerCase())) {
          finalUrl = realUrl
          fromGrounding = true
          break
        }
      }

      // Buscar por dominio
      if (!fromGrounding && item.source_name) {
        const sourceDomain = extractDomain(item.source_name)
        for (const [_, realUrl] of groundingUrls) {
          const groundingDomain = extractDomain(realUrl)
          if (sourceDomain === groundingDomain) {
            finalUrl = realUrl
            fromGrounding = true
            break
          }
        }
      }

      if (
        !fromGrounding &&
        finalUrl &&
        finalUrl !== "https://example.com" &&
        !finalUrl.includes("vertexaisearch.cloud.google.com")
      ) {
        const isValid = await validateUrl(finalUrl)
        if (!isValid) {
          const domain = extractDomain(finalUrl)
          finalUrl = `https://${domain}`
          console.log("[v0] Implementations: URL validation failed, using domain:", finalUrl)
        }
      }

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
        _fromGrounding: fromGrounding,
      }
    }),
  )

  return results
}

async function validateUrl(url: string): Promise<boolean> {
  try {
    if (url.includes("vertexaisearch.cloud.google.com") || url.includes("grounding-api-redirect")) {
      return false
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)

    console.log("[v0] Implementations: Validating URL:", url)

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    })

    clearTimeout(timeoutId)
    const isValid = response.ok

    if (!isValid) {
      console.log(
        "[v0] Implementations: URL returned non-OK status (expected, will fallback to domain):",
        response.status,
      )
    }

    return isValid
  } catch (error) {
    console.log("[v0] Implementations: URL validation failed (expected, will fallback to domain)")
    return false
  }
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

    const body = await request.json()
    const { bookmarkId, forceRefresh = false } = body

    if (!bookmarkId) {
      return NextResponse.json({ error: "bookmarkId is required" }, { status: 400 })
    }

    const { data: bookmark, error: bookmarkError } = await supabase
      .from("bookmarks")
      .select("*, company:companies(*)")
      .eq("id", bookmarkId)
      .single()

    if (bookmarkError || !bookmark) {
      return NextResponse.json({ error: "Bookmark not found" }, { status: 404 })
    }

    const company = bookmark.company
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    const companyId = company.id
    const companyName = company.name
    const companyWebsite = company.website

    if (!forceRefresh) {
      const cached = await getImplementationsFromCache(supabase, companyId)
      if (cached && cached.length > 0) {
        console.log("[v0] Implementations: Returning from cache")
        await registerUserInteractions(
          supabase,
          user.id,
          companyId,
          cached.map((n: any) => n.id),
        )
        return NextResponse.json({
          implementations: cached,
          cached: true,
          provider: "cache",
        })
      }
    }

    const perplexityResult = await searchWithPerplexity({
      company_name: companyName,
      industry: company.industry,
      country: company.country,
      keywords: [], // Assuming keywords are not directly available from bookmark
    })

    let implementations: any[] = []
    let provider = "none"

    if (perplexityResult.success && perplexityResult.data?.implementations?.length > 0) {
      implementations = perplexityResult.data.implementations
      provider = "perplexity"
      console.log(`[v0] Implementations: Using Perplexity results (${implementations.length} items)`)
    } else {
      console.log(
        "[v0] Implementations: Perplexity failed or returned 0 results, trying Tavily with improved filters...",
      )

      const tavilyResult = await searchWithTavilyMultiQuery({
        company_name: companyName,
        industry: company.industry,
        country: company.country,
        keywords: [],
        website: companyWebsite, // Agregado website
      })

      if (tavilyResult.success && tavilyResult.data?.implementations?.length > 0) {
        implementations = tavilyResult.data.implementations
        provider = "tavily"
        console.log(`[v0] Implementations: Using Tavily results (${implementations.length} items)`)
      } else {
        console.log("[v0] Implementations: Both Perplexity and Tavily failed, checking old cache...")

        const oldCache = await getOldCache(supabase, companyId)
        if (oldCache && oldCache.length > 0) {
          console.log("[v0] Implementations: Returning old cache")
          await registerUserInteractions(
            supabase,
            user.id,
            companyId,
            oldCache.map((n: any) => n.id),
          )
          return NextResponse.json({
            implementations: oldCache,
            cached: true,
            provider: "old_cache",
          })
        }

        console.log("[v0] Implementations: No results from any source")
        return NextResponse.json({
          implementations: [],
          cached: false,
          provider: "none",
        })
      }
    }

    const seenUrls = new Set<string>()
    const uniqueImplementations = implementations.filter((item) => {
      if (seenUrls.has(item.source_url)) {
        return false
      }
      seenUrls.add(item.source_url)
      return true
    })

    // Obtener URLs de implementaciones existentes para esta empresa
    const { data: existingImpls } = await supabase
      .from("company_implementations")
      .select("source_url")
      .eq("company_id", companyId)

    const existingUrls = new Set(existingImpls?.map((i) => i.source_url) || [])

    // Filtrar solo implementaciones nuevas que no existen en la DB
    const newImplementationsToInsert = uniqueImplementations
      .filter((item) => !existingUrls.has(item.source_url))
      .map((item) => ({
        company_id: companyId,
        title: item.title,
        summary: item.summary,
        source_url: item.source_url,
        source_name: item.source_name,
        published_at: sanitizeDate(item.published_at),
        ai_provider: provider,
      }))

    console.log(
      `[v0] Implementations: Inserting ${newImplementationsToInsert.length} new items (${uniqueImplementations.length - newImplementationsToInsert.length} duplicates skipped)`,
    )

    let saved = []

    // Solo insertar si hay implementaciones nuevas
    if (newImplementationsToInsert.length > 0) {
      const { data: inserted, error: insertError } = await supabase
        .from("company_implementations")
        .insert(newImplementationsToInsert)
        .select()

      if (insertError) {
        console.error("[v0] Implementations: Error inserting:", insertError)
        return NextResponse.json({ error: "Failed to save implementations" }, { status: 500 })
      }

      saved = inserted || []
    }

    // Obtener todas las implementaciones de esta empresa (incluyendo las que ya existían)
    const { data: allCompanyImpls } = await supabase
      .from("company_implementations")
      .select("*")
      .eq("company_id", companyId)
      .order("published_at", { ascending: false })
      .limit(15)

    const finalImplementations = allCompanyImpls || saved

    await registerUserInteractions(
      supabase,
      user.id,
      companyId,
      finalImplementations.map((i: any) => i.id),
    )

    return NextResponse.json({
      implementations: finalImplementations,
      cached: false,
      provider: provider,
    })
  } catch (error) {
    console.error("[v0] Implementations: Unexpected error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
