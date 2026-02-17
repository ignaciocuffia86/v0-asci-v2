import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { parallelSearch, buildImplementationsSearchParams } from "@/lib/parallel"
import { GoogleGenerativeAI } from "@google/generative-ai"

const IMPL_CACHE_DAYS = 7
const MAX_IMPLEMENTATIONS = 10

// ── Gemini structuring ─────────────────────────────────────────────────
const GEMINI_SYSTEM = `Eres un investigador de implementaciones tecnologicas e innovacion empresarial.
Se te dan excerpts de paginas web sobre proyectos, casos de exito e implementaciones tecnologicas de una empresa.
Tu tarea es extraer implementaciones y casos de exito relevantes.

REGLAS:
1. Responde UNICAMENTE con JSON valido (sin markdown, sin texto extra).
2. Resume con TUS PROPIAS PALABRAS, NO copies texto literal.
3. Maximo 10 implementaciones. Prioriza calidad y evidencia fuerte.
4. Si no hay implementaciones relevantes, devuelve {"implementations":[]}
5. Las fechas deben ser YYYY-MM-DD. Si no hay fecha exacta, intenta inferirla. Si es imposible, usa null.

EVIDENCE LEVELS:
- strong: Case study oficial, comunicado de prensa del vendor, announcement oficial
- medium: Articulo con fuentes nombradas, LinkedIn post de ejecutivos, industry report
- weak: Mencion indirecta, partnership announcement, inferencia de uso de tecnologia

AREAS validas: finanzas | ventas | logistica | rrhh | it | ciberseguridad | ecommerce | operaciones

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
  ]
}`

async function structureImplementationsWithGemini(
  excerpts: { url: string; title: string; publish_date: string | null; content: string }[],
  companyName: string,
  keywords: string[],
): Promise<any[]> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not configured")

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

  const excerptText = excerpts
    .map(
      (e, i) =>
        `--- Fuente ${i + 1}: ${e.title} (${e.url}) [fecha: ${e.publish_date || "desconocida"}] ---\n${e.content.slice(0, 5000)}`,
    )
    .join("\n\n")

  const keywordsCtx = keywords.length > 0
    ? `\nTecnologias/procesos de interes: ${keywords.join(", ")}`
    : ""

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${GEMINI_SYSTEM}\n\n---\nEmpresa: "${companyName}"${keywordsCtx}\n\nExcerpts de busqueda web:\n\n${excerptText}\n\nExtrae las implementaciones relevantes en JSON.`,
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
  const parsed = JSON.parse(text)
  return parsed.implementations ?? parsed ?? []
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

// ── Cache helpers (public by company_id) ─────────────────────────────
async function getRecentCache(supabase: any, companyId: string) {
  const cacheDate = new Date()
  cacheDate.setDate(cacheDate.getDate() - IMPL_CACHE_DAYS)

  const { data } = await supabase
    .from("company_implementations")
    .select("*")
    .eq("company_id", companyId)
    .gte("created_at", cacheDate.toISOString())
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(MAX_IMPLEMENTATIONS)

  return data
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

    // Only superadmins can force refresh
    if (forceRefresh) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
      if (profile?.role !== "superadmin") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
      }
    }

    // ── 1. Check public cache (by company_id, visible to all users) ──
    if (!forceRefresh) {
      const cached = await getRecentCache(supabase, companyId)
      if (cached && cached.length > 0) {
        console.log("[v0] Implementations: Public cache hit -", cached.length, "items")
        await registerUserInteractions(supabase, user.id, companyId, cached.map((i: any) => i.id))
        return NextResponse.json({ implementations: cached, cached: true, provider: "cache" })
      }
    }

    // ── 2. Get signal keywords from bookmark context ─────────────────
    const keywords = await getBookmarkKeywords(supabase, bookmarkId)
    console.log("[v0] Implementations: Keywords for search:", keywords)

    // ── 3. Search with Parallel ──────────────────────────────────────
    console.log("[v0] Implementations: Searching with Parallel for", companyName)

    const searchParams = buildImplementationsSearchParams({
      company_name: companyName,
      industry: company.industry,
      country: company.country,
      keywords,
    })

    let implementations: any[] = []

    try {
      const searchResult = await parallelSearch(searchParams)
      console.log("[v0] Implementations: Parallel returned", searchResult.results.length, "results")

      if (searchResult.results.length > 0) {
        // Prepare excerpts for Gemini structuring
        const excerpts = searchResult.results.map(r => ({
          url: r.url,
          title: r.title,
          publish_date: r.publish_date,
          content: r.excerpts.join("\n"),
        }))

        // Structure with Gemini
        console.log("[v0] Implementations: Structuring with Gemini...")
        const structured = await structureImplementationsWithGemini(excerpts, companyName, keywords)
        console.log("[v0] Implementations: Gemini structured", structured.length, "items")

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
    } catch (parallelError) {
      console.error("[v0] Implementations: Parallel search error:", parallelError)
    }

    // ── 4. Fallback to old cache if no results ───────────────────────
    if (implementations.length === 0) {
      const oldCache = await getAnyCache(supabase, companyId)
      if (oldCache && oldCache.length > 0) {
        console.log("[v0] Implementations: Using old cache -", oldCache.length, "items")
        await registerUserInteractions(supabase, user.id, companyId, oldCache.map((i: any) => i.id))
        return NextResponse.json({ implementations: oldCache, cached: true, provider: "old_cache" })
      }
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

    const newToInsert = uniqueItems
      .filter(item => !existingUrls.has(item.source_url))
      .map(item => ({
        company_id: companyId,
        title: item.title,
        summary: item.summary,
        source_url: item.source_url,
        source_name: item.source_name,
        published_at: item.published_at,
        ai_provider: "parallel",
        technology: item.technology,
        area: item.area,
        provider_name: item.provider_name,
        evidence_level: item.evidence_level,
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

    return NextResponse.json({
      implementations: finalImpls,
      cached: false,
      provider: "parallel",
    })
  } catch (error) {
    console.error("[v0] Implementations: Error in POST handler:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
