import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { buildEvidenceRow } from "@/lib/shared/evidence"
import { searchCompanyNews } from "@/lib/shared/news-search"
import { classifyNewsEvent } from "./news-rules"

// ═══════════════════════════════════════════════════════════
// Ingesta de noticias de una cuenta seguida.
//
// La BÚSQUEDA vive en `lib/shared/news-search.ts` y es la misma que usa v2:
// dos bundles profundos con haiku (~US$0,20 por cuenta). Acá sólo está lo que
// es propio de v3: cuándo corresponde gastar, la marca previa al gasto y la
// ingesta a `company_news`.
//
// En v3 la noticia es un HECHO GLOBAL: no lleva `user_id` ni `bookmark_id`, y
// si tres workspaces siguen YPF se paga un solo scrape. La interpretación por
// workspace vive en `news-readings.ts` y cuesta ~US$0,0004.
// ═══════════════════════════════════════════════════════════

/** Ventana de frescura: se re-scrapea recién al mes (decisión G.6). */
export const NEWS_SCRAPE_COOLDOWN_DAYS = 30
/** Ventana de búsqueda: la misma del informe manual. */
export const NEWS_WINDOW_MONTHS = 4
/**
 * Un `running` más viejo que esto se considera colgado y se puede reintentar.
 * Lo comparte el informe para decidir si sigue mostrando el loader.
 */
export const NEWS_SCRAPE_STALE_MS = 15 * 60 * 1000

export interface NewsScrapeResult {
  ran: boolean
  skipped?: "cooldown" | "in_flight"
  inserted: number
  error?: string
}

/**
 * ¿Corresponde buscar noticias de esta compañía?
 *
 * Mira `company_news_scrapes`, NO `company_news`: una búsqueda que no encontró
 * nada igual dejó marca, y sin eso se re-dispararía en cada intento.
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

  const ageMs = Date.now() - new Date(data.started_at).getTime()

  // Un 'running' reciente es un scrape en vuelo (otro workspace siguió la misma
  // cuenta al mismo tiempo): se espera en vez de pagarlo dos veces.
  if (data.status === "running" && ageMs < NEWS_SCRAPE_STALE_MS) {
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
  options: { force?: boolean; workspaceId?: string | null; userId?: string | null } = {},
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
    const found = await searchCompanyNews({
      companyId,
      companyName: company.name,
      industry: company.industry,
      country: company.country,
      windowMonths: NEWS_WINDOW_MONTHS,
      tracking: { workspaceId: options.workspaceId ?? null, userId: options.userId ?? null },
    })

    if (found.items.length === 0) {
      await finish({ status: "completed", items_inserted: 0 })
      return { ran: true, inserted: 0 }
    }

    // URLs ya conocidas de la compañía: la noticia es global, así que el dedup
    // también (no por workspace).
    const { data: existing } = await admin
      .from("company_news")
      .select("source_url")
      .eq("company_id", companyId)
    const existingUrls = new Set((existing ?? []).map((n) => n.source_url))

    // Procedencia REAL de la fila: qué motor la produjo y con qué modelos.
    // Antes acá iba sólo el estructurador, que dejaba invisible al buscador —
    // que es la etapa que se lleva el 99% del costo.
    const aiProvider = `${found.searchModel}+${found.structurerModel}`

    const rows = found.items
      // `published_at` es obligatorio: sin fecha no hay recencia y el radar no
      // puede ordenar ni decidir si está dentro de la ventana.
      .filter((item) => item.publishedAt !== null && !existingUrls.has(item.sourceUrl))
      .map((item) => {
        // Clasificación del HECHO (capa L1): dirección y tipo de evento. Es
        // global y determinística; se guarda al ingerir para que el radar y el
        // timing del scorecard no tengan que recalcularla en cada lectura.
        const event = classifyNewsEvent(item.title, item.summary)
        // La fila la arma el contrato compartido de evidencia, NO a mano: es
        // quien sabe que `company_news.source` es una columna legacy con CHECK
        // y mapea cada productor al valor permitido, además de llenar
        // produced_by y dedupe_hash. Escribir el insert a mano acá costó dos
        // scrapes fallidos en producción.
        return buildEvidenceRow({
          kind: "news",
          producedBy: "v3_news",
          companyId,
          title: item.title,
          summary: item.summary,
          sourceUrl: item.sourceUrl,
          sourceName: item.sourceName,
          occurredAt: item.publishedAt,
          category: item.category ?? event.eventType,
          direction: event.direction,
          aiProvider,
          sourcedByWorkspace: options.workspaceId ?? null,
        }).row
      })

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
