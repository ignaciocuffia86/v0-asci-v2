import { generateText } from "ai"
import { logAiUsage, type UsageFeature } from "@/lib/v3/usage"

/**
 * Modelo por defecto para estructurar texto crudo a JSON.
 *
 * ── Por qué este y no otro (medido, no intuido) ──
 * El default anterior era `google/gemini-2.0-flash`, que fue RETIRADO del AI
 * Gateway y devolvía `model_not_found`. Como los 4 call sites no pasan modelo
 * explícito, todos los caminos de estructuración de v2 estaban fallando en
 * silencio (`/research/news`, `/research/public-docs` y las 2 llamadas de
 * `lib/tech-radar.ts`).
 *
 * Benchmark con los prompts y datos reales de producción — ver
 * `scripts/bench-structurer-models.mts` (4 casos: 2 de noticias, 2 de radar):
 *
 *   modelo                  JSON válido   items usables   latencia   costo
 *   2.5-flash-lite            4/4              25           5,8 s    $0,0026
 *   2.5-flash                 1/4               5          21,1 s    $0,0089
 *   3.5-flash-lite            4/4              19           3,4 s    (sin precio)
 *
 * `2.5-flash` es un modelo de RAZONAMIENTO: gastó entre 3.800 y 5.700 tokens
 * "pensando" antes de escribir, se comió el presupuesto de `maxOutputTokens` y
 * cortó el JSON a mitad (finishReason `length`) en 3 de 4 casos. Para pasar
 * texto a JSON no hay nada que razonar, así que ese pensamiento es puro costo y
 * latencia. `2.5-flash-lite` no razona, acierta siempre y es 3,5x más barato.
 *
 * `3.5-flash-lite` también acertó 4/4 y es el más rápido, pero NO está en la
 * tabla de precios de `lib/v3/usage.ts` (caería al fallback 3/15, que
 * sobrereporta el costo). Es el candidato natural para migrar más adelante,
 * agregando primero su precio real.
 *
 * ⚠️ Al cambiar este valor, verificar que el modelo exista en el Gateway y que
 * tenga precio en `MODEL_PRICING` de `lib/v3/usage.ts`.
 */
export const STRUCTURER_DEFAULT_MODEL = "google/gemini-2.5-flash-lite"

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
  model = STRUCTURER_DEFAULT_MODEL,
  context = "llm",
  tracking,
}: {
  systemPrompt: string
  userPrompt: string
  maxOutputTokens?: number
  temperature?: number
  maxRetries?: number
  model?: string
  /** Etiqueta para identificar la llamada en los logs (ej: "news", "impl", "docs"). */
  context?: string
  /**
   * Atribución opcional del costo. Sin esto la llamada igual se registra (con
   * workspace/empresa en null), porque el objetivo es que NINGÚN gasto quede
   * fuera de la contabilidad; los campos solo mejoran a quién se le imputa.
   */
  tracking?: {
    workspaceId?: string | null
    userId?: string | null
    companyId?: string | null
    feature?: UsageFeature
  }
}): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { text, usage } = await generateText({
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

      // Registrar el gasto ACÁ, apenas vuelve el modelo y antes de parsear.
      //
      // Dos razones para no ponerlo después del JSON.parse:
      //  1. Estos tokens ya se pagaron pase lo que pase. Si el parse falla y se
      //     reintenta, el intento fallido igual se facturó — loguear solo el
      //     éxito escondía justamente el costo de los reintentos.
      //  2. Antes esta función no registraba NADA, así que todo el gasto de los
      //     caminos de v2 (/research/news, /research/implementations, public-docs)
      //     era invisible en v3.ai_usage_log.
      //
      // No se hace `await` a propósito: es fire-and-forget para no sumar latencia
      // a la respuesta, y `logAiUsage` nunca lanza.
      void logAiUsage({
        workspaceId: tracking?.workspaceId ?? null,
        userId: tracking?.userId ?? null,
        companyId: tracking?.companyId ?? null,
        feature: tracking?.feature ?? "research-structure",
        model,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        metadata: { context, attempt, source: "ai-structurer" },
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

      // Modelo inexistente o dado de baja en el Gateway.
      //
      // Es un error de CONFIGURACIÓN, no transitorio: reintentar 3 veces con
      // backoff solo agrega latencia y vuelve a fallar igual. Se corta acá con
      // un mensaje que nombra el modelo, porque así se detecta en minutos en vez
      // de semanas: `gemini-2.0-flash` estuvo roto sin que nadie lo notara
      // porque el error se perdía entre los genéricos.
      const isModelNotFound =
        message.includes("model_not_found") ||
        message.includes("Model not found") ||
        message.includes("does not exist") ||
        message.includes("NOT_FOUND")

      if (isModelNotFound) {
        const explicativo =
          `[ai-structurer][${context}] El modelo "${model}" no existe o fue dado de baja en el AI Gateway. ` +
          `Revisar el catálogo vigente y actualizar STRUCTURER_DEFAULT_MODEL en lib/ai-structurer.ts ` +
          `(y agregar su precio en MODEL_PRICING de lib/v3/usage.ts). Error original: ${message.slice(0, 200)}`
        console.error(`[v0]${explicativo}`)
        throw new Error(explicativo)
      }

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
 * Codigos que significan "este host no existe / no se puede alcanzar". Solo
 * estos descartan una fuente: un timeout o un 403 no prueban que no exista.
 */
const DNS_FAILURE_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ERR_INVALID_URL"])

/**
 * Busca un error de resolucion de host en toda la cadena de `cause`.
 *
 * `fetch` envuelve el error real: el objeto de arriba dice "fetch failed" y el
 * codigo aparece en `err.cause.code` (a veces mas abajo todavia). Devuelve el
 * codigo encontrado, o null si el fallo no es concluyente.
 */
function findDnsFailure(err: unknown): string | null {
  let nodo: unknown = err
  // Tope de profundidad por si alguna libreria arma una cadena circular.
  for (let i = 0; i < 5 && nodo; i++) {
    const actual = nodo as { code?: unknown; message?: unknown; cause?: unknown }
    const code = typeof actual.code === "string" ? actual.code : null
    if (code && DNS_FAILURE_CODES.has(code)) return code
    // Fallback por si algun runtime si lo mete en el texto.
    const msg = typeof actual.message === "string" ? actual.message : ""
    const enTexto = [...DNS_FAILURE_CODES, "getaddrinfo"].find((c) => msg.includes(c))
    if (enTexto) return enTexto
    nodo = actual.cause
  }
  return null
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
        // OJO: `undici` (el fetch de Node) NO pone el codigo del error en
        // `err.message`, que dice solamente "fetch failed". El ENOTFOUND real
        // viaja en `err.cause.code` y puede venir anidado varios niveles.
        // Durante mucho tiempo aca se leia solo el message, asi que la condicion
        // NUNCA matcheaba: todo dominio inexistente terminaba en
        // "network_error_assume_alive" y se publicaba como fuente valida.
        const failure = findDnsFailure(err)
        if (failure) {
          return { url, alive: false, reason: `dns_error:${failure}` }
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
