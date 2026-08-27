import { describe, expect, it } from "vitest"

import {
  PHONE_STATUSES,
  PHONE_STATUS_DEFAULT,
  PHONE_STATUS_MEANING,
  PHONE_STATUS_TERMINAL,
  isPhoneStatus,
  normalizePhoneStatus,
} from "@/lib/shared/phone-status"

// ═══════════════════════════════════════════════════════════════════════════
// Un vocabulario compartido entre dos plataformas necesita UN dueño, y la forma
// de que se note cuando deja de tenerlo es un test.
//
// Los dos daños medidos de tener tres vocabularios:
//   - El webhook de Apollo escribe las palabras de v2. Contra el CHECK viejo de
//     v3 eso era un rechazo, o sea que el teléfono no tenía camino de vuelta.
//   - `pendingPhone` contaba 'processing', que nadie escribía: daba 0 por
//     construcción, no por no haber pendientes.
//
// El primer test de abajo es el que importa: fija que los cuatro valores son
// EXACTAMENTE los del CHECK de public.user_company_contacts. Si alguien agrega un
// quinto de un lado, esto falla antes que la base.
// ═══════════════════════════════════════════════════════════════════════════

describe("el vocabulario es el de v2, sin agregados", () => {
  it("los cuatro valores, exactos", () => {
    // Copiado del CHECK real: user_company_contacts_phone_status_check.
    expect([...PHONE_STATUSES]).toEqual(["not_requested", "pending", "received", "not_available"])
  })

  it("el default es el mismo que el de la columna de v2", () => {
    expect(PHONE_STATUS_DEFAULT).toBe("not_requested")
  })

  it("cada estado tiene su glosa: un estado sin explicar se interpreta", () => {
    // `not_available` es el que más se malinterpreta: no es "esta persona no
    // tiene teléfono", es "Apollo no nos lo dio" — y el crédito se gastó igual.
    for (const status of PHONE_STATUSES) {
      expect(PHONE_STATUS_MEANING[status], status).toBeTruthy()
    }
    expect(PHONE_STATUS_MEANING.not_available).toContain("crédito")
  })

  it("solo `received` y `not_available` cierran; `pending` NO", () => {
    // 16 de 141 pedidos reales quedaron colgados en pending. Contarlo como
    // terminal los haría desaparecer del radar en vez de mostrarlos.
    expect([...PHONE_STATUS_TERMINAL]).toEqual(["received", "not_available"])
    expect(PHONE_STATUS_TERMINAL).not.toContain("pending")
  })
})

describe("normalizePhoneStatus — la red para el vocabulario viejo de v3", () => {
  it("traduce uno a uno lo que aceptaba el CHECK anterior", () => {
    expect(normalizePhoneStatus("processing")).toBe("pending")
    expect(normalizePhoneStatus("available")).toBe("received")
    expect(normalizePhoneStatus("unavailable")).toBe("not_available")
    expect(normalizePhoneStatus("unknown")).toBe("not_requested")
  })

  it("`failed` colapsa en `not_available`, que es lo que significa para quien lee", () => {
    expect(normalizePhoneStatus("failed")).toBe("not_available")
  })

  it("el mapeo es el MISMO que el de la migración", () => {
    // Si esta tabla y el CASE del SQL divergen, una fila vieja termina con un
    // estado distinto según por dónde se la lea. Se escriben juntos a propósito.
    const migracion: Record<string, string> = {
      processing: "pending",
      available: "received",
      unavailable: "not_available",
      failed: "not_available",
      unknown: "not_requested",
    }
    for (const [viejo, nuevo] of Object.entries(migracion)) {
      expect(normalizePhoneStatus(viejo), viejo).toBe(nuevo)
    }
  })

  it("lo que ya es canónico pasa igual", () => {
    for (const status of PHONE_STATUSES) expect(normalizePhoneStatus(status)).toBe(status)
  })

  it("un valor desconocido cae a `not_requested`, nunca a un estado resuelto", () => {
    // El default seguro dice "no sabemos que se haya pedido". Caer en `received`
    // afirmaría que hay un teléfono; caer en `not_available` afirmaría que
    // Apollo ya respondió que no. Las dos son afirmaciones que no tenemos.
    expect(normalizePhoneStatus("cualquier_cosa")).toBe("not_requested")
    expect(normalizePhoneStatus(null)).toBe("not_requested")
    expect(normalizePhoneStatus(undefined)).toBe("not_requested")
    expect(normalizePhoneStatus(42)).toBe("not_requested")
  })

  it("isPhoneStatus no acepta las palabras viejas", () => {
    expect(isPhoneStatus("pending")).toBe(true)
    expect(isPhoneStatus("processing")).toBe(false)
    expect(isPhoneStatus("available")).toBe(false)
  })
})
