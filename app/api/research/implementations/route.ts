import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { parallelSearch, buildImplementationsSearchParams } from "@/lib/parallel"
import { structureWithLLM } from "@/lib/ai-structurer"

const IMPL_CACHE_DAYS = 30 // Refresh at most once per month per company+signal
const MAX_IMPLEMENTATIONS = 10

// ── Gemini structuring ─────────────────────────────────────────────────
const GEMINI_SYSTEM = `Eres un investigador de implementaciones tecnologicas e innovacion empresarial.
Se te dan excerpts de paginas web sobre proyectos, casos de exito e implementaciones tecnologicas de una empresa.
Tu tarea es extraer implementaciones y casos de exito relevantes.

REGLAS:
1. Responde UNICAMENTE con JSON valido (sin markdown, sin texto extra).
2. Resume con TUS PROPIAS PALABRAS, NO copies texto literal.
3. Maximo 10 implementaciones. Prioriza calidad y evidencia fuerte.
4. Si no hay implementaciones relevantes, devuelve {"implementations":[], "digest": null}
5. Las fechas deben ser YYYY-MM-DD. Si no hay fecha exacta, intenta inferirla. Si es imposible, usa null.

EVIDENCE LEVELS:
- strong: Case study oficial, comunicado de prensa del vendor, announcement oficial
- medium: Articulo con fuentes nombradas, LinkedIn post de ejecutivos, industry report
- weak: Mencion indirecta, partnership announcement, inferencia de uso de tecnologia

AREAS validas: finanzas | ventas | logistica | rrhh | it | ciberseguridad | ecommerce | operaciones

ADEMAS de las implementaciones, genera un "digest" de EXACTAMENTE 1 parrafo (2-4 oraciones) en ESPAÑOL que resuma:
- Que tecnologias/vendors usa la empresa
- Que tipo de proyectos ha implementado recientemente
- Como pueden usar esta info los vendedores para posicionarse

El digest debe responder: "¿Con quien compito si quiero venderle a esta empresa?"

FORMATO JSON:
{
  "implementations": [
    {
      "title": "string (titulo descriptivo del caso/proyecto)",
      "provider_name": "string (vendor/consultora que implemento)",
      "technology": "string (tecnologia implementada)",
      "area": "string (area de la empresa)",
      "summary": "string (descripcion del caso en 2-3 oraciones)",
      "results": "string o null (resultados obtenidos si estan disponibles)",
      "evidence_level": "strong | medium | weak",
      "source_name": "string (nombre del medio/sitio)",
      "published_at": "YYYY-MM-DD o null"
    }
  ],
  "digest": "string (parrafo resumen en ESPAÑOL) o null si no hay implementaciones relevantes"
}`

interface GeminiImplResult {
  implementations: any[]
  digest: string | null
}

async function structureImplementationsWithGemini(
  excerpts: { url: string; title: string; publish_date: string | null; content: string }[],
  companyName: string,
  keywords: string[],
): Promise<GeminiImplResult> {
  const excerptText = excerpts
    .map(
      (e, i) =>
        `--- Fuente ${i + 1}: ${e.title} (${e.url}) [fecha: ${e.publish_date || "desconocida"}] ---\n${e.content.slice(0, 5000)}`,
    )
    .join("\n\n")

  const keywordsCtx = keywords.length > 0
    ? `\nTecnologias/procesos de interes: ${keywords.join(", ")}`
    : ""

  const userPrompt = `Empresa: "${companyName}"${keywordsCtx}\n\nExcerpts de busqueda web:\n\n${excerptText}\n\nExtrae las implementaciones relevantes en JSON.`

  const parsed = await structureWithLLM<{ implementations?: any[]; digest?: string | null }>({
    systemPrompt: GEMINI_SYSTEM,
    userPrompt,
    maxOutputTokens: 4000,
    temperature: 0.2,
    context: "impl",
  })

  return {
    implementations: parsed.implementations ?? [],
    digest: parsed.digest ?? null,
  }
}

/**
 * Fallback degradado para Implementaciones cuando Gemini falla despues de retries.
 * Publica los excerpts crudos como items "evidencia debil" para que el usuario
 * vea AL MENOS los resultados de busqueda en lugar del empty state.
 */
function buildDegradedImplItems(
  excerpts: { url: string; title: string; publish_date: string | null; content: string }[],
): GeminiImplResult {
  const implementations = excerpts.slice(0, 10).map((e) => {
    let hostname: string
    try {
      hostname = new URL(e.url).hostname.replace(/^www\./, "")
    } catch {
      hostname = "fuente"
    }
    const summary = e.content.replace(/\s+/g, " ").trim().slice(0, 240)
    return {
      title: e.title || hostname,
      provider_name: null,
      technology: null,
      area: null,
      summary: summary || null,
      results: null,
      evidence_level: "weak",
      source_name: hostname,
      published_at: e.publish_date,
    }
  })
  return { implementations, digest: null }
}

// ── Date helpers ────────────────────────────────────────────────────────
function sanitizeDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  if (/XX|TBD|unknown/i.test(dateStr)) return null

  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return null

  const now = new Date()
  const threeYearsAgo = new Date()
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3)

  if (date > now || date < threeYearsAgo) return null
  return date.toISOString().split("T")[0]
}

// ── Cache helpers (public by company_id, scoped by search_context) ────
// search_context is a hash of the keywords used for the search, allowing
// per-signal caching: company+process A vs company+technology B have separate caches
function buildSearchContext(keywords: string[]): string {
  if (keywords.length === 0) return "general"
  return keywords.sort().join("|").toLowerCase()
}

interface CacheResult {
  implementations: any[] | null
  lastSearchDate: string | null
  canRefresh: boolean
  daysUntilRefresh: number
}

async function getRecentCache(supabase: any, companyId: string, searchContext: string, isSuperadmin: boolean): Promise<CacheResult> {
  const cacheDate = new Date()
  cacheDate.setDate(cacheDate.getDate() - IMPL_CACHE_DAYS)

  // Get most recent implementation to determine last search date
  const { data: lastImpl } = await supabase
    .from("company_implementations")
    .select("created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()

  const lastSearchDate = lastImpl?.created_at ?? null
  const daysSinceLastSearch = lastSearchDate
    ? (Date.now() - new Date(lastSearchDate).getTime()) / (1000 * 60 * 60 * 24)
    : Infinity

  // Superadmins can always refresh; regular users wait 30 days
  const canRefresh = isSuperadmin || daysSinceLastSearch >= IMPL_CACHE_DAYS
  const daysUntilRefresh = canRefresh ? 0 : Math.ceil(IMPL_CACHE_DAYS - daysSinceLastSearch)

  console.log("[v0][impl][cache] lastSearchDate:", lastSearchDate, "| daysSinceLastSearch:", Math.round(daysSinceLastSearch), "| canRefresh:", canRefresh, "| isSuperadmin:", isSuperadmin, "| context:", searchContext)

  // Check if we have implementations fetched within the cache window for this context
  let query = supabase
    .from("company_implementations")
    .select("id")
    .eq("company_id", companyId)
    .gte("created_at", cacheDate.toISOString())
    .limit(1)

  if (searchContext !== "general") {
    query = query.eq("search_context", searchContext)
  }

  const { data: recentFetch } = await query

  if (recentFetch && recentFetch.length > 0) {
    // Cache is fresh -- return ALL implementations for this company (company-wide view)
    const { data } = await supabase
      .from("company_implementations")
      .select("*")
      .eq("company_id", companyId)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(MAX_IMPLEMENTATIONS)

    return { implementations: data, lastSearchDate, canRefresh, daysUntilRefresh }
  }

  return { implementations: null, lastSearchDate, canRefresh, daysUntilRefresh } // Cache expired for this context
}

async function getAnyCache(supabase: any, companyId: string) {
  const { data } = await supabase
    .from("company_implementations")
    .select("*")
    .eq("company_id", companyId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(MAX_IMPLEMENTATIONS)

  return data
}

// ── User interaction tracking ────────────────────────────────────────
async function registerUserInteractions(
  supabase: any,
  userId: string,
  companyId: string,
  implIds: string[],
) {
  if (implIds.length === 0) return
  for (const implId of implIds) {
    await supabase
      .from("user_implementation_interactions")
      .upsert(
        { user_id: userId, implementation_id: implId, company_id: companyId, source: "search", viewed_at: new Date().toISOString() },
        { onConflict: "user_id,implementation_id", ignoreDuplicates: true },
      )
  }
}

// ── Get signals/keywords from bookmark context ───────────────────────
async function getBookmarkKeywords(supabase: any, bookmarkId: string): Promise<string[]> {
  // Get signals associated with the bookmark's company
  const { data: bookmark } = await supabase
    .from("bookmarks")
    .select("company_id, signal_type, signal_id")
    .eq("id", bookmarkId)
    .single()

  if (!bookmark) return []

  const keywords: string[] = []

  // If bookmark has a specific signal, get its name
  if (bookmark.signal_type === "process" && bookmark.signal_id) {
    const { data } = await supabase
      .from("dictionary_processes")
      .select("name")
      .eq("id", bookmark.signal_id)
      .single()
    if (data?.name) keywords.push(data.name)
  } else if (bookmark.signal_type === "technology" && bookmark.signal_id) {
    const { data } = await supabase
      .from("dictionary_products")
      .select("name")
      .eq("id", bookmark.signal_id)
      .single()
    if (data?.name) keywords.push(data.name)
  }

  // Also get top signals for this company
  const { data: topSignals } = await supabase.rpc("get_company_signal_summary", {
    p_company_id: bookmark.company_id,
  })

  if (topSignals?.[0]) {
    const summary = topSignals[0]
    if (summary.top_processes) {
      for (const p of summary.top_processes.slice(0, 3)) {
        if (p.process_name && !keywords.includes(p.process_name)) {
          keywords.push(p.process_name)
        }
      }
    }
    if (summary.top_technologies) {
      for (const t of summary.top_technologies.slice(0, 3)) {
        if (t.product_name && !keywords.includes(t.product_name)) {
          keywords.push(t.product_name)
        }
      }
    }
  }

  return keywords.slice(0, 5) // max 5 keywords
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
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    const isSuperadmin = profile?.role === "superadmin"

    // Only superadmins can force refresh
    if (forceRefresh && !isSuperadmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    // ── 1. Get signal keywords from bookmark context ───────────────────
    const keywords = await getBookmarkKeywords(supabase, bookmarkId)
    const searchContext = buildSearchContext(keywords)
    console.log("[v0] Implementations: Keywords:", keywords, "| Context:", searchContext)

    // ── 2. Check public cache (by company_id + search_context) ───────
    const cacheResult = await getRecentCache(supabase, companyId, searchContext, isSuperadmin)
    
    if (!forceRefresh && cacheResult.implementations && cacheResult.implementations.length > 0) {
      console.log("[v0] Implementations: Public cache hit -", cacheResult.implementations.length, "items")
      await registerUserInteractions(supabase, user.id, companyId, cacheResult.implementations.map((i: any) => i.id))
      return NextResponse.json({ 
        implementations: cacheResult.implementations, 
        cached: true, 
        provider: "cache",
        canRefresh: cacheResult.canRefresh,
        lastSearchDate: cacheResult.lastSearchDate,
        daysUntilRefresh: cacheResult.daysUntilRefresh,
      })
    }

    // ── 3. Search with Parallel ──────────────────────────────────────
    console.log("[v0] Implementations: Searching with Parallel for", companyName)

    const searchParams = buildImplementationsSearchParams({
      company_name: companyName,
      industry: company.industry,
      country: company.country,
      keywords,
    })

    console.log("[v0][impl][parallel] objective:", searchParams.objective.slice(0, 200))
    console.log("[v0][impl][parallel] search_queries:", JSON.stringify(searchParams.search_queries))
    console.log("[v0][impl][parallel] include_domains count:", searchParams.source_policy?.include_domains?.length ?? 0, "| exclude:", searchParams.source_policy?.exclude_domains?.length ?? 0, "| after_date:", searchParams.source_policy?.after_date)
    console.log("[v0][impl][parallel] max_results:", searchParams.max_results, "| keywords:", keywords)

    let implementations: any[] = []
    let geminiDigest: string | null = null
    let aiProvider = "gemini-2.0-flash"

    // Paso A: llamar a Parallel
    let parallelResults: Awaited<ReturnType<typeof parallelSearch>> | null = null
    try {
      parallelResults = await parallelSearch(searchParams)
      console.log("[v0] Implementations: Parallel returned", parallelResults.results.length, "results")
      if (parallelResults.warnings && parallelResults.warnings.length > 0) {
        console.log("[v0][impl][parallel] warnings:", JSON.stringify(parallelResults.warnings))
      }
      parallelResults.results.forEach((r, i) => {
        const excerptChars = r.excerpts.reduce((acc, e) => acc + (e?.length ?? 0), 0)
        console.log(`[v0][impl][parallel][result ${i + 1}/${parallelResults!.results.length}] date=${r.publish_date ?? "null"} | chars=${excerptChars} | ${r.url}`)
      })
    } catch (parallelError) {
      console.error("[v0] Implementations: Parallel search error:", parallelError)
    }

    // Paso B: estructurar con Gemini via AI Gateway. Si falla, fallback degradado.
    if (parallelResults && parallelResults.results.length > 0) {
      const searchResult = parallelResults
      const excerpts = searchResult.results.map(r => ({
        url: r.url,
        title: r.title,
        publish_date: r.publish_date,
        content: r.excerpts.join("\n"),
      }))

      let structured: any[] = []
      try {
        console.log("[v0] Implementations: Structuring with AI Gateway (gemini-2.0-flash)...")
        const result = await structureImplementationsWithGemini(excerpts, companyName, keywords)
        structured = result.implementations
        geminiDigest = result.digest
        console.log("[v0] Implementations: Gemini structured", structured.length, "items, digest:", geminiDigest ? "generated" : "none")
      } catch (geminiError) {
        console.error("[v0] Implementations: Gemini structuring failed after retries, using degraded fallback:", geminiError)
        const degraded = buildDegradedImplItems(excerpts)
        structured = degraded.implementations
        geminiDigest = degraded.digest
        aiProvider = "degraded-fallback"
      }

      // Map structured items back to source URLs from Parallel
      implementations = structured.slice(0, MAX_IMPLEMENTATIONS).map((item: any, idx: number) => {
        const matchingResult = searchResult.results.find(r =>
          r.title.toLowerCase().includes((item.title || "").toLowerCase().slice(0, 30)) ||
          (item.source_name && r.url.toLowerCase().includes(item.source_name.toLowerCase().replace(/\s/g, "")))
        )
        const sourceResult = matchingResult || searchResult.results[idx] || searchResult.results[0]

        return {
          title: item.title,
          provider_name: item.provider_name || "N/A",
          technology: item.technology || "N/A",
          area: item.area || "operaciones",
          summary: item.summary,
          results: item.results || null,
          evidence_level: item.evidence_level || "weak",
          source_url: sourceResult?.url || "#",
          source_name: item.source_name || sourceResult?.title || "Desconocido",
          published_at: sanitizeDate(item.published_at) || sanitizeDate(sourceResult?.publish_date),
        }
      })
    }

    // ── 4. Fallback to old cache if no results ───────────────────────
    if (implementations.length === 0) {
      console.log("[v0][impl][empty] No items after Parallel+Gemini. Checking old cache...")
      const oldCache = await getAnyCache(supabase, companyId)
      if (oldCache && oldCache.length > 0) {
        console.log("[v0] Implementations: Using old cache -", oldCache.length, "items")
        await registerUserInteractions(supabase, user.id, companyId, oldCache.map((i: any) => i.id))
        return NextResponse.json({ implementations: oldCache, cached: true, provider: "old_cache" })
      }
      console.log("[v0][impl][empty] No old cache either. Returning provider=none.")
      return NextResponse.json({ implementations: [], cached: false, provider: "none" })
    }

    // ── 5. Deduplicate and save to public cache ──────────────────────
    const seenUrls = new Set<string>()
    const uniqueItems = implementations.filter(item => {
      if (seenUrls.has(item.source_url)) return false
      seenUrls.add(item.source_url)
      return true
    })

    const { data: existingImpls } = await supabase
      .from("company_implementations")
      .select("source_url")
      .eq("company_id", companyId)

    const existingUrls = new Set(existingImpls?.map((i: any) => i.source_url) || [])

    // We'll use the digest to update all items in this batch
    const newToInsert = uniqueItems
      .filter(item => !existingUrls.has(item.source_url))
      .map((item, idx) => ({
        company_id: companyId,
        title: item.title,
        summary: item.summary,
        source_url: item.source_url,
        source_name: item.source_name,
        published_at: item.published_at,
        ai_provider: aiProvider,
        technology: item.technology,
        area: item.area,
        provider_name: item.provider_name,
        evidence_level: item.evidence_level,
        search_context: searchContext,
        // Only store digest on the first item as a flag that batch was processed
        digest: idx === 0 ? geminiDigest : null,
        digest_generated_at: idx === 0 && geminiDigest ? new Date().toISOString() : null,
      }))

    console.log(`[v0] Implementations: Inserting ${newToInsert.length} new items`)

    if (newToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("company_implementations")
        .insert(newToInsert)
        .select()

      if (insertError) {
        console.error("[v0] Implementations: Error inserting:", insertError)
      }
    }

    // ── 6. Return all implementations for this company (public) ──────
    const { data: allImpls } = await supabase
      .from("company_implementations")
      .select("*")
      .eq("company_id", companyId)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(MAX_IMPLEMENTATIONS)

    const finalImpls = allImpls || []

    await registerUserInteractions(supabase, user.id, companyId, finalImpls.map((i: any) => i.id))

    // Get fresh cache info for response
    const freshCacheResult = await getRecentCache(supabase, companyId, searchContext, isSuperadmin)

    return NextResponse.json({
      implementations: finalImpls,
      cached: false,
      provider: "parallel",
      canRefresh: freshCacheResult.canRefresh,
      lastSearchDate: freshCacheResult.lastSearchDate,
      daysUntilRefresh: freshCacheResult.daysUntilRefresh,
    })
  } catch (error) {
    console.error("[v0] Implementations: Error in POST handler:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
