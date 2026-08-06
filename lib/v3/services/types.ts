// ═══════════════════════════════════════════════════════════
// Tipos compartidos de la capa de servicios v3 (cuenta-céntrico)
// Consumidos por: chat web, MCP server, cron de refresh.
// ═══════════════════════════════════════════════════════════

import type { EvidenceLevel } from "./evidence-level"
// Modulo LEAF (cero imports) a proposito: se puede importar desde este archivo
// de tipos sin arrastrar el SDK de IA ni crear ciclos.
import { RESEARCH_MODEL, STRUCTURER_MODEL } from "@/lib/ai-models"

export type RadarType = "tech" | "news" | "jobs-interpretation"

export type ResearchJobStatus =
  | "pending"
  | "running"
  | "preliminary_ready"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "failed_retriable"
  | "failed_terminal"
  | "cancelled"

export type ResearchPhase = "internal" | "external" | "finalizing"

export interface ResearchJob {
  id: string
  workspace_id: string
  conversation_id: string | null
  batch_id: string
  company_id: string | null
  company_input: string
  resolved_domain: string | null
  resolved_country: string | null
  status: ResearchJobStatus
  current_step: string | null
  progress: number
  force_refresh: boolean
  error: string | null
  requested_by: string
  created_at: string
  started_at: string | null
  finished_at: string | null
  phase: ResearchPhase
  heartbeat_at: string | null
  lease_expires_at: string | null
  worker_id: string | null
  attempt_count: number
  max_attempts: number
  error_code: string | null
  next_retry_at: string | null
  cancel_requested_at: string | null
  preliminary_ready_at: string | null
  external_started_at: string | null
}

export interface RadarFinding {
  id: string
  company_id: string
  radar_type: RadarType
  category: string
  title: string
  summary: string | null
  url: string | null
  source_name: string | null
  source_date: string | null
  /**
   * Valor crudo de la base. Conserva los binarios históricos ('explicit' |
   * 'inferred') y admite los canónicos nuevos. Para presentar o puntuar hay que
   * pasarlo siempre por `toEvidenceLevel()`, nunca compararlo a mano.
   */
  evidence_level: "explicit" | "inferred" | EvidenceLevel
  confidence: number | null
  dictionary_product_ids: string[]
  dictionary_process_ids: string[]
  supporting_job_posting_ids: string[]
  payload: Record<string, unknown> | null
  detected_at: string
}

export interface Scorecard {
  id: string
  workspace_id: string
  company_id: string
  score: number | null
  fit_score: number | null
  buying_signals_score: number | null
  accessibility_score: number | null
  timing_score: number | null
  score_stage: "preliminary" | "final"
  fit_status: "evaluated" | "fit_not_evaluated"
  profile_version: string | null
  snapshot_version: string | null
  rationale: string | null
  dictionary_matches: Record<string, unknown> | null
  signals_snapshot: Record<string, unknown> | null
  created_at: string
}

export interface Icebreaker {
  id: string
  workspace_id: string
  company_id: string
  contact_apollo_id: string | null
  contact_name: string
  contact_title: string | null
  contact_country: string | null
  language_register: string
  content: string
  evidence: unknown
  version: number
  feedback: number | null
  created_at: string
}

export interface FollowedAccount {
  id: string
  workspace_id: string
  company_id: string
  followed_by: string
  is_active: boolean
  refresh_day: number
  last_refreshed_at: string | null
  created_at: string
}

export interface CompanyResolution {
  input: string
  companyId: string | null
  name: string | null
  domain: string | null
  country: string | null
  industry: string | null
  /** true si hay datos frescos en cache (< CACHE_TTL_DAYS) */
  cacheFresh: boolean
  lastResearchedAt: string | null
  /** true si el workspace ya sigue esta cuenta */
  alreadyFollowed: boolean
  /** `company_id`: el input ya era un UUID, así que no hubo match difuso. */
  matchedBy?: "company_id" | "domain" | "alias" | "exact_name" | "ranked"
  confidence?: number
  resolutionReason?: string
  /** candidatos cuando el input es ambiguo */
  candidates: {
    companyId: string
    name: string
    domain: string | null
    country: string | null
    confidence?: number
    signalsCount?: number
  }[]
}

export interface DictionaryData {
  vendors: { id: string; name: string }[]
  products: { id: string; vendor_id: string | null; name: string; keywords: string[] }[]
  processes: { id: string; name: string; keywords: string[] }[]
}

export interface DictionaryMatch {
  type: "product" | "process"
  id: string
  name: string
  keyword: string
  snippet: string
}

/** Límites operativos de la plataforma */
export const LIMITS = {
  /** Máximo de cuentas por lote en el chat */
  MAX_BATCH_SIZE: 25,
  /** Días de validez del cache global antes de re-investigar */
  CACHE_TTL_DAYS: 30,
  /**
   * Máximo de micro-agentes de investigación por cuenta por ejecución.
   *
   * ÚNICA fuente de verdad. Antes había tres números que se contradecían:
   * este decía 5, el array `BUNDLES` de radar.ts tenía 3 entradas y
   * `DEFAULT_TOP_N` de agent-selection.ts usaba 6 — así que "cuántos agentes
   * corren" dependía de qué archivo mirabas. `agent-selection` importa esta
   * constante y `runMicroAgents` la aplica como tope duro.
   *
   * Se llamaba `MAX_OPUS_BUNDLES`, pero desde la migración a haiku ya no corre
   * ningún agente Opus, así que el nombre mentía sobre la realidad. El tope
   * sigue existiendo por presupuesto y por `maxDuration`, no por el modelo.
   */
  MAX_RESEARCH_BUNDLES: 6,
  /** Contactos máximos a sugerir por cuenta */
  MAX_CONTACTS: 5,
} as const

/** Modelos vía Vercel AI Gateway */
export const MODELS = {
  /**
   * Investigación profunda con búsqueda web (etapa A).
   *
   * Migrado de `claude-opus-4-5` a haiku: el benchmark midió que haiku trae más
   * URLs y más dominios a 4,7x menos costo. Ver el detalle y la contrapartida en
   * `lib/ai-models.ts`, que además permite revertir por env var sin redeploy.
   */
  RESEARCH: RESEARCH_MODEL,
  /**
   * Estructuración y tareas baratas (etapa B).
   *
   * Sale de `lib/ai-models.ts` para que v2 y v3 usen EL MISMO modelo. Antes acá
   * decía `gemini-2.5-flash` hardcodeado y v2 tenía su propia constante: las dos
   * apuntaban a un modelo retirado del Gateway y fallaban distinto (v2 en
   * silencio por acotar `maxOutputTokens`, v3 no porque no lo acota), así que
   * arreglar una no arreglaba la otra.
   */
  STRUCTURER: STRUCTURER_MODEL,
  /** Generación de icebreakers (calidad media, barato) */
  WRITER: "anthropic/claude-sonnet-4-5",
  /** Chat orquestador */
  CHAT: "anthropic/claude-sonnet-4-5",
} as const
