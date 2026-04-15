/**
 * Search Provider Abstraction Layer
 * 
 * This module provides a unified interface for web search providers (Parallel, Firecrawl, etc.)
 * allowing transparent switching between providers without changing application code.
 */

export type SearchProvider = "parallel" | "firecrawl"

export interface SearchOptions {
  // Common options supported by all providers
  query: string
  objective?: string // Semantic objective (Parallel) or enriched query (Firecrawl)
  maxResults?: number
  
  // Domain filtering
  includeDomains?: string[]
  excludeDomains?: string[]
  
  // Date filtering
  afterDate?: string // YYYY-MM-DD
  beforeDate?: string // YYYY-MM-DD
  timeRange?: "hour" | "day" | "week" | "month" | "year" // For Firecrawl tbs
  
  // Content options
  excerptMaxChars?: number
  scrapeFullContent?: boolean // Only Firecrawl
  
  // Geo-targeting (Firecrawl only)
  location?: string
  
  // Special categories (Firecrawl only)
  categories?: ("web" | "news" | "images" | "github" | "research" | "pdf")[]
}

export interface SearchResult {
  url: string
  title: string
  description?: string
  publishDate: string | null
  excerpts: string[]
  markdown?: string // Only if scrapeFullContent=true
  category?: string
}

export interface SearchResponse {
  provider: SearchProvider
  searchId?: string
  results: SearchResult[]
  warnings?: string[]
}

/**
 * Get the currently configured search provider
 */
export function getActiveProvider(): SearchProvider {
  const provider = process.env.SEARCH_PROVIDER as SearchProvider
  
  // Check which API keys are available
  const hasParallel = !!process.env.PARALLEL_API_KEY
  const hasFirecrawl = !!process.env.FIRECRAWL_API_KEY
  
  // Use configured provider if available, otherwise fallback
  if (provider === "firecrawl" && hasFirecrawl) return "firecrawl"
  if (provider === "parallel" && hasParallel) return "parallel"
  
  // Default fallback order
  if (hasParallel) return "parallel"
  if (hasFirecrawl) return "firecrawl"
  
  throw new Error("No search provider configured. Set PARALLEL_API_KEY or FIRECRAWL_API_KEY")
}

/**
 * Unified search function that routes to the appropriate provider
 */
export async function search(options: SearchOptions): Promise<SearchResponse> {
  const provider = getActiveProvider()
  
  console.log(`[SearchProvider] Using ${provider} for search`)
  
  switch (provider) {
    case "parallel":
      return searchWithParallel(options)
    case "firecrawl":
      return searchWithFirecrawl(options)
    default:
      throw new Error(`Unknown search provider: ${provider}`)
  }
}

// ============================================================
// PARALLEL IMPLEMENTATION
// ============================================================

async function searchWithParallel(options: SearchOptions): Promise<SearchResponse> {
  const Parallel = (await import("parallel-web")).default
  const client = new Parallel({ apiKey: process.env.PARALLEL_API_KEY })
  
  // Build search queries from the main query
  const searchQueries = options.objective
    ? [options.query] // If we have objective, single query is fine
    : [
        options.query,
        `${options.query} noticias recientes`,
        `${options.query} últimas novedades`,
      ]
  
  const result = await client.beta.search({
    objective: options.objective || `Busco información sobre: ${options.query}`,
    search_queries: searchQueries.slice(0, 5),
    max_results: options.maxResults ?? 10,
    source_policy: {
      include_domains: options.includeDomains,
      exclude_domains: options.excludeDomains,
      after_date: options.afterDate,
    },
    excerpts: {
      max_chars_per_result: options.excerptMaxChars ?? 6000,
    },
  })
  
  return {
    provider: "parallel",
    searchId: result.search_id,
    results: (result.results ?? []).map((r: any) => ({
      url: r.url ?? "",
      title: r.title ?? "",
      publishDate: r.publish_date ?? null,
      excerpts: r.excerpts ?? [],
    })),
    warnings: result.warnings ?? undefined,
  }
}

// ============================================================
// FIRECRAWL IMPLEMENTATION
// ============================================================

async function searchWithFirecrawl(options: SearchOptions): Promise<SearchResponse> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured")
  
  // Build the query with domain filters (Firecrawl uses site: operator)
  let query = options.query
  
  if (options.includeDomains?.length) {
    // Add site: operators for include domains
    const siteFilters = options.includeDomains.slice(0, 3).map(d => `site:${d}`).join(" OR ")
    query = `${query} (${siteFilters})`
  }
  
  if (options.excludeDomains?.length) {
    // Add -site: operators for exclude domains
    const excludeFilters = options.excludeDomains.slice(0, 5).map(d => `-site:${d}`).join(" ")
    query = `${query} ${excludeFilters}`
  }
  
  // Map timeRange to Firecrawl tbs format
  const tbsMap: Record<string, string> = {
    hour: "qdr:h",
    day: "qdr:d",
    week: "qdr:w",
    month: "qdr:m",
    year: "qdr:y",
  }
  
  const requestBody: any = {
    query,
    limit: options.maxResults ?? 10,
  }
  
  // Add time-based search if specified
  if (options.timeRange) {
    requestBody.tbs = tbsMap[options.timeRange]
  }
  
  // Add location if specified
  if (options.location) {
    requestBody.location = options.location
  }
  
  // Add categories/sources if specified
  if (options.categories?.length) {
    // Firecrawl uses 'sources' for web/news/images
    const sources = options.categories.filter(c => ["web", "news", "images"].includes(c))
    if (sources.length > 0) {
      requestBody.sources = sources
    }
    
    // And 'categories' for github/research/pdf
    const cats = options.categories.filter(c => ["github", "research", "pdf"].includes(c))
    if (cats.length > 0) {
      requestBody.categories = cats
    }
  }
  
  // Add scrape options if we want full content
  if (options.scrapeFullContent) {
    requestBody.scrapeOptions = {
      formats: ["markdown"],
    }
  }
  
  const response = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Firecrawl search failed: ${response.status} ${errorText}`)
  }
  
  const data = await response.json()
  
  // Firecrawl returns different structure based on sources
  const webResults = data.data?.web ?? data.data ?? []
  const newsResults = data.data?.news ?? []
  
  // Combine and normalize results
  const allResults = [
    ...webResults.map((r: any) => ({ ...r, category: "web" })),
    ...newsResults.map((r: any) => ({ ...r, category: "news" })),
  ]
  
  return {
    provider: "firecrawl",
    results: allResults.map((r: any) => ({
      url: r.url ?? "",
      title: r.title ?? "",
      description: r.description ?? r.snippet,
      publishDate: r.date ?? null,
      excerpts: r.markdown ? [r.markdown] : (r.description ? [r.description] : []),
      markdown: r.markdown,
      category: r.category,
    })),
  }
}

// ============================================================
// HELPER FUNCTIONS FOR COMMON USE CASES
// ============================================================

/**
 * Search for company news (optimized for news detection)
 */
export async function searchCompanyNews(
  companyName: string,
  options?: Partial<SearchOptions>
): Promise<SearchResponse> {
  const provider = getActiveProvider()
  
  const baseOptions: SearchOptions = {
    query: `"${companyName}" noticias inversión tecnología`,
    objective: `Busco noticias recientes sobre la empresa "${companyName}". ` +
      `Necesito señales de compra B2B: inversiones en tecnología, transformación digital, ` +
      `expansión, cambios de liderazgo, alianzas estratégicas, M&A, resultados financieros.`,
    maxResults: 15,
    timeRange: "year",
    excludeDomains: [
      "linkedin.com", "facebook.com", "twitter.com", "x.com",
      "instagram.com", "tiktok.com", "youtube.com",
    ],
    ...options,
  }
  
  // For Firecrawl, also request news category
  if (provider === "firecrawl") {
    baseOptions.categories = ["web", "news"]
  }
  
  return search(baseOptions)
}

/**
 * Search for company implementations/case studies
 */
export async function searchCompanyImplementations(
  companyName: string,
  keywords: string[] = [],
  options?: Partial<SearchOptions>
): Promise<SearchResponse> {
  const keywordsCtx = keywords.length > 0
    ? ` Tecnologías de interés: ${keywords.join(", ")}.`
    : ""
  
  return search({
    query: `"${companyName}" customer success case study implementación`,
    objective: `Busco CASOS DE ÉXITO y CUSTOMER SUCCESS STORIES publicados por vendors ` +
      `SOBRE la empresa "${companyName}".${keywordsCtx} ` +
      `SOLO case studies oficiales de vendors como AWS, Microsoft, SAP, Salesforce, Oracle.`,
    maxResults: 10,
    includeDomains: [
      "aws.amazon.com", "customers.microsoft.com", "azure.microsoft.com",
      "cloud.google.com", "sap.com", "salesforce.com", "oracle.com",
      "accenture.com", "deloitte.com", "ibm.com", "servicenow.com",
    ],
    excludeDomains: [
      "linkedin.com", "facebook.com", "twitter.com", "youtube.com",
      "reuters.com", "bloomberg.com", "forbes.com",
    ],
    ...options,
  })
}

/**
 * Search for public documents (annual reports, sustainability reports)
 */
export async function searchPublicDocuments(
  companyName: string,
  ticker?: string,
  options?: Partial<SearchOptions>
): Promise<SearchResponse> {
  const year = new Date().getFullYear()
  const tickerNote = ticker ? ` (ticker: ${ticker})` : ""
  
  return search({
    query: `"${companyName}" annual report sustainability ESG ${year}`,
    objective: `Busco DOCUMENTOS OFICIALES publicados por "${companyName}"${tickerNote}: ` +
      `memorias anuales, reportes de sostenibilidad, ESG reports. ` +
      `SOLO documentos publicados por la empresa en su sitio de investor relations.`,
    maxResults: 12,
    timeRange: "year",
    excludeDomains: [
      "linkedin.com", "facebook.com", "twitter.com", "youtube.com",
      "reuters.com", "bloomberg.com", "forbes.com",
      "aws.amazon.com", "salesforce.com", // Vendor sites go to implementations
    ],
    ...options,
  })
}
