import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Webhook callback de Apollo cuando un /people/match con reveal_phone_number=true
 * resuelve de forma asincrona (i.e. Apollo no tenia el telefono cacheado y lo
 * conseguio en background). Apollo POSTea al webhook_url que pasamos en el
 * request original, sin firma estandar — la seguridad la garantizamos con el
 * secret en el path: solo nosotros conocemos /api/webhooks/apollo/{secret}.
 *
 * Body esperado (segun docs de Apollo, schema variable):
 *   {
 *     "person": { "id": "...", "linkedin_url": "...", "phone_numbers": [...] }
 *   }
 *  o bien con los campos al nivel raiz. Probamos ambos.
 *
 * IMPORTANT: SIEMPRE devolver 200 (idempotencia). Apollo reintenta si recibe
 * cualquier error y no queremos duplicar costos.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type ApolloPhoneNumber = {
  raw_number?: string | null
  sanitized_number?: string | null
  type?: string | null
  status?: string | null
}

function extractPhoneInfo(payload: any): {
  apollo_person_id: string | null
  linkedin_url: string | null
  phones: ApolloPhoneNumber[]
} {
  const person = payload?.person ?? payload ?? {}
  const apollo_person_id =
    typeof person.id === "string" && person.id.length > 0 ? person.id : null
  const linkedin_url =
    typeof person.linkedin_url === "string" && person.linkedin_url.length > 0
      ? person.linkedin_url
      : null
  const phones = Array.isArray(person.phone_numbers) ? person.phone_numbers : []
  return { apollo_person_id, linkedin_url, phones }
}

/**
 * Elige el "mejor" telefono disponible. Prioridad:
 *   1. mobile verified
 *   2. mobile unverified
 *   3. work verified
 *   4. cualquier verified
 *   5. el primero
 * Devuelve { value, isMobile } para que el caller decida en que columna lo guarda.
 */
function pickBestPhone(phones: ApolloPhoneNumber[]): { value: string | null; isMobile: boolean } {
  if (phones.length === 0) return { value: null, isMobile: false }

  const score = (p: ApolloPhoneNumber) => {
    let s = 0
    const t = (p.type ?? "").toLowerCase()
    const st = (p.status ?? "").toLowerCase()
    if (t.includes("mobile")) s += 100
    if (t.includes("work")) s += 50
    if (st.includes("verif")) s += 10
    return s
  }

  const sorted = [...phones].sort((a, b) => score(b) - score(a))
  const best = sorted[0]
  const value = best.sanitized_number ?? best.raw_number ?? null
  const isMobile = (best.type ?? "").toLowerCase().includes("mobile")
  return { value: value && value.length > 0 ? value : null, isMobile }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params
  const expected = process.env.APOLLO_WEBHOOK_SECRET

  if (!expected || secret !== expected) {
    console.warn("[v0][apollo-webhook] reject: secret mismatch")
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let payload: any
  try {
    payload = await request.json()
  } catch (err) {
    console.error("[v0][apollo-webhook] invalid JSON:", err)
    // Devolvemos 200 igual: si el body es invalido, reintentar no ayuda.
    return NextResponse.json({ ok: true, ignored: "invalid_json" })
  }

  const { apollo_person_id, linkedin_url, phones } = extractPhoneInfo(payload)
  console.log("[v0][apollo-webhook] received:", {
    apollo_person_id,
    linkedin_url,
    phones_count: phones.length,
  })

  if (!apollo_person_id && !linkedin_url) {
    console.warn("[v0][apollo-webhook] no identifier in payload, ignoring")
    return NextResponse.json({ ok: true, ignored: "no_identifier" })
  }

  const { value: bestPhone, isMobile } = pickBestPhone(phones)
  const supabase = createAdminClient()

  // Match: preferimos apollo_person_id, fallback a linkedin_url.
  // Puede haber N filas (un mismo contacto cacheado para multiples bookmarks).
  let query = supabase.from("user_company_contacts").select("id, mobile_phone, phone")
  if (apollo_person_id) {
    query = query.eq("apollo_person_id", apollo_person_id)
  } else {
    query = query.eq("linkedin_url", linkedin_url!)
  }

  const { data: matches, error: matchError } = await query
  if (matchError) {
    console.error("[v0][apollo-webhook] match query failed:", matchError)
    return NextResponse.json({ ok: true, ignored: "db_error" })
  }

  if (!matches || matches.length === 0) {
    console.warn("[v0][apollo-webhook] no contact matched, ignoring")
    return NextResponse.json({ ok: true, ignored: "no_match" })
  }

  // Si Apollo no encontro telefono, marcamos not_available.
  if (!bestPhone) {
    const ids = matches.map((m) => m.id)
    const { error: updErr } = await supabase
      .from("user_company_contacts")
      .update({ phone_status: "not_available" })
      .in("id", ids)
      .eq("phone_status", "pending")
    if (updErr) {
      console.error("[v0][apollo-webhook] mark not_available failed:", updErr)
    }
    console.log(`[v0][apollo-webhook] marked ${ids.length} contacts as not_available`)
    return NextResponse.json({ ok: true, updated: ids.length, status: "not_available" })
  }

  // Si vino telefono, lo guardamos en mobile_phone (preferido) o phone (fallback).
  // Solo sobreescribimos si el campo esta vacio: respetamos data manual del usuario.
  const updateColumn = isMobile ? "mobile_phone" : "phone"
  const updates = matches
    .filter((m) => {
      const current = (m as any)[updateColumn]
      return !current || current === ""
    })
    .map((m) => m.id)

  if (updates.length === 0) {
    console.log("[v0][apollo-webhook] all matches already had phone, only marking received")
    await supabase
      .from("user_company_contacts")
      .update({ phone_status: "received" })
      .in(
        "id",
        matches.map((m) => m.id),
      )
      .eq("phone_status", "pending")
    return NextResponse.json({ ok: true, updated: 0, status: "received_no_overwrite" })
  }

  const { error: updErr } = await supabase
    .from("user_company_contacts")
    .update({
      [updateColumn]: bestPhone,
      phone_status: "received",
    })
    .in("id", updates)

  if (updErr) {
    console.error("[v0][apollo-webhook] update phone failed:", updErr)
    return NextResponse.json({ ok: true, ignored: "update_error" })
  }

  // Log en apollo_api_calls para tracking de hit rate sync vs async.
  await supabase.from("apollo_api_calls").insert({
    endpoint: "webhook:phone",
    success: true,
    phone_revealed: true,
    phone_sync: false,
    response_summary: `webhook async: ${updates.length} contacts updated, isMobile=${isMobile}`,
  })

  console.log(
    `[v0][apollo-webhook] updated ${updates.length} contacts (column=${updateColumn})`,
  )
  return NextResponse.json({
    ok: true,
    updated: updates.length,
    status: "received",
    column: updateColumn,
  })
}

// GET de healthcheck: responde 200 si el secret matchea, util para verificar
// desde el dashboard de Apollo si la URL es alcanzable.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params
  const expected = process.env.APOLLO_WEBHOOK_SECRET
  if (!expected || secret !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  return NextResponse.json({ ok: true, hint: "Apollo webhook receiver alive" })
}
