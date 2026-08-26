/**
 * Cliente HTTP para la API de Apollo con retries, backoff y logging centralizado.
 *
 * Responsabilidades:
 *  - Hacer fetch contra Apollo con el header X-Api-Key.
 *  - Reintentar 429 / 5xx con exponential backoff (hasta 3 intentos).
 *  - Loggear cada llamada en apollo_api_calls via logApolloCall.
 *  - Devolver un discriminated union { ok, data } | { ok:false, error } para
 *    que los callers no tengan que lidiar con excepciones.
 */

import { logApolloCall, type ApolloCallLog, type ApolloEndpoint } from "./logger"
import { extractRateLimits, type ApolloRateLimits } from "./rate-limits"

const APOLLO_BASE_URL = "https://api.apollo.io/api/v1"

export type ApolloRequestOpts = Omit<ApolloCallLog, "responseStatus" | "latencyMs" | "errorMessage"> & {
  endpoint: ApolloEndpoint
  maxRetries?: number
  // Query params a appender a la URL (URL-encoded). Algunos endpoints de Apollo
  // esperan flags como `reveal_phone_number` y `webhook_url` en la URL, NO en el
  // body. Ver docs oficial de /people/match con phone reveal.
  queryParams?: Record<string, string | number | boolean | undefined | null>
}

export type ApolloResult<T> =
  | { ok: true; data: T; status: number; latencyMs: number; rateLimits: ApolloRateLimits }
  | {
      ok: false
      status: number
      error: string
      latencyMs: number
      retriesUsed: number
      rateLimits: ApolloRateLimits
    }

function getApiKey(): string | null {
  return process.env.APOLLO_API_KEY || null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504
}

/**
 * Mapea endpoint lógico a path real. Permite que los callers pidan
 * "people/match:phone" (variante con reveal) y el cliente use el path correcto.
 */
function endpointToPath(endpoint: ApolloEndpoint): string {
  switch (endpoint) {
    case "organizations/enrich":
      return "/organizations/enrich"
    case "mixed_people/search":
      // Apollo deprecó /mixed_people/search para callers de API.
      // El endpoint oficial actual es /mixed_people/api_search.
      // Mantenemos el nombre lógico "mixed_people/search" internamente para
      // no romper logs/queries históricos.
      return "/mixed_people/api_search"
    case "people/match":
    case "people/match:phone":
      return "/people/match"
    default:
      return `/${endpoint}`
  }
}

export async function apolloRequest<T = unknown>(
  opts: ApolloRequestOpts & { method?: "GET" | "POST" },
): Promise<ApolloResult<T>> {
  const apiKey = getApiKey()
  if (!apiKey) {
    return {
      ok: false,
      status: 0,
      error: "APOLLO_API_KEY no está configurada",
      latencyMs: 0,
      retriesUsed: 0,
      rateLimits: extractRateLimits(null),
    }
  }

  const path = endpointToPath(opts.endpoint)
  // Agregar query params URL-encoded cuando el endpoint los requiere (ej. phone reveal)
  let url = `${APOLLO_BASE_URL}${path}`
  if (opts.queryParams) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.queryParams)) {
      if (v !== undefined && v !== null) {
        qs.set(k, String(v))
      }
    }
    const qsString = qs.toString()
    if (qsString) url += `?${qsString}`
  }
  const method = opts.method ?? "POST"
  const maxRetries = opts.maxRetries ?? 3

  let attempt = 0
  let lastStatus = 0
  let lastError = ""
  const start = Date.now()

  // Algunos endpoints (phone reveal) requieren que TODO vaya como query params
  // y NO se mande body. Si requestBody es undefined o {}, omitimos body para
  // que Apollo no lo malinterprete.
  const hasBody =
    opts.requestBody !== undefined &&
    opts.requestBody !== null &&
    !(typeof opts.requestBody === "object" && Object.keys(opts.requestBody as object).length === 0)

  let lastResponseBody: unknown = null
  let lastRateLimits: ApolloRateLimits = extractRateLimits(null)

  while (attempt < maxRetries) {
    attempt++
    const attemptStart = Date.now()
    try {
      const fetchInit: RequestInit = {
        method,
        headers: {
          "Cache-Control": "no-cache",
          "X-Api-Key": apiKey,
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
        },
      }
      if (method === "POST" && hasBody) {
        fetchInit.body = JSON.stringify(opts.requestBody)
      }
      const res = await fetch(url, fetchInit)

      const latencyMs = Date.now() - attemptStart
      lastStatus = res.status
      // La cuota viaja en los headers de CADA response (incluidas las que
      // fallan). Se lee siempre para que el caller pueda frenar antes del 429.
      lastRateLimits = extractRateLimits(res.headers)

      if (res.ok) {
        const data = (await res.json()) as T
        lastResponseBody = data
        const totalLatency = Date.now() - start

        // Log success con response_body para diagnostico futuro
        await logApolloCall({
          endpoint: opts.endpoint,
          userId: opts.userId,
          bookmarkId: opts.bookmarkId,
          companyId: opts.companyId,
          requestBody: opts.requestBody,
          responseStatus: res.status,
          responseBody: data,
          responseCount: opts.responseCount,
          totalEntries: opts.totalEntries,
          latencyMs: totalLatency,
          queryHash: opts.queryHash,
          creditsEstimated: opts.creditsEstimated,
          extraMetadata: {
            ...(opts.extraMetadata ?? {}),
            attempts: attempt,
            rate_limits: lastRateLimits,
          },
        })

        return { ok: true, data, status: res.status, latencyMs: totalLatency, rateLimits: lastRateLimits }
      }

      const body = await res.text()
      lastError = body.slice(0, 500)
      // Intentamos capturar el response como JSON para diagnostico
      try {
        lastResponseBody = JSON.parse(body)
      } catch {
        lastResponseBody = { raw: body.slice(0, 1000) }
      }

      if (!isRetryable(res.status)) {
        break
      }

      // Backoff 500ms, 1.5s, 4.5s — salvo que Apollo diga explicitamente
      // cuanto esperar (Retry-After en un 429), en cuyo caso mandamos eso.
      const backoff = 500 * Math.pow(3, attempt - 1)
      const retryAfterMs =
        lastRateLimits.retryAfterSeconds !== null ? lastRateLimits.retryAfterSeconds * 1000 : 0
      await sleep(Math.max(backoff, retryAfterMs))
    } catch (err) {
      lastStatus = 0
      lastError = err instanceof Error ? err.message : String(err)
      lastResponseBody = { fetch_error: lastError }
      const delay = 500 * Math.pow(3, attempt - 1)
      await sleep(delay)
    }
  }

  const totalLatency = Date.now() - start
  await logApolloCall({
    endpoint: opts.endpoint,
    userId: opts.userId,
    bookmarkId: opts.bookmarkId,
    companyId: opts.companyId,
    requestBody: opts.requestBody,
    responseStatus: lastStatus,
    responseBody: lastResponseBody,
    latencyMs: totalLatency,
    errorMessage: lastError,
    queryHash: opts.queryHash,
    extraMetadata: {
      ...(opts.extraMetadata ?? {}),
      attempts: attempt,
      rate_limits: lastRateLimits,
    },
  })

  return {
    ok: false,
    status: lastStatus,
    error: lastError || `Apollo respondió ${lastStatus}`,
    latencyMs: totalLatency,
    retriesUsed: attempt,
    rateLimits: lastRateLimits,
  }
}
