// ═══════════════════════════════════════════════════════════════════════════
// El estado del teléfono, con UNA sola palabra por cosa.
//
// EL PROBLEMA QUE RESUELVE
// ------------------------
// Había tres vocabularios para el mismo eje, y ninguno era compatible con otro:
//
//   v2 (`public.user_company_contacts`, webhook)  not_requested · pending · received · not_available
//   v3 (`v3.account_contacts`, CHECK)             unknown · not_requested · processing · available · unavailable · failed
//   el código de v3                               escribía 'not_requested', leía 'processing'
//
// Solo `not_requested` estaba en los dos CHECKs. O sea que el webhook de Apollo
// —que escribe las palabras de v2— no podía tocar `v3.account_contacts` sin que
// el CHECK lo rechazara, y del lado del código el contador de pendientes buscaba
// 'processing', que nadie escribía nunca: `pendingPhone` era 0 por construcción.
//
// Ya nos pasó exactamente esto con `role_origin`: se escribía 'mcp_enrichment',
// el CHECK lo rechazaba y el enrichment entero moría con LINK_CONTACTS_FAILED.
// El CHECK tenía razón las dos veces. La lección no es "arreglar el valor" sino
// que un vocabulario compartido entre dos plataformas necesita UN dueño.
//
// LA DECISIÓN
// -----------
// Gana v2, y no por antigüedad: es el vocabulario que está en producción con
// 5.148 filas y el que habla el webhook de Apollo, que es la pieza que ninguna
// de las dos plataformas controla. Alinear v3 a v2 es un CHECK y un default;
// alinear v2 a v3 sería migrar datos vivos y reescribir el webhook.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Los cuatro estados. No hay un quinto, y la ausencia de `failed` es
 * deliberada: un pedido que se cuelga no es una categoría distinta de "Apollo no
 * lo entregó" desde el lado del que lee. Ver `PHONE_STATUS_MEANING`.
 */
export const PHONE_STATUSES = ["not_requested", "pending", "received", "not_available"] as const

export type PhoneStatus = (typeof PHONE_STATUSES)[number]

/** Lo que hay que escribir cuando todavía no se pidió nada. Igual que el default de v2. */
export const PHONE_STATUS_DEFAULT: PhoneStatus = "not_requested"

/**
 * Qué significa cada uno para quien lee un informe. Va en el payload de las
 * tools: un estado sin glosa se interpreta, y `not_available` se lee como "no
 * tiene teléfono" cuando en realidad es "Apollo no nos lo dio".
 */
export const PHONE_STATUS_MEANING: Record<PhoneStatus, string> = {
  not_requested: "No se pidió. No cuesta nada pedirlo, pero cuesta créditos.",
  pending: "Se pidió y se pagó; Apollo todavía no respondió. Puede no responder nunca.",
  received: "Llegó. El número está en el caché de contactos.",
  not_available: "Apollo no nos dio un número. El crédito se gastó igual.",
}

/** Estados en los que ya no hay nada que esperar. */
export const PHONE_STATUS_TERMINAL: readonly PhoneStatus[] = ["received", "not_available"]

export function isPhoneStatus(value: unknown): value is PhoneStatus {
  return typeof value === "string" && (PHONE_STATUSES as readonly string[]).includes(value)
}

/**
 * Normaliza cualquier valor leído de la base al vocabulario canónico.
 *
 * Traduce las palabras viejas de v3 en vez de descartarlas: la migración que
 * alinea el CHECK convierte las filas existentes, pero esta función es la red
 * para una fila vieja que sobreviva en un backup, en una réplica, o en un
 * entorno que todavía no aplicó la migración. Un estado desconocido cae a
 * `not_requested`, que es el único default seguro: dice "no sabemos que se haya
 * pedido", nunca "ya se resolvió".
 */
export function normalizePhoneStatus(value: unknown): PhoneStatus {
  if (isPhoneStatus(value)) return value
  switch (value) {
    // El vocabulario viejo de v3, uno a uno.
    case "processing":
      return "pending"
    case "available":
      return "received"
    case "unavailable":
      return "not_available"
    // `failed` era "se pidió y se rompió". Desde el lado del que lee, eso es
    // indistinguible de que Apollo no lo entregara, y tener las dos palabras
    // obligaba a explicar la diferencia en cada informe.
    case "failed":
      return "not_available"
    case "unknown":
    default:
      return PHONE_STATUS_DEFAULT
  }
}
