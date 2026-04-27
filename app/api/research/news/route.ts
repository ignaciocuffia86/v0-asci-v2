import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { parallelSearch, buildNewsSearchParams } from "@/lib/parallel"
import { GoogleGenerativeAI } from "@google/generative-ai"

const NEWS_CACHE_DAYS = 30 // Refresh at most once per month
const MAX_NEWS = 15

// ── Gemini structuring ─────────────────────────────────────────────────
const GEMINI_SYSTEM = `Eres un analista de inteligencia comercial B2B.
Se te dan excerpts de paginas web sobre una empresa. Tu tarea es extraer noticias relevantes como senales de compra B2B.

REGLAS:
1. Responde UNICAMENTE con JSON valido (sin markdown, sin texto extra).
2. Resume con TUS PROPIAS PALABRAS, NO copies texto literal.
3. Cada noticia debe tener relevancia para un vendedor B2B.
4. Minimo 1, maximo 15 noticias. Prioriza calidad.
5. Si no hay noticias relevantes, devuelve {"news":[], "digest": null}
6. Las fechas deben ser YYYY-MM-DD. Si no hay fecha exacta, intenta inferirla del contexto. Si es imposible, usa null.

CATEGORIAS validas: inversion | transformacion | crecimiento | ejecutivos | desafios | alianzas | regulatorio | ma | innovacion

ADEMAS de las noticias, genera un "digest" de EXACTAMENTE 1 parrafo (2-4 oraciones) en ESPAÑOL que resuma:
- Los hallazgos mas importantes para un vendedor B2B
- Senales de compra o oportunidades detectadas
- Tono: informativo y accionable

El digest debe responder: "¿Por que deberia prestar atencion a esta empresa ahora?"

FORMATO JSON:
{
  "news": [
    {
      "title": "string (titulo descriptivo de la noticia)",
      "summary": "string (analisis de 150-250 chars de por que es relevante para ventas B2B)",
      "source_name": "string (nombre del medio/sitio)",
      "published_at": "YYYY-MM-DD o null",
      "category": "string (una de las categorias validas)"
    }
  ],
  "digest": "string (parrafo resumen en ESPAÑOL) o null si no hay noticias relevantes"
}`

interface GeminiNewsResult {
  news: any[]
  digest: string | null
}

async function structureNewsWithGemini(
  excerpts: { url: string; title: string; publish_date: string | null; content: string }[],
  companyName: string,
): Promise<GeminiNewsResult> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not configured")

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

  const excerptText = excerpts
    .map(
      (e, i) =>
        `--- Fuente ${i + 1}: ${e.title} (${e.url}) [fecha: ${e.publish_date || "desconocida"}] ---\n${e.content.slice(0, 4000)}`,
    )
    .join("\n\n")

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${GEMINI_SYSTEM}\n\n---\nEmpresa: "${companyName}"\n\nExcerpts de busqueda web:\n\n${excerptText}\n\nExtrae las noticias relevantes en JSON.`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4000,
      responseMimeType: "application/json",
    },
  })

  const text = result.response.text()
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch (parseErr) {
    console.error("[v0][news][gemini] JSON parse failed. Raw response (first 500):", text.slice(0, 500))
    throw parseErr
  }
  return {
    news: parsed.news ?? [],
    digest: parsed.digest ?? null,
  }
}

// ── Date helpers ────────────────────────────────────────────────────────
function sanitizeDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  if (/XX|TBD|unknown/i.test(dateStr)) return null

  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return null

  const now = new Date()
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)

  if (date > now || date < twoYearsAgo) return null
  return date.toISOString().split("T")[0]
}

function categorizeNews(text: string): string {
  const lower = text.toLowerCase()
  if (lower.match(/inversión|capex|presupuesto|financiamiento/)) return "inversion"
  if (lower.match(/fusión|adquisición|m&a|compra|merger/)) return "ma"
  if (lower.match(/regulación|normativa|compliance|ley|regulatorio/)) return "regulatorio"
  if (lower.match(/ceo|cto|cfo|cio|ciso|cdo|ejecutivo|director/)) return "ejecutivos"
  if (lower.match(/transformación|modernización|innovación|digital|automatización/)) return "transformacion"
  if (lower.match(/expansión|crecimiento|apertura|nuevo mercado/)) return "crecimiento"
  if (lower.match(/alianza|partnership|acuerdo|colaboración/)) return "alianzas"
  if (lower.match(/problema|desafío|multa|sanción/)) return "desafios"
  return "innovacion"
}

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

    // ── 3. Search with Parallel ──────────────────────────────────────
    console.log("[v0] News: Searching with Parallel for", companyName)

    const searchParams = buildNewsSearchParams({
      company_name: companyName,
      industry: company?.industry,
      country: company?.country,
    })

    console.log("[v0][news][parallel] objective:", searchParams.objective.slice(0, 200))
    console.log("[v0][news][parallel] search_queries:", JSON.stringify(searchParams.search_queries))
    console.log("[v0][news][parallel] source_policy:", JSON.stringify(searchParams.source_policy))
    console.log("[v0][news][parallel] max_results:", searchParams.max_results, "| company industry/country:", company?.industry, "/", company?.country)

    let newsItems: any[] = []
    let geminiDigest: string | null = null

    try {
      const searchResult = await parallelSearch(searchParams)
      console.log("[v0] News: Parallel returned", searchResult.results.length, "results")
      if (searchResult.warnings && searchResult.warnings.length > 0) {
        console.log("[v0][news][parallel] warnings:", JSON.stringify(searchResult.warnings))
      }
      // Loguear cada resultado crudo: url + title + fecha + tama\u00f1o de excerpt
      searchResult.results.forEach((r, i) => {
        const excerptChars = r.excerpts.reduce((acc, e) => acc + (e?.length ?? 0), 0)
        console.log(`[v0][news][parallel][result ${i + 1}/${searchResult.results.length}] date=${r.publish_date ?? "null"} | chars=${excerptChars} | ${r.url}`)
      })

      if (searchResult.results.length > 0) {
        // Prepare excerpts for Gemini structuring
        const excerpts = searchResult.results.map(r => ({
          url: r.url,
          title: r.title,
          publish_date: r.publish_date,
          content: r.excerpts.join("\n"),
        }))

        // Structure with Gemini
        console.log("[v0] News: Structuring with Gemini...")
        const { news: structured, digest } = await structureNewsWithGemini(excerpts, companyName)
        geminiDigest = digest
        console.log("[v0] News: Gemini structured", structured.length, "news items, digest:", digest ? "generated" : "none")

        // Map structured items back to source URLs from Parallel
        newsItems = structured.map((item: any, idx: number) => {
          // Try to find the best matching source URL
          const matchingResult = searchResult.results.find(r =>
            r.title.toLowerCase().includes((item.title || "").toLowerCase().slice(0, 30)) ||
            (item.source_name && r.url.toLowerCase().includes(item.source_name.toLowerCase().replace(/\s/g, "")))
          )
          const sourceResult = matchingResult || searchResult.results[idx] || searchResult.results[0]

          return {
            title: item.title,
            summary: item.summary,
            source_url: sourceResult?.url || "#",
            source_name: item.source_name || sourceResult?.title || "Desconocido",
            published_at: sanitizeDate(item.published_at) || sanitizeDate(sourceResult?.publish_date),
            category: item.category || categorizeNews((item.title || "") + " " + (item.summary || "")),
          }
        })
      }
    } catch (parallelError) {
      console.error("[v0] News: Parallel search error:", parallelError)
    }

    // ── 4. Fallback to old cache if no results ───────────────────────
    if (newsItems.length === 0) {
      console.log("[v0][news][empty] No items after Parallel+Gemini. Checking old cache...")
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
    const seenUrls = new Set<string>()
    const uniqueItems = newsItems.filter(item => {
      if (seenUrls.has(item.source_url)) return false
      seenUrls.add(item.source_url)
      return true
    })
    console.log(`[v0][news][filter] structured=${newsItems.length} | unique=${uniqueItems.length} | dropped_dup=${newsItems.length - uniqueItems.length}`)

    // Check existing URLs in DB for this company
    const { data: existingNews } = await supabase
      .from("company_news")
      .select("source_url")
      .eq("company_id", companyId)

    const existingUrls = new Set(existingNews?.map((n: any) => n.source_url) || [])
    console.log(`[v0][news][filter] existing_in_db=${existingUrls.size}`)

    // We'll use the digest to update all items in this batch
    const newToInsert = uniqueItems
      .filter(item => !existingUrls.has(item.source_url))
      .filter(item => item.published_at !== null) // require valid date
      .map((item, idx) => ({
        company_id: companyId,
        title: item.title,
        summary: item.summary,
        source_url: item.source_url,
        source_name: item.source_name,
        published_at: item.published_at,
        category: item.category,
        ai_provider: "parallel",
        // Only store digest on the first item as a flag that batch was processed
        digest: idx === 0 ? geminiDigest : null,
        digest_generated_at: idx === 0 && geminiDigest ? new Date().toISOString() : null,
      }))

    console.log(`[v0] News: Inserting ${newToInsert.length} new items (${uniqueItems.length - newToInsert.length} duplicates/invalid skipped)`)

    if (newToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("company_news")
        .insert(newToInsert)
        .select()

      if (insertError) {
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
      source: "parallel",
      canRefresh: freshCacheResult.canRefresh,
      lastSearchDate: freshCacheResult.lastSearchDate,
      daysUntilRefresh: freshCacheResult.daysUntilRefresh,
    })
  } catch (error) {
    console.error("[v0] News: Error in POST handler:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
