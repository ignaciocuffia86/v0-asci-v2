/**
 * Parallel Extract API Client
 * 
 * Provides functions to extract and parse content from URLs (including PDFs)
 * using Parallel's Extract API, which converts documents to markdown
 * optimized for LLM processing.
 */

import Parallel from "parallel-web"

const client = new Parallel({ apiKey: process.env.PARALLEL_API_KEY })

export interface ExtractResult {
  url: string
  title: string
  content: string
  excerpts: string[]
  error?: string
  fallback_used?: boolean
}

export interface ExtractOptions {
  url: string
  objective?: string
  timeout?: number
}

/**
 * Default objective for public document extraction
 */
export const PUBLIC_DOCS_EXTRACTION_OBJECTIVE = `
Extrae la información más relevante para análisis de inversión B2B:

1. SEÑALES DE INVERSIÓN TECH:
   - Capex en tecnología (montos, proyectos)
   - Iniciativas de transformación digital
   - Modernización de sistemas / infraestructura
   - Adopción de cloud, AI, automation
   - Cybersecurity investments

2. PAIN POINTS / DESAFÍOS:
   - Risk factors relacionados a tecnología
   - Problemas operativos mencionados
   - Debt técnica o sistemas legacy
   - Challenges de integración o escalabilidad

3. ESTRATEGIA CORPORATIVA:
   - Prioridades estratégicas de la empresa
   - Planes de expansión o M&A
   - Guidance y proyecciones
   - Cambios organizacionales

Para cada hallazgo importante, CITA el texto original entre comillas 
y menciona la sección/página donde se encontró.
`

/**
 * Extract content from a URL using Parallel Extract API
 * With fallback strategies for failed extractions
 * 
 * NOTE: Parallel API expects `urls` (array) not `url` (singular)
 */
export async function extractDocumentContent(
  options: ExtractOptions
): Promise<ExtractResult> {
  const { url, objective = PUBLIC_DOCS_EXTRACTION_OBJECTIVE, timeout = 30000 } = options

  try {
    // Attempt 1: Direct extraction via Parallel (using urls array as required by API)
    const result = await Promise.race([
      client.beta.extract({
        urls: [url], // API expects array of URLs
        objective,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeout)
      ),
    ])

    // Result contains array of extracted documents
    const extracted = result.results?.[0] ?? result

    return {
      url,
      title: extracted.title ?? "Document",
      content: extracted.content ?? extracted.text ?? "",
      excerpts: extracted.excerpts ?? [],
    }
  } catch (error) {
    console.warn(`[Parallel Extract] Failed for ${url}:`, error)

    // Fallback 1: If SEC filing, try HTML version instead of PDF
    if (url.includes("sec.gov") && (url.endsWith(".pdf") || url.endsWith(".PDF"))) {
      try {
        const htmlUrl = url.replace(/\.pdf$/i, ".htm")
        console.log(`[Parallel Extract] Trying HTML fallback: ${htmlUrl}`)

        const htmlResult = await Promise.race([
          client.beta.extract({
            urls: [htmlUrl], // API expects array
            objective,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), timeout)
          ),
        ])

        const extracted = htmlResult.results?.[0] ?? htmlResult

        return {
          url: htmlUrl,
          title: extracted.title ?? "Document",
          content: extracted.content ?? extracted.text ?? "",
          excerpts: extracted.excerpts ?? [],
          fallback_used: true,
        }
      } catch (htmlError) {
        console.warn(`[Parallel Extract] HTML fallback also failed for ${url}`)
      }
    }

    // Fallback 2: Return error state (caller can use search excerpts instead)
    return {
      url,
      title: "Contenido no disponible",
      content: "",
      excerpts: [],
      error: `No se pudo extraer el contenido del documento: ${error instanceof Error ? error.message : "Unknown error"}`,
      fallback_used: true,
    }
  }
}

/**
 * Extract content from multiple URLs in parallel
 * Respects a maximum number of concurrent extractions
 */
export async function extractMultipleDocuments(
  urls: { url: string; type: string; date?: string }[],
  options: {
    objective?: string
    maxConcurrent?: number
    timeout?: number
  } = {}
): Promise<(ExtractResult & { type: string; date?: string })[]> {
  const { 
    objective = PUBLIC_DOCS_EXTRACTION_OBJECTIVE,
    maxConcurrent = 4,
    timeout = 30000 
  } = options

  // Process in batches to avoid overwhelming the API
  const results: (ExtractResult & { type: string; date?: string })[] = []

  for (let i = 0; i < urls.length; i += maxConcurrent) {
    const batch = urls.slice(i, i + maxConcurrent)
    
    const batchResults = await Promise.allSettled(
      batch.map(async (doc) => {
        const result = await extractDocumentContent({
          url: doc.url,
          objective,
          timeout,
        })
        return {
          ...result,
          type: doc.type,
          date: doc.date,
        }
      })
    )

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      const originalDoc = batch[j]

      if (result.status === "fulfilled") {
        results.push(result.value)
      } else {
        results.push({
          url: originalDoc.url,
          title: "Error de extracción",
          content: "",
          excerpts: [],
          error: result.reason?.message ?? "Unknown error",
          fallback_used: true,
          type: originalDoc.type,
          date: originalDoc.date,
        })
      }
    }
  }

  return results
}

/**
 * Priority order for document types when limiting to max documents
 */
const DOCUMENT_PRIORITY: Record<string, number> = {
  "10-K": 1, // Most important: annual report with full disclosure
  earnings_call: 2, // Second: forward-looking guidance
  sustainability: 3, // Third: ESG and operational insights
  "10-Q": 4, // Fourth: quarterly updates
  annual_report: 5, // Fifth: non-SEC annual reports
  "8-K": 6, // Sixth: material events
  financial: 7, // Last: generic financial reports
}

/**
 * Prioritize and limit document URLs to process
 * Ensures diversity of document types while respecting limits
 */
export function prioritizeAndLimitUrls(
  urls: { url: string; type: string; date?: string }[],
  maxDocs: number = 8
): { url: string; type: string; date?: string }[] {
  // Sort by priority and then by date (most recent first)
  const sorted = [...urls].sort((a, b) => {
    const priorityDiff =
      (DOCUMENT_PRIORITY[a.type] ?? 99) - (DOCUMENT_PRIORITY[b.type] ?? 99)
    if (priorityDiff !== 0) return priorityDiff

    // If same priority, sort by date (most recent first)
    if (a.date && b.date) {
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    }
    return 0
  })

  // Select with diversity: max 2 of each type
  const selected: { url: string; type: string; date?: string }[] = []
  const countByType: Record<string, number> = {}

  for (const doc of sorted) {
    const typeCount = countByType[doc.type] ?? 0
    if (typeCount < 2 && selected.length < maxDocs) {
      selected.push(doc)
      countByType[doc.type] = typeCount + 1
    }
  }

  return selected
}
