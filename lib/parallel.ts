import Parallel from "parallel-web"

const client = new Parallel({ apiKey: process.env.PARALLEL_API_KEY })

export interface ParallelSearchOptions {
  objective: string
  search_queries: string[]
  max_results?: number
  source_policy?: {
    include_domains?: string[]
    exclude_domains?: string[]
    after_date?: string // YYYY-MM-DD
  }
  excerpts?: {
    max_chars_per_result?: number
    max_chars_total?: number
  }
}

export interface ParallelResult {
  url: string
  title: string
  publish_date: string | null
  excerpts: string[]
}

export interface ParallelSearchResponse {
  search_id: string
  results: ParallelResult[]
  warnings: string[] | null
}

/**
 * Execute a Parallel web search.
 * Returns structured results with URLs, titles, dates and LLM-optimized excerpts.
 */
export async function parallelSearch(options: ParallelSearchOptions): Promise<ParallelSearchResponse> {
  const search = await client.beta.search({
    objective: options.objective,
    search_queries: options.search_queries,
    max_results: options.max_results ?? 10,
    source_policy: options.source_policy,
    excerpts: options.excerpts ?? { max_chars_per_result: 8000 },
  })

  return {
    search_id: search.search_id ?? "",
    results: (search.results ?? []).map((r: any) => ({
      url: r.url ?? "",
      title: r.title ?? "",
      publish_date: r.publish_date ?? null,
      excerpts: r.excerpts ?? [],
    })),
    warnings: search.warnings ?? null,
  }
}

/**
 * Build search queries for company NEWS (press, media, events, financials, M&A).
 * Returns both objective and search_queries optimized for Parallel best practices.
 */
export function buildNewsSearchParams(context: {
  company_name: string
  industry?: string
  country?: string
}): ParallelSearchOptions {
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
  const afterDate = oneYearAgo.toISOString().split("T")[0]

  const industryCtx = context.industry ? ` (industria: ${context.industry})` : ""
  const countryCtx = context.country ? ` en ${context.country}` : " en Latinoamérica"

  return {
    objective: `Busco noticias recientes sobre la empresa "${context.company_name}"${industryCtx}${countryCtx}. ` +
      `Necesito señales de compra B2B: inversiones en tecnología, transformación digital, expansión, cambios de liderazgo C-level, ` +
      `alianzas estratégicas, fusiones y adquisiciones, resultados financieros, nuevos productos o mercados. ` +
      `Priorizar fuentes de prensa de negocios y tecnología. Excluir noticias de productos al consumidor, RSE genérica, eventos sociales.`,
    search_queries: [
      `"${context.company_name}" noticias inversión tecnología transformación digital`,
      `"${context.company_name}" expansión crecimiento nuevo mercado alianza`,
      `"${context.company_name}" CEO CTO CIO nombramientos liderazgo ejecutivo`,
      `"${context.company_name}" adquisición fusión partnership estratégico`,
      `"${context.company_name}" resultados financieros revenue earnings innovación`,
    ],
    max_results: 15,
    source_policy: {
      exclude_domains: [
        "linkedin.com",
        "facebook.com",
        "twitter.com",
        "x.com",
        "instagram.com",
        "tiktok.com",
        "youtube.com",
      ],
      after_date: afterDate,
    },
    excerpts: { max_chars_per_result: 6000 },
  }
}

/**
 * Build search queries for company IMPLEMENTATIONS (business cases, success stories from vendors).
 * IMPORTANT: Focuses on case studies published BY vendors/consultants about the company.
 * Returns both objective and search_queries optimized for Parallel best practices.
 */
export function buildImplementationsSearchParams(context: {
  company_name: string
  industry?: string
  country?: string
  keywords?: string[] // señales de tecnología/procesos del bookmark
}): ParallelSearchOptions {
  const threeYearsAgo = new Date()
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3)
  const afterDate = threeYearsAgo.toISOString().split("T")[0]

  const industryCtx = context.industry ? ` (industria: ${context.industry})` : ""
  const countryCtx = context.country ? ` en ${context.country}` : " en Latinoamérica"
  const keywordsCtx = context.keywords?.length
    ? ` Tecnologías de interés: ${context.keywords.join(", ")}.`
    : ""

  // Build technology-specific queries if keywords are available
  const techQueries = (context.keywords ?? [])
    .slice(0, 2)
    .map(kw => `"${context.company_name}" "${kw}" customer success case study`)

  return {
    objective: `Busco CASOS DE ÉXITO y CUSTOMER SUCCESS STORIES publicados por vendors y consultoras SOBRE la empresa "${context.company_name}"${industryCtx}${countryCtx}.${keywordsCtx} ` +
      `SOLO busco case studies oficiales publicados en sitios de vendors como: AWS (aws.amazon.com/solutions/case-studies), ` +
      `Microsoft (customers.microsoft.com), SAP (sap.com/customers), Salesforce (salesforce.com/customer-success-stories), ` +
      `Oracle, Google Cloud, Accenture, Deloitte, McKinsey, Globant, etc. ` +
      `NO busco noticias de prensa general - esas van en la pestaña de Noticias. ` +
      `NO busco reportes de sostenibilidad, memorias anuales ni documentos corporativos - esos van en otra pestaña. ` +
      `Quiero saber: qué tecnología implementaron, qué problema resolvieron, qué resultados obtuvieron.`,
    search_queries: [
      `"${context.company_name}" customer success story case study`,
      `"${context.company_name}" cliente caso de éxito implementación vendor`,
      `"${context.company_name}" AWS Azure Google Cloud Microsoft customer story`,
      `"${context.company_name}" SAP Salesforce Oracle implementation case study`,
      ...techQueries,
    ].slice(0, 5), // max 5 queries
    max_results: 10,
    source_policy: {
      // Exclude social and news media (keep under 10 domains to avoid API limits)
      exclude_domains: [
        "linkedin.com",
        "facebook.com",
        "twitter.com",
        "instagram.com",
        "youtube.com",
        "sec.gov", // SEC goes to public docs tab
      ],
      after_date: afterDate,
    },
    excerpts: { max_chars_per_result: 8000 },
  }
}

/**
 * Build search queries for PUBLIC DOCUMENTS (annual reports, sustainability reports, financial reports).
 * NOTE: SEC filings are fetched directly via SEC EDGAR API, this is for non-SEC documents.
 * Returns both objective and search_queries optimized for Parallel best practices.
 */
export function buildPublicDocsSearchParams(context: {
  company_name: string
  ticker?: string
  country?: string
  is_public?: boolean // If we know the company is public/private
  sources: ("annual" | "earnings" | "sustainability" | "financial")[]
}): ParallelSearchOptions {
  const currentYear = new Date().getFullYear()
  const year = currentYear
  const prevYear = year - 1

  // Calculate 2 years ago for date filter
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const afterDate = twoYearsAgo.toISOString().split("T")[0]

  // Detect if company might be from LATAM for bilingual search
  const isLatam =
    context.country &&
    [
      "México",
      "Mexico",
      "Argentina",
      "Colombia",
      "Chile",
      "Perú",
      "Peru",
      "Brasil",
      "Brazil",
      "Ecuador",
    ].some((c) => context.country?.toLowerCase().includes(c.toLowerCase()))

  // Build search queries based on requested sources (bilingual)
  const searchQueries: string[] = []
  const sourceDescriptions: string[] = []

  if (context.sources.includes("annual")) {
    searchQueries.push(
      `"${context.company_name}" annual report ${year} ${prevYear}`,
      `"${context.company_name}" memoria anual informe anual ${year}`
    )
    sourceDescriptions.push(
      "annual reports / memorias anuales / informes anuales"
    )
  }

  if (context.sources.includes("earnings")) {
    searchQueries.push(
      `"${context.company_name}" earnings call transcript ${year}`,
      `"${context.company_name}" conference call investors Q4 Q3 ${year}`
    )
    sourceDescriptions.push("earnings call transcripts")
  }

  if (context.sources.includes("sustainability")) {
    searchQueries.push(
      `"${context.company_name}" sustainability report ESG ${year}`,
      `"${context.company_name}" reporte sostenibilidad sustentabilidad ${year}`,
      `"${context.company_name}" environmental social governance report ${year}`
    )
    sourceDescriptions.push(
      "sustainability reports / reportes de sostenibilidad / ESG reports"
    )
  }

  if (context.sources.includes("financial")) {
    searchQueries.push(
      `"${context.company_name}" financial report annual results ${year}`,
      `"${context.company_name}" reporte financiero resultados anuales ${year}`
    )
    sourceDescriptions.push(
      "financial reports / reportes financieros anuales"
    )
  }

  const tickerNote = context.ticker ? ` (ticker: ${context.ticker})` : ""
  const languageNote = isLatam
    ? " Buscar en español e inglés."
    : " Search in English."

  // Add company-specific IR site search if we can infer it
  const companyDomain = context.company_name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
  
  // For LATAM, add specific queries for local regulator sites
  if (isLatam && context.country) {
    const countryLower = context.country.toLowerCase()
    if (countryLower.includes("argentin")) {
      searchQueries.push(`"${context.company_name}" site:cnv.gob.ar OR site:byma.com.ar`)
    } else if (countryLower.includes("chile")) {
      searchQueries.push(`"${context.company_name}" site:cmfchile.cl OR site:bolsadesantiago.com`)
    } else if (countryLower.includes("colombia")) {
      searchQueries.push(`"${context.company_name}" site:superfinanciera.gov.co OR site:bvc.com.co`)
    } else if (countryLower.includes("mexic")) {
      searchQueries.push(`"${context.company_name}" site:bmv.com.mx reporte anual`)
    } else if (countryLower.includes("brasil") || countryLower.includes("brazil")) {
      searchQueries.push(`"${context.company_name}" site:cvm.gov.br OR site:b3.com.br`)
    } else if (countryLower.includes("peru")) {
      searchQueries.push(`"${context.company_name}" site:smv.gob.pe OR site:bvl.com.pe`)
    }
  }

  return {
    objective:
      `Busco DOCUMENTOS OFICIALES publicados directamente por la empresa "${context.company_name}"${tickerNote}: ` +
      `${sourceDescriptions.join(", ")}.${languageNote} ` +
      `SOLO documentos publicados por la empresa en su sitio de investor relations, su página corporativa, o comunicados oficiales. ` +
      `IMPORTANTE: El documento DEBE mencionar explícitamente a "${context.company_name}" en su contenido. ` +
      `NO busco artículos de prensa que HABLAN SOBRE reportes - busco los documentos ORIGINALES. ` +
      `NO busco case studies de vendors - esos van en otra pestaña. ` +
      `NO incluir documentos de OTRAS empresas aunque tengan nombres similares. ` +
      `Años de interés: ${year} y ${prevYear}. ` +
      `IMPORTANTE: Solo documentos publicados en los últimos 2 años (desde ${afterDate}).`,
    search_queries: searchQueries.slice(0, 7), // Max 7 queries for bilingual coverage
    max_results: 12,
    source_policy: {
      // Minimal exclude list to stay under API limits
      exclude_domains: [
        "linkedin.com",
        "facebook.com",
        "twitter.com",
        "instagram.com",
        "youtube.com",
      ],
      // Only documents from last 2 years
      after_date: afterDate,
    },
    excerpts: { max_chars_per_result: 10000 }, // Larger excerpts for documents
  }
}
