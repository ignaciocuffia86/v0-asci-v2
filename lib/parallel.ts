import { gateway, generateText, stepCountIs } from "ai"
import { RESEARCH_MODEL } from "@/lib/ai-models"
import { logAiUsage } from "@/lib/v3/usage"

// Desde la migracion a ai@7 este modulo ya NO usa el SDK `parallel-web` ni
// PARALLEL_API_KEY: la unica busqueda (searchPublicDocsViaGateway) va por el AI
// Gateway. Se conservan los tipos + buildPublicDocsSearchParams (constructor de
// params puro) que consume la ruta /api/research/public-docs.

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
 * Busqueda de documentos publicos ENRUTADA POR EL AI GATEWAY
 * (`gateway.tools.parallelSearch`) en vez de pegarle directo a parallel-web con el
 * SDK. Es el unico camino de busqueda de este modulo desde la migracion a ai@7.
 *
 * ── Por que ──
 * 1. Costo VISIBLE: la busqueda se factura y reporta por el Gateway (como el resto
 *    de la IA de v3), y ademas se registra en v3.ai_usage_log. El path directo era
 *    invisible para la reporteria de costos.
 * 2. Sin PARALLEL_API_KEY en la app: el Gateway tiene la credencial de Parallel.
 *    Elimina una env var que ademas DIVERGE entre los dos proyectos Vercel.
 *
 * ── Trade-off (medido) ──
 * Es una provider-executed tool: el `objective` y las `search_queries` los arma el
 * MODELO (Haiku), no el codigo. Se le pasan las queries afinadas como prompt y se
 * PINEA el `source_policy` (dominios + fecha) via config, que es lo que sostiene el
 * anti-contaminacion. En la validacion con Arcos Dorados dio 12 docs (9 oficiales:
 * earnings transcripts + annual reports) en 1 sola tool-call, respetando el
 * include/exclude de dominios. Ruido menor de cross-mentions (marca madre /
 * competidor) que la clasificacion + dedup downstream de la ruta ya absorbe.
 *
 * Devuelve un `ParallelSearchResponse` (url/title/publish_date/excerpts) listo para
 * el caller de la ruta public-docs.
 */
export async function searchPublicDocsViaGateway(
  options: ParallelSearchOptions,
  tracking?: { companyId?: string | null; userId?: string | null; workspaceId?: string | null },
): Promise<ParallelSearchResponse> {
  const sp = options.source_policy ?? {}
  const prompt =
    `${options.objective}\n\n` +
    `Ejecuta UNA busqueda web con estas queries (todas en una sola llamada a la herramienta):\n` +
    options.search_queries.map((q, i) => `${i + 1}. ${q}`).join("\n")

  const results: ParallelResult[] = []
  let usage: { inputTokens?: number; outputTokens?: number } | undefined

  try {
    const res = await generateText({
      model: RESEARCH_MODEL,
      prompt,
      tools: {
        parallelSearch: gateway.tools.parallelSearch({
          maxResults: options.max_results ?? 10,
          sourcePolicy: {
            includeDomains: sp.include_domains,
            excludeDomains: sp.exclude_domains,
            afterDate: sp.after_date,
          },
          excerpts: {
            maxCharsPerResult: options.excerpts?.max_chars_per_result ?? 8000,
          },
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // 1 ronda de busqueda + turno de cierre. La tool trae todo en una llamada.
      stopWhen: stepCountIs(3),
    })
    usage = res.usage
    const seen = new Set<string>()
    for (const tr of res.staticToolResults ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out = (tr as any).output
      if (!out || !Array.isArray(out.results)) continue
      for (const r of out.results) {
        const url = r.url ?? ""
        if (!url || seen.has(url)) continue
        seen.add(url)
        results.push({
          url,
          title: r.title ?? "",
          publish_date: r.publishDate ?? null,
          excerpts: r.excerpt ? [r.excerpt] : [],
        })
      }
    }
  } catch (err) {
    console.error("[v0][public-docs] searchPublicDocsViaGateway error:", err)
  }

  // Atribucion de costo. Se usa 'research-collect' (esta etapa ES descubrimiento
  // de fuentes) + metadata.stage para poder distinguirla en auditoria; 'public-docs'
  // no esta en el CHECK de feature y no queremos una migracion sobre esa tabla.
  void logAiUsage({
    workspaceId: tracking?.workspaceId ?? null,
    userId: tracking?.userId ?? null,
    companyId: tracking?.companyId ?? null,
    feature: "research-collect",
    model: RESEARCH_MODEL,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    metadata: { stage: "public-docs-search", results: results.length },
  })

  return { search_id: "", results, warnings: null }
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

  return {
    objective:
      `Busco DOCUMENTOS OFICIALES publicados directamente por la empresa "${context.company_name}"${tickerNote}: ` +
      `${sourceDescriptions.join(", ")}.${languageNote} ` +
      `SOLO documentos publicados por la empresa en su sitio de investor relations o comunicados oficiales. ` +
      `NO busco artículos de prensa que HABLAN SOBRE reportes - busco los documentos ORIGINALES. ` +
      `NO busco case studies de vendors - esos van en otra pestaña. ` +
      `Años de interés: ${year} y ${prevYear}. ` +
      `IMPORTANTE: Solo documentos publicados en los últimos 2 años (desde ${afterDate}).`,
    search_queries: searchQueries.slice(0, 7), // Max 7 queries for bilingual coverage
    max_results: 12,
    source_policy: {
      // Allow IR/corporate sites and financial data providers
      include_domains: [
        "seekingalpha.com", // Earnings transcripts
        "fool.com", // Earnings transcripts
        "annualreports.com",
        // Note: Company IR sites are allowed by not being excluded
      ],
      // Exclude sources that belong to other tabs
      exclude_domains: [
        "linkedin.com",
        "facebook.com",
        "twitter.com",
        "x.com",
        "instagram.com",
        "youtube.com",
        // Exclude news media (goes to news tab)
        "reuters.com",
        "bloomberg.com",
        "cnbc.com",
        "forbes.com",
        "wsj.com",
        "ft.com",
        // Exclude vendors (goes to implementations tab)
        "aws.amazon.com",
        "customers.microsoft.com",
        "salesforce.com",
        "sap.com",
        "accenture.com",
        "deloitte.com",
      ],
      // Only documents from last 2 years
      after_date: afterDate,
    },
    excerpts: { max_chars_per_result: 10000 }, // Larger excerpts for documents
  }
}
