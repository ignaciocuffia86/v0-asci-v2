import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logApolloCall } from "@/lib/apollo/logger"
import { receivePhoneForV3 } from "@/lib/v3/services/contact-phone-inbox"

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

/**
 * Apollo no documenta un schema unico para el webhook callback. Variantes
 * observadas en la API:
 *   1) { person: { id, linkedin_url, phone_numbers: [...] } }   <- /people/match
 *   2) { people: [{ id, linkedin_url, phone_numbers: [...] }] } <- bulk match
 *   3) { id, linkedin_url, phone_numbers: [...] }                <- root level
 * Probamos las 3.
 */
function extractPhoneInfo(payload: any): {
  apollo_person_id: string | null
  linkedin_url: string | null
  phones: ApolloPhoneNumber[]
} {
  // Si viene como array de people, tomamos el primero (en nuestro flow per-card
  // siempre mandamos 1 contacto, asi que el array tendra 1 elemento).
  const person =
    payload?.person ??
    (Array.isArray(payload?.people) && payload.people.length > 0
      ? payload.people[0]
      : null) ??
    payload ??
    {}
  const apollo_person_id =
    typeof person.id === "string" && person.id.length > 0 ? person.id : null
  const linkedin_url =
    typeof person.linkedin_url === "string" && person.linkedin_url.length > 0
      ? person.linkedin_url
      : null
  // Apollo a veces usa raw_number/sanitized_number, otras veces direct strings,
  // u objetos con type_cd/status_cd (legacy). Normalizamos.
  const rawPhones = Array.isArray(person.phone_numbers) ? person.phone_numbers : []
  const phones: ApolloPhoneNumber[] = rawPhones.map((p: any) => {
    if (typeof p === "string") {
      return { raw_number: p, sanitized_number: p, type: null, status: null }
    }
    return {
      raw_number: p?.raw_number ?? p?.number ?? null,
      sanitized_number: p?.sanitized_number ?? p?.number ?? p?.raw_number ?? null,
      // type_cd es el formato legacy, type es el actual
      type: p?.type ?? p?.type_cd ?? null,
      status: p?.status ?? p?.status_cd ?? p?.dnc_status ?? null,
    }
  })
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

// Util para no loggear secrets en plano. Solo nos importa la longitud y
// los primeros 6 caracteres para poder comparar entre intentos sin exponer
// el secret completo en la tabla de logs.
function fingerprint(value: string | null | undefined): string {
  if (!value) return "<empty>"
  const str = String(value)
  return `len=${str.length}:prefix=${str.slice(0, 6)}`
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params
  const expected = process.env.APOLLO_WEBHOOK_SECRET
  const secretMatches = !!expected && secret === expected

  // Parseamos el body lo antes posible para poder loggearlo SIEMPRE,
  // incluso cuando el secret no matchea. Antes el handler devolvia 401
  // antes de loggear, dejando un punto ciego cuando Apollo llegaba con
  // un secret distinto (env var rotada, encoding de URL, etc.).
  let payload: any = null
  let parseError: string | null = null
  try {
    payload = await request.json()
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err)
  }

  // Log de arrival INCONDICIONAL — esto se ejecuta SIEMPRE, antes de
  // cualquier validacion. Si Apollo esta llegando con secret invalido,
  // este log lo va a mostrar y vamos a poder diagnosticarlo.
  // Captura headers utiles: user-agent, content-type, signature de Apollo.
  const headerEntries: Record<string, string> = {}
  for (const [k, v] of request.headers.entries()) {
    // Skip headers ruidosos / sensibles
    if (k.startsWith("x-vercel") || k === "cookie" || k === "authorization") continue
    headerEntries[k] = v
  }

  await logApolloCall({
    endpoint: "webhook:arrival",
    userId: null,
    requestBody: { secret_fingerprint: fingerprint(secret) },
    responseBody: payload,
    responseStatus: secretMatches ? 200 : 401,
    latencyMs: 0,
    errorMessage: parseError,
    extraMetadata: {
      secret_matches: secretMatches,
      expected_secret_fingerprint: fingerprint(expected),
      received_secret_fingerprint: fingerprint(secret),
      url_path: new URL(request.url).pathname,
      method: request.method,
      content_type: request.headers.get("content-type"),
      user_agent: request.headers.get("user-agent"),
      headers: headerEntries,
      payload_top_keys: payload && typeof payload === "object" ? Object.keys(payload) : [],
    },
  })

  // Ahora si validamos secret. Si no matchea, devolvemos 401 (ya quedo
  // logueado el intento en webhook:arrival con secret_matches=false).
  if (!secretMatches) {
    console.warn("[v0][apollo-webhook] reject: secret mismatch", {
      expected_fp: fingerprint(expected),
      received_fp: fingerprint(secret),
    })
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  if (parseError) {
    console.error("[v0][apollo-webhook] invalid JSON:", parseError)
    // Devolvemos 200 igual: si el body es invalido, reintentar no ayuda.
    return NextResponse.json({ ok: true, ignored: "invalid_json" })
  }

  const { apollo_person_id, linkedin_url, phones } = extractPhoneInfo(payload)
  console.log("[v0][apollo-webhook] received:", {
    apollo_person_id,
    linkedin_url,
    phones_count: phones.length,
    payload_top_keys: Object.keys(payload ?? {}),
  })

  if (!apollo_person_id && !linkedin_url) {
    console.warn("[v0][apollo-webhook] no identifier in payload, ignoring")
    return NextResponse.json({ ok: true, ignored: "no_identifier" })
  }

  const { value: bestPhone, isMobile } = pickBestPhone(phones)

  // ── El lado v3, ANTES de las tres salidas de v2 ──────────────────────────
  //
  // Va acá arriba y no dentro de cada rama a propósito: abajo hay tres returns
  // distintos —sin teléfono, ya lo tenía, lo escribimos— y meter el camino v3
  // en los tres es la forma segura de que uno quede afuera cuando alguien toque
  // esta función. Lo que v3 hace no depende del resultado de v2: las dos
  // plataformas guardan lo mismo en lugares distintos.
  //
  // Nunca tira. El webhook tiene que devolver 200 igual, porque un reintento de
  // Apollo no recupera el crédito.
  const v3 = await receivePhoneForV3({
    apolloPersonId: apollo_person_id,
    linkedinUrl: linkedin_url,
    phone: bestPhone,
    isMobile,
  })

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
    return NextResponse.json({ ok: true, ignored: "db_error", v3 })
  }

  if (!matches || matches.length === 0) {
    console.warn("[v0][apollo-webhook] no contact matched, ignoring")
    return NextResponse.json({ ok: true, ignored: "no_match", v3 })
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
    return NextResponse.json({ ok: true, updated: ids.length, status: "not_available", v3 })
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
    return NextResponse.json({ ok: true, updated: 0, status: "received_no_overwrite", v3 })
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
    return NextResponse.json({ ok: true, ignored: "update_error", v3 })
  }

  // Log en apollo_api_calls via logger (que conoce el schema real de la
  // tabla). Antes el insert directo fallaba porque usaba columnas inexistentes
  // (success, response_summary), dejando los webhooks sin trazabilidad.
  await logApolloCall({
    endpoint: "webhook:phone",
    userId: null,
    requestBody: { phones_count: phones.length, isMobile },
    responseBody: payload,
    responseStatus: 200,
    latencyMs: 0,
    extraMetadata: {
      apollo_person_id,
      linkedin_url,
      contacts_updated: updates.length,
      column_used: updateColumn,
      // Sin esto, un teléfono que no aterriza en v3 se pierde en silencio: v2
      // devuelve 200 igual y nadie se entera.
      v3,
    },
  })

  console.log(
    `[v0][apollo-webhook] updated ${updates.length} contacts (column=${updateColumn})`,
  )
  return NextResponse.json({
    ok: true,
    updated: updates.length,
    status: "received",
    column: updateColumn,
    v3,
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
