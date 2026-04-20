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

const APOLLO_BASE_URL = "https://api.apollo.io/api/v1"

export type ApolloRequestOpts = Omit<ApolloCallLog, "responseStatus" | "latencyMs" | "errorMessage"> & {
  endpoint: ApolloEndpoint
  maxRetries?: number
}

export type ApolloResult<T> =
  | { ok: true; data: T; status: number; latencyMs: number }
  | { ok: false; status: number; error: string; latencyMs: number; retriesUsed: number }

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
      return "/mixed_people/search"
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
    }
  }

  const path = endpointToPath(opts.endpoint)
  const url = `${APOLLO_BASE_URL}${path}`
  const method = opts.method ?? "POST"
  const maxRetries = opts.maxRetries ?? 3

  let attempt = 0
  let lastStatus = 0
  let lastError = ""
  const start = Date.now()

  while (attempt < maxRetries) {
    attempt++
    const attemptStart = Date.now()
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": apiKey,
        },
        body: method === "POST" ? JSON.stringify(opts.requestBody) : undefined,
      })

      const latencyMs = Date.now() - attemptStart
      lastStatus = res.status

      if (res.ok) {
        const data = (await res.json()) as T
        const totalLatency = Date.now() - start

        // Log success
        await logApolloCall({
          endpoint: opts.endpoint,
          userId: opts.userId,
          bookmarkId: opts.bookmarkId,
          companyId: opts.companyId,
          requestBody: opts.requestBody,
          responseStatus: res.status,
          responseCount: opts.responseCount,
          totalEntries: opts.totalEntries,
          latencyMs: totalLatency,
          queryHash: opts.queryHash,
          creditsEstimated: opts.creditsEstimated,
          extraMetadata: { ...(opts.extraMetadata ?? {}), attempts: attempt },
        })

        return { ok: true, data, status: res.status, latencyMs: totalLatency }
      }

      const body = await res.text()
      lastError = body.slice(0, 500)

      if (!isRetryable(res.status)) {
        break
      }

      // Backoff 500ms, 1.5s, 3.5s
      const delay = 500 * Math.pow(3, attempt - 1)
      await sleep(delay)
    } catch (err) {
      lastStatus = 0
      lastError = err instanceof Error ? err.message : String(err)
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
    latencyMs: totalLatency,
    errorMessage: lastError,
    queryHash: opts.queryHash,
    extraMetadata: { ...(opts.extraMetadata ?? {}), attempts: attempt },
  })

  return {
    ok: false,
    status: lastStatus,
    error: lastError || `Apollo respondió ${lastStatus}`,
    latencyMs: totalLatency,
    retriesUsed: attempt,
  }
}
