import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { runTechRadar } from "@/lib/tech-radar"
import { startTechRadarRun, finishTechRadarRun, type TechRadarRunHandle } from "@/lib/v3/tech-radar-runs"

const IMPL_CACHE_DAYS = 30 // Refresh at most once per month per company+signal
const MAX_IMPLEMENTATIONS = 40 // limite del Tech Radar v2 (hasta 17 micro-agentes x N hallazgos)

// El orquestador completo (Parallel x4 bundles -> Gemini consolidador ->
// mapping deterministico por source_index -> guardrail relevancia -> liveness
// check) vive ahora en lib/tech-radar.ts.

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

  // Get most recent v2 implementation to determine last search date
  // (registros v1 viejos no cuentan para el cooldown de refresh)
  const { data: lastImpl } = await supabase
    .from("company_implementations")
    .select("created_at")
    .eq("company_id", companyId)
    .eq("prompt_version", "v2")
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

  // Check if we have v2 implementations fetched within the cache window for this context.
  // IMPORTANTE: filtramos por prompt_version='v2' para que el primer run del nuevo
  // Tech Radar se ejecute aunque haya registros viejos (v1) en cache, ya que esos
  // registros viejos no tienen los campos del Tech Radar (micro_agent, evidence_detail, etc.).
  let query = supabase
    .from("company_implementations")
    .select("id")
    .eq("company_id", companyId)
    .eq("prompt_version", "v2")
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
  // Handle de la corrida en v3.tech_radar_runs. Se declara afuera del bloque de
  // ejecucion para poder cerrarla como 'failed' desde el catch global.
  let radarRun: TechRadarRunHandle | null = null
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

    // ── 3. Run Tech Radar (4 bundles collect x 1 Gemini consolidador) ─
    console.log("[v0] Implementations: Running Tech Radar for", companyName)

    // Abrir la fila de corrida (drilldown). No bloquea si falla el insert.
    radarRun = await startTechRadarRun({
      companyId,
      companyName,
      // El drilldown de bookmarks es v2: no hay workspace. userId sirve para
      // saber quien la disparo.
      userId: user.id,
      caller: "drilldown",
      bookmarkId,
      keywords,
    })

    const radar = await runTechRadar({
      companyName,
      country: company.country ?? undefined,
      industry: company.industry ?? undefined,
      keywords,
      // Aliases derivados de la fila de companies para mejorar el match
      // de menciones a la empresa (subsidiarias, ticker, slug LinkedIn).
      ticker: company.ticker ?? null,
      linkedinSlug: company.linkedin_slug ?? null,
      // Atribucion del gasto de IA (feature 'radar-tech' + company). Sin
      // workspace en el drilldown.
      tracking: { companyId, userId: user.id },
    })

    console.log(
      "[v0][impl] tech-radar findings:", radar.findings.length,
      "| ai_provider:", radar.ai_provider,
      "| cost:", radar.usage.costUsd,
      "| bundles:", radar.bundle_stats.map((b) => `${b.bundle}=${b.sources}`).join(" "),
    )

    // Cerrar la corrida con las metricas (findings.length aca es el total mapeado
    // post-filtros; representa lo que efectivamente produjo el radar).
    await finishTechRadarRun(radarRun, { status: "completed", result: radar })
    radarRun = null // ya cerrada; el catch global no debe re-cerrarla como failed

    const findings = radar.findings
    const radarDigest = radar.digest
    const aiProvider = radar.ai_provider

    // ── 4. Fallback to old cache if no results ───────────────────────
    if (findings.length === 0) {
      console.log("[v0][impl][empty] No findings from Tech Radar. Checking old cache...")
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
    const uniqueFindings = findings.filter((f) => {
      if (seenUrls.has(f.source_url)) return false
      seenUrls.add(f.source_url)
      return true
    })

    const { data: existingImpls } = await supabase
      .from("company_implementations")
      .select("source_url")
      .eq("company_id", companyId)

    const existingUrls = new Set(existingImpls?.map((i: any) => i.source_url) || [])

    // Insert new v2 findings con todos los campos del Tech Radar
    const newToInsert = uniqueFindings
      .filter((f) => !existingUrls.has(f.source_url))
      .map((f, idx) => ({
        company_id: companyId,
        title: f.title,
        summary: f.summary,
        source_url: f.source_url,
        source_name: f.source_name,
        published_at: f.published_at,
        ai_provider: aiProvider,
        technology: f.technology,
        area: f.area,
        provider_name: f.provider_name,
        evidence_level: f.evidence_level,
        evidence_detail: f.evidence_detail,
        micro_agent: f.micro_agent,
        convergent_sources: f.convergent_sources,
        supporting_source_urls: f.supporting_source_urls,
        prompt_version: "v2",
        results: f.results,
        search_context: searchContext,
        // Solo guardamos digest en el primer item como flag de batch procesado
        digest: idx === 0 ? radarDigest : null,
        digest_generated_at: idx === 0 && radarDigest ? new Date().toISOString() : null,
      }))

    console.log(`[v0] Implementations: Inserting ${newToInsert.length} new v2 findings`)

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
      provider: "tech-radar",
      canRefresh: freshCacheResult.canRefresh,
      lastSearchDate: freshCacheResult.lastSearchDate,
      daysUntilRefresh: freshCacheResult.daysUntilRefresh,
    })
  } catch (error) {
    console.error("[v0] Implementations: Error in POST handler:", error)
    // Si la corrida quedo abierta (fallo despues de startTechRadarRun), cerrarla
    // como 'failed' para no dejar filas 'running' colgadas —- el mismo sintoma
    // que ya vimos en cron_executions.
    if (radarRun) {
      await finishTechRadarRun(radarRun, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
