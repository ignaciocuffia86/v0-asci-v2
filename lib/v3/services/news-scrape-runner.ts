import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { collect, structure } from "@/lib/research/engine"
import { GEMINI_SYSTEM, NewsSchema, type NewsItem } from "@/lib/news-prompt"
import { filterRelevantToCompany, checkUrlsAlive, STRUCTURER_DEFAULT_MODEL } from "@/lib/ai-structurer"
import { classifyNewsEvent } from "./news-rules"

// ═══════════════════════════════════════════════════════════
// Fase 8 · Scrape LIVIANO de noticias (diseño G.1)
//
// Por qué no el bundle del research (medido en v3.ai_usage_log):
//   research completo = 3 bundles × US$0,178 + estructuración + scoring
//                     ≈ US$0,52-0,55 por cuenta, consume cupo del plan,
//                       cooldown de 30 días y REESCRIBE radar_findings,
//                       scorecard y brief.
//   flujo liviano     = 1 búsqueda acotada + 1 estructurador ≈ US$0,17,
//                       escribe SOLO company_news.
//
// Es un port del flujo probado de v2 (`app/api/research/news/route.ts`) a un
// servicio compartido: acá no hay `user_id` ni `bookmark_id`, porque en v3 la
// noticia es un HECHO GLOBAL — si tres workspaces siguen YPF se paga un solo
// scrape. La interpretación por workspace vive en `news-readings.ts`.
// ═══════════════════════════════════════════════════════════

/** Ventana de frescura: se re-scrapea recién al mes (decisión G.6). */
export const NEWS_SCRAPE_COOLDOWN_DAYS = 30
/** Ventana de búsqueda: la misma del informe manual. */
export const NEWS_WINDOW_MONTHS = 4
/**
 * Búsquedas web permitidas al recolector. Calibrado en v2: con 4 daba 5,75
 * items/empresa y con 8 sube a ~9 crudos (~4 insertables). Más no compensa.
 */
const NEWS_MAX_SEARCHES = 8

export interface NewsScrapeResult {
  ran: boolean
  skipped?: "cooldown" | "in_flight"
  inserted: number
  error?: string
}

/** Nombre de país → ISO-2 para sesgar la búsqueda. `null` = sin sesgo. */
function countryToISO(country: string | null): string | null {
  if (!country) return null
  const c = country.trim().toLowerCase()
  const map: Record<string, string> = {
    argentina: "AR", chile: "CL", ecuador: "EC", colombia: "CO", peru: "PE", perú: "PE",
    uruguay: "UY", mexico: "MX", méxico: "MX", brasil: "BR", brazil: "BR", paraguay: "PY",
    bolivia: "BO", venezuela: "VE", españa: "ES", spain: "ES", panama: "PA", panamá: "PA",
    "costa rica": "CR", guatemala: "GT", "el salvador": "SV", "united states": "US",
    "estados unidos": "US", usa: "US", portugal: "PT",
    "republica dominicana": "DO", "república dominicana": "DO",
  }
  if (map[c]) return map[c]
  // `companies.country` a veces guarda direcciones ("Quito, Pichincha, Ecuador").
  const last = c.split(",").pop()?.trim()
  if (last && map[last]) return map[last]
  if (/^[a-z]{2}$/.test(c)) return c.toUpperCase()
  // Sin sesgo es mejor que con el sesgo equivocado: caer a "US" por defecto
  // haría buscar noticias de EE.UU. para una empresa ecuatoriana.
  return null
}

/** Fecha válida o null: descarta futuras, muy viejas y placeholders. */
function sanitizeDate(raw: string | null | undefined): string | null {
  if (!raw || /XX|TBD|unknown/i.test(raw)) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  const now = new Date()
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  if (date > now || date < twoYearsAgo) return null
  return date.toISOString().split("T")[0]
}

/**
 * ¿Corresponde buscar noticias de esta compañía?
 *
 * Mira `company_news_scrapes`, NO `company_news`: una búsqueda que no encontró
 * nada igual dejó marca, y sin eso se re-dispararía en cada visita al bookmark.
 */
export async function shouldScrapeNews(companyId: string): Promise<{ due: boolean; reason?: "cooldown" | "in_flight" }> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("company_news_scrapes")
    .select("started_at, status")
    .eq("company_id", companyId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return { due: true }

  const startedMs = new Date(data.started_at).getTime()
  const ageMs = Date.now() - startedMs

  // Un 'running' reciente es un scrape en vuelo (otra pestaña, otro workspace):
  // 15 minutos de gracia y después se considera colgado y se puede reintentar.
  if (data.status === "running" && ageMs < 15 * 60 * 1000) {
    return { due: false, reason: "in_flight" }
  }
  if (ageMs < NEWS_SCRAPE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000 && data.status !== "failed") {
    return { due: false, reason: "cooldown" }
  }
  return { due: true }
}

/**
 * Busca noticias de la compañía y las ingesta en `company_news` (global).
 *
 * Marca el intento ANTES de gastar. Devuelve cuántas noticias NUEVAS entraron;
 * 0 es un resultado válido (la cuenta no tuvo novedades), no un error.
 */
export async function scrapeCompanyNews(
  companyId: string,
  options: { force?: boolean } = {},
): Promise<NewsScrapeResult> {
  const admin = createAdminClient()

  if (!options.force) {
    const eligibility = await shouldScrapeNews(companyId)
    if (!eligibility.due) {
      return { ran: false, skipped: eligibility.reason, inserted: 0 }
    }
  }

  const { data: company } = await admin
    .from("companies")
    .select("id, name, industry, country")
    .eq("id", companyId)
    .maybeSingle()

  if (!company?.name) {
    return { ran: false, inserted: 0, error: "Compañía inexistente o sin nombre" }
  }

  // ── Marca ANTES de gastar (lección del corredor de vacantes) ──
  const { data: scrapeRow } = await admin
    .from("company_news_scrapes")
    .insert({ company_id: companyId, status: "running", window_months: NEWS_WINDOW_MONTHS })
    .select("id")
    .single()

  const finish = async (patch: { status: "completed" | "failed"; items_inserted?: number; error_message?: string }) => {
    if (!scrapeRow?.id) return
    await admin
      .from("company_news_scrapes")
      .update({ ...patch, finished_at: new Date().toISOString() })
      .eq("id", scrapeRow.id)
  }

  try {
    const industryCtx = company.industry ? ` (industria: ${company.industry})` : ""
    const countryCtx = company.country ? ` de ${company.country}` : ""
    const searchPrompt =
      `Busca noticias de los ULTIMOS ${NEWS_WINDOW_MONTHS} MESES sobre la empresa "${company.name}"${countryCtx}${industryCtx}: ` +
      `inversiones, tecnologia, cambios de ejecutivos, expansion, adquisiciones, alianzas, resultados financieros. ` +
      `Para CADA noticia indica su FECHA DE PUBLICACION exacta en formato YYYY-MM-DD y cita la fuente. ` +
      `Priorizar prensa economica y de negocios. Ignorar redes sociales y contenido promocional.`

    const collected = await collect({
      prompt: searchPrompt,
      companyName: company.name,
      countryISO: countryToISO(company.country),
      maxSearches: NEWS_MAX_SEARCHES,
      context: "news",
      tracking: { companyId, feature: "research-collect" },
    })

    if (!collected || collected.sources.length === 0) {
      await finish({ status: "completed", items_inserted: 0 })
      return { ran: true, inserted: 0 }
    }

    // Las fuentes van NUMERADAS: el modelo elige un `source_index` de ESTA
    // lista, así no puede inventar URLs (el bug que el índice vino a matar).
    const sourceList = collected.sources
      .map((s, i) => `--- Fuente ${i + 1}: ${s.title ?? "(sin titulo)"} (${s.url}) ---`)
      .join("\n")

    let structured: NewsItem[] = []
    try {
      const parsed = await structure({
        schema: NewsSchema,
        systemPrompt: GEMINI_SYSTEM,
        userPrompt:
          `Empresa: "${company.name}"\n\nInforme de busqueda web:\n\n${collected.text}\n\n` +
          `Fuentes disponibles (el source_index se refiere a ESTA lista):\n${sourceList}\n\n` +
          `Extrae las noticias relevantes en JSON.`,
        temperature: 0.2,
        context: "news",
        tracking: { companyId, feature: "research-structure" },
      })
      structured = parsed.news
    } catch (structureError) {
      // Sin fallback degradado a propósito: en v2 publicar los excerpts crudos
      // metió 47 filas de basura permanente y tapó 2 meses un modelo muerto.
      await finish({
        status: "failed",
        error_message: structureError instanceof Error ? structureError.message : "structure failed",
      })
      return { ran: true, inserted: 0, error: "No se pudo estructurar el resultado" }
    }

    // Guardrail: la empresa tiene que estar nombrada en el título o el resumen.
    structured = filterRelevantToCompany(structured, company.name, ["title", "summary"])

    // Mapeo determinístico item → URL por source_index; sin índice válido, fuera.
    const withSource = structured
      .map((item) => {
        const idx = Number((item as { source_index?: unknown }).source_index)
        const source =
          Number.isFinite(idx) && idx >= 1 && idx <= collected.sources.length
            ? collected.sources[idx - 1]
            : null
        return { item, source }
      })
      .filter((x): x is { item: NewsItem; source: (typeof collected.sources)[number] } => x.source !== null)

    // Links muertos afuera (HEAD en paralelo).
    const aliveUrls = await checkUrlsAlive(withSource.map((x) => x.source.url), { context: "news" })
    const alive = withSource.filter((x) => aliveUrls.has(x.source.url))

    // URLs ya conocidas de la compañía: la noticia es global, así que el dedup
    // también (no por workspace).
    const { data: existing } = await admin
      .from("company_news")
      .select("source_url")
      .eq("company_id", companyId)
    const existingUrls = new Set((existing ?? []).map((n) => n.source_url))

    const seen = new Set<string>()
    const rows = alive
      .filter(({ source }) => {
        if (seen.has(source.url) || existingUrls.has(source.url)) return false
        seen.add(source.url)
        return true
      })
      .map(({ item, source }) => {
        let hostname = "fuente"
        try {
          hostname = new URL(source.url).hostname.replace(/^www\./, "")
        } catch {
          // hostname queda en el default
        }
        // Clasificación del HECHO (capa L1): dirección y tipo de evento. Es
        // global y determinística; se guarda al ingerir para que el radar y el
        // timing del scorecard no tengan que recalcularla en cada lectura.
        const event = classifyNewsEvent(item.title, item.summary)
        return {
          company_id: companyId,
          title: item.title,
          summary: item.summary,
          source_url: source.url,
          source_name: item.source_name || hostname,
          published_at: sanitizeDate(item.published_at),
          category: item.category ?? event.eventType,
          direction: event.direction,
          ai_provider: STRUCTURER_DEFAULT_MODEL,
          source: "v3-news-scrape",
        }
      })
      // `published_at` es obligatorio: sin fecha no hay recencia y el radar no
      // puede ordenar ni decidir si está dentro de la ventana.
      .filter((row) => row.published_at !== null)

    if (rows.length > 0) {
      const { error } = await admin.from("company_news").insert(rows)
      if (error) {
        await finish({ status: "failed", error_message: error.message })
        return { ran: true, inserted: 0, error: error.message }
      }
    }

    await finish({ status: "completed", items_inserted: rows.length })
    return { ran: true, inserted: rows.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido"
    await finish({ status: "failed", error_message: message })
    return { ran: true, inserted: 0, error: message }
  }
}
