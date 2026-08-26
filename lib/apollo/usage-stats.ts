/**
 * Consulta de la cuota real de la cuenta: GET /usage_stats/api_usage_stats.
 *
 * Es la unica fuente confiable para dos preguntas que no se pueden contestar
 * leyendo nuestro codigo:
 *   1. Cuanto cuesta REALMENTE cada endpoint (nuestro `creditsEstimated: 0`
 *      para organizations/enrich es una suposicion nuestra, no la contabilidad
 *      de Apollo).
 *   2. Cuales son los limites por minuto/hora/dia de NUESTRO plan.
 *
 * Requiere master API key: con una key comun Apollo devuelve 403. Ese 403 no es
 * un bug, es la respuesta esperada segun el plan de la cuenta.
 */

import { apolloRequest } from "./client"

export type EndpointUsage = {
  endpoint: string
  minute: { limit: number | null; consumed: number | null; left: number | null }
  hourly: { limit: number | null; consumed: number | null; left: number | null }
  daily: { limit: number | null; consumed: number | null; left: number | null }
}

export type ApolloUsageSnapshot = {
  ok: boolean
  /** 403 = la key no es master; el resto de la integracion sigue funcionando */
  status: number
  error?: string
  endpoints: EndpointUsage[]
  raw: unknown
}

function windowOf(node: unknown): { limit: number | null; consumed: number | null; left: number | null } {
  if (!node || typeof node !== "object") return { limit: null, consumed: null, left: null }
  const n = node as Record<string, unknown>
  const pick = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = n[k]
      if (typeof v === "number" && Number.isFinite(v)) return v
    }
    return null
  }
  return {
    limit: pick("limit", "max"),
    consumed: pick("consumed", "used"),
    left: pick("left", "remaining"),
  }
}

/**
 * Aplana el response de Apollo, que viene como
 * `{ "<path>": { "<verbo>": { day: {...}, hour: {...}, minute: {...} } } }`.
 * El shape cambio varias veces, asi que se navega defensivamente y el crudo
 * queda disponible en `raw`.
 */
export function parseUsageStats(resp: unknown): EndpointUsage[] {
  if (!resp || typeof resp !== "object") return []
  const out: EndpointUsage[] = []

  for (const [path, byVerb] of Object.entries(resp as Record<string, unknown>)) {
    if (!byVerb || typeof byVerb !== "object") continue
    for (const [verb, windows] of Object.entries(byVerb as Record<string, unknown>)) {
      if (!windows || typeof windows !== "object") continue
      const w = windows as Record<string, unknown>
      // Solo nos interesan los nodos que realmente tienen ventanas de cuota.
      if (!("day" in w) && !("hour" in w) && !("minute" in w)) continue
      out.push({
        endpoint: `${verb.toUpperCase()} ${path}`,
        minute: windowOf(w.minute),
        hourly: windowOf(w.hour),
        daily: windowOf(w.day),
      })
    }
  }
  return out
}

export async function fetchUsageStats(): Promise<ApolloUsageSnapshot> {
  const result = await apolloRequest<unknown>({
    endpoint: "usage_stats/api_usage_stats",
    method: "GET",
    userId: null,
    requestBody: {},
    creditsEstimated: 0,
  })

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error:
        result.status === 403
          ? "La APOLLO_API_KEY no es una master key (Apollo restringe usage_stats al plan Organization)"
          : result.error,
      endpoints: [],
      raw: null,
    }
  }

  return {
    ok: true,
    status: result.status,
    endpoints: parseUsageStats(result.data),
    raw: result.data,
  }
}

/** Busca el uso de un endpoint puntual dentro del snapshot. */
export function findEndpointUsage(
  snapshot: ApolloUsageSnapshot,
  fragment: string,
): EndpointUsage | null {
  const needle = fragment.toLowerCase()
  return snapshot.endpoints.find((e) => e.endpoint.toLowerCase().includes(needle)) ?? null
}
