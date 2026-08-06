import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { parallelSearch, buildPublicDocsSearchParams } from "@/lib/parallel"
import {
  getCIKByTicker,
  searchSECByCompanyName,
  getCompanyFilings,
  mapSECFormToDocumentType,
} from "@/lib/sec-edgar"

const DOCS_CACHE_DAYS = 30 // Refresh at most once per month
const MAX_DOCS = 10

// ── Gemini structuring for public documents ─────────────────────────────
const GEMINI_SYSTEM = `Eres un analista de inversiones B2B especializado en analizar documentos públicos de empresas.
Se te dan excerpts de reportes anuales, reportes de sostenibilidad, transcripciones de earnings calls, y filings de SEC.
Tu tarea es extraer información relevante para un vendedor B2B que quiere entender a esta empresa.

REGLAS:
1. Responde UNICAMENTE con JSON válido (sin markdown, sin texto extra).
2. SIEMPRE cita el texto original entre comillas cuando extraigas un hallazgo.
3. Indica la sección/página/fuente de cada hallazgo cuando sea posible.
4. Enfócate en señales de inversión tecnológica, pain points, y estrategia corporativa.
5. Si no hay información relevante, devuelve {"findings":[], "digest": null}

CATEGORÍAS de hallazgos válidas:
- tech_investment: Inversiones en tecnología, CAPEX IT, proyectos de modernización
- pain_point: Desafíos, riesgos, problemas operativos, deuda técnica
- strategy: Prioridades estratégicas, planes de expansión, M&A
- financial: KPIs, guidance, métricas financieras relevantes

ADEMAS de los hallazgos, genera un "digest" de EXACTAMENTE 1 párrafo (2-4 oraciones) en ESPAÑOL que resuma:
- Inversiones o planes tecnológicos detectados
- Desafíos operativos o pain points mencionados
- Oportunidades para un vendedor B2B

El digest debe responder: "¿Qué dice la empresa oficialmente sobre sus prioridades y desafíos?"

FORMATO JSON:
{
  "findings": [
    {
      "category": "string (una de las categorías válidas)",
      "finding": "string (descripción del hallazgo en español)",
      "quote": "string (cita textual del documento original)",
      "source_section": "string o null (sección/página donde se encontró)",
      "relevance": "high | medium | low"
    }
  ],
  "digest": "string (párrafo resumen en ESPAÑOL) o null"
}`

/**
 * ── Por qué acá NO hay llamada a IA ──
 *
 * Existía una `structureDocumentsWithGemini` con el prompt de arriba que
 * **nunca se llamaba desde ningún lugar**: código muerto. El handler seteaba
 * `findings = []` y un digest de plantilla a mano, y aun así guardaba
 * `ai_provider: "gemini-2.0-flash"`. Verificado en produccion: 29/29 filas de
 * `company_public_docs` sin findings y las 29 declarando ese modelo.
 *
 * La funcion se elimino en vez de engancharla, y la razon importa: los
 * "excerpts" que se le pasaban NO tienen el contenido de los documentos, solo el
 * titulo, el tipo y la URL (ver la construccion de `excerpts` mas abajo, y el
 * comentario original "we can't extract PDFs directly in this simple version").
 * Pedirle hallazgos citados a un modelo que solo ve titulos no da hallazgos: da
 * alucinaciones con formato de cita, que es peor que no tener nada porque
 * parecen verificables.
 *
 * Para que esto haga research de verdad falta la extraccion de PDFs
 * (`lib/parallel-extract.ts`). Hasta entonces esta ruta hace lo unico honesto
 * que puede hacer sin contenido: listar los documentos que encontro. El
 * `ai_provider` ahora lo dice.
 *
 * El prompt GEMINI_SYSTEM se deja como especificacion de lo que habria que pedir
 * cuando exista la extraccion.
 */

// ── Cache helpers ─────────────────────────────────────────────────────
interface CacheResult {
  docs: any[] | null
  lastSearchDate: string | null
  canRefresh: boolean
  daysUntilRefresh: number
}

async function getRecentCache(
  supabase: any,
  companyId: string,
  isSuperadmin: boolean
): Promise<CacheResult> {
  const cacheDate = new Date()
  cacheDate.setDate(cacheDate.getDate() - DOCS_CACHE_DAYS)

  // Get most recent doc to determine last search date
  const { data: lastDoc } = await supabase
    .from("company_public_docs")
    .select("created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()

  const lastSearchDate = lastDoc?.created_at ?? null
  const daysSinceLastSearch = lastSearchDate
    ? (Date.now() - new Date(lastSearchDate).getTime()) / (1000 * 60 * 60 * 24)
    : Infinity

  const canRefresh = isSuperadmin || daysSinceLastSearch >= DOCS_CACHE_DAYS
  const daysUntilRefresh = canRefresh ? 0 : Math.ceil(DOCS_CACHE_DAYS - daysSinceLastSearch)

  // Check if we have docs fetched within the cache window
  const { data: recentFetch } = await supabase
    .from("company_public_docs")
    .select("id")
    .eq("company_id", companyId)
    .gte("created_at", cacheDate.toISOString())
    .limit(1)

  if (recentFetch && recentFetch.length > 0) {
    const { data } = await supabase
      .from("company_public_docs")
      .select("*")
      .eq("company_id", companyId)
      .order("document_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(MAX_DOCS)

    return { docs: data, lastSearchDate, canRefresh, daysUntilRefresh }
  }

  return { docs: null, lastSearchDate, canRefresh, daysUntilRefresh }
}

async function getAnyCache(supabase: any, companyId: string) {
  const { data } = await supabase
    .from("company_public_docs")
    .select("*")
    .eq("company_id", companyId)
    .order("document_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(MAX_DOCS)

  return data
}

// ── Main handler ─────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { bookmarkId, forceRefresh = false } = await request.json()

    if (!bookmarkId) {
      return NextResponse.json({ error: "bookmarkId is required" }, { status: 400 })
    }

    // Get bookmark + company
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

    // Check if user is superadmin
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single()
    const isSuperadmin = profile?.role === "superadmin"

    // Only superadmins can force refresh
    if (forceRefresh && !isSuperadmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    // ── 1. Check cache ───────────────────────────────────────────
    const cacheResult = await getRecentCache(supabase, companyId, isSuperadmin)

    if (!forceRefresh && cacheResult.docs && cacheResult.docs.length > 0) {
      console.log("[v0] Public Docs: Cache hit -", cacheResult.docs.length, "items")
      return NextResponse.json({
        docs: cacheResult.docs,
        isPublic: company.is_public,
        cached: true,
        provider: "cache",
        canRefresh: cacheResult.canRefresh,
        lastSearchDate: cacheResult.lastSearchDate,
        daysUntilRefresh: cacheResult.daysUntilRefresh,
      })
    }

    // ── 2. Check if company is public (SEC) ──────────────────────
    let isPublicCompany = company.is_public
    let ticker = company.ticker
    let cik = company.cik

    // If we don't know yet, try to detect
    if (isPublicCompany === null || isPublicCompany === undefined) {
      console.log("[v0] Public Docs: Checking if company is public...")

      // Try ticker first if available
      if (ticker) {
        cik = await getCIKByTicker(ticker)
        if (cik) {
          isPublicCompany = true
        }
      }

      // Try company name search
      if (!cik) {
        const secResult = await searchSECByCompanyName(companyName)
        if (secResult) {
          isPublicCompany = true
          cik = secResult.cik
          ticker = secResult.ticker ?? ticker
        }
      }

      // Update company record with public status
      await supabase
        .from("companies")
        .update({
          is_public: isPublicCompany ?? false,
          ticker: ticker || null,
          cik: cik || null,
          public_status_checked_at: new Date().toISOString(),
        })
        .eq("id", companyId)

      console.log("[v0] Public Docs: Company is", isPublicCompany ? "PUBLIC" : "PRIVATE", "| CIK:", cik)
    }

    // ── 3. Gather document sources ───────────────────────────────
    const documentSources: { url: string; type: string; title: string; date?: string }[] = []

    // 3a. If public company with CIK, get SEC filings
    if (isPublicCompany && cik) {
      console.log("[v0] Public Docs: Fetching SEC filings for CIK:", cik)
      const secFilings = await getCompanyFilings(cik, {
        forms: ["10-K", "10-Q", "8-K"],
        limit: 6,
      })

      for (const filing of secFilings) {
        documentSources.push({
          url: filing.fileUrl,
          type: mapSECFormToDocumentType(filing.form),
          title: `${filing.form} - ${filing.filingDate}`,
          date: filing.filingDate,
        })
      }
      console.log("[v0] Public Docs: Found", secFilings.length, "SEC filings")
    }

    // 3b. Search for other public documents (annual reports, sustainability, earnings)
    console.log("[v0] Public Docs: Searching for additional public documents...")
    const parallelParams = buildPublicDocsSearchParams({
      company_name: companyName,
      ticker: ticker || undefined,
      country: company.country,
      is_public: isPublicCompany ?? false,
      sources: ["annual", "earnings", "sustainability", "financial"],
    })

    try {
      const searchResult = await parallelSearch(parallelParams)
      console.log("[v0] Public Docs: Parallel returned", searchResult.results.length, "results")

      for (const result of searchResult.results) {
        // Determine document type from URL/title
        const urlLower = result.url.toLowerCase()
        const titleLower = result.title.toLowerCase()

        let docType = "financial"
        if (urlLower.includes("sustainability") || titleLower.includes("sustain") || titleLower.includes("esg")) {
          docType = "sustainability"
        } else if (urlLower.includes("annual") || titleLower.includes("annual") || titleLower.includes("memoria")) {
          docType = "annual_report"
        } else if (titleLower.includes("earnings") || titleLower.includes("call") || titleLower.includes("transcript")) {
          docType = "earnings_call"
        }

        // Avoid duplicates
        if (!documentSources.some((d) => d.url === result.url)) {
          documentSources.push({
            url: result.url,
            type: docType,
            title: result.title,
            date: result.publish_date ?? undefined,
          })
        }
      }
    } catch (parallelError) {
      console.error("[v0] Public Docs: Parallel search error:", parallelError)
    }

    // ── 4. If no documents found, return empty or old cache ──────
    if (documentSources.length === 0) {
      console.log("[v0] Public Docs: No documents found")
      const oldCache = await getAnyCache(supabase, companyId)
      if (oldCache && oldCache.length > 0) {
        return NextResponse.json({
          docs: oldCache,
          isPublic: isPublicCompany,
          cached: true,
          provider: "old_cache",
          canRefresh: cacheResult.canRefresh,
          lastSearchDate: cacheResult.lastSearchDate,
          daysUntilRefresh: cacheResult.daysUntilRefresh,
        })
      }
      return NextResponse.json({
        docs: [],
        isPublic: isPublicCompany,
        cached: false,
        provider: "none",
        canRefresh: true,
        lastSearchDate: null,
        daysUntilRefresh: 0,
      })
    }

    // ── 5. Extract content and structure with Gemini ─────────────
    // For now, we'll use search excerpts directly (parallel-extract would need more setup)
    // In production, you'd use extractMultipleDocuments from lib/parallel-extract.ts

    console.log("[v0] Public Docs: Structuring", documentSources.length, "documents with Gemini...")

    // Prepare excerpts for Gemini
    const excerpts = documentSources.slice(0, 8).map((doc) => ({
      url: doc.url,
      title: doc.title,
      type: doc.type,
      content: `[Documento: ${doc.title}]\nTipo: ${doc.type}\nURL: ${doc.url}`,
    }))

    // If we have parallel search results with excerpts, use those
    // (In a full implementation, we'd extract PDF content here)

    let findings: any[] = []
    let digest: string | null = null

    // Since we can't extract PDFs directly in this simple version,
    // we'll note that documents exist and let the user view them
    // The digest will explain what's available

    const docSummary = documentSources.slice(0, 8).map(d => `${d.type}: ${d.title}`).join("; ")
    digest = `Se encontraron ${documentSources.length} documentos públicos para ${companyName}: ${docSummary.slice(0, 200)}...`

    // ── 6. Save documents to database ────────────────────────────
    const docsToInsert = documentSources.slice(0, MAX_DOCS).map((doc, idx) => ({
      company_id: companyId,
      bookmark_id: bookmarkId,
      user_id: user.id,
      requested_by: user.id,
      requested_at: new Date().toISOString(),
      document_type: doc.type,
      document_title: doc.title,
      document_date: doc.date || null,
      source_url: doc.url,
      source_name: doc.url.includes("sec.gov") ? "SEC EDGAR" : new URL(doc.url).hostname,
      ticker: ticker || null,
      findings: findings.length > 0 ? findings : [],
      digest: idx === 0 ? digest : null,
      digest_generated_at: idx === 0 && digest ? new Date().toISOString() : null,
      // No se llama a ningun modelo en esta ruta (ver la nota de arriba). Decir
      // "gemini-2.0-flash" hacia imposible distinguir por query las filas con
      // analisis real de las que solo listan documentos, que es justo lo que se
      // necesita para auditar. `extraction_method` ya decia la verdad.
      ai_provider: "none",
      extraction_method: "search_metadata",
    }))

    console.log("[v0] Public Docs: Inserting", docsToInsert.length, "documents")

    // Delete old docs for this company and insert new ones
    await supabase
      .from("company_public_docs")
      .delete()
      .eq("company_id", companyId)

    const { error: insertError } = await supabase
      .from("company_public_docs")
      .insert(docsToInsert)

    if (insertError) {
      console.error("[v0] Public Docs: Error inserting:", insertError)
    }

    // ── 7. Return results ────────────────────────────���───────────
    const { data: allDocs } = await supabase
      .from("company_public_docs")
      .select("*")
      .eq("company_id", companyId)
      .order("document_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(MAX_DOCS)

    const freshCacheResult = await getRecentCache(supabase, companyId, isSuperadmin)

    return NextResponse.json({
      docs: allDocs || [],
      isPublic: isPublicCompany,
      cached: false,
      provider: "search",
      canRefresh: freshCacheResult.canRefresh,
      lastSearchDate: freshCacheResult.lastSearchDate,
      daysUntilRefresh: freshCacheResult.daysUntilRefresh,
    })
  } catch (error) {
    console.error("[v0] Public Docs: Error in POST handler:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
