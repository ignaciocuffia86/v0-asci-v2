import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logApolloCall } from "@/lib/apollo/logger"

/**
 * Pollea directamente a Apollo con el request_id del phone_enrichment para
 * obtener el estado del reveal. Esto es un respaldo al webhook (que puede
 * fallar por firewalls, DNS, o downtime).
 *
 * Flujo:
 *  1. Traer prospectos del bookmark con phone_status=pending y apollo_request_id.
 *  2. Para cada uno, hacer GET a Apollo con el request_id.
 *  3. Si Apollo devuelve phone_numbers -> guardar y marcar received.
 *  4. Si Apollo devuelve failed/not_found -> marcar not_available.
 *  5. Si sigue pending -> no hacer nada (el siguiente tick lo intenta otra vez).
 *
 * El endpoint de Apollo no esta publicamente documentado pero viene indicado
 * en el mensaje sincrono del reveal: "Call apollo_people_phone_enrichment_status
 * with this request_id after ~10 seconds."
 *
 * Intentamos varios paths candidatos y usamos el que responda 200 primero.
 */

// GET so it doesnt trigger Next server-action revalidation on the client.
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const bookmarkId = searchParams.get("bookmarkId")
  if (!bookmarkId) return NextResponse.json({ error: "bookmarkId required" }, { status: 400 })

  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) return NextResponse.json({ error: "APOLLO_API_KEY missing" }, { status: 500 })

  const admin = createAdminClient()

  // 1. Traer pending con request_id
  const { data: pending } = await admin
    .from("user_company_contacts")
    .select("id, apollo_request_id, apollo_person_id, user_id, bookmark_id")
    .eq("user_id", user.id)
    .eq("phone_status", "pending")
    .not("apollo_request_id", "is", null)

  if (!pending || pending.length === 0) {
    return NextResponse.json({ polled: 0, resolved: 0, message: "No pending prospects" })
  }

  // Endpoints candidatos para consultar el status (orden de preferencia)
  const endpointCandidates = [
    "https://api.apollo.io/api/v1/people/phone_enrichment_status",
    "https://api.apollo.io/api/v1/people/phone_enrichment/status",
    "https://api.apollo.io/api/v1/phone_enrichment_status",
  ]

  let polled = 0
  let resolved = 0
  const errors: Array<{ id: string; error: string }> = []

  for (const p of pending) {
    polled++
    const startedAt = Date.now()
    let data: Record<string, unknown> | null = null
    let lastStatus = 0
    let lastError: string | null = null
    let winningEndpoint: string | null = null

    for (const endpoint of endpointCandidates) {
      try {
        const url = `${endpoint}?request_id=${encodeURIComponent(p.apollo_request_id as string)}`
        const res = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "Cache-Control": "no-cache",
          },
        })
        lastStatus = res.status
        if (res.ok) {
          data = await res.json()
          winningEndpoint = endpoint
          break
        } else {
          // Log el error-body del endpoint para diagnostico (solo si no es 404)
          if (res.status !== 404) {
            lastError = await res.text().catch(() => `HTTP ${res.status}`)
          }
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }

    const latencyMs = Date.now() - startedAt

    if (!data) {
      // Ningun endpoint funciono — logueamos y seguimos
      await logApolloCall({
        endpoint: "poll:phone_enrichment_status",
        userId: user.id,
        bookmarkId,
        requestBody: { apollo_request_id: p.apollo_request_id },
        responseStatus: lastStatus || 0,
        latencyMs,
        errorMessage: (lastError || "all endpoints failed").slice(0, 500),
        extraMetadata: { prospect_id: p.id, endpoints_tried: endpointCandidates },
      })
      errors.push({ id: p.id, error: `All poll endpoints returned ${lastStatus}` })
      continue
    }

    // 2. Interpretar respuesta
    const status = ((data.status as string) || "").toLowerCase()
    const phoneNumbers = (data.phone_numbers ||
      (data.person as Record<string, unknown> | undefined)?.phone_numbers ||
      []) as Array<{ type?: string; sanitized_number?: string; raw_number?: string }>
    const inlineMobile =
      (data.mobile_phone as string) ||
      ((data.person as Record<string, unknown> | undefined)?.mobile_phone as string) ||
      null
    const mobileFromArr = phoneNumbers.find(
      (n) => n.type === "mobile" || n.type === "Mobile",
    )?.sanitized_number
    const workFromArr = phoneNumbers.find((n) => n.type === "work")?.sanitized_number
    const best = inlineMobile || mobileFromArr || workFromArr || null

    await logApolloCall({
      endpoint: "poll:phone_enrichment_status",
      userId: user.id,
      bookmarkId,
      requestBody: { apollo_request_id: p.apollo_request_id },
      responseStatus: lastStatus,
      responseCount: phoneNumbers.length,
      latencyMs,
      extraMetadata: {
        prospect_id: p.id,
        apollo_person_id: p.apollo_person_id,
        status_from_apollo: status,
        phone_numbers_returned: phoneNumbers.length,
        inline_phone_found: best,
        winning_endpoint: winningEndpoint,
        response_top_keys: Object.keys(data),
      },
    })

    const terminalFail = ["failed", "no_data", "not_found", "unavailable", "error"]
    const success = ["success", "completed", "done", "enriched"]

    if (best) {
      await admin
        .from("user_company_contacts")
        .update({ mobile_phone: best, phone: best, phone_status: "received" })
        .eq("id", p.id)
      resolved++
    } else if (success.includes(status) && !best) {
      // Apollo completo pero no hay telefono
      await admin
        .from("user_company_contacts")
        .update({ phone_status: "not_available" })
        .eq("id", p.id)
      resolved++
    } else if (terminalFail.includes(status)) {
      await admin
        .from("user_company_contacts")
        .update({ phone_status: "not_available" })
        .eq("id", p.id)
      resolved++
    }
    // else: sigue pending, el siguiente tick lo reintenta
  }

  return NextResponse.json({ polled, resolved, errors: errors.length > 0 ? errors : undefined })
}
