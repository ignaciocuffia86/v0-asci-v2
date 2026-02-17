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
 * Build search queries for company IMPLEMENTATIONS (technology projects, case studies, vendor relationships).
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
    .map(kw => `"${context.company_name}" "${kw}" implementación proyecto caso de éxito`)

  return {
    objective: `Busco implementaciones tecnológicas, casos de éxito y proyectos de IT realizados EN o PARA la empresa "${context.company_name}"${industryCtx}${countryCtx}.${keywordsCtx} ` +
      `Necesito saber: qué tecnologías usan, qué vendors/consultoras les proveen servicios, proyectos de transformación digital en curso o completados, ` +
      `migraciones cloud, implementaciones ERP/CRM/analytics, partnerships con empresas de tecnología. ` +
      `Priorizar case studies oficiales de vendors (AWS, Microsoft, SAP, Salesforce, Oracle, Google Cloud, etc.), ` +
      `artículos de consultoras (Accenture, Deloitte, Globant, etc.), y noticias de tecnología enterprise.`,
    search_queries: [
      `"${context.company_name}" technology implementation case study digital transformation`,
      `"${context.company_name}" implementación tecnología caso de éxito proyecto`,
      `"${context.company_name}" cloud migration ERP CRM SAP Oracle Salesforce AWS Azure`,
      `"${context.company_name}" vendor partner technology provider consultora`,
      ...techQueries,
    ].slice(0, 5), // max 5 queries
    max_results: 10,
    source_policy: {
      exclude_domains: [
        "linkedin.com",
        "facebook.com",
        "twitter.com",
        "x.com",
        "instagram.com",
        "tiktok.com",
      ],
      after_date: afterDate,
    },
    excerpts: { max_chars_per_result: 8000 },
  }
}
