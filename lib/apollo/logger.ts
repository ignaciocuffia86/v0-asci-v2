/**
 * Logger de llamadas a Apollo hacia la tabla apollo_api_calls.
 *
 * Firma intencionalmente asincrónica + non-throwing: si el insert falla,
 * logueamos por consola pero NO interrumpimos el flujo de busqueda.
 * Un fallo de observabilidad no debe romper la feature principal.
 */

import { createAdminClient } from "@/lib/supabase/admin"

export type ApolloEndpoint =
  | "organizations/enrich"
  | "mixed_people/search"
  | "people/match"
  | "people/match:phone"
  | "webhook:phone"
  | "webhook:arrival"

export type ApolloCallLog = {
  endpoint: ApolloEndpoint
  userId: string | null
  bookmarkId?: string | null
  companyId?: string | null
  requestBody: Record<string, unknown>
  // responseBody es opcional pero MUY recomendado para diagnostico futuro.
  // Apollo a veces devuelve 200 con bodies extranios (ej. phone reveal sin
  // phone_numbers). Sin guardar el body completo, no se puede entender que
  // paso. Truncamos a 32KB para no inflar la tabla.
  responseBody?: unknown
  responseStatus: number
  responseCount?: number
  totalEntries?: number
  latencyMs: number
  errorMessage?: string | null
  queryHash?: string | null
  creditsEstimated?: number
  extraMetadata?: Record<string, unknown>
}

// Truncado seguro del response_body para no inflar la tabla.
// Si el JSON serializado supera el limite, lo cortamos y agregamos meta.
const MAX_RESPONSE_BYTES = 32 * 1024
function truncateForLog(body: unknown): unknown {
  if (body === null || body === undefined) return null
  try {
    const json = JSON.stringify(body)
    if (json.length <= MAX_RESPONSE_BYTES) return body
    return {
      _truncated: true,
      _original_size: json.length,
      _preview: json.slice(0, MAX_RESPONSE_BYTES),
    }
  } catch {
    return { _truncate_error: "could not stringify" }
  }
}

export async function logApolloCall(entry: ApolloCallLog): Promise<void> {
  // Diagnostico: si falta env var, gritarlo con error (no warn) para que sea
  // visible en produccion. Esta es una de las razones mas frecuentes por las
  // que la tabla apollo_api_calls queda vacia.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[apollo:logger] CRITICAL — SUPABASE_SERVICE_ROLE_KEY no esta configurado. Los logs de Apollo y el webhook NO van a funcionar.",
    )
    return
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error("[apollo:logger] CRITICAL — NEXT_PUBLIC_SUPABASE_URL no esta configurado.")
    return
  }

  try {
    const supabase = createAdminClient()
    // IMPORTANTE: los nombres de columna abajo matchean el schema REAL de
    // apollo_api_calls (ver migracion 109 para verlo completo). En particular:
    //   - `error`                -> NO "error_message"
    //   - `response_total_entries` -> NO "total_entries"
    // El logger previamente usaba los nombres wrong y cada insert fallaba en
    // silencio ("column does not exist"), dejando la tabla 100% vacia.
    const { error } = await supabase.from("apollo_api_calls").insert({
      endpoint: entry.endpoint,
      user_id: entry.userId,
      bookmark_id: entry.bookmarkId ?? null,
      company_id: entry.companyId ?? null,
      request_body: entry.requestBody,
      response_status: entry.responseStatus,
      response_body: truncateForLog(entry.responseBody),
      response_count: entry.responseCount ?? null,
      response_total_entries: entry.totalEntries ?? null,
      latency_ms: entry.latencyMs,
      error: entry.errorMessage ?? null,
      query_hash: entry.queryHash ?? null,
      credits_estimated: entry.creditsEstimated ?? 0,
      metadata: entry.extraMetadata ?? {},
    })
    if (error) {
      // Log con error (no warn) para que sea visible en Vercel logs
      console.error(
        "[apollo:logger] failed to persist log — endpoint:",
        entry.endpoint,
        "code:",
        error.code,
        "message:",
        error.message,
        "hint:",
        error.hint,
      )
    }
  } catch (err) {
    console.error("[apollo:logger] unexpected error:", err)
  }
}
