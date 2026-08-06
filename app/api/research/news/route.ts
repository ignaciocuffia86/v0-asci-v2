import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { filterRelevantToCompany, checkUrlsAlive, STRUCTURER_DEFAULT_MODEL } from "@/lib/ai-structurer"
import { collect, structure } from "@/lib/research/engine"
// Prompt Y schema salen del mismo modulo: con `generateObject` tienen que
// coincidir, asi que tenerlos juntos evita que deriven.
import { GEMINI_SYSTEM, NewsSchema, type NewsItem } from "@/lib/news-prompt"

const NEWS_CACHE_DAYS = 30 // Refresh at most once per month
const MAX_NEWS = 15

/**
 * Cuantas busquedas web se le permiten al recolector.
 *
 * Calibrado, no elegido a dedo: con 4 daba 5,75 items/empresa y con 8 sube a
 * ~9 items crudos, que tras todo el pipeline quedan en ~4 insertables. Subirlo
 * mas no compensa el costo por token.
 */
const NEWS_MAX_SEARCHES = 8

/**
 * Nombre de pais -> ISO-2 para el `userLocation` de la busqueda web.
 *
 * Devuelve `null` cuando no reconoce el valor, y esa es la diferencia importante
 * con la version que vive en `lib/v3/services/radar.ts`: esa cae a `"US"` por
 * defecto. Aca eso seria un bug silencioso, porque `companies.country` de v2 NO
 * es un pais normalizado: guarda direcciones. Entre las empresas que hoy tienen
 * noticias hay "Switzerland", "El Salvador" y "Quito, Pichincha, Ecuador", y con
 * el default a "US" las tres irian a buscar noticias sesgadas a Estados Unidos.
 *
 * `null` hace que `collect` simplemente omita `userLocation`, que es el
 * comportamiento correcto cuando no se sabe: buscar sin sesgo geografico es mejor
 * que buscar con el sesgo equivocado.
 */
function newsCountryToISO(country: string): string | null {
  const c = country.trim().toLowerCase()
  const map: Record<string, string> = {
    argentina: "AR",
    chile: "CL",
    ecuador: "EC",
    colombia: "CO",
    "united states": "US",
    "estados unidos": "US",
    usa: "US",
    peru: "PE",
    perú: "PE",
    switzerland: "CH",
    suiza: "CH",
    "el salvador": "SV",
    uruguay: "UY",
    mexico: "MX",
    méxico: "MX",
    portugal: "PT",
    brasil: "BR",
    brazil: "BR",
    paraguay: "PY",
    bolivia: "BO",
    venezuela: "VE",
    españa: "ES",
    spain: "ES",
    panama: "PA",
    panamá: "PA",
    "costa rica": "CR",
    guatemala: "GT",
    "republica dominicana": "DO",
    "república dominicana": "DO",
  }
  if (map[c]) return map[c]
  // Valores como "Quito, Pichincha, Ecuador": el pais suele ser el ultimo campo.
  const last = c.split(",").pop()?.trim()
  if (last && map[last]) return map[last]
  if (/^[a-z]{2}$/.test(c)) return c.toUpperCase()
  return null
}

async function structureNewsWithGemini(
  /** Fuentes CITADAS por el recolector, en orden. El indice 1-based es el `source_index`. */
  sources: { url: string; title: string | null }[],
  /** Informe en prosa del recolector: es el material del que se extraen las noticias. */
  report: string,
  companyName: string,
  tracking: { userId: string; companyId: string },
): Promise<{ news: NewsItem[]; digest: string | null }> {
  // La lista va NUMERADA para preservar el mapeo determinista `source_index` -> URL.
  //
  // Es el detalle que hace que este cambio no sea riesgoso: `collect` devuelve el
  // texto y las fuentes por separado, asi que la tentacion es pedirle al modelo
  // que escriba la URL. Eso reintroduciria las URLs inventadas que el
  // `source_index` justamente elimino. Numerando las fuentes citadas, el modelo
  // solo puede elegir un indice DE ESTA LISTA, y la whitelist sale gratis: si el
  // indice no existe, el item se descarta aguas abajo.
  const sourceList = sources
    .map((s, i) => `--- Fuente ${i + 1}: ${s.title ?? "(sin titulo)"} (${s.url}) ---`)
    .join("\n")

  const userPrompt =
    `Empresa: "${companyName}"\n\nInforme de busqueda web:\n\n${report}\n\n` +
    `Fuentes disponibles (el source_index se refiere a ESTA lista):\n${sourceList}\n\n` +
    `Extrae las noticias relevantes en JSON.`

  // Sin `maxOutputTokens`: el tope de 4000 que habia aca fue EL GATILLO del
  // incidente. El modelo gastaba el presupuesto razonando y el JSON salia
  // cortado a mitad de string.
  const parsed = await structure({
    schema: NewsSchema,
    systemPrompt: GEMINI_SYSTEM,
    userPrompt,
    temperature: 0.2,
    context: "news",
    tracking: { userId: tracking.userId, companyId: tracking.companyId, feature: "research-structure" },
  })

  return { news: parsed.news, digest: parsed.digest }
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

    // ── 3. Recoleccion con el motor unificado ────────────────────────
    //
    // Antes esto era `parallelSearch`. Se reemplazo por `collect` del motor por
    // dos razones, las dos medidas:
    //
    //  1. Parallel NO es enrutable por el AI Gateway, asi que mientras siguiera
    //     aca la centralizacion quedaba a medias: un proveedor con su propia
    //     clave, su propio manejo de errores y sin la telemetria del motor.
    //  2. Calidad de las URLs. El camino nativo cita fuentes que el modelo
    //     realmente leyo: 22/22 URLs vivas (100%) contra el ~79% historico de
    //     Parallel, que indexaba links ya muertos.
    //
    // El prompt pide la FECHA explicitamente porque es el unico dato que se
    // pierde al soltar Parallel (ver el fallback de `published_at` mas abajo).
    console.log("[v0] News: Recolectando con el motor unificado para", companyName)

    const industryCtx = company?.industry ? ` (industria: ${company.industry})` : ""
    const countryCtx = company?.country ? ` de ${company.country}` : ""
    const searchPrompt =
      `Busca noticias de los ULTIMOS 12 MESES sobre la empresa "${companyName}"${countryCtx}${industryCtx}: ` +
      `inversiones, tecnologia, cambios de ejecutivos, expansion, adquisiciones, alianzas, resultados financieros. ` +
      `Para CADA noticia indica su FECHA DE PUBLICACION exacta en formato YYYY-MM-DD y cita la fuente. ` +
      `Priorizar prensa economica y de negocios. Ignorar redes sociales y contenido promocional.`

    let newsItems: any[] = []
    let geminiDigest: string | null = null
    // Se deriva del default real del structurer en vez de hardcodearse.
    //
    // Esta columna es la única evidencia forense de qué produjo cada noticia: gracias a ella se
    // pudo datar que el modelo retirado murió el 3-jun-2026 (última fila `gemini-2.0-flash`) y que
    // las 47 filas siguientes salieron en `degraded-fallback`. Estaba hardcodeada en
    // "gemini-2.0-flash", así que al cambiar el default habría seguido estampando el nombre del
    // modelo muerto y arruinado justamente la señal que hizo visible el incidente.
    //
    // Ahora es `const`: al eliminarse el fallback degradado, NINGÚN camino puede volver a escribir
    // `degraded-fallback`. Que el compilador lo garantice vale más que un comentario pidiéndolo.
    const aiProvider: string = STRUCTURER_DEFAULT_MODEL

    // Paso A: recolectar. Si falla la busqueda, capturamos y caemos a cache vieja.
    let collected: Awaited<ReturnType<typeof collect>> | null = null
    try {
      collected = await collect({
        prompt: searchPrompt,
        companyName,
        countryISO: company?.country ? newsCountryToISO(company.country) : null,
        maxSearches: NEWS_MAX_SEARCHES,
        context: "news",
        tracking: { userId: user.id, companyId, feature: "research-collect" },
      })
      console.log(
        `[v0][news][collect] ${collected.sources.length} fuentes citadas | ${collected.searchCount} busquedas | ${collected.text.length} chars de informe`,
      )
      collected.sources.forEach((s, i) => {
        console.log(`[v0][news][collect][fuente ${i + 1}/${collected!.sources.length}] ${s.url}`)
      })
    } catch (collectError) {
      console.error("[v0] News: error de recoleccion:", collectError)
    }

    // Paso B: estructurar con el motor. Si falla, no se publica nada degradado:
    // se cae a cache vieja mas abajo.
    if (collected && collected.sources.length > 0) {
      const searchResult = collected

      let structured: NewsItem[] = []
      try {
        console.log(`[v0] News: Structuring with AI Gateway (${STRUCTURER_DEFAULT_MODEL})...`)
        const result = await structureNewsWithGemini(searchResult.sources, searchResult.text, companyName, {
          userId: user.id,
          companyId,
        })
        structured = result.news
        geminiDigest = result.digest
        console.log("[v0] News: Gemini structured", structured.length, "items, digest:", geminiDigest ? "generated" : "none")
      } catch (structureError) {
        // NO hay fallback degradado, a proposito.
        //
        // Antes aca se publicaban los excerpts crudos de Parallel como si fueran
        // noticias. Eso parecia "mejor que un empty state", pero era peor por
        // tres razones: (1) escribia basura PERMANENTE en la base (47 filas con
        // titulos como "Noticias | Infobae" y markdown crudo), (2) el usuario no
        // podia distinguirla de una noticia real, y (3) al no fallar nunca, el
        // modelo retirado paso 2 meses roto sin que nadie se enterara.
        //
        // Dejando `structured` vacio, el flujo cae al paso 4 (cache vieja), que
        // muestra noticias REALES de una corrida anterior y no contamina nada.
        console.error("[v0][news] Structuring FALLO; se cae a cache vieja sin escribir nada:", structureError)
        structured = []
      }

      // Guardrail post-LLM: descartar items que NO mencionan el nombre de la empresa
      // en title+summary. Atrapa los casos donde el modelo (o el fallback degradado)
      // arrastra una noticia tangencial donde la empresa solo se menciona al pasar.
      const beforeFilter = structured.length
      structured = filterRelevantToCompany(structured, companyName, ["title", "summary"])
      const droppedByGuardrail = beforeFilter - structured.length
      if (droppedByGuardrail > 0) {
        console.log(`[v0][news][guardrail] dropped ${droppedByGuardrail} item(s) sin mencion explicita de "${companyName}"`)
      }

      // Mapeo deterministico item -> URL via source_index (1-based) que el LLM
      // debe devolver explicitamente. Esto elimina el matching fragil por titulo
      // que producia mismatches (ej: item "X" terminaba con URL de un articulo
      // aleman tangencial). Items sin source_index valido se descartan.
      const itemsWithSource = structured
        .map((item: any) => {
          const idx1 = Number(item.source_index)
          const sourceResult =
            Number.isFinite(idx1) && idx1 >= 1 && idx1 <= searchResult.sources.length
              ? searchResult.sources[idx1 - 1]
              : null
          return { item, sourceResult }
        })
        .filter((x) => x.sourceResult !== null)

      const droppedNoSource = structured.length - itemsWithSource.length
      if (droppedNoSource > 0) {
        console.log(`[v0][news][mapping] dropped ${droppedNoSource} item(s) sin source_index valido`)
      }

      // Liveness check: HEAD a las URLs candidatas en paralelo. Descartamos las
      // que devuelven 404/410 o tienen errores de DNS (links muertos que Parallel
      // tenia indexados pero ya no existen).
      const candidateUrls = itemsWithSource.map((x) => x.sourceResult!.url)
      const aliveUrls = await checkUrlsAlive(candidateUrls, { context: "news" })
      const aliveItems = itemsWithSource.filter((x) => aliveUrls.has(x.sourceResult!.url))
      const droppedDead = itemsWithSource.length - aliveItems.length
      if (droppedDead > 0) {
        console.log(`[v0][news][mapping] dropped ${droppedDead} item(s) por links muertos`)
      }

      newsItems = aliveItems.map(({ item, sourceResult }) => {
        const r = sourceResult!
        let hostname: string
        try {
          hostname = new URL(r.url).hostname.replace(/^www\./, "")
        } catch {
          hostname = "fuente"
        }
        return {
          title: item.title,
          summary: item.summary,
          source_url: r.url,
          source_name: item.source_name || hostname || r.title || "Desconocido",
          // Unica fuente de fecha: la que el modelo extrae del contenido.
          //
          // Antes habia un segundo intento con `r.publish_date`, el metadato que
          // traia Parallel. `collect` no lo tiene: devuelve las fuentes que el
          // modelo cito, sin metadatos por URL. Es el UNICO costo real de este
          // cambio y esta medido: el modelo fecha 20/23 items (87%) y sobreviven
          // 17/23 (74%) a `sanitizeDate`, contra el 79% que hay hoy en la base.
          //
          // Importa porque el insert exige `published_at !== null`, asi que un
          // item sin fecha se descarta en silencio. Por eso el prompt de
          // recoleccion pide la fecha de forma explicita: es lo que sostiene ese
          // 87%. Si esta tasa cae, el sintoma va a ser "faltan noticias", y hay
          // que mirar aca.
          published_at: sanitizeDate(item.published_at),
          category: item.category || categorizeNews((item.title || "") + " " + (item.summary || "")),
        }
      })
    }

    // ── 4. Fallback to old cache if no results ──────────────────────��
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
        ai_provider: aiProvider,
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
