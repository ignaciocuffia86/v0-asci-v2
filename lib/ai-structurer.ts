import { generateText } from "ai"

/**
 * Devuelve los tokens significativos (>=4 chars) del nombre de la empresa,
 * normalizados sin tildes, en lowercase. Filtra sufijos juridicos comunes
 * para que "Garbarino S.A." -> ["garbarino"], "Tsoft Latam" -> ["tsoft", "latam"].
 */
export function companyNameTokens(name: string): string[] {
  const stopwords = new Set([
    "sa", "sas", "srl", "s.a.", "s.a", "s.r.l", "ltd", "ltda", "limited",
    "inc", "corp", "corporation", "company", "co", "group", "grupo", "holding",
    "sociedad", "anonima", "anonimo", "holdings",
  ])
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !stopwords.has(t))
}

/**
 * Filtra items que NO mencionan el nombre de la empresa en los campos textuales.
 * Atrapa los casos donde el LLM se desvio y publico items donde la empresa
 * solo aparecia tangencialmente en el excerpt fuente.
 */
export function filterRelevantToCompany<T extends Record<string, any>>(
  items: T[],
  companyName: string,
  textFields: (keyof T)[],
): T[] {
  const tokens = companyNameTokens(companyName)
  if (tokens.length === 0) return items
  return items.filter((item) => {
    const haystack = textFields
      .map((f) => String(item[f] ?? ""))
      .join(" ")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
    return tokens.some((t) => haystack.includes(t))
  })
}

/**
 * Structured LLM call via Vercel AI Gateway (zero-config Gemini).
 *
 * Uses the AI Gateway by default which has aggregated quota gestionada por la
 * cuenta de Vercel. Esto evita el rate limit del free tier directo de Google
 * Generative AI API que estaba rompiendo /research/news y /research/implementations.
 *
 * Implementa retry con exponential backoff para errores transitorios (429, 503, 502).
 */
export async function structureWithLLM<T>({
  systemPrompt,
  userPrompt,
  maxOutputTokens = 4000,
  temperature = 0.2,
  maxRetries = 3,
  model = "google/gemini-2.0-flash",
  context = "llm",
}: {
  systemPrompt: string
  userPrompt: string
  maxOutputTokens?: number
  temperature?: number
  maxRetries?: number
  model?: string
  /** Etiqueta para identificar la llamada en los logs (ej: "news", "impl", "docs"). */
  context?: string
}): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { text } = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        temperature,
        // AI SDK v5+: el parametro es maxOutputTokens (antes maxTokens).
        maxOutputTokens,
        providerOptions: {
          google: {
            // Gemini admite forzar JSON via responseMimeType.
            // AI Gateway respeta providerOptions.
            responseMimeType: "application/json",
          },
        },
      })

      const cleaned = stripMarkdownFences(text)

      try {
        return JSON.parse(cleaned) as T
      } catch (parseErr) {
        // El modelo devolvio algo invalido. Loguear y reintentar (a veces Gemini
        // tira texto fuera del JSON cuando el contexto es muy grande).
        console.error(
          `[v0][ai-structurer][${context}] JSON parse failed (attempt ${attempt}/${maxRetries}). Raw (500):`,
          cleaned.slice(0, 500),
        )
        if (attempt < maxRetries) {
          await sleep(backoffMs(attempt))
          continue
        }
        throw parseErr
      }
    } catch (err) {
      lastError = err
      const message = String((err as Error)?.message ?? err)
      const isRateLimit =
        message.includes("429") ||
        message.includes("Too Many Requests") ||
        message.includes("Resource exhausted") ||
        message.includes("rate limit") ||
        message.includes("RATE_LIMIT")
      const isTransient =
        isRateLimit ||
        message.includes("503") ||
        message.includes("502") ||
        message.includes("504") ||
        message.includes("ECONNRESET") ||
        message.includes("ETIMEDOUT") ||
        message.includes("fetch failed")

      if (attempt < maxRetries && isTransient) {
        const wait = backoffMs(attempt)
        console.log(
          `[v0][ai-structurer][${context}] Attempt ${attempt}/${maxRetries} failed (${isRateLimit ? "rate-limit" : "transient"}). Retrying in ${wait}ms. Error: ${message.slice(0, 200)}`,
        )
        await sleep(wait)
        continue
      }
      throw err
    }
  }

  throw lastError ?? new Error(`structureWithLLM: exhausted retries for ${context}`)
}

function stripMarkdownFences(raw: string): string {
  let s = raw.trim()
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
  }
  return s
}

function backoffMs(attempt: number): number {
  // Exponential backoff con jitter: 1s, 2s, 4s (+/- 500ms)
  return Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 500)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
