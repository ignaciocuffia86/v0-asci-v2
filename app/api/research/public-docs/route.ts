import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { parallelSearch, buildPublicDocsSearchParams } from "@/lib/parallel"
import {
  getCIKByTicker,
  searchSECByCompanyName,
  getCompanyFilings,
  mapSECFormToDocumentType,
} from "@/lib/sec-edgar"
import {
  extractMultipleDocuments,
  prioritizeAndLimitUrls,
  PUBLIC_DOCS_EXTRACTION_OBJECTIVE,
} from "@/lib/parallel-extract"
import { GoogleGenerativeAI } from "@google/generative-ai"

const DOCS_CACHE_DAYS = 30 // Refresh at most once per month
const MAX_DOCS = 10

// ── Gemini structuring for public documents ─────────────────────────────
const GEMINI_SYSTEM = `Eres un analista de inversiones B2B especializado en analizar documentos públicos de empresas.
Se te dan excerpts de reportes anuales, reportes de sostenibilidad, transcripciones de earnings calls, y filings de SEC.
Tu tarea es extraer SEÑALES DE INVERSIÓN TECNOLÓGICA y VENDORS para un vendedor B2B.

REGLAS CRÍTICAS:
1. Responde UNICAMENTE con JSON válido (sin markdown, sin texto extra).
2. SIEMPRE cita el texto original entre comillas cuando extraigas un hallazgo.
3. Indica la sección/página/fuente de cada hallazgo cuando sea posible.
4. PRIORIZA menciones de vendors específicos, tecnologías nombradas, y montos de inversión.
5. Si no hay información relevante, devuelve {"findings":[], "tech_signals": [], "digest": null}

CATEGORÍAS de hallazgos:
- tech_investment: Inversiones en tecnología, CAPEX IT, proyectos de modernización
- vendor_mention: Menciones de vendors específicos (SAP, AWS, Microsoft, Oracle, Salesforce, etc.)
- digital_initiative: Proyectos de transformación digital, cloud, AI, automation
- pain_point: Desafíos, riesgos tecnológicos, deuda técnica, sistemas legacy
- strategy: Prioridades estratégicas relacionadas con tecnología

SEÑALES TECH que debes buscar activamente:
- Nombres de VENDORS: SAP, Oracle, Salesforce, Microsoft, AWS, Google Cloud, ServiceNow, Workday, etc.
- Tecnologías: ERP, CRM, cloud migration, AI/ML, RPA, data analytics, cybersecurity
- Proyectos: transformación digital, modernización, migración, integración
- Inversiones: CAPEX IT, budget tecnológico, contrataciones IT

FORMATO JSON:
{
  "findings": [
    {
      "category": "string (una de las categorías válidas)",
      "finding": "string (descripción del hallazgo en español)",
      "quote": "string (cita textual del documento original - OBLIGATORIO)",
      "source_section": "string o null (sección/página donde se encontró)",
      "relevance": "high | medium | low",
      "vendors_mentioned": ["string"] // lista de vendors mencionados (si aplica)
    }
  ],
  "tech_signals": [
    {
      "signal_type": "vendor_used | vendor_planned | tech_initiative | investment_planned",
      "name": "string (nombre del vendor o tecnología)",
      "confidence": "confirmed | likely | inferred",
      "context": "string (contexto breve de cómo se menciona)",
      "source_quote": "string (cita que respalda la señal)"
    }
  ],
  "digest": "string (2-3 oraciones en ESPAÑOL) o null"
}

El digest debe responder: "¿Qué vendors/tecnologías usa esta empresa y qué proyectos tech tiene planeados?"
SOLO incluye señales con evidencia REAL en el texto. NO inventes ni infieras sin cita.`

interface TechSignal {
  signal_type: "vendor_used" | "vendor_planned" | "tech_initiative" | "investment_planned"
  name: string
  confidence: "confirmed" | "likely" | "inferred"
  context: string
  source_quote: string
}

interface GeminiDocsResult {
  findings: any[]
  tech_signals: TechSignal[]
  digest: string | null
}

async function structureDocumentsWithGemini(
  excerpts: { url: string; title: string; content: string; type: string }[],
  companyName: string
): Promise<GeminiDocsResult> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not configured")

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

  // Build detailed excerpt text with more content for better analysis
  const excerptText = excerpts
    .map(
      (e, i) =>
        `--- Documento ${i + 1}: ${e.title} [tipo: ${e.type}] (${e.url}) ---\n${e.content.slice(0, 12000)}`
    )
    .join("\n\n")

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${GEMINI_SYSTEM}\n\n---\nEmpresa: "${companyName}"\n\nExcerpts de documentos públicos:\n\n${excerptText}\n\nExtrae los hallazgos relevantes y SEÑALES TECH en JSON. PRIORIZA encontrar vendors específicos mencionados.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8000,
      responseMimeType: "application/json",
    },
  })

  const text = result.response.text()
  const parsed = JSON.parse(text)
  return {
    findings: parsed.findings ?? [],
    tech_signals: parsed.tech_signals ?? [],
    digest: parsed.digest ?? null,
  }
}

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

    // Get company country - SEC only has US companies (and some ADRs with explicit tickers)
    const companyCountry = (company.country || "").toLowerCase().trim()
    const isUSCompany = !companyCountry || 
                        companyCountry === "us" || 
                        companyCountry === "usa" || 
                        companyCountry === "united states" || 
                        companyCountry === "estados unidos"

    // If we don't know yet, try to detect
    if (isPublicCompany === null || isPublicCompany === undefined) {
      console.log("[v0] Public Docs: Checking if company is public... (country:", companyCountry || "unknown", ", isUS:", isUSCompany, ")")

      // Only search SEC if:
      // 1. Company has an explicit ticker (could be ADR), OR
      // 2. Company is from US or country is unknown
      
      // Try ticker first if available (works for ADRs too)
      if (ticker) {
        cik = await getCIKByTicker(ticker)
        if (cik) {
          isPublicCompany = true
          console.log("[v0] Public Docs: Found CIK by ticker:", cik)
        }
      }

      // Only try company name search for US companies or unknown country
      // This prevents false matches like "Pluspetrol" -> "US Bancorp"
      if (!cik && isUSCompany) {
        console.log("[v0] Public Docs: Searching SEC by company name (US company)...")
        const secResult = await searchSECByCompanyName(companyName)
        if (secResult) {
          isPublicCompany = true
          cik = secResult.cik
          ticker = secResult.ticker ?? ticker
          console.log("[v0] Public Docs: SEC match found:", secResult.name, "CIK:", cik)
        }
      } else if (!cik && !isUSCompany) {
        // Non-US company without ticker - mark as private (for SEC purposes)
        console.log("[v0] Public Docs: Non-US company without ticker, skipping SEC search")
        isPublicCompany = false
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

      console.log("[v0] Public Docs: Company is", isPublicCompany ? "PUBLIC (SEC)" : "PRIVATE/Non-US", "| CIK:", cik || "none")
    }

    // ── 3. Gather document sources ───────────────────────────────
    const documentSources: { url: string; type: string; title: string; date?: string; excerpts?: string[] }[] = []

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

      // Normalize company name for matching (remove suffixes, lowercase)
      const companyNameNormalized = companyName
        .toLowerCase()
        .replace(/\s+(inc\.?|corp\.?|ltd\.?|llc\.?|s\.?a\.?|s\.?r\.?l\.?|plc\.?)$/i, "")
        .replace(/[,\.]/g, "")
        .trim()
      const companyNameWords = companyNameNormalized.split(/\s+/).filter(w => w.length > 2)

      for (const result of searchResult.results) {
        const urlLower = result.url.toLowerCase()
        const titleLower = result.title.toLowerCase()
        const excerptText = (result.excerpts || []).join(" ").toLowerCase()
        
        // VALIDATION: Check if this result actually relates to our company
        // Must have company name (or significant parts) in title, URL, or excerpts
        const combinedText = `${urlLower} ${titleLower} ${excerptText}`
        
        // Count how many significant words from company name appear
        const matchingWords = companyNameWords.filter(word => combinedText.includes(word))
        const matchRatio = matchingWords.length / companyNameWords.length
        
        // Require at least 50% of company name words to match, or exact match of first word
        const hasCompanyMatch = matchRatio >= 0.5 || combinedText.includes(companyNameWords[0])
        
        if (!hasCompanyMatch) {
          console.log("[v0] Public Docs: Skipping unrelated result:", result.title.slice(0, 60), "- no company match")
          continue
        }

        // Determine document type from URL/title
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
            title: result.title,
            type: docType,
            date: result.publish_date ?? undefined,
            excerpts: result.excerpts ?? [], // Include search excerpts for fallback analysis
          })
        }
      }
      
      console.log("[v0] Public Docs: After validation,", documentSources.length, "documents match company")
    } catch (parallelError) {
      console.error("[v0] Public Docs: Parallel search error:", parallelError)
    }

                // Avoid duplicates
                if (!documentSources.some((d) => d.url === result.url)) {
                  documentSources.push({
                    url: result.url,
                    type: docType,
                    title: result.title,
                    date: result.publish_date ?? undefined,
                    excerpts: result.excerpts ?? [], // Include search excerpts for fallback analysis
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

    // ── 5. Extract content from documents using Parallel Extract ─────────────
    // Prioritize and limit URLs for extraction (max 6 docs, diverse types)
    const prioritizedDocs = prioritizeAndLimitUrls(documentSources, 6)
    console.log("[v0] Public Docs: Extracting content from", prioritizedDocs.length, "prioritized documents...")

    // Extract content from documents
    let extractedDocs: { url: string; title: string; content: string; type: string; date?: string; excerpts: string[] }[] = []
    
    try {
      const extractionResults = await extractMultipleDocuments(prioritizedDocs, {
        objective: PUBLIC_DOCS_EXTRACTION_OBJECTIVE,
        maxConcurrent: 3,
        timeout: 45000,
      })

      // Process extraction results
      for (const result of extractionResults) {
        if (result.content && result.content.length > 100) {
          extractedDocs.push({
            url: result.url,
            title: result.title,
            content: result.content,
            type: result.type,
            date: result.date,
            excerpts: result.excerpts,
          })
          console.log("[v0] Public Docs: Extracted", result.title, "-", result.content.length, "chars")
        } else if (result.error) {
          console.warn("[v0] Public Docs: Failed to extract", result.url, "-", result.error)
        }
      }
    } catch (extractionError) {
      console.error("[v0] Public Docs: Extraction error:", extractionError)
    }

    // ── 6. Structure with Gemini to find tech signals ─────────────
    let findings: any[] = []
    let techSignals: TechSignal[] = []
    let digest: string | null = null

    if (extractedDocs.length > 0) {
      console.log("[v0] Public Docs: Analyzing", extractedDocs.length, "documents with Gemini for tech signals...")

      try {
        const geminiResult = await structureDocumentsWithGemini(extractedDocs, companyName)
        findings = geminiResult.findings
        techSignals = geminiResult.tech_signals
        digest = geminiResult.digest

        console.log("[v0] Public Docs: Gemini found", findings.length, "findings and", techSignals.length, "tech signals")
      } catch (geminiError) {
        console.error("[v0] Public Docs: Gemini analysis error:", geminiError)
        // Fallback digest
        const docSummary = extractedDocs.map(d => `${d.type}: ${d.title}`).join("; ")
        digest = `Se encontraron ${documentSources.length} documentos públicos. Documentos analizados: ${docSummary.slice(0, 200)}...`
      }
    } else {
      // No content extracted via Parallel Extract - try using search excerpts as fallback
      console.log("[v0] Public Docs: No extracted content, trying search excerpts as fallback...")
      
      // Build fallback excerpts from search results if available
      const searchExcerpts = documentSources
        .filter(d => d.excerpts && d.excerpts.length > 0)
        .slice(0, 6)
        .map(d => ({
          url: d.url,
          title: d.title,
          content: d.excerpts?.join("\n") || "",
          type: d.type,
        }))
      
      if (searchExcerpts.length > 0 && searchExcerpts.some(e => e.content.length > 100)) {
        console.log("[v0] Public Docs: Using", searchExcerpts.length, "search excerpts as fallback")
        
        try {
          const geminiResult = await structureDocumentsWithGemini(searchExcerpts, companyName)
          findings = geminiResult.findings
          techSignals = geminiResult.tech_signals
          digest = geminiResult.digest
          
          console.log("[v0] Public Docs: Fallback Gemini found", findings.length, "findings and", techSignals.length, "tech signals")
        } catch (geminiError) {
          console.error("[v0] Public Docs: Fallback Gemini analysis error:", geminiError)
          const docSummary = documentSources.slice(0, 6).map(d => `${d.type}: ${d.title}`).join("; ")
          digest = `Se encontraron ${documentSources.length} documentos públicos. No se pudo analizar el contenido.`
        }
      } else {
        // No useful content available
        const docSummary = documentSources.slice(0, 6).map(d => `${d.type}: ${d.title}`).join("; ")
        digest = `Se encontraron ${documentSources.length} documentos públicos para ${companyName}. No se pudo extraer contenido para análisis de señales tech.`
      }
    }

    // ── 7. Save documents to database ────────────────────────────
    // Create a map of extracted content and findings per URL
    const extractedContentMap = new Map(extractedDocs.map(d => [d.url, d]))
    
    // Distribute findings to their respective documents based on source mentions
    const findingsPerDoc: Map<string, any[]> = new Map()
    for (const finding of findings) {
      // Try to match finding to a document
      const matchedDoc = extractedDocs.find(doc => 
        finding.source_section?.toLowerCase().includes(doc.type.toLowerCase()) ||
        finding.quote?.toLowerCase().includes(doc.title.toLowerCase().slice(0, 30))
      )
      if (matchedDoc) {
        const existing = findingsPerDoc.get(matchedDoc.url) || []
        existing.push(finding)
        findingsPerDoc.set(matchedDoc.url, existing)
      }
    }

    const docsToInsert = documentSources.slice(0, MAX_DOCS).map((doc, idx) => {
      const extracted = extractedContentMap.get(doc.url)
      const docFindings = findingsPerDoc.get(doc.url) || []
      
      return {
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
        findings: docFindings,
        tech_signals: idx === 0 ? techSignals : [], // Store all tech signals on first doc
        digest: idx === 0 ? digest : null,
        digest_generated_at: idx === 0 && digest ? new Date().toISOString() : null,
        ai_provider: "gemini-2.0-flash",
        extraction_method: extracted ? "parallel_extract" : "search_metadata",
        content_extracted: !!extracted,
      }
    })

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

    // ── 8. Return results ────────────────────────────────────────
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
      techSignals: techSignals, // Include tech signals in response
      totalFindings: findings.length,
    })
  } catch (error) {
    console.error("[v0] Public Docs: Error in POST handler:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
