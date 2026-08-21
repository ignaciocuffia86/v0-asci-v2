import "server-only"

import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  toEvidenceLevel,
  toRadarEvidenceLevel,
  toV2EvidenceLevel,
  type EvidenceLevel,
} from "./evidence-level"

/**
 * Escritor único de evidencia de compañía.
 *
 * Antes de este módulo, company_news, company_implementations y radar_findings
 * eran tres dialectos del mismo idioma: cada motor (v2 research, radar de v3,
 * drilldown, MCP) le agregaba a SU tabla la columna que necesitaba y llenaba las
 * que se acordaba. El resultado medible al 2026-08-17: 1.133 de 1.133 noticias
 * con `bookmark_id` nulo, 0 filas con `sourced_by_workspace`, y un workaround con
 * race condition en persistClientNews porque v3 no se animaba a tocar un índice
 * parcial de v2.
 *
 * La regla es simple: TODA escritura de evidencia pasa por acá. A cambio, el
 * módulo garantiza el núcleo del contrato (`produced_by`, `dedupe_hash`,
 * atribución) y resuelve el mapeo a la tabla física, que es lo único que cambia
 * entre los tres tipos.
 *
 * Contrato SQL: supabase/migrations/20260818045619_evidence_contract.sql
 * Diseño:       docs/plan-unificacion-evidencia-v2-v3.md
 */

// ─── Vocabulario compartido ──────────────────────────────────────────────────

/**
 * Motor que produjo la fila. Se valida acá y no con un CHECK en la base para que
 * sumar un motor nuevo no exija una migración.
 */
export const PRODUCED_BY = [
  "v2_research",
  "v2_manual",
  /** Bundles de noticias del bookmark de v3 (lib/shared/news-search.ts). */
  "v3_news",
  "v3_radar",
  "v3_drilldown",
  "mcp_client",
  "etl_apify",
  "cron_refresh",
] as const

export type ProducedBy = (typeof PRODUCED_BY)[number]

export function isProducedBy(value: unknown): value is ProducedBy {
  return typeof value === "string" && (PRODUCED_BY as readonly string[]).includes(value)
}

export type EvidenceKind = "news" | "implementation" | "radar"

/**
 * El nivel de evidencia se declara SIEMPRE en el vocabulario canónico
 * (`Confirmado` | `Probable` | `Inferido`) y este módulo lo traduce al dialecto
 * de cada tabla al escribir. Son tres dialectos distintos en producción:
 *   - company_implementations → directa | convergente | inferencia  (los rotula la UI de v2)
 *   - radar_findings          → explicit | inferred                 (lo exige su CHECK)
 *   - company_news            → canónico                            (columna nueva, sin lectores legacy)
 * La vista `company_evidence` los normaliza de vuelta al canónico al leer.
 */
export type { EvidenceLevel }

/**
 * `company_news.source` es la columna legacy de procedencia: NOT NULL, hoy con
 * DEFAULT 'research'. `produced_by` la reemplaza, pero v2 sigue leyendo
 * `source`, así que se mantiene en sincronía al escribir.
 *
 * ── 'parallel' está deprecado (21-ago-2026) ──
 * El valor original era 'parallel', por el buscador que usaba el research de v2.
 * Parallel se retiró hace meses y la columna siguió estampando su nombre para
 * filas producidas por cinco motores distintos (perplexity, gemini, serpapi,
 * haiku…), así que no se podía medir quién generó qué. Ahora el valor grueso es
 * 'research' = "lo buscó el pipeline del servidor", y QUIÉN exactamente lo dice
 * `produced_by` (motor) + `ai_provider` (modelos reales de cada etapa).
 *
 * Contrato SQL: supabase/migrations/20260821160000_deprecate_parallel_source.sql
 */
const LEGACY_NEWS_SOURCE: Record<ProducedBy, string> = {
  v2_research: "research",
  v2_manual: "research",
  v3_news: "research",
  v3_radar: "research",
  v3_drilldown: "client_mcp",
  mcp_client: "client_mcp",
  etl_apify: "research",
  cron_refresh: "research",
}

/** Tabla física donde aterriza cada tipo. */
const TABLE_BY_KIND: Record<EvidenceKind, string> = {
  news: "company_news",
  implementation: "company_implementations",
  radar: "radar_findings",
}

// ─── Entrada ─────────────────────────────────────────────────────────────────

type BaseEvidence = {
  companyId: string
  title: string
  summary?: string | null
  sourceUrl?: string | null
  sourceName?: string | null
  /** Cuándo pasó el hecho (no cuándo lo detectamos). */
  occurredAt?: string | Date | null
  category?: string | null
  /** Canónico. Se aceptan valores legacy: `toEvidenceLevel` los normaliza. */
  evidenceLevel?: EvidenceLevel | string | null
  confidence?: number | null
  producedBy: ProducedBy
  /** Workspace de v3 que disparó la búsqueda. El dato es compartido; esto es atribución. */
  sourcedByWorkspace?: string | null
  /** Usuario de v2 que la pidió. */
  requestedBy?: string | null
  microAgent?: string | null
  convergentSources?: number | null
  supportingSources?: unknown
  promptVersion?: string | null
  aiProvider?: string | null
  verifiedAt?: string | Date | null
}

export type NewsEvidence = BaseEvidence & {
  kind: "news"
  direction?: "expansion" | "contraccion" | "neutro" | null
  /** Legado de v2: hoy el 100% de las filas los tiene nulos. Se aceptan pero no se exigen. */
  userId?: string | null
  bookmarkId?: string | null
}

export type ImplementationEvidence = BaseEvidence & {
  kind: "implementation"
  technology?: string | null
  providerName?: string | null
  results?: string | null
  searchContext?: string | null
  userId?: string | null
  bookmarkId?: string | null
}

export type RadarEvidence = BaseEvidence & {
  kind: "radar"
  /** NOT NULL con CHECK en la tabla, así que es obligatorio acá. */
  radarType: "tech" | "news" | "jobs-interpretation"
  runId?: string | null
  dictionaryProductIds?: string[]
  dictionaryProcessIds?: string[]
  supportingJobPostingIds?: string[]
  payload?: unknown
}

export type EvidenceInput = NewsEvidence | ImplementationEvidence | RadarEvidence

// ─── Normalización y dedupe ──────────────────────────────────────────────────

/**
 * Normaliza una URL **sólo para el hash de dedupe**: lo que se guarda en la
 * tabla es el valor original, porque forzar https o sacar parámetros cambiaría
 * el link que el usuario termina clickeando.
 *
 * Dos formas de escribir la misma nota tienen que colisionar, así que baja el
 * host, saca `www.`, la barra final, el fragmento y los parámetros de tracking. Si no parsea, devuelve el string crudo recortado — es preferible un
 * dedupe imperfecto a perder la fila.
 */
export function normalizeSourceUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    url.hash = ""
    url.host = url.host.toLowerCase().replace(/^www\./, "")
    url.protocol = "https:"
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_cid|mc_eid|ref$)/i.test(key)) url.searchParams.delete(key)
    }
    let out = url.toString()
    if (out.endsWith("/")) out = out.slice(0, -1)
    return out
  } catch {
    return trimmed
  }
}

/** Título normalizado: sirve de clave cuando no hay URL. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Hash determinístico de la evidencia. La clave es la URL normalizada cuando
 * existe, porque es lo único estable entre motores: el mismo artículo traído por
 * el research de v2 y por el drilldown del MCP tiene distinto título resumido
 * pero la misma URL.
 */
export function evidenceDedupeHash(input: EvidenceInput): string {
  const url = normalizeSourceUrl(input.sourceUrl)
  const key = url ?? `title:${normalizeTitle(input.title)}`
  return crypto.createHash("sha256").update(`${input.companyId}|${input.kind}|${key}`).digest("hex")
}

function toIso(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** radar_findings.source_date es `date`, no timestamptz. */
function toDateOnly(value: string | Date | null | undefined): string | null {
  const iso = toIso(value)
  return iso ? iso.slice(0, 10) : null
}

// ─── Mapeo a la tabla física ─────────────────────────────────────────────────

export type EvidenceRow = { table: string; row: Record<string, unknown>; dedupeHash: string }

/**
 * Traduce la entrada canónica a la fila de la tabla que corresponde. Es la
 * única parte del sistema que sabe que la URL se llama `url` en radar_findings y
 * `source_url` en las otras dos, o que la clasificación es `area` en
 * implementations y `category` en el resto.
 *
 * Se exporta aparte de recordEvidence para poder testear el mapeo sin base.
 */
export function buildEvidenceRow(input: EvidenceInput): EvidenceRow {
  if (!isProducedBy(input.producedBy)) {
    throw new Error(`producedBy inválido: ${String(input.producedBy)}`)
  }

  const dedupeHash = evidenceDedupeHash(input)

  const common = {
    company_id: input.companyId,
    title: input.title,
    summary: input.summary ?? null,
    source_name: input.sourceName ?? null,
    confidence: input.confidence ?? null,
    produced_by: input.producedBy,
    sourced_by_workspace: input.sourcedByWorkspace ?? null,
    requested_by: input.requestedBy ?? null,
    micro_agent: input.microAgent ?? null,
    convergent_sources: input.convergentSources ?? null,
    prompt_version: input.promptVersion ?? null,
    verified_at: toIso(input.verifiedAt),
    dedupe_hash: dedupeHash,
  }

  switch (input.kind) {
    case "news":
      return {
        table: TABLE_BY_KIND.news,
        dedupeHash,
        row: {
          ...common,
          source_url: input.sourceUrl?.trim() || null,
          published_at: toIso(input.occurredAt),
          category: input.category ?? null,
          // Columna nueva sin lectores legacy: se guarda el canónico tal cual.
          evidence_level: input.evidenceLevel ? toEvidenceLevel(input.evidenceLevel) : null,
          ai_provider: input.aiProvider ?? null,
          supporting_sources: input.supportingSources ?? null,
          direction: input.direction ?? null,
          source: LEGACY_NEWS_SOURCE[input.producedBy],
          user_id: input.userId ?? null,
          bookmark_id: input.bookmarkId ?? null,
        },
      }

    case "implementation":
      return {
        table: TABLE_BY_KIND.implementation,
        dedupeHash,
        row: {
          ...common,
          source_url: input.sourceUrl?.trim() || null,
          published_at: toIso(input.occurredAt),
          // En esta tabla la clasificación se llama `area`.
          area: input.category ?? null,
          // La UI de v2 rotula directa|convergente|inferencia: escribir el
          // canónico acá dejaría filas que v2 no sabe mostrar.
          evidence_level: input.evidenceLevel ? toV2EvidenceLevel(toEvidenceLevel(input.evidenceLevel)) : null,
          ai_provider: input.aiProvider ?? null,
          supporting_source_urls: input.supportingSources ?? null,
          technology: input.technology ?? null,
          provider_name: input.providerName ?? null,
          results: input.results ?? null,
          search_context: input.searchContext ?? null,
          user_id: input.userId ?? null,
          bookmark_id: input.bookmarkId ?? null,
        },
      }

    case "radar":
      return {
        table: TABLE_BY_KIND.radar,
        dedupeHash,
        row: {
          ...common,
          // Acá la URL se llama `url` y la fecha del hecho es un `date`.
          url: input.sourceUrl?.trim() || null,
          source_date: toDateOnly(input.occurredAt),
          category: input.category ?? "general",
          // El CHECK de la tabla es binario, así que "Probable" colapsa a explicit.
          evidence_level: input.evidenceLevel ? toRadarEvidenceLevel(toEvidenceLevel(input.evidenceLevel)) : null,
          radar_type: input.radarType,
          run_id: input.runId ?? null,
          dictionary_product_ids: input.dictionaryProductIds ?? [],
          dictionary_process_ids: input.dictionaryProcessIds ?? [],
          supporting_job_posting_ids: input.supportingJobPostingIds ?? [],
          supporting_sources: input.supportingSources ?? null,
          ai_provider: input.aiProvider ?? null,
          payload: input.payload ?? null,
        },
      }
  }
}

// ─── Escritura ───────────────────────────────────────────────────────────────

export type RecordResult = { id: string | null; duplicate: boolean }

/** Postgres: unique_violation. Reencontrar una nota conocida es lo normal, no un error. */
const UNIQUE_VIOLATION = "23505"

/**
 * Persiste una evidencia. Un duplicado NO es un error: devuelve
 * `{ duplicate: true }` y el llamador decide si lo cuenta como novedad.
 */
export async function recordEvidence(input: EvidenceInput): Promise<RecordResult> {
  const { table, row } = buildEvidenceRow(input)
  const admin = createAdminClient()

  const { data, error } = await admin.from(table).insert(row).select("id").single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { id: null, duplicate: true }
    throw new Error(`No se pudo guardar la evidencia en ${table}: ${error.message}`)
  }

  return { id: (data as { id: string }).id, duplicate: false }
}

export type BatchResult = { inserted: number; duplicates: number; ids: string[] }

/**
 * Versión de lote. Intenta un insert único y, si choca contra el índice de
 * dedupe, reintenta fila por fila para no perder las nuevas por culpa de una
 * repetida — que es exactamente el problema que persistClientNews resolvía con
 * un SELECT previo y una race condition abierta entre el SELECT y el INSERT.
 * Acá el índice hace de árbitro, así que la carrera no existe.
 */
export async function recordEvidenceBatch(inputs: EvidenceInput[]): Promise<BatchResult> {
  if (inputs.length === 0) return { inserted: 0, duplicates: 0, ids: [] }

  const built = inputs.map(buildEvidenceRow)
  const table = built[0].table
  if (built.some((b) => b.table !== table)) {
    throw new Error("recordEvidenceBatch requiere que todas las evidencias sean del mismo tipo")
  }

  // Dedupe dentro del propio lote: dos fuentes pueden traer la misma URL.
  const seen = new Set<string>()
  const rows: Record<string, unknown>[] = []
  let duplicates = 0
  for (const b of built) {
    if (seen.has(b.dedupeHash)) {
      duplicates++
      continue
    }
    seen.add(b.dedupeHash)
    rows.push(b.row)
  }

  const admin = createAdminClient()
  const bulk = await admin.from(table).insert(rows).select("id")

  if (!bulk.error) {
    const ids = (bulk.data ?? []).map((r) => (r as { id: string }).id)
    return { inserted: ids.length, duplicates, ids }
  }

  if (bulk.error.code !== UNIQUE_VIOLATION) {
    throw new Error(`No se pudo guardar la evidencia en ${table}: ${bulk.error.message}`)
  }

  const ids: string[] = []
  for (const row of rows) {
    const one = await admin.from(table).insert(row).select("id").single()
    if (!one.error) {
      ids.push((one.data as { id: string }).id)
    } else if (one.error.code === UNIQUE_VIOLATION) {
      duplicates++
    } else {
      throw new Error(`No se pudo guardar la evidencia en ${table}: ${one.error.message}`)
    }
  }

  return { inserted: ids.length, duplicates, ids }
}
