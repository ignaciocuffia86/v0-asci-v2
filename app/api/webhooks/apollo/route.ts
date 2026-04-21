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
import { createAdminClient } from "@/lib/supabase/admin"
import { pickBestPhone, type ApolloPhoneNumber } from "@/lib/apollo/parsers"
import { logApolloCall } from "@/lib/apollo/logger"

function verifySignature(request: Request): boolean {
  const expected = process.env.APOLLO_WEBHOOK_SECRET
  if (!expected) return true // opt-in: si no se configura secret, no validamos
  const provided =
    request.headers.get("x-apollo-signature") || request.headers.get("x-webhook-secret")
  return provided === expected
}

// GET healthcheck para verificar que la URL del webhook es accesible desde fuera.
// Uso: curl https://<tu-dominio>/api/webhooks/apollo
// Apollo hace POST, pero un GET publico nos sirve para confirmar deploy + ruteo.
export async function GET() {
  return NextResponse.json({
    ok: true,
    method: "POST",
    message: "Apollo webhook activo. Apollo debe llamar con POST a esta URL.",
    configured: {
      signature_validation: !!process.env.APOLLO_WEBHOOK_SECRET,
      site_url: process.env.NEXT_PUBLIC_SITE_URL || "(no seteado, usando fallback)",
    },
  })
}

export async function POST(request: Request) {
  const start = Date.now()

  // INSTRUMENTACION CRITICA: loggeamos la llegada INMEDIATA del POST antes de
  // cualquier otro procesamiento. Asi en apollo_api_calls vemos 'webhook:arrival'
  // cada vez que Apollo nos alcanza, aun si despues falla por firma/JSON/shape.
  // Esto nos permite distinguir "Apollo no me esta llamando" vs "Apollo me
  // llama pero algo en el handler falla".
  const clientIp =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  const userAgent = request.headers.get("user-agent") || "unknown"

  // Log de arrival SIN await para no bloquear la respuesta al webhook
  logApolloCall({
    endpoint: "webhook:arrival",
    userId: null,
    requestBody: { headers: { ip: clientIp, user_agent: userAgent } },
    responseStatus: 0,
    latencyMs: 0,
    extraMetadata: {
      client_ip: clientIp,
      user_agent: userAgent,
      arrived_at: new Date().toISOString(),
    },
  }).catch(() => {})

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
    // No hay telefono en el payload: Apollo confirmó que no lo encontró.
    // Marcamos las filas pending -> not_available para que la UI deje de esperar.
    const supabaseNoPhone = createAdminClient()
    let touched = 0
    if (person.id) {
      const { count } = await supabaseNoPhone
        .from("user_company_contacts")
        .update({ phone_status: "not_available" })
        .eq("apollo_person_id", person.id)
        .eq("phone_status", "pending")
        .select("id", { count: "exact", head: true })
      touched += count || 0
    }
    if (person.linkedin_url) {
      const { count } = await supabaseNoPhone
        .from("user_company_contacts")
        .update({ phone_status: "not_available" })
        .eq("linkedin_url", person.linkedin_url)
        .eq("phone_status", "pending")
        .select("id", { count: "exact", head: true })
      touched += count || 0
    }
    await logApolloCall({
      endpoint: "webhook:phone",
      userId: null,
      requestBody: person as Record<string, unknown>,
      responseStatus: 204,
      latencyMs: Date.now() - start,
      errorMessage: "No phone data in payload",
      responseCount: touched,
      extraMetadata: { apollo_id: person.id || null },
    })
    return NextResponse.json({ ok: true, message: "No phone data available", updated: touched })
  }

  const supabase = createAdminClient()
  const phoneUpdate = {
    mobile_phone: mobilePhone,
    phone: workPhone || mobilePhone,
    phone_status: "received" as const,
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
  // Ahora usamos phone_status como indicador: actualizamos todos los que están
  // pending o not_requested, sin importar si mobile_phone es null o "".
  // Preferimos match por apollo_person_id (key fuerte), fallback a linkedin_url.
  let updatedRows = 0
  if (person.id) {
    const { count } = await supabase
      .from("user_company_contacts")
      .update(phoneUpdate)
      .eq("apollo_person_id", person.id)
      .select("id", { count: "exact", head: true })

    updatedRows += count || 0
  }

  if (linkedinForPropagation) {
    const { count } = await supabase
      .from("user_company_contacts")
      .update(phoneUpdate)
      .eq("linkedin_url", linkedinForPropagation)
      .is("apollo_person_id", null) // sólo los que no matchearon por apollo_person_id
      .select("id", { count: "exact", head: true })

    updatedRows += count || 0
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
