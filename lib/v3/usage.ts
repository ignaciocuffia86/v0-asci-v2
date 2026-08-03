import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Tracking de uso de IA para v3.
 * Registra tokens y costo estimado (USD) de cada llamada en v3.ai_usage_log.
 * El costo se calcula con una tabla de precios propia por modelo.
 */

export type UsageFeature =
  | "chat"
  | "radar-tech"
  | "radar-news"
  | "jobs-interpretation"
  | "scoring"
  | "icebreaker"
  | "doc-analysis"
  | "dedupe"
  | "other"

/**
 * Precios por millón de tokens (USD).
 * Actualizar acá cuando cambien los precios de los proveedores.
 */
const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  // Anthropic
  "anthropic/claude-opus-4.5": { inputPerM: 5, outputPerM: 25 },
  "anthropic/claude-sonnet-4.5": { inputPerM: 3, outputPerM: 15 },
  "anthropic/claude-haiku-4.5": { inputPerM: 1, outputPerM: 5 },
  // Google
  "google/gemini-3-pro-preview": { inputPerM: 2, outputPerM: 12 },
  "google/gemini-2.5-flash": { inputPerM: 0.3, outputPerM: 2.5 },
  "google/gemini-2.5-flash-lite": { inputPerM: 0.075, outputPerM: 0.3 },
  "google/gemini-2.0-flash": { inputPerM: 0.15, outputPerM: 0.6 },
  // OpenAI
  "openai/gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
}

/** Fallback conservador para modelos no listados */
const DEFAULT_PRICING = { inputPerM: 3, outputPerM: 15 }

/**
 * Normaliza el id de modelo antes de buscar precio.
 *
 * El AI Gateway nombra las versiones de Anthropic con GUION ("claude-opus-4-5")
 * mientras que las claves de arriba se escribieron con PUNTO ("claude-opus-4.5").
 * Por esa sola diferencia, TODAS las llamadas a Anthropic caian al fallback de
 * 3/15 en lugar de los 5/25 reales de Opus, subreportando el costo ~1.7x.
 * Comparamos sin separadores para que la version con punto y la con guion
 * resuelvan al mismo precio.
 */
function normalizeModelKey(model: string): string {
  return model.toLowerCase().replace(/[.\-_]/g, "")
}

const NORMALIZED_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = Object.fromEntries(
  Object.entries(MODEL_PRICING).map(([key, value]) => [normalizeModelKey(key), value]),
)

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? NORMALIZED_PRICING[normalizeModelKey(model)] ?? DEFAULT_PRICING
  const cost = (inputTokens / 1_000_000) * pricing.inputPerM + (outputTokens / 1_000_000) * pricing.outputPerM
  return Math.round(cost * 1_000_000) / 1_000_000
}

export interface LogAiUsageParams {
  workspaceId?: string | null
  userId?: string | null
  feature: UsageFeature
  model: string
  inputTokens?: number
  outputTokens?: number
  companyId?: string | null
  conversationId?: string | null
  metadata?: Record<string, unknown> | null
  /**
   * Atribución del gasto. `api_key_id`, `request_id` y `research_job_id` existían en
   * `v3.ai_usage_log` pero nadie las escribía, así que no se podía saber qué costó un
   * research puntual ni con qué credencial se gastó.
   *
   * `generation_mode` es distinto: ya tenía DEFAULT 'server_managed', así que no estaba
   * vacío — pero por eso mismo TODO quedaba marcado como server-managed por omisión. El
   * gasto que corre con el modelo del cliente tiene que pasar `'client_model'` de forma
   * explícita (el vocabulario que ya usan `account_scorecards` y `mcp-client-ai`), porque
   * el default nunca lo va a inferir.
   */
  /**
   * ⚠️ SOLO el id de una `v3.mcp_api_keys`: la columna tiene FK a esa tabla y no existe
   * una equivalente para OAuth. Un principal MCP puede ser `api_key` u `oauth_token` y los
   * dos exponen el mismo campo `keyId`, así que pasarlo a ciegas viola la FK. Como el
   * insert de abajo solo hace `console.error`, eso perdería la fila de costo COMPLETA, que
   * es peor que no atribuirla. Discriminá por `keyType` (ver `principalColumns`).
   */
  apiKeyId?: string | null
  requestId?: string | null
  researchJobId?: string | null
  generationMode?: "server_managed" | "client_model" | null
}

/**
 * Registra una llamada de IA. Nunca lanza: el tracking no debe romper la feature.
 */
export async function logAiUsage(params: LogAiUsageParams): Promise<void> {
  try {
    const inputTokens = Math.max(0, Math.round(params.inputTokens ?? 0))
    const outputTokens = Math.max(0, Math.round(params.outputTokens ?? 0))
    const admin = createAdminClient()
    const { error } = await admin
      .schema("v3")
      .from("ai_usage_log")
      .insert({
        workspace_id: params.workspaceId ?? null,
        user_id: params.userId ?? null,
        feature: params.feature,
        model: params.model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: estimateCostUsd(params.model, inputTokens, outputTokens),
        company_id: params.companyId ?? null,
        conversation_id: params.conversationId ?? null,
        metadata: params.metadata ?? null,
        api_key_id: params.apiKeyId ?? null,
        request_id: params.requestId ?? null,
        research_job_id: params.researchJobId ?? null,
        // `generation_mode` es NOT NULL con DEFAULT 'server_managed'. Un NULL explícito NO
        // dispara el default: viola la restricción y tira el insert entero, así que la
        // clave se OMITE cuando no vino y deja que la base ponga el default.
        ...(params.generationMode ? { generation_mode: params.generationMode } : {}),
      })
    if (error) {
      console.error("[v3] Error registrando uso de IA:", error.message)
    }
  } catch (e) {
    console.error("[v3] Error inesperado registrando uso de IA:", e)
  }
}

/**
 * Contexto de tracking que los servicios pueden recibir opcionalmente
 * para atribuir el uso a un workspace/usuario.
 */
export interface UsageContext {
  workspaceId?: string | null
  userId?: string | null
  conversationId?: string | null
}
