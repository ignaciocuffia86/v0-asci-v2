import "server-only"

import { z } from "zod/v3"
import { createAdminClient } from "@/lib/supabase/admin"
import { structure } from "@/lib/research/engine"
import { renderPrompt } from "@/lib/v3/prompts"
import { loadDictionary, matchTextAgainstDictionary } from "./dictionary"
import { getWorkspaceFitProfile } from "./workspace-fit-profile"
import {
  computeNewsRelevance,
  uncoveredTerms,
  type NewsRelevanceType,
} from "./news-rules"
import type { SignalDirection } from "@/lib/shared/evidence-level"

// ═══════════════════════════════════════════════════════════
// Fase 8 · Lectura de noticias POR WORKSPACE (diseño G.2-G.5)
//
// El hecho es global (`public.company_news`, un scrape compartido) y la lectura
// es específica: la misma noticia de un proyecto con datacenter es 'propuesta'
// para quien vende datacenters y 'negocio' para un workspace de staffing.
//
// Clasificación híbrida, en ese orden:
//   1. Matcher DETERMINÍSTICO contra la propuesta de valor + diccionario. Dice
//      el tipo y deja los términos que matchearon (trazabilidad: el usuario ve
//      POR QUÉ una noticia está destacada, no solo que lo está).
//   2. IA barata en BATCH (una sola llamada por cuenta) que solo REDACTA el
//      "por qué te importa" citando el dato. No clasifica.
// ═══════════════════════════════════════════════════════════

export interface NewsRadarItem {
  id: string
  title: string
  summary: string | null
  sourceUrl: string | null
  sourceName: string | null
  publishedAt: string | null
  eventType: string
  direction: SignalDirection
  relevanceType: NewsRelevanceType
  relevanceScore: number
  whyItMatters: string | null
  matchedTerms: string[]
}

export interface AccountNewsRadar {
  items: NewsRadarItem[]
  /** Términos de la propuesta que NO aparecieron en ninguna noticia (nota de cobertura). */
  uncovered: string[]
  lastScrapedAt: string | null
  hasVendorProfile: boolean
  counts: { propuesta: number; negocio: number; ruido: number }
}

const ReadingBatchSchema = z.object({
  readings: z.array(
    z.object({
      /** Índice 1-based de la lista que se le pasó al modelo. */
      index: z.number(),
      /** 1-2 oraciones. El cap está en el prompt Y acá: el schema es el que manda. */
      why_it_matters: z.string().max(400),
    }),
  ),
})

const EMPTY_RADAR: AccountNewsRadar = {
  items: [],
  uncovered: [],
  lastScrapedAt: null,
  hasVendorProfile: false,
  counts: { propuesta: 0, negocio: 0, ruido: 0 },
}

/**
 * Radar de noticias de una cuenta para un workspace.
 *
 * Genera las lecturas que falten y regenera las obsoletas (la propuesta de
 * valor cambió → `profile_version` distinto). NO dispara el scrape: eso lo
 * decide el kick on-demand con su propia regla de frescura.
 */
export async function getAccountNewsRadar(
  companyId: string,
  workspaceId: string,
): Promise<AccountNewsRadar> {
  const admin = createAdminClient()

  const [{ data: news, error }, { data: readings }, { data: lastScrape }, profile, dictionary] =
    await Promise.all([
      admin
        .from("company_news")
        .select("id, title, summary, source_url, source_name, published_at, category, direction")
        .eq("company_id", companyId)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(40),
      admin
        .schema("v3")
        .from("account_news_readings")
        .select("news_id, relevance_type, relevance_score, why_it_matters, matched_terms, profile_version")
        .eq("workspace_id", workspaceId)
        .eq("company_id", companyId),
      admin
        .from("company_news_scrapes")
        .select("started_at")
        .eq("company_id", companyId)
        .eq("status", "completed")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      getWorkspaceFitProfile(workspaceId),
      loadDictionary(),
    ])

  if (error) {
    console.error("[v3] Error leyendo noticias de la cuenta:", error.message)
    return EMPTY_RADAR
  }
  if (!news || news.length === 0) {
    return { ...EMPTY_RADAR, lastScrapedAt: lastScrape?.started_at ?? null }
  }

  const targetTerms = [...profile.targetTechnologies, ...profile.targetProcesses]
  const targetTermsLower = targetTerms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3)
  const readingByNewsId = new Map((readings ?? []).map((r) => [r.news_id, r]))

  const allMatchedTerms: string[] = []
  const items: NewsRadarItem[] = []
  /** Lecturas a (re)generar: sin fila, o generadas con otra propuesta de valor. */
  const pending: { item: NewsRadarItem; newsId: string }[] = []

  for (const row of news) {
    const existing = readingByNewsId.get(row.id)
    const isFresh = existing && existing.profile_version === profile.version

    if (isFresh && existing) {
      allMatchedTerms.push(...(existing.matched_terms ?? []))
      items.push({
        id: row.id,
        title: row.title,
        summary: row.summary ?? null,
        sourceUrl: row.source_url ?? null,
        sourceName: row.source_name ?? null,
        publishedAt: row.published_at ?? null,
        eventType: row.category ?? "Noticia general",
        direction: (row.direction as SignalDirection) ?? "neutro",
        relevanceType: existing.relevance_type as NewsRelevanceType,
        relevanceScore: existing.relevance_score,
        whyItMatters: existing.why_it_matters ?? null,
        matchedTerms: existing.matched_terms ?? [],
      })
      continue
    }

    // ── 1. Matcher determinístico (gratis, trazable) ──
    const text = [row.title, row.summary].filter(Boolean).join(" · ")
    const textLower = text.toLowerCase()
    const matched = new Set<string>()
    // a) Términos de la propuesta de valor del workspace.
    targetTermsLower.forEach((term, i) => {
      if (textLower.includes(term)) matched.add(targetTerms[i].trim())
    })
    // b) Diccionario global: solo cuenta si además es target del workspace, si
    //    no cualquier mención de "cloud" convertiría la noticia en 'propuesta'.
    if (targetTermsLower.length > 0) {
      for (const hit of matchTextAgainstDictionary(text, dictionary)) {
        const name = hit.name.trim().toLowerCase()
        if (targetTermsLower.some((t) => name.includes(t) || t.includes(name))) {
          matched.add(hit.name.trim())
        }
      }
    }

    const matchedTerms = [...matched]
    allMatchedTerms.push(...matchedTerms)

    const relevance = computeNewsRelevance({
      title: row.title,
      summary: row.summary ?? null,
      publishedAt: row.published_at ?? null,
      matchedTerms,
    })

    const item: NewsRadarItem = {
      id: row.id,
      title: row.title,
      summary: row.summary ?? null,
      sourceUrl: row.source_url ?? null,
      sourceName: row.source_name ?? null,
      publishedAt: row.published_at ?? null,
      eventType: relevance.eventType,
      direction: relevance.direction,
      relevanceType: relevance.type,
      relevanceScore: relevance.score,
      whyItMatters: null,
      matchedTerms,
    }
    items.push(item)
    // El ruido no se manda a redactar: no vale gastar tokens en lo que se
    // muestra colapsado. Igual se persiste la lectura para no reclasificarlo.
    pending.push({ item, newsId: row.id })
  }

  // ── 2. Redacción en batch (una sola llamada por cuenta) ──
  const toWrite = pending.filter(({ item }) => item.relevanceType !== "ruido")
  if (toWrite.length > 0 && profile.available) {
    try {
      const list = toWrite
        .map(({ item }, i) => {
          const terms = item.matchedTerms.length > 0 ? ` [coincide con: ${item.matchedTerms.join(", ")}]` : ""
          return `${i + 1}. [${item.relevanceType}] ${item.title}${terms}\n   ${item.summary ?? "(sin resumen)"}`
        })
        .join("\n")

      const prompt = await renderPrompt("news.reading", {
        vendorProfile: profile.summary ?? "sin perfil definido",
        targetTerms: targetTerms.join(", ") || "ninguno",
        newsList: list,
      })

      const parsed = await structure({
        schema: ReadingBatchSchema,
        systemPrompt:
          "Sos un analista de inteligencia comercial B2B. Devolvés JSON válido y nada más.",
        userPrompt: prompt,
        temperature: 0.2,
        context: "news-reading",
        tracking: { companyId, feature: "research-structure" },
      })

      for (const reading of parsed.readings) {
        const target = toWrite[reading.index - 1]
        if (target) target.item.whyItMatters = reading.why_it_matters.trim() || null
      }
    } catch (err) {
      // Sin lectura redactada el radar sigue siendo útil: el tipo y el score son
      // determinísticos. Se persiste igual para no reintentar en cada visita.
      console.error("[v3] No se pudo redactar la lectura de noticias:", err)
    }
  }

  // ── 3. Persistir (upsert por workspace+noticia) ──
  if (pending.length > 0) {
    const rows = pending.map(({ item, newsId }) => ({
      workspace_id: workspaceId,
      news_id: newsId,
      company_id: companyId,
      relevance_type: item.relevanceType,
      relevance_score: item.relevanceScore,
      why_it_matters: item.whyItMatters,
      matched_terms: item.matchedTerms,
      profile_version: profile.version,
    }))
    const { error: upsertError } = await admin
      .schema("v3")
      .from("account_news_readings")
      .upsert(rows, { onConflict: "workspace_id,news_id" })
    if (upsertError) {
      console.error("[v3] Error guardando lecturas de noticias:", upsertError.message)
    }
  }

  items.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore
    const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0
    const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0
    return tb - ta
  })

  return {
    items,
    uncovered: uncoveredTerms(targetTerms, allMatchedTerms),
    lastScrapedAt: lastScrape?.started_at ?? null,
    hasVendorProfile: targetTermsLower.length > 0,
    counts: {
      propuesta: items.filter((i) => i.relevanceType === "propuesta").length,
      negocio: items.filter((i) => i.relevanceType === "negocio").length,
      ruido: items.filter((i) => i.relevanceType === "ruido").length,
    },
  }
}
