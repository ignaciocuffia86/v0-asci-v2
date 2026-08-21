// Reglas PURAS del radar de noticias (Fase 8, diseño sección G).
//
// Sin "server-only" para poder testearlas directo: acá vive el vocabulario que
// decide QUÉ tipo de evento es una noticia y CUÁNTO pesa para un workspace.
//
// Fuente única de verdad: `scoring.ts` importa `NEWS_EVENT_RULES` desde acá en
// vez de tener su propia copia. Antes el mismo vocabulario (expansión,
// contracción, cambio ejecutivo…) vivía sólo dentro del scorecard, así que el
// radar de noticias habría necesitado duplicarlo y las dos copias iban a
// derivar.

import type { SignalDirection } from "@/lib/shared/evidence-level"

export interface NewsEventRule {
  type: string
  weight: number
  direction: SignalDirection
  patterns: RegExp
}

export const NEWS_EVENT_RULES: NewsEventRule[] = [
  // ── Contracción: va PRIMERO porque comparte vocabulario con expansión ──
  // "venta de la unidad de negocio" o "cierre de planta" matchean los patrones de
  // expansión ("planta", "unidad"). Al evaluarse antes, la contracción gana el
  // desempate y no se cuenta como una buena noticia.
  {
    type: "Contracción / desinversión",
    weight: 22,
    direction: "contraccion",
    // Cubre sustantivo Y verbo. Un test sobre titulares reales mostró que
    // "vende la unidad de negocio" NO matcheaba, porque solo estaba "venta de":
    // los titulares usan el verbo más seguido que el sustantivo, así que una
    // desinversión se estaba contando como noticia neutra.
    patterns:
      /cierre de (planta|f[aá]brica|operaciones)|cierra su|despido|desvincula|reestructuraci[oó]n|(venta|vende|vendi[oó]|desprende)\s+(de\s+)?(la\s+|su\s+)?(unidad|divisi[oó]n|negocio|filial|participaci[oó]n)|desinversi[oó]n|se retira de|salida de(l)? (pa[ií]s|mercado)|abandona el mercado|default|concurso de acreedores|quiebra|suspensi[oó]n de pagos|aumento de (la )?deuda|endeudamiento|p[eé]rdidas|ca[ií]da de (ventas|ingresos)|recorte/i,
  },
  {
    type: "Expansión / inversión",
    weight: 25,
    direction: "expansion",
    // Mismo criterio que contracción: "adquiere competidor" no matcheaba porque
    // solo estaba el sustantivo "adquisición". Se agregan las formas verbales
    // frecuentes en titulares (adquiere, invierte, inaugura, se fusiona).
    patterns:
      /expansi[oó]n|inversi[oó]n|invierte|planta|f[aá]brica|apertura|inaugura|nuevo mercado|adquisici[oó]n|adquiere|adquiri[oó]|compra (la )?(empresa|competidor|participaci[oó]n)|fusi[oó]n|se fusiona|m&a|centro de distribuci[oó]n|licitaci[oó]n|rfp/i,
  },
  {
    type: "Cambio ejecutivo",
    weight: 20,
    direction: "neutro",
    patterns: /\bcio\b|\bcto\b|\bcdo\b|\bcfo\b|\bceo\b|nombramiento|nuevo director|nueva director|gerente de|ejecutiv/i,
  },
  {
    type: "Implementación tecnológica",
    weight: 15,
    direction: "expansion",
    // "innovación" se sumó en la fase 8: un "proyecto de innovación" no
    // matcheaba ninguna regla y caía como noticia general, así que el radar lo
    // mandaba a ruido — justo el tipo de anuncio que el informe manual destaca.
    patterns:
      /implementaci[oó]n|migraci[oó]n|moderniza|transformaci[oó]n digital|innovaci[oó]n|erp|crm|sap|oracle|cloud|nube|datacenter|data center/i,
  },
]

/** Peso de una noticia que no matchea ninguna regla. */
export const GENERAL_NEWS_WEIGHT = 8

export interface NewsEventClassification {
  eventType: string
  weight: number
  direction: SignalDirection
}

/**
 * Clasifica el HECHO (capa L1 del diseño): qué tipo de evento es y en qué
 * dirección va. Es global — no depende del workspace.
 */
export function classifyNewsEvent(title: string, summary?: string | null): NewsEventClassification {
  const text = `${title} ${summary ?? ""}`
  const matched = NEWS_EVENT_RULES.find((rule) => rule.patterns.test(text))
  if (matched) {
    return { eventType: matched.type, weight: matched.weight, direction: matched.direction }
  }
  return { eventType: "Noticia general", weight: GENERAL_NEWS_WEIGHT, direction: "neutro" }
}

/**
 * Decaimiento por antigüedad. La ventana del informe es de 4 meses: una noticia
 * más vieja que eso sigue existiendo pero ya no mueve el semáforo.
 */
export function recencyMultiplier(publishedAt: string | null, now: number = Date.now()): number {
  if (!publishedAt) return 0
  const ms = new Date(publishedAt).getTime()
  if (Number.isNaN(ms)) return 0
  const ageDays = (now - ms) / (24 * 60 * 60 * 1000)
  if (ageDays < 0) return 0 // fecha futura: dato roto
  if (ageDays <= 30) return 1
  if (ageDays <= 60) return 0.7
  if (ageDays <= 90) return 0.4
  if (ageDays <= 120) return 0.2
  return 0
}

/** Relevancia de la noticia PARA UN WORKSPACE (capa L2). */
export type NewsRelevanceType = "propuesta" | "negocio" | "ruido"

/** Multiplicador por tipo: lo que toca la propuesta vale el doble (decisión G.5). */
export const RELEVANCE_MULTIPLIER: Record<NewsRelevanceType, number> = {
  propuesta: 2,
  negocio: 1,
  ruido: 0,
}

export interface NewsRelevanceInput {
  title: string
  summary: string | null
  publishedAt: string | null
  /** Términos de la propuesta/diccionario que matchearon el texto (G.4). */
  matchedTerms: string[]
  now?: number
}

export interface NewsRelevance {
  type: NewsRelevanceType
  /** 0-100, determinístico: ordena el radar y alimenta el semáforo. */
  score: number
  eventType: string
  direction: SignalDirection
}

/**
 * Relevancia determinística de una noticia para un workspace.
 *
 * - Si matcheó términos de la propuesta → `propuesta` (se destaca).
 * - Si no, pero el hecho dice algo de la situación de la cuenta (expansión,
 *   contracción, cambio ejecutivo, implementación) y está dentro de la ventana
 *   → `negocio` (contexto: "se expande, tiene recursos").
 * - Si no aporta ninguna de las dos cosas → `ruido` (se colapsa, no se borra).
 *
 * La contracción RESTA: el score se devuelve en 0-100 pero el signo negativo se
 * conserva en el semáforo vía `direction`, igual que en el scorecard.
 */
export function computeNewsRelevance(input: NewsRelevanceInput): NewsRelevance {
  const { eventType, weight, direction } = classifyNewsEvent(input.title, input.summary)
  const recency = recencyMultiplier(input.publishedAt, input.now)
  const hasMatch = input.matchedTerms.length > 0

  let type: NewsRelevanceType
  if (hasMatch && recency > 0) {
    type = "propuesta"
  } else if (recency > 0 && eventType !== "Noticia general") {
    type = "negocio"
  } else {
    // Fuera de ventana o sin nada que decir: ruido. Una noticia general reciente
    // tampoco destaca sola — es el caso "salió en el diario pero no dice nada".
    type = "ruido"
  }

  const raw = weight * recency * RELEVANCE_MULTIPLIER[type]
  const score = Math.max(0, Math.min(100, Math.round(raw * 2)))

  return { type, score, eventType, direction }
}

/**
 * Términos de la propuesta que NO aparecieron en ninguna noticia de la cuenta.
 *
 * Alimenta la "nota de cobertura" del informe: la diferencia entre "no hay
 * nada" y "no buscamos". Se compara normalizado (minúsculas) pero se devuelve
 * el término tal como lo escribió el workspace.
 */
export function uncoveredTerms(targetTerms: string[], matchedTerms: string[]): string[] {
  const matched = new Set(matchedTerms.map((t) => t.trim().toLowerCase()))
  const seen = new Set<string>()
  const result: string[] = []
  for (const term of targetTerms) {
    const key = term.trim().toLowerCase()
    if (!key || matched.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(term.trim())
  }
  return result
}
