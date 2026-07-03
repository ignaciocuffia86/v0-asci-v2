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

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING
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
