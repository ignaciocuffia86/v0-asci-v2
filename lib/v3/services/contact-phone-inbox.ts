import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { type PhoneStatus } from "@/lib/shared/phone-status"

// ═══════════════════════════════════════════════════════════════════════════
// El camino de vuelta del teléfono, del lado de v3.
//
// El webhook de Apollo llega a `app/api/webhooks/apollo/[secret]` y hasta ahora
// solo sabía escribir en `public.user_company_contacts`, que es la tabla de la
// UI v2. El MCP escribe en `v3.account_contacts`: otra tabla, otro scope. O sea
// que un teléfono pedido desde v3 no tenía dónde aterrizar.
//
// DÓNDE VA CADA COSA, Y POR QUÉ NO ES LO MISMO QUE EN v2
// ------------------------------------------------------
// v2 guarda el teléfono EN la fila del contacto del usuario. v3 no puede: su
// diseño separa la PII del scope, y `account_contacts` solo referencia
// `apollo_cache_id`. Repetir el modelo de v2 duplicaría el mismo número por
// workspace.
//
//   el número          →  public.apollo_contacts_cache (phone / mobile_phone)
//   el estado del pedido →  v3.account_contacts (phone_status)
//
// LAS DOS REGLAS QUE NO SON OBVIAS
// --------------------------------
// 1. El ESTADO solo se toca en filas que están en `pending`.
//    Pedir es por workspace. Si el workspace A pagó el reveal y el workspace B
//    tiene a la misma persona sin haberla pedido, el estado de B sigue siendo
//    `not_requested`: B no pidió nada. Escribirle `received` afirmaría un pedido
//    que no hizo.
//
// 2. `phone_last_verified_at` sí se toca en TODAS las filas que apuntan a esa
//    persona, haya pedido o no.
//    Porque ese campo describe EL DATO, no el pedido: cuándo se verificó por
//    última vez el teléfono de esta persona. B se beneficia del número que pagó
//    A —está en el caché compartido, que es el punto del diseño— y sin la fecha,
//    `get_company_contacts` lo contaría como `never_verified` y `withUsablePhone`
//    daría 0 teniendo el número en la mano.
//
// El webhook NUNCA puede fallar por esto: Apollo reintenta ante cualquier error
// y un reintento no recupera el crédito. Todo acá adentro atrapa y reporta.
// ═══════════════════════════════════════════════════════════════════════════

export type PhoneInboxInput = {
  /** Identificador principal. Es la columna que comparten las dos plataformas. */
  apolloPersonId: string | null
  /** Respaldo cuando Apollo no manda el id. */
  linkedinUrl: string | null
  /** El número elegido, ya normalizado. `null` = Apollo no entregó ninguno. */
  phone: string | null
  isMobile: boolean
}

export type PhoneInboxResult = {
  /** Filas de `apollo_contacts_cache` en las que se escribió el número. */
  cacheRowsWritten: number
  /** Filas de `v3.account_contacts` cuyo estado pasó de `pending` a terminal. */
  statusRowsUpdated: number
  /** Filas a las que se les refrescó la fecha de verificación. */
  verifiedRowsTouched: number
  status: PhoneStatus
  /** Por qué no se hizo nada, cuando no se hizo nada. */
  skipped: string | null
  /** El error, si lo hubo. El webhook igual devuelve 200. */
  error: string | null
}

const EMPTY = (skipped: string, status: PhoneStatus): PhoneInboxResult => ({
  cacheRowsWritten: 0,
  statusRowsUpdated: 0,
  verifiedRowsTouched: 0,
  status,
  skipped,
  error: null,
})

/**
 * Aterriza un teléfono que llegó por webhook en el lado v3.
 *
 * Devuelve siempre; nunca tira. El resultado va al log del webhook para que un
 * teléfono que no aterrizó se pueda ver, en vez de perderse en silencio.
 */
export async function receivePhoneForV3(input: PhoneInboxInput): Promise<PhoneInboxResult> {
  const status: PhoneStatus = input.phone ? "received" : "not_available"

  if (!input.apolloPersonId && !input.linkedinUrl) {
    return EMPTY("sin identificador: no hay por dónde matchear", status)
  }

  try {
    const admin = createAdminClient()
    const nowIso = new Date().toISOString()

    // ── 1) El número, al caché compartido ────────────────────────────────
    //
    // Solo si la columna está vacía. Es la misma regla que ya aplica v2: un
    // número cargado a mano vale más que uno que vuelve a llegar de Apollo, y
    // pisarlo es una pérdida silenciosa.
    let cacheRowsWritten = 0
    const column = input.isMobile ? "mobile_phone" : "phone"

    if (input.phone) {
      let cacheQuery = admin.from("apollo_contacts_cache").select("id, phone, mobile_phone")
      cacheQuery = input.apolloPersonId
        ? cacheQuery.eq("apollo_id", input.apolloPersonId)
        : cacheQuery.eq("linkedin_url", input.linkedinUrl as string)

      const { data: cacheRows, error: cacheReadError } = await cacheQuery
      if (cacheReadError) throw new Error(`CACHE_READ_FAILED:${cacheReadError.message}`)

      const toFill = (cacheRows ?? [])
        .filter((row) => {
          const current = (row as Record<string, unknown>)[column]
          return !current || String(current).trim() === ""
        })
        .map((row) => row.id as string)

      if (toFill.length) {
        const { error: cacheWriteError } = await admin
          .from("apollo_contacts_cache")
          .update({ [column]: input.phone, updated_at: nowIso })
          .in("id", toFill)
        if (cacheWriteError) throw new Error(`CACHE_WRITE_FAILED:${cacheWriteError.message}`)
        cacheRowsWritten = toFill.length
      }
    }

    // ── 2) El estado, solo donde había un pedido abierto ─────────────────
    //
    // `account_contacts` no tiene `linkedin_url`: se matchea por
    // `apollo_person_id` y nada más. Si Apollo no lo mandó, el estado no se
    // puede resolver y se dice, en vez de adivinar a quién le corresponde.
    if (!input.apolloPersonId) {
      return {
        cacheRowsWritten,
        statusRowsUpdated: 0,
        verifiedRowsTouched: 0,
        status,
        skipped: "sin apolloPersonId: el número entró al caché pero ningún estado de v3 se puede resolver",
        error: null,
      }
    }

    const { data: statusRows, error: statusError } = await admin
      .schema("v3")
      .from("account_contacts")
      .update({ phone_status: status, updated_at: nowIso })
      .eq("apollo_person_id", input.apolloPersonId)
      .eq("phone_status", "pending")
      .select("id")
    if (statusError) throw new Error(`STATUS_UPDATE_FAILED:${statusError.message}`)

    // ── 3) La fecha del dato, en todas las que apuntan a esa persona ─────
    let verifiedRowsTouched = 0
    if (input.phone) {
      const { data: verifiedRows, error: verifiedError } = await admin
        .schema("v3")
        .from("account_contacts")
        .update({ phone_last_verified_at: nowIso, updated_at: nowIso })
        .eq("apollo_person_id", input.apolloPersonId)
        .select("id")
      if (verifiedError) throw new Error(`VERIFIED_UPDATE_FAILED:${verifiedError.message}`)
      verifiedRowsTouched = verifiedRows?.length ?? 0
    }

    return {
      cacheRowsWritten,
      statusRowsUpdated: statusRows?.length ?? 0,
      verifiedRowsTouched,
      status,
      skipped: null,
      error: null,
    }
  } catch (error) {
    // El webhook devuelve 200 igual. Un reintento de Apollo no recupera el
    // crédito y sí puede duplicar trabajo; lo que hace falta es que el fallo
    // quede escrito.
    const message = error instanceof Error ? error.message : String(error)
    console.error("[v3][phone-inbox] no se pudo aterrizar el teléfono:", message)
    return {
      cacheRowsWritten: 0,
      statusRowsUpdated: 0,
      verifiedRowsTouched: 0,
      status,
      skipped: null,
      error: message,
    }
  }
}
