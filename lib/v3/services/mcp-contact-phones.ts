import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { apolloRequest } from "@/lib/apollo/client"
import { requirePaidMcp, type McpPrincipal } from "@/lib/v3/mcp-usage"
import { requireSavedAccount } from "@/lib/v3/mcp-account-lifecycle"
import { PHONE_STATUS_MEANING, normalizePhoneStatus } from "@/lib/shared/phone-status"

// ═══════════════════════════════════════════════════════════════════════════
// F3 — pedir teléfonos por MCP.
//
// NO ESPERA, y es una decisión, no una limitación. El reveal de Apollo es
// asíncrono y entrega el ~57% de las veces (80 de 141 pedidos, medido). Una tool
// que espera bloquea la conversación por algo que la mitad de las veces no llega.
// Esta pide, dice qué pidió, y termina. Los resultados se leen por cuenta con
// `get_company_contacts`, que ya devuelve `hasPhone`, `phoneStatus` y frescura.
//
// A QUIÉN SE LE PIDE
// ------------------
// Solo a los que tienen EMAIL VERIFICADO y CARGO QUE MATCHEA. Es el criterio del
// dueño y tiene una lógica de plata: el teléfono cuesta 5 créditos contra 1 del
// email, así que se paga solo por los contactos que ya probaron ser los
// correctos. Pedirlo para todos los contactos de 37 cuentas serían ~185
// personas; con este filtro se paga por los que ibas a llamar igual.
//
// LO QUE NO SE PIDE, Y POR QUÉ
// ----------------------------
//   ya tiene teléfono  → está en el caché compartido. Es la misma regla que ya
//                        rige para el email: no se paga dos veces por el mismo
//                        dato. El backfill 20260827190000 metió ahí los 80 que
//                        v2 había pagado y que el MCP no veía.
//   pedido en curso    → `phone_status = 'pending'`. No es un tope: es no
//                        duplicar un pedido que todavía puede llegar.
//
// El cooldown de 7 días de la UI NO se aplica acá: es un tope administrativo, y
// el perfil admin existe para no tenerlos. Lo que frena es tener el dato, no el
// calendario.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que Apollo cobra por un reveal con waterfall. */
const CREDITS_PER_PHONE = 5

/** Techo por llamada. Mismo criterio que `maxContacts` del enrichment: no es un
 *  tope de plan, es cuántos créditos gasta ESTA llamada. */
const MAX_PHONES_PER_CALL = 50

export type PhoneRequestInput = {
  companyId: string
  /** Tope de esta llamada. Por defecto `MAX_PHONES_PER_CALL`. */
  maxContacts?: number
}

export type SkipReason = "ya_tiene_telefono" | "pedido_en_curso" | "email_no_verificado" | "sin_cargo_que_matchea"

export type PhoneRequestResult = {
  companyId: string
  companyName: string | null
  requested: Array<{ contactId: string; fullName: string | null; title: string | null; status: "pending" | "failed"; message?: string }>
  /** Por qué NO se le pidió a cada uno. Es la mitad del valor de la respuesta. */
  skipped: Array<{ contactId: string; fullName: string | null; reason: SkipReason }>
  /** Créditos comprometidos: 5 por pedido que Apollo aceptó. */
  creditsSpent: number
  /** Contactos que ya tenían el número. A 5 créditos cada uno, esto es lo que NO se gastó. */
  creditsSaved: number
  nextStep: string
  statusMeaning: typeof PHONE_STATUS_MEANING
}

type Candidato = {
  contactId: string
  apolloPersonId: string
  fullName: string | null
  title: string | null
  email: string | null
  emailStatus: string | null
  linkedinUrl: string | null
  firstName: string | null
  lastName: string | null
  hasPhone: boolean
  phoneStatus: string
  matchedRole: string | null
}

export class PhoneRequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = "PhoneRequestError"
  }
}

/**
 * Decide a quién se le pide y a quién no. Función pura y exportada a propósito:
 * es la regla que decide el gasto, y tiene que poder testearse sin base ni red.
 *
 * El ORDEN de los descartes importa para el informe: "ya lo tenemos" y "ya se
 * pidió" van ANTES que los de calificación, porque son los que responden "¿por
 * qué no se gastó?" — que es la pregunta que se hace quien lee. Si un contacto
 * ya tiene el número, que además no tenga el email verificado es irrelevante.
 */
export function decidirPedidos(candidatos: Candidato[], max: number) {
  const pedir: Candidato[] = []
  const skipped: Array<{ contactId: string; fullName: string | null; reason: SkipReason }> = []

  for (const c of candidatos) {
    if (c.hasPhone) {
      skipped.push({ contactId: c.contactId, fullName: c.fullName, reason: "ya_tiene_telefono" })
      continue
    }
    if (normalizePhoneStatus(c.phoneStatus) === "pending") {
      skipped.push({ contactId: c.contactId, fullName: c.fullName, reason: "pedido_en_curso" })
      continue
    }
    if (c.emailStatus !== "verified") {
      skipped.push({ contactId: c.contactId, fullName: c.fullName, reason: "email_no_verificado" })
      continue
    }
    if (!c.matchedRole) {
      skipped.push({ contactId: c.contactId, fullName: c.fullName, reason: "sin_cargo_que_matchea" })
      continue
    }
    pedir.push(c)
  }

  // El tope se aplica AL FINAL, sobre los que califican. Aplicarlo antes
  // gastaría el cupo en contactos que después se descartan.
  return { pedir: pedir.slice(0, max), sobrantes: pedir.slice(max), skipped }
}

export async function requestContactPhones(
  principal: McpPrincipal,
  input: PhoneRequestInput,
): Promise<PhoneRequestResult> {
  await requirePaidMcp(principal, "contacts:write", "server_managed")

  const guard = await requireSavedAccount(principal, input.companyId)
  if (guard.state !== "saved") {
    throw new PhoneRequestError(
      `ACCOUNT_${guard.state.toUpperCase()}`,
      guard.message ?? "La cuenta tiene que estar guardada en el workspace.",
    )
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
  const webhookSecret = process.env.APOLLO_WEBHOOK_SECRET
  if (!siteUrl || !webhookSecret) {
    // Se falla ANTES de gastar. Sin webhook alcanzable, el waterfall de Apollo
    // cobra y el número no vuelve nunca.
    throw new PhoneRequestError(
      "WEBHOOK_NOT_CONFIGURED",
      "Falta NEXT_PUBLIC_SITE_URL o APOLLO_WEBHOOK_SECRET. Sin webhook alcanzable Apollo cobra el reveal y el número no vuelve.",
    )
  }
  const webhookUrl = `${siteUrl.replace(/\/$/, "")}/api/webhooks/apollo/${webhookSecret}`

  const admin = createAdminClient()
  const { data: rows, error } = await admin
    .schema("v3")
    .from("account_contacts")
    .select("id, apollo_person_id, apollo_cache_id, phone_status, matched_role")
    .eq("workspace_id", principal.workspaceId)
    .eq("company_id", input.companyId)
  if (error) throw new PhoneRequestError("CONTACTS_READ_FAILED", error.message)

  const cacheIds = (rows ?? []).map((r) => r.apollo_cache_id).filter(Boolean) as string[]
  const { data: cacheRows } = cacheIds.length
    ? await admin
        .from("apollo_contacts_cache")
        .select("id, apollo_id, full_name, first_name, last_name, title, email, email_status, linkedin_url, phone, mobile_phone")
        .in("id", cacheIds)
    : { data: [] as Array<Record<string, unknown>> }

  const cacheById = new Map((cacheRows ?? []).map((c) => [c.id as string, c]))

  const candidatos: Candidato[] = (rows ?? [])
    .filter((r) => r.apollo_person_id)
    .map((r) => {
      const c = r.apollo_cache_id ? cacheById.get(r.apollo_cache_id) : undefined
      return {
        contactId: r.id as string,
        apolloPersonId: r.apollo_person_id as string,
        fullName: (c?.full_name as string) ?? null,
        title: (c?.title as string) ?? null,
        email: (c?.email as string) ?? null,
        emailStatus: (c?.email_status as string) ?? null,
        linkedinUrl: (c?.linkedin_url as string) ?? null,
        firstName: (c?.first_name as string) ?? null,
        lastName: (c?.last_name as string) ?? null,
        hasPhone: Boolean(c?.phone || c?.mobile_phone),
        phoneStatus: (r.phone_status as string) ?? "not_requested",
        matchedRole: (r.matched_role as string) ?? null,
      }
    })

  const max = Math.min(Math.max(1, input.maxContacts ?? MAX_PHONES_PER_CALL), MAX_PHONES_PER_CALL)
  const { pedir, sobrantes, skipped } = decidirPedidos(candidatos, max)

  const requested: PhoneRequestResult["requested"] = []
  let creditsSpent = 0

  for (const c of pedir) {
    // Todos los identificadores que tengamos: el waterfall matchea mejor contra
    // los data sources de terceros cuantos más le pasemos.
    const queryParams: Record<string, string | number | boolean> = {
      run_waterfall_phone: true,
      webhook_url: webhookUrl,
      id: c.apolloPersonId,
    }
    if (c.email) queryParams.email = c.email
    if (c.linkedinUrl) queryParams.linkedin_url = c.linkedinUrl
    if (c.firstName) queryParams.first_name = c.firstName
    if (c.lastName) queryParams.last_name = c.lastName

    // Marcar `pending` ANTES de llamar, igual que v2: si la llamada sale y el
    // proceso se cae, el estado ya dice que hay un pedido en vuelo y una
    // segunda corrida no lo duplica.
    await admin
      .schema("v3")
      .from("account_contacts")
      .update({ phone_status: "pending", phone_requested_at: new Date().toISOString() })
      .eq("id", c.contactId)

    const result = await apolloRequest<{
      waterfall?: { status?: "accepted" | "failed" | "partial_accepted"; message?: string } | null
      request_id?: string | number
    }>({
      endpoint: "people/match:phone",
      method: "POST",
      requestBody: {},
      queryParams,
      userId: principal.userId,
      companyId: input.companyId,
      creditsEstimated: CREDITS_PER_PHONE,
      extraMetadata: {
        phone_revealed: true,
        waterfall_mode: true,
        v3_contact_id: c.contactId,
        profile: "mcp",
        // Igual que v2: si el webhook no vuelve nunca, lo primero que hay que
        // mirar es a qué URL se le dijo a Apollo que entregara. Un deployment de
        // preview con auth activa se ve exactamente igual que un Apollo mudo.
        webhook_url_sent: webhookUrl,
      },
    })

    const waterfall = result.ok ? (result.data?.waterfall ?? null) : null
    const aceptado = waterfall?.status === "accepted" || waterfall?.status === "partial_accepted"

    if (aceptado) {
      creditsSpent += CREDITS_PER_PHONE
      const requestId = result.ok && result.data?.request_id != null ? String(result.data.request_id) : null
      if (requestId) {
        await admin.schema("v3").from("account_contacts").update({ apollo_request_id: requestId }).eq("id", c.contactId)
      }
      requested.push({ contactId: c.contactId, fullName: c.fullName, title: c.title, status: "pending" })
    } else {
      // No quedó pedido en vuelo: devolver el estado para que no aparezca como
      // pendiente eterno. Un `pending` que nunca fue pedido es peor que un
      // fallo, porque parece que todavía puede llegar.
      await admin
        .schema("v3")
        .from("account_contacts")
        .update({ phone_status: "not_requested", phone_requested_at: null })
        .eq("id", c.contactId)
      const mensaje = !result.ok
        ? `Apollo devolvió ${result.status}: ${result.error.slice(0, 160)}`
        : (waterfall?.message ?? "Apollo no aceptó el waterfall. No se gastó crédito.")
      requested.push({ contactId: c.contactId, fullName: c.fullName, title: c.title, status: "failed", message: mensaje })

      // Si el plan de Apollo no tiene habilitado el waterfall, NINGUNO va a
      // funcionar: seguir el bucle son 49 llamadas más para llegar al mismo
      // error 49 veces. Se corta acá y se dice qué hay que arreglar.
      if (/permission|not have/i.test(mensaje)) {
        throw new PhoneRequestError(
          "WATERFALL_NOT_ENABLED",
          `El plan de Apollo no tiene habilitado Waterfall Enrichment, así que ningún teléfono se puede pedir. Apollo dijo: ${mensaje}`,
        )
      }
    }
  }

  const yaTenian = skipped.filter((s) => s.reason === "ya_tiene_telefono").length

  return {
    companyId: input.companyId,
    companyName: guard.companyName,
    requested,
    skipped,
    creditsSpent,
    creditsSaved: yaTenian * CREDITS_PER_PHONE,
    nextStep:
      `Los teléfonos NO llegan en esta respuesta: Apollo entrega por webhook y tarda minutos. ` +
      `Leelos con get_company_contacts(companyId) — ahí van a aparecer en \`hasPhone\` y \`phoneStatus\`. ` +
      (sobrantes.length
        ? `Quedaron ${sobrantes.length} contacto(s) que califican fuera del tope de esta llamada: repetí la tool para pedirlos. `
        : "") +
      `Entrega histórica medida: 57% de los pedidos terminan con número; el resto Apollo no lo tiene, y eso NO se cobra.`,
    statusMeaning: PHONE_STATUS_MEANING,
  }
}
