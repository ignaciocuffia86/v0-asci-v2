import "server-only"

import { collect, structure } from "@/lib/research/engine"
import { RESEARCH_MODEL, STRUCTURER_MODEL } from "@/lib/ai-models"
import { GEMINI_SYSTEM, NewsSchema, type NewsItem } from "@/lib/news-prompt"
import { filterRelevantToCompany, checkUrlsAlive } from "@/lib/ai-structurer"
import { renderPrompt } from "@/lib/v3/prompts"
import type { UsageFeature } from "@/lib/v3/usage"

/**
 * Búsqueda de noticias de una compañía. ÚNICA en el sistema: la usan el runner
 * de v3 (bookmark) y la ruta de v2 (`/api/research/news`).
 *
 * ── Por qué es el bundle caro y no el liviano (decisión 21-ago-2026) ──
 * La fase 8 arrancó con un flujo liviano: UNA búsqueda acotada + un
 * estructurador (~US$0,05 medidos en `v3.ai_usage_log`). Se eligió por costo,
 * con el research completo como alternativa descartada.
 *
 * Se revirtió por decisión de producto: se abrió el consumo. Una sola pasada
 * con un prompt genérico mezcla dos preguntas distintas — "¿cómo le va al
 * negocio?" y "¿está creciendo o achicándose?" — y el modelo reparte un
 * presupuesto de búsqueda único entre las dos, así que contesta las dos por la
 * mitad. Dos bundles con foco propio buscan el doble y cada uno busca UNA cosa.
 *
 * Costo medido por bundle con haiku: ~US$0,10 la recolección + US$0,0004 la
 * estructuración → **~US$0,20 por cuenta**, contra los ~US$0,05 del liviano.
 * No hay confirmación de costo ni cupo: se paga y se registra.
 *
 * El modelo NO cambia (`RESEARCH_MODEL` = haiku). Está medido en
 * `scripts/bench-search-providers.mts` que haiku trae MÁS URLs vivas y más
 * dominios que opus a 4,7x menos costo: lo caro acá es la profundidad de la
 * búsqueda, no el modelo.
 */

/**
 * Los dos focos. El texto vive en `v3.ai_prompts` (editable desde
 * /v3/admin/prompts) con fallback a `lib/v3/prompt-defaults.ts`, igual que el
 * resto de los prompts del producto.
 *
 * Se separan por PREGUNTA, no por categoría de noticia: el primero mira la
 * situación de la cuenta (¿tiene con qué comprar?) y el segundo su dirección
 * (¿se expande o se retrae?). Es la misma distinción que hace
 * `computeNewsRelevance` al leerlas, así que buscar con ella alinea la
 * recolección con la lectura.
 */
export const NEWS_BUNDLES = [
  { key: "negocio", promptKey: "news.bundle.negocio" },
  { key: "expansion", promptKey: "news.bundle.expansion" },
] as const

export type NewsBundleKey = (typeof NEWS_BUNDLES)[number]["key"]

/**
 * Búsquedas web por bundle. Calibrado en v2 sobre el flujo de una sola pasada:
 * con 4 daba 5,75 items/empresa y con 8 sube a ~9 crudos. Ahora son 8 POR
 * BUNDLE, así que el presupuesto total se duplica a 16.
 */
const SEARCHES_PER_BUNDLE = 8

export interface FoundNews {
  title: string
  summary: string | null
  sourceUrl: string
  sourceName: string
  /** `YYYY-MM-DD` ya saneada, o null si el modelo no la pudo fechar. */
  publishedAt: string | null
  category: string | null
  /** Qué foco la encontró. Sirve para auditar si un bundle deja de rendir. */
  bundle: NewsBundleKey
}

export interface NewsSearchOutcome {
  items: FoundNews[]
  /** Párrafo resumen del primer bundle que lo haya producido. */
  digest: string | null
  /** Bundles que devolvieron algo. 0 = la búsqueda no encontró nada. */
  bundlesOk: number
  /** Modelos REALES de cada etapa, para estampar procedencia en la evidencia. */
  searchModel: string
  structurerModel: string
}

/**
 * Nombre de país → ISO-2 para sesgar la búsqueda. `null` = sin sesgo.
 *
 * Sin sesgo es mejor que con el sesgo equivocado: caer a "US" por defecto haría
 * buscar noticias de EE.UU. para una empresa ecuatoriana.
 */
export function newsCountryToISO(country: string | null | undefined): string | null {
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
  return null
}

/** Fecha válida o null: descarta futuras, muy viejas y placeholders. */
export function sanitizeNewsDate(raw: string | null | undefined): string | null {
  if (!raw || /XX|TBD|unknown/i.test(raw)) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  const now = new Date()
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  if (date > now || date < twoYearsAgo) return null
  return date.toISOString().split("T")[0]
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return "fuente"
  }
}

export interface NewsSearchInput {
  companyId: string
  companyName: string
  industry?: string | null
  country?: string | null
  /** Antigüedad máxima que se le pide al buscador. */
  windowMonths: number
  /** Atribución del gasto. Sin esto el costo igual se registra, pero sin dueño. */
  tracking?: { workspaceId?: string | null; userId?: string | null }
}

/**
 * Corre un bundle: recolecta con búsqueda web y estructura acotado a las
 * fuentes de ESE bundle.
 *
 * Las fuentes van numeradas y el modelo elige un `source_index` de esa lista,
 * así no puede inventar URLs. Numerar por bundle y no globalmente es lo que
 * mantiene el mapeo fiable: con las fuentes de los dos bundles mezcladas el
 * structurer elige mal el índice (medido en el Tech Radar: informe excelente →
 * 0 hallazgos).
 */
async function runBundle(
  input: NewsSearchInput,
  bundle: (typeof NEWS_BUNDLES)[number],
): Promise<{ items: FoundNews[]; digest: string | null }> {
  const focus = await renderPrompt(bundle.promptKey, {
    companyName: input.companyName,
    windowMonths: input.windowMonths,
    industry: input.industry ?? "",
    country: input.country ?? "",
  })

  const tracking = {
    workspaceId: input.tracking?.workspaceId ?? null,
    userId: input.tracking?.userId ?? null,
    companyId: input.companyId,
    // La búsqueda de noticias se mide como `radar-news`, no como
    // `research-collect`: con el nombre genérico el gasto de noticias quedaba
    // mezclado con el de cualquier otra recolección y no se podía separar.
    feature: "radar-news" as UsageFeature,
  }
  const context = `news-bundle-${bundle.key}`

  const collected = await collect({
    prompt: focus,
    companyName: input.companyName,
    countryISO: newsCountryToISO(input.country),
    maxSearches: SEARCHES_PER_BUNDLE,
    context,
    tracking,
  })

  if (!collected || collected.sources.length === 0 || !collected.text.trim()) {
    return { items: [], digest: null }
  }

  const sourceList = collected.sources
    .map((s, i) => `--- Fuente ${i + 1}: ${s.title ?? "(sin titulo)"} (${s.url}) ---`)
    .join("\n")

  // Sin fallback degradado a propósito: en v2 publicar los excerpts crudos metió
  // 47 filas de basura permanente y tapó 2 meses un modelo muerto. Si el
  // structure falla, este bundle aporta cero y el otro sigue.
  const parsed = await structure({
    schema: NewsSchema,
    systemPrompt: GEMINI_SYSTEM,
    userPrompt:
      `Empresa: "${input.companyName}"\n\nInforme de busqueda web:\n\n${collected.text}\n\n` +
      `Fuentes disponibles (el source_index se refiere a ESTA lista):\n${sourceList}\n\n` +
      `Extrae las noticias relevantes en JSON.`,
    temperature: 0.2,
    context: `${context}-structure`,
    tracking,
  })

  // Guardrail: la empresa tiene que estar nombrada en el título o el resumen.
  const relevant = filterRelevantToCompany(parsed.news as NewsItem[], input.companyName, ["title", "summary"])

  // Mapeo determinístico item → URL por source_index; sin índice válido, fuera.
  const items: FoundNews[] = []
  for (const item of relevant) {
    const idx = Number((item as { source_index?: unknown }).source_index)
    if (!Number.isFinite(idx) || idx < 1 || idx > collected.sources.length) continue
    const source = collected.sources[idx - 1]
    items.push({
      title: item.title,
      summary: item.summary,
      sourceUrl: source.url,
      sourceName: item.source_name || hostnameOf(source.url),
      publishedAt: sanitizeNewsDate(item.published_at),
      category: item.category,
      bundle: bundle.key,
    })
  }

  return { items, digest: parsed.digest ?? null }
}

/**
 * Busca noticias de la compañía con los dos bundles y devuelve los items
 * limpios: relevantes, con URL citada y viva, sin repetir.
 *
 * NO escribe en la base — eso lo decide cada llamador (v3 ingesta a
 * `company_news` con el contrato de evidencia; v2 además maneja su cache).
 * Un bundle que falla no tumba al otro.
 */
export async function searchCompanyNews(input: NewsSearchInput): Promise<NewsSearchOutcome> {
  const settled = await Promise.allSettled(NEWS_BUNDLES.map((bundle) => runBundle(input, bundle)))

  const merged: FoundNews[] = []
  let digest: string | null = null
  let bundlesOk = 0

  for (const [i, result] of settled.entries()) {
    if (result.status === "rejected") {
      console.error(
        `[news-search][${NEWS_BUNDLES[i].key}] bundle falló:`,
        result.reason instanceof Error ? result.reason.message : result.reason,
      )
      continue
    }
    if (result.value.items.length > 0) bundlesOk++
    digest ??= result.value.digest
    merged.push(...result.value.items)
  }

  // Dedup entre bundles: los dos focos pueden citar la misma nota. Se queda la
  // primera, que es la del bundle de negocio (orden de NEWS_BUNDLES).
  const seen = new Set<string>()
  const unique = merged.filter((item) => {
    if (seen.has(item.sourceUrl)) return false
    seen.add(item.sourceUrl)
    return true
  })

  // Links muertos afuera. Un solo chequeo para los dos bundles: es un HEAD por
  // URL y hacerlo por bundle duplicaría los que se repiten.
  const alive = await checkUrlsAlive(
    unique.map((i) => i.sourceUrl),
    { context: "news" },
  )
  const items = unique.filter((i) => alive.has(i.sourceUrl))

  console.log(
    `[news-search] ${input.companyName}: ${bundlesOk}/${NEWS_BUNDLES.length} bundles con items | ` +
      `${merged.length} crudos → ${unique.length} únicos → ${items.length} con link vivo`,
  )

  return {
    items,
    digest,
    bundlesOk,
    searchModel: RESEARCH_MODEL,
    structurerModel: STRUCTURER_MODEL,
  }
}
