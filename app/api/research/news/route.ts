import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { STRUCTURER_DEFAULT_MODEL } from "@/lib/ai-structurer"
import { recordEvidenceBatch } from "@/lib/shared/evidence"
// La busqueda es UNA sola en el sistema y vive en el modulo compartido: la
// misma que corre el bookmark de v3. Antes esta ruta tenia su propia copia del
// pipeline (recoleccion, estructuracion, mapeo por source_index, liveness), y
// esa duplicacion es lo que dejo que el incidente del modelo retirado estuviera
// 2 meses roto de un lado y no del otro.
import { searchCompanyNews, type FoundNews } from "@/lib/shared/news-search"

const NEWS_CACHE_DAYS = 30 // Refresh at most once per month
const MAX_NEWS = 15

/**
 * Antiguedad maxima de las noticias que se le piden al buscador.
 *
 * v2 mira 12 meses y el bookmark de v3 mira 4: v2 es una consulta puntual sobre
 * una cuenta que quiza nunca se volvio a mirar, mientras que v3 refresca cada
 * 30 dias y la ventana corta es la que hace que "reciente" signifique algo.
 */
const NEWS_WINDOW_MONTHS = 12

// ── Cache helpers (public by company_id) ─────────────────────────────
interface CacheResult {
  news: any[] | null
  lastSearchDate: string | null
  canRefresh: boolean
  daysUntilRefresh: number
}

async function getRecentCache(supabase: any, companyId: string, isSuperadmin: boolean): Promise<CacheResult> {
  const cacheDate = new Date()
  cacheDate.setDate(cacheDate.getDate() - NEWS_CACHE_DAYS)

  // Get most recent news item to determine last search date
  const { data: lastNews } = await supabase
    .from("company_news")
    .select("created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single()

  const lastSearchDate = lastNews?.created_at ?? null
  const daysSinceLastSearch = lastSearchDate
    ? (Date.now() - new Date(lastSearchDate).getTime()) / (1000 * 60 * 60 * 24)
    : Infinity

  // Superadmins can always refresh; regular users wait 30 days
  const canRefresh = isSuperadmin || daysSinceLastSearch >= NEWS_CACHE_DAYS
  const daysUntilRefresh = canRefresh ? 0 : Math.ceil(NEWS_CACHE_DAYS - daysSinceLastSearch)

  console.log("[v0][news][cache] lastSearchDate:", lastSearchDate, "| daysSinceLastSearch:", Math.round(daysSinceLastSearch), "| canRefresh:", canRefresh, "| isSuperadmin:", isSuperadmin)

  // Check if we have ANY news fetched within the cache window
  const { data: recentFetch } = await supabase
    .from("company_news")
    .select("id")
    .eq("company_id", companyId)
    .gte("created_at", cacheDate.toISOString())
    .limit(1)

  // If there was a recent fetch, return ALL news for this company (no duplicates)
  if (recentFetch && recentFetch.length > 0) {
    const { data } = await supabase
      .from("company_news")
      .select("*")
      .eq("company_id", companyId)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(MAX_NEWS)

    return { news: data, lastSearchDate, canRefresh, daysUntilRefresh }
  }

  return { news: null, lastSearchDate, canRefresh, daysUntilRefresh } // Cache expired, needs refresh
}

async function getAnyCache(supabase: any, companyId: string) {
  const { data } = await supabase
    .from("company_news")
    .select("*")
    .eq("company_id", companyId)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(MAX_NEWS)

  return data
}

// ── User interaction tracking ────────────────────────────────────────
async function registerUserInteractions(
  supabase: any,
  userId: string,
  companyId: string,
  newsIds: string[],
) {
  if (newsIds.length === 0) return
  for (const newsId of newsIds) {
    await supabase
      .from("user_news_interactions")
      .upsert(
        { user_id: userId, news_id: newsId, company_id: companyId, source: "search", viewed_at: new Date().toISOString() },
        { onConflict: "user_id,news_id", ignoreDuplicates: true },
      )
  }
}

// ── Main handler ─────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { companyId, companyName, forceRefresh } = await request.json()

    if (!companyId || !companyName) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    // Check if user is superadmin
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    const isSuperadmin = profile?.role === "superadmin"

    // Only superadmins can force refresh
    if (forceRefresh && !isSuperadmin) {
      return NextResponse.json({ error: "Unauthorized: Only superadmins can force refresh" }, { status: 403 })
    }

    // ── 1. Check public cache (by company_id, visible to all users) ──
    const cacheResult = await getRecentCache(supabase, companyId, isSuperadmin)
    
    if (!forceRefresh && cacheResult.news && cacheResult.news.length > 0) {
      console.log("[v0] News: Public cache hit -", cacheResult.news.length, "items")
      await registerUserInteractions(supabase, user.id, companyId, cacheResult.news.map((n: any) => n.id))
      return NextResponse.json({ 
        success: true, 
        news: cacheResult.news, 
        source: "cache",
        canRefresh: cacheResult.canRefresh,
        lastSearchDate: cacheResult.lastSearchDate,
        daysUntilRefresh: cacheResult.daysUntilRefresh,
      })
    }

    // ── 2. Fetch company context for search ──────────────────────────
    const { data: company } = await supabase
      .from("companies")
      .select("industry, website, country")
      .eq("id", companyId)
      .single()

    // ── 3. Busqueda con los bundles compartidos ──────────────────────
    //
    // Antes aca vivia una copia del pipeline de noticias: collect + structure +
    // mapeo por source_index + liveness. La otra copia estaba en v3. Eran el
    // mismo codigo con dos dueños, que es exactamente como el incidente del
    // modelo retirado pudo estar 2 meses roto de un lado y no del otro.
    //
    // Ahora las dos rutas llaman a `searchCompanyNews`, que corre los DOS
    // bundles profundos con haiku (~US$0,20 por cuenta). Se paga y se registra:
    // no hay confirmacion de costo ni cupo (decision de producto, 21-ago-2026).
    console.log("[v0] News: buscando con los bundles compartidos para", companyName)

    let newsItems: FoundNews[] = []
    let geminiDigest: string | null = null
    // Procedencia REAL de la fila: los dos modelos que la produjeron.
    //
    // Esta columna es la unica evidencia forense de que genero cada noticia:
    // gracias a ella se pudo datar que el modelo retirado murio el 3-jun-2026 y
    // que las 47 filas siguientes salieron en `degraded-fallback`. Antes
    // guardaba solo el estructurador, lo que dejaba invisible al buscador — la
    // etapa que se lleva el 99% del costo.
    let aiProvider: string = STRUCTURER_DEFAULT_MODEL

    try {
      const found = await searchCompanyNews({
        companyId,
        companyName,
        industry: company?.industry,
        country: company?.country,
        windowMonths: NEWS_WINDOW_MONTHS,
        tracking: { userId: user.id },
      })
      // El insert exige fecha: sin ella no hay recencia y la nota no se puede
      // ordenar ni ubicar en la ventana.
      newsItems = found.items.filter((item) => item.publishedAt !== null)
      geminiDigest = found.digest
      aiProvider = `${found.searchModel}+${found.structurerModel}`
    } catch (searchError) {
      // NO hay fallback degradado, a proposito.
      //
      // Antes aca se publicaban los excerpts crudos del buscador como si fueran
      // noticias. Eso parecia "mejor que un empty state", pero era peor: (1)
      // escribia basura PERMANENTE en la base (47 filas con titulos como
      // "Noticias | Infobae" y markdown crudo), (2) el usuario no podia
      // distinguirla de una noticia real, y (3) al no fallar nunca, el modelo
      // retirado paso 2 meses roto sin que nadie se enterara.
      //
      // Con `newsItems` vacio el flujo cae al paso 4 (cache vieja), que muestra
      // noticias REALES de una corrida anterior y no contamina nada.
      console.error("[v0][news] La busqueda FALLO; se cae a cache vieja sin escribir nada:", searchError)
    }

    // ── 4. Fallback to old cache if no results ──────────────────────��
    if (newsItems.length === 0) {
      console.log("[v0][news][empty] Los bundles no dejaron items. Checking old cache...")
      const oldCache = await getAnyCache(supabase, companyId)
      if (oldCache && oldCache.length > 0) {
        console.log("[v0] News: Using old cache -", oldCache.length, "items")
        await registerUserInteractions(supabase, user.id, companyId, oldCache.map((n: any) => n.id))
        return NextResponse.json({ success: true, news: oldCache, source: "old_cache" })
      }
      console.log("[v0][news][empty] No old cache either. Returning source=none.")
      return NextResponse.json({ success: true, news: [], source: "none" })
    }

    // ── 5. Deduplicate and save to public cache ──────────────────────
    // `searchCompanyNews` ya deduplica entre bundles; aca solo falta contrastar
    // contra lo que la compañia ya tiene guardado.
    const { data: existingNews } = await supabase
      .from("company_news")
      .select("source_url")
      .eq("company_id", companyId)

    const existingUrls = new Set(existingNews?.map((n: any) => n.source_url) || [])
    console.log(`[v0][news][filter] encontradas=${newsItems.length} | ya_en_base=${existingUrls.size}`)

    const newToInsert = newsItems.filter((item) => !existingUrls.has(item.sourceUrl))

    console.log(`[v0] News: Inserting ${newToInsert.length} new items (${newsItems.length - newToInsert.length} duplicates skipped)`)

    if (newToInsert.length > 0) {
      // Via el contrato compartido de evidencia y NO con un insert a mano.
      //
      // Este insert era el ultimo que escribia `company_news` por fuera del
      // contrato, y se le notaba: dejaba `produced_by` en null (4 filas asi en
      // produccion) y `source` en el DEFAULT de la tabla, que hasta ayer decia
      // 'parallel' aunque Parallel llevara meses retirado.
      //
      // `recordEvidenceBatch` llena produced_by, dedupe_hash y la columna legacy
      // `source`, y trata el duplicado como resultado normal en vez de error.
      try {
        const { inserted, duplicates } = await recordEvidenceBatch(
          newToInsert.map((item) => ({
            kind: "news" as const,
            producedBy: "v2_research" as const,
            companyId,
            title: item.title,
            summary: item.summary,
            sourceUrl: item.sourceUrl,
            sourceName: item.sourceName,
            occurredAt: item.publishedAt,
            category: item.category,
            aiProvider,
            requestedBy: user.id,
          })),
        )
        console.log(`[v0] News: ${inserted} insertadas, ${duplicates} ya conocidas`)

        // El digest describe el LOTE, no una nota suelta: se estampa aparte,
        // sobre la primera fila de esta corrida, que es como lo lee la UI.
        if (inserted > 0 && geminiDigest) {
          await supabase
            .from("company_news")
            .update({ digest: geminiDigest, digest_generated_at: new Date().toISOString() })
            .eq("company_id", companyId)
            .eq("source_url", newToInsert[0].sourceUrl)
        }
      } catch (insertError) {
        console.error("[v0] News: Error inserting:", insertError)
      }
    }

    // ── 6. Return all news for this company (public) ─────────────────
    const { data: allNews } = await supabase
      .from("company_news")
      .select("*")
      .eq("company_id", companyId)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(MAX_NEWS)

    const finalNews = allNews || []

    await registerUserInteractions(supabase, user.id, companyId, finalNews.map((n: any) => n.id))

    // Get fresh cache info for response
    const freshCacheResult = await getRecentCache(supabase, companyId, isSuperadmin)

    return NextResponse.json({
      success: true,
      news: finalNews,
      // De donde salieron estas noticias, para el log del front. Decia
      // "parallel" desde antes de que Parallel se retirara.
      source: "search",
      canRefresh: freshCacheResult.canRefresh,
      lastSearchDate: freshCacheResult.lastSearchDate,
      daysUntilRefresh: freshCacheResult.daysUntilRefresh,
    })
  } catch (error) {
    console.error("[v0] News: Error in POST handler:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
