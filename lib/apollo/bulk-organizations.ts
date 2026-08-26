/**
 * Enrichment de organizaciones en lote: POST /organizations/bulk_enrich.
 *
 * Apollo acepta hasta 10 dominios por llamada. Para el catalogo actual
 * (~57.500 dominios unicos sin resolver) eso es la diferencia entre 57.500
 * llamadas y 5.750.
 *
 * CUIDADO CON LOS LIMITES: los endpoints bulk consumen la MISMA cuota que los
 * simples pero cuentan distinto — la documentacion de Apollo indica que el
 * limite de los bulk es ~1/10 del limite del endpoint simple. O sea: agrupar
 * de a 10 no multiplica el throughput por 10, lo empareja. La ganancia real es
 * en latencia total y en no gastar una request por empresa.
 *
 * El orden del array de respuesta se corresponde con el de los dominios
 * enviados, y ese mapeo es lo unico que permite saber que resultado es de que
 * empresa. Por eso nunca se filtran los huecos antes de re-emparejar.
 */

import { apolloRequest } from "./client"
import { normalizeDomain } from "./domain"
import { countEnrichCredits, parseBulkOrganizationResponse } from "./parsers"
import type { ApolloOrganization } from "./parsers"
import { extractRateLimits, type ApolloRateLimits } from "./rate-limits"

/** Tope duro de Apollo. */
export const BULK_MAX_DOMAINS = 10

export type BulkEnrichInput = {
  companyId: string
  /** El website crudo de la fila; se normaliza internamente */
  website: string | null
}

export type BulkEnrichItem = {
  companyId: string
  requestedDomain: string | null
  organization: ApolloOrganization | null
  /** 'found' | 'not_found' | 'skipped' (sin dominio utilizable) */
  status: "found" | "not_found" | "skipped"
}

export type BulkEnrichResult = {
  ok: boolean
  items: BulkEnrichItem[]
  error?: string
  status: number
  latencyMs: number
  rateLimits: ApolloRateLimits
  /** Respuesta cruda, para poder guardar el payload por empresa */
  raw: unknown
}

/**
 * Enriquece hasta 10 empresas de una. Las que no tengan un dominio parseable
 * se devuelven como 'skipped' sin gastar cupo.
 */
export async function bulkEnrichOrganizations(
  inputs: BulkEnrichInput[],
  opts: { userId?: string | null } = {},
): Promise<BulkEnrichResult> {
  if (inputs.length > BULK_MAX_DOMAINS) {
    throw new Error(
      `bulkEnrichOrganizations acepta como maximo ${BULK_MAX_DOMAINS} empresas por llamada, recibio ${inputs.length}`,
    )
  }

  // Separar lo enviable de lo que no tiene dominio, conservando el orden.
  const sendable: Array<{ companyId: string; domain: string }> = []
  const skipped: BulkEnrichItem[] = []
  for (const input of inputs) {
    const normalized = normalizeDomain(input.website)
    if (!normalized) {
      skipped.push({
        companyId: input.companyId,
        requestedDomain: null,
        organization: null,
        status: "skipped",
      })
      continue
    }
    sendable.push({ companyId: input.companyId, domain: normalized.primary })
  }

  if (sendable.length === 0) {
    return {
      ok: true,
      items: skipped,
      status: 0,
      latencyMs: 0,
      rateLimits: extractRateLimits(null),
      raw: null,
    }
  }

  const result = await apolloRequest<unknown>({
    endpoint: "organizations/bulk_enrich",
    method: "POST",
    userId: opts.userId ?? null,
    requestBody: { domains: sendable.map((s) => s.domain) },
    // 1 credito por cuenta que matchee, no por dominio enviado. bulk_size deja
    // los dos numeros anotados para poder reconciliar contra Apollo.
    creditsEstimated: countEnrichCredits,
    extraMetadata: { bulk_size: sendable.length },
  })

  if (!result.ok) {
    return {
      ok: false,
      items: skipped,
      error: result.error,
      status: result.status,
      latencyMs: result.latencyMs,
      rateLimits: result.rateLimits,
      raw: null,
    }
  }

  const parsed = parseBulkOrganizationResponse(result.data)
  const items: BulkEnrichItem[] = sendable.map((sent, i) => {
    const org = parsed[i] ?? null
    return {
      companyId: sent.companyId,
      requestedDomain: sent.domain,
      organization: org,
      status: org ? "found" : "not_found",
    }
  })

  return {
    ok: true,
    items: [...items, ...skipped],
    status: result.status,
    latencyMs: result.latencyMs,
    rateLimits: result.rateLimits,
    raw: result.data,
  }
}

/** Parte una lista en tandas de a 10 (el tope de Apollo). */
export function chunkForBulk<T>(items: T[], size: number = BULK_MAX_DOMAINS): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}
