import { generateText } from "ai"
import { logAiUsage, type UsageFeature } from "@/lib/v3/usage"

/**
 * Traducción de los IDs "pelados" de la API directa de Google a los IDs del
 * AI Gateway.
 *
 * Los call sites pasan nombres sin prefijo (`"gemini-2.5-flash"`) porque antes
 * se armaba la URL de `generativelanguage.googleapis.com` a mano. El Gateway
 * necesita el proveedor adelante (`"google/gemini-2.5-flash"`), así que se
 * traduce acá y NINGÚN call site necesita cambiar.
 *
 * ⚠️ Toda la familia `gemini-2.0-*` fue RETIRADA del Gateway (verificado: da
 * `not found`). Como los 12 call sites la usaban justamente como fallback en su
 * `catch`, el fallback estaba garantizado a fallar también. Se redirige a
 * `2.5-flash-lite`, que existe, es el más barato y en el benchmark de
 * `scripts/bench-structurer-models.mts` fue el más confiable para JSON (4/4).
 */
const MODEL_ALIASES: Record<string, string> = {
  "gemini-2.0-flash": "google/gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite": "google/gemini-2.5-flash-lite",
  "gemini-2.5-flash": "google/gemini-2.5-flash",
  "gemini-2.5-flash-lite": "google/gemini-2.5-flash-lite",
  "gemini-2.5-pro": "google/gemini-2.5-pro",
}

/** Modelos vigentes en el Gateway al momento de escribir esto. */
const MODELOS_VIGENTES = new Set([
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-pro",
  "google/gemini-3.5-flash-lite",
])

function toGatewayModel(model: string): string {
  // Si ya viene con proveedor, se respeta tal cual.
  if (model.includes("/")) return model
  const alias = MODEL_ALIASES[model]
  if (alias) return alias
  // Modelo desconocido: se asume Google y se avisa, porque si no existe el
  // error del Gateway va a ser oscuro.
  console.warn(
    `[v0][ai-service] Modelo "${model}" no está en MODEL_ALIASES. Se intenta como "google/${model}". Si falla, revisar el catálogo del Gateway.`,
  )
  return `google/${model}`
}

/**
 * Genera texto con Gemini a través del AI Gateway.
 *
 * ── Por qué se migró (esto estaba roto en producción) ──
 * Antes esta función pegaba directo a `generativelanguage.googleapis.com` con
 * `GOOGLE_GENERATIVE_AI_API_KEY`. Esa clave devolvía **403 PERMISSION_DENIED**
 * en todos los modelos, así que las 9 features de v2 que dependen de acá
 * (enriquecimiento Apollo, generación de workspace, briefs y summaries de
 * bookmarks, análisis y perfil de valor de documentos) estaban caídas. Y como
 * era un canal paralelo al Gateway, su gasto NUNCA se registró en
 * `v3.ai_usage_log`: era plata invisible.
 *
 * Ahora va por el Gateway igual que todo lo demás, con una sola credencial y
 * con el gasto contabilizado.
 *
 * La firma se mantiene idéntica a propósito para no tocar los 12 call sites.
 */
export async function generateGeminiContent(
  prompt: string,
  model = "gemini-2.5-flash",
  temperature = 0.7,
  thinkingBudget?: number,
  /** Atribución opcional del costo. Sin esto igual se registra, como 'other'. */
  tracking?: {
    feature?: UsageFeature
    workspaceId?: string | null
    userId?: string | null
    companyId?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<string> {
  const gatewayModel = toGatewayModel(model)

  // `thinkingBudget` es LOAD-BEARING, no un detalle de performance: los modelos
  // 2.5 "razonan" antes de responder y ese razonamiento consume el presupuesto
  // de salida. Medido en el benchmark: con thinking activo, gemini-2.5-flash
  // gastó 3.800-5.700 tokens pensando y cortó el JSON a mitad en 3 de 4 casos.
  // Los call sites que piden JSON pasan `thinkingBudget: 0` justamente para
  // evitarlo, así que hay que respetarlo. Verificado que el Gateway lo honra:
  // con budget 0 los tokens de razonamiento bajan de 191 a 0 y la latencia se
  // parte al medio.
  const isThinkingModel = gatewayModel.includes("2.5") || gatewayModel.includes("3.5")
  const providerOptions =
    isThinkingModel && thinkingBudget !== undefined
      ? { google: { thinkingConfig: { thinkingBudget } } }
      : undefined

  try {
    const { text, usage } = await generateText({
      model: gatewayModel,
      prompt,
      temperature,
      ...(providerOptions ? { providerOptions } : {}),
    })

    // Fire-and-forget: `logAiUsage` nunca lanza y no queremos sumar latencia.
    void logAiUsage({
      workspaceId: tracking?.workspaceId ?? null,
      userId: tracking?.userId ?? null,
      companyId: tracking?.companyId ?? null,
      feature: tracking?.feature ?? "other",
      model: gatewayModel,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      metadata: {
        source: "generateGeminiContent",
        modelo_pedido: model,
        thinking_budget: thinkingBudget ?? null,
        ...(tracking?.metadata ?? {}),
      },
    })

    return text || ""
  } catch (error: any) {
    const message = String(error?.message ?? error)

    // Modelo inexistente: error de configuración, no transitorio. Se avisa con
    // un mensaje que nombra el modelo para que la próxima baja del catálogo se
    // detecte al instante y no después de semanas en silencio.
    if (message.includes("not found") || message.includes("not_found") || message.includes("NOT_FOUND")) {
      const vigentes = [...MODELOS_VIGENTES].join(", ")
      const explicativo =
        `[ai-service] El modelo "${gatewayModel}" (pedido como "${model}") no existe en el AI Gateway. ` +
        `Vigentes al última revisión: ${vigentes}. Actualizar MODEL_ALIASES en lib/ai-service.ts. ` +
        `Error original: ${message.slice(0, 200)}`
      console.error(`[v0]${explicativo}`)
      throw new Error(explicativo)
    }

    console.error(`[v0] Error en generateGeminiContent (${gatewayModel}):`, message)
    throw error
  }
}

/**
 * Genera contenido con Perplexity (búsqueda web con citas).
 *
 * Sigue pegándole directo a `api.perplexity.ai` a propósito: Perplexity no es un
 * proveedor zero-config del AI Gateway y lo que se usa acá es su producto de
 * búsqueda, no una llamada LLM común.
 *
 * ⚠️ Este camino NO registra costo en `v3.ai_usage_log` porque el gasto lo
 * factura Perplexity aparte y su respuesta no trae tokens comparables. Es el
 * único canal de IA que queda fuera de la contabilidad, y es deliberado.
 */
export async function generatePerplexityContent(
  prompt: string,
  model = "sonar-pro",
  systemPrompt?: string,
): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY
  if (!apiKey) throw new Error("Perplexity API Key is missing")

  console.log(`[v0] Sending request to Perplexity (${model})...`)

  try {
    const messages: Array<{ role: string; content: string }> = []

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt })
    }
    messages.push({ role: "user", content: prompt })

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[v0] Perplexity API Error (${response.status}):`, errorText)
      throw new Error(`Perplexity API Failed: ${response.status} - ${errorText}`)
    }

    const data = await response.json()

    if (!data.choices || data.choices.length === 0) {
      console.error("[v0] Perplexity returned no choices:", JSON.stringify(data))
      return ""
    }

    return data.choices[0].message.content || ""
  } catch (error: any) {
    console.error("[v0] Network/Parsing Error in generatePerplexityContent:", error)
    throw error
  }
}

export function debugAIConfiguration() {
  // Gemini ya no usa GOOGLE_GENERATIVE_AI_API_KEY: va por el Gateway, que se
  // autentica solo en Vercel (o con AI_GATEWAY_API_KEY fuera de Vercel).
  const gatewayKey = process.env.AI_GATEWAY_API_KEY
  const perplexityKey = process.env.PERPLEXITY_API_KEY

  console.log("[v0] --- AI Configuration Check ---")
  console.log("[v0] Gemini: via AI Gateway")
  console.log("[v0] AI_GATEWAY_API_KEY:", gatewayKey ? "Present" : "ausente (OK dentro de Vercel: usa OIDC)")
  console.log("[v0] Perplexity API Key:", perplexityKey ? "Present" : "MISSING")
  console.log("[v0] ------------------------------")

  return {
    hasGoogle: true,
    hasPerplexity: !!perplexityKey,
  }
}
