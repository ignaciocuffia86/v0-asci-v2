/**
 * Logger de llamadas a Apollo hacia la tabla apollo_api_calls.
 *
 * Firma intencionalmente asincrónica + non-throwing: si el insert falla,
 * logueamos por consola pero NO interrumpimos el flujo de busqueda.
 * Un fallo de observabilidad no debe romper la feature principal.
 */

import { createServiceRoleClient } from "@/lib/supabase/admin"

export type ApolloEndpoint =
  | "organizations/enrich"
  | "mixed_people/search"
  | "people/match"
  | "people/match:phone"
  | "webhook:phone"

export type ApolloCallLog = {
  endpoint: ApolloEndpoint
  userId: string | null
  bookmarkId?: string | null
  companyId?: string | null
  requestBody: Record<string, unknown>
  responseStatus: number
  responseCount?: number
  totalEntries?: number
  latencyMs: number
  errorMessage?: string | null
  queryHash?: string | null
  creditsEstimated?: number
  extraMetadata?: Record<string, unknown>
}

export async function logApolloCall(entry: ApolloCallLog): Promise<void> {
  try {
    const supabase = createServiceRoleClient()
    const { error } = await supabase.from("apollo_api_calls").insert({
      endpoint: entry.endpoint,
      user_id: entry.userId,
      bookmark_id: entry.bookmarkId ?? null,
      company_id: entry.companyId ?? null,
      request_body: entry.requestBody,
      response_status: entry.responseStatus,
      response_count: entry.responseCount ?? null,
      total_entries: entry.totalEntries ?? null,
      latency_ms: entry.latencyMs,
      error_message: entry.errorMessage ?? null,
      query_hash: entry.queryHash ?? null,
      credits_estimated: entry.creditsEstimated ?? 0,
      metadata: entry.extraMetadata ?? {},
    })
    if (error) {
      console.warn("[apollo:logger] failed to persist log:", error.message)
    }
  } catch (err) {
    console.warn("[apollo:logger] unexpected error:", err)
  }
}
