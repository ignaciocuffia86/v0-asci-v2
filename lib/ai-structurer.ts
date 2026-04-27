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

/**
 * Verifica liveness de una lista de URLs en paralelo (HEAD request con timeout).
 * Devuelve un Set con las URLs que respondieron < 400 (o 405 Method Not Allowed,
 * porque algunos sitios bloquean HEAD pero la URL si existe).
 *
 * Esto descarta URLs muertas (404, 410, DNS errors) que Parallel a veces tiene
 * indexadas pero que ya no existen, evitando publicar items con links rotos.
 *
 * NOTA: si el HEAD falla por motivos no concluyentes (timeout, 403, network),
 * SE CONSIDERA VALIDA por defecto para no descartar fuentes legitimas que solo
 * bloquean bots. Solo descartamos en errores claros de "el recurso no existe".
 */
export async function checkUrlsAlive(
  urls: string[],
  { timeoutMs = 3500, context = "urls" }: { timeoutMs?: number; context?: string } = {},
): Promise<Set<string>> {
  const unique = Array.from(new Set(urls))
  const results = await Promise.all(
    unique.map(async (url) => {
      // Sanity: si la URL es invalida, descartar de una.
      try {
        new URL(url)
      } catch {
        return { url, alive: false, reason: "invalid_url" }
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: controller.signal,
          // Identificarse como navegador para evitar bloqueos baratos
          headers: {
            "user-agent":
              "Mozilla/5.0 (compatible; v0-link-validator/1.0; +https://vercel.com)",
          },
        })
        clearTimeout(timer)

        // 4xx claros de "no existe" -> descartar.
        if (res.status === 404 || res.status === 410) {
          return { url, alive: false, reason: `status_${res.status}` }
        }
        // 405 (HEAD no soportado) o cualquier otro -> aceptar (la URL existe, solo no responde a HEAD)
        return { url, alive: true, reason: `status_${res.status}` }
      } catch (err) {
        clearTimeout(timer)
        const msg = String((err as Error)?.message ?? err)
        // DNS no resuelve -> descartar.
        if (
          msg.includes("ENOTFOUND") ||
          msg.includes("getaddrinfo") ||
          msg.includes("EAI_AGAIN")
        ) {
          return { url, alive: false, reason: "dns_error" }
        }
        // Timeout / network reset -> aceptar por defecto (no podemos saber).
        return { url, alive: true, reason: "network_error_assume_alive" }
      }
    }),
  )

  const dead = results.filter((r) => !r.alive)
  if (dead.length > 0) {
    console.log(
      `[v0][${context}][url-check] dead ${dead.length}/${results.length}: ${dead
        .map((d) => `${d.reason}=${d.url}`)
        .join(" | ")}`,
    )
  }

  return new Set(results.filter((r) => r.alive).map((r) => r.url))
}
