/**
 * Webhook de Apollo para datos asincronicos (tipicamente telefonos).
 *
 * Mejoras respecto a la version anterior:
 *  - Match primario por `apollo_id`, fallback a `linkedin_url`.
 *  - Propaga el telefono a TODOS los `user_company_contacts` que matcheen.
 *  - Reemplaza el filtro `.is("mobile_phone", null)` por uno que tambien
 *    captura strings vacios (`""`) que dejaron corridas anteriores.
 *  - Validacion opcional de firma via APOLLO_WEBHOOK_SECRET (si esta seteado).
 *  - Idempotente: dos webhooks con el mismo apollo_id hacen el mismo update.
 *  - Logging en apollo_api_calls para auditoria.
 */

import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase/admin"
import { pickBestPhone, type ApolloPhoneNumber } from "@/lib/apollo/parsers"
import { logApolloCall } from "@/lib/apollo/logger"

function verifySignature(request: Request): boolean {
  const expected = process.env.APOLLO_WEBHOOK_SECRET
  if (!expected) return true // opt-in: si no se configura secret, no validamos
  const provided =
    request.headers.get("x-apollo-signature") || request.headers.get("x-webhook-secret")
  return provided === expected
}

export async function POST(request: Request) {
  const start = Date.now()

  if (!verifySignature(request)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const person = (payload.person || payload) as {
    id?: string
    linkedin_url?: string
    phone_numbers?: ApolloPhoneNumber[]
    sanitized_phone?: string
  }

  if (!person?.id && !person?.linkedin_url) {
    return NextResponse.json({ ok: false, error: "No identifier" }, { status: 400 })
  }

  const mobilePhone =
    pickBestPhone(person.phone_numbers, "mobile") || person.sanitized_phone || null
  const workPhone = pickBestPhone(person.phone_numbers, "work")

  if (!mobilePhone && !workPhone) {
    await logApolloCall({
      endpoint: "webhook:phone",
      userId: null,
      requestBody: person as Record<string, unknown>,
      responseStatus: 204,
      latencyMs: Date.now() - start,
      errorMessage: "No phone data in payload",
      extraMetadata: { apollo_id: person.id || null },
    })
    return NextResponse.json({ ok: true, message: "No phone data to update" })
  }

  const supabase = createServiceRoleClient()
  const phoneUpdate = {
    mobile_phone: mobilePhone,
    phone: workPhone || mobilePhone,
  }
  const cacheUpdate = {
    ...phoneUpdate,
    updated_at: new Date().toISOString(),
  }

  // Resolvemos el linkedin_url "autoritativo" a partir del cache si tenemos apollo_id.
  let linkedinForPropagation: string | null = person.linkedin_url || null

  if (person.id) {
    const { data: cacheRow } = await supabase
      .from("apollo_contacts_cache")
      .select("linkedin_url")
      .eq("apollo_id", person.id)
      .maybeSingle()

    if (cacheRow?.linkedin_url) {
      linkedinForPropagation = cacheRow.linkedin_url
    }

    // Actualizamos el cache por apollo_id (fuente de verdad)
    await supabase.from("apollo_contacts_cache").update(cacheUpdate).eq("apollo_id", person.id)
  } else if (person.linkedin_url) {
    await supabase
      .from("apollo_contacts_cache")
      .update(cacheUpdate)
      .eq("linkedin_url", person.linkedin_url)
  }

  // Propagar a user_company_contacts de todos los usuarios.
  // Captura tanto null como string vacio ("") en mobile_phone.
  let updatedRows = 0
  if (linkedinForPropagation) {
    const { count } = await supabase
      .from("user_company_contacts")
      .update(phoneUpdate)
      .eq("linkedin_url", linkedinForPropagation)
      .or("mobile_phone.is.null,mobile_phone.eq.")
      .select("id", { count: "exact", head: true })

    updatedRows = count || 0
  }

  await logApolloCall({
    endpoint: "webhook:phone",
    userId: null,
    requestBody: person as Record<string, unknown>,
    responseStatus: 200,
    responseCount: updatedRows,
    latencyMs: Date.now() - start,
    extraMetadata: {
      apollo_id: person.id || null,
      linkedin_url: linkedinForPropagation,
      had_mobile: !!mobilePhone,
      had_work: !!workPhone,
    },
  })

  return NextResponse.json({
    ok: true,
    updated: updatedRows,
    message: `Phone data propagated to ${updatedRows} contacts`,
  })
}
