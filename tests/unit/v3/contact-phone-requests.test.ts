import { describe, expect, it, vi } from "vitest"

// Las dependencias de servidor solo se cargan porque el módulo las importa
// arriba; `decidirPedidos` no las toca. Se doblan para que el test no necesite
// base, red ni variables de entorno.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))
vi.mock("@/lib/apollo/client", () => ({ apolloRequest: vi.fn() }))
vi.mock("@/lib/v3/mcp-usage", () => ({ requirePaidMcp: vi.fn() }))
vi.mock("@/lib/v3/mcp-account-lifecycle", () => ({ requireSavedAccount: vi.fn() }))

import { decidirPedidos } from "@/lib/v3/services/mcp-contact-phones"

// ═══════════════════════════════════════════════════════════════════════════
// A quién se le pide el teléfono — y, sobre todo, a quién no.
//
// Un teléfono cuesta 5 créditos contra 1 del email: cinco veces más caro, y con
// una entrega del 57% medida sobre 141 pedidos reales. Esta función es la que
// decide ese gasto, así que es la que tiene que estar cubierta. El resto de
// `requestContactPhones` es base y red.
// ═══════════════════════════════════════════════════════════════════════════

type Candidato = Parameters<typeof decidirPedidos>[0][number]

const califica = (id: string, extra: Partial<Candidato> = {}): Candidato => ({
  contactId: id,
  apolloPersonId: `apollo-${id}`,
  fullName: `Persona ${id}`,
  title: "CIO",
  email: `${id}@empresa.cl`,
  emailStatus: "verified",
  linkedinUrl: null,
  firstName: "Persona",
  lastName: id,
  hasPhone: false,
  phoneStatus: "not_requested",
  matchedRole: "CIO",
  ...extra,
})

const razonDe = (r: ReturnType<typeof decidirPedidos>, id: string) =>
  r.skipped.find((s) => s.contactId === id)?.reason

describe("decidirPedidos — el criterio del gasto", () => {
  it("pide solo a quien tiene email verificado Y cargo que matchea", () => {
    const r = decidirPedidos(
      [
        califica("ok"),
        califica("sin-email", { emailStatus: null }),
        califica("email-dudoso", { emailStatus: "guessed" }),
        califica("sin-cargo", { matchedRole: null }),
      ],
      50,
    )

    expect(r.pedir.map((c) => c.contactId)).toEqual(["ok"])
    expect(razonDe(r, "sin-email")).toBe("email_no_verificado")
    expect(razonDe(r, "email-dudoso")).toBe("email_no_verificado")
    expect(razonDe(r, "sin-cargo")).toBe("sin_cargo_que_matchea")
  })

  it("no le pide a quien ya tiene el número", () => {
    // El backfill 20260827190000 metió en el caché compartido los 80 teléfonos
    // que v2 ya había pagado. Sin esta guarda se pagarían de nuevo, a 5
    // créditos cada uno: exactamente el error que se cerró para los emails.
    const r = decidirPedidos([califica("ya", { hasPhone: true })], 50)

    expect(r.pedir).toEqual([])
    expect(razonDe(r, "ya")).toBe("ya_tiene_telefono")
  })

  it("no duplica un pedido que sigue en vuelo", () => {
    const r = decidirPedidos([califica("en-curso", { phoneStatus: "pending" })], 50)

    expect(r.pedir).toEqual([])
    expect(razonDe(r, "en-curso")).toBe("pedido_en_curso")
  })

  it("entiende el vocabulario viejo de v3 como pedido en curso", () => {
    // Una fila que sobreviva sin la migración 20260827172000 dice 'processing'.
    // Leerla como desconocida la volvería a pedir, y el primer pedido ya se pagó.
    const r = decidirPedidos([califica("viejo", { phoneStatus: "processing" })], 50)

    expect(razonDe(r, "viejo")).toBe("pedido_en_curso")
  })

  it("un estado terminal vuelve a ser pedible", () => {
    // `not_available` es "Apollo no lo tenía la vez pasada", no "no existe".
    // Volver a pedirlo es una decisión del que lee, no un bloqueo de acá.
    const r = decidirPedidos(
      [califica("sin-suerte", { phoneStatus: "not_available" }), califica("fallado", { phoneStatus: "failed" })],
      50,
    )

    expect(r.pedir.map((c) => c.contactId).sort()).toEqual(["fallado", "sin-suerte"])
    expect(r.skipped).toEqual([])
  })
})

describe("el orden de los descartes responde '¿por qué no se gastó?'", () => {
  it("tener el número gana sobre cualquier motivo de calificación", () => {
    // Si ya tenemos el teléfono, que además el email no esté verificado no le
    // importa a nadie. Informar 'email_no_verificado' mandaría a arreglar un
    // email para conseguir un dato que ya está en la base.
    const r = decidirPedidos(
      [califica("x", { hasPhone: true, emailStatus: null, matchedRole: null, phoneStatus: "pending" })],
      50,
    )

    expect(razonDe(r, "x")).toBe("ya_tiene_telefono")
  })

  it("un pedido en curso gana sobre los motivos de calificación", () => {
    const r = decidirPedidos([califica("y", { phoneStatus: "pending", emailStatus: null, matchedRole: null })], 50)

    expect(razonDe(r, "y")).toBe("pedido_en_curso")
  })

  it("el email va antes que el cargo cuando faltan los dos", () => {
    const r = decidirPedidos([califica("z", { emailStatus: null, matchedRole: null })], 50)

    expect(razonDe(r, "z")).toBe("email_no_verificado")
    expect(r.skipped).toHaveLength(1)
  })
})

describe("el tope se aplica DESPUÉS de filtrar", () => {
  it("no gasta el cupo en contactos que se van a descartar", () => {
    // Aplicar el tope antes: los tres primeros no califican, el cupo de 2 se
    // consume en ellos y no se pide ninguno de los que sí servían.
    const r = decidirPedidos(
      [
        califica("descarte-1", { hasPhone: true }),
        califica("descarte-2", { emailStatus: null }),
        califica("descarte-3", { matchedRole: null }),
        califica("bueno-1"),
        califica("bueno-2"),
        califica("bueno-3"),
      ],
      2,
    )

    expect(r.pedir.map((c) => c.contactId)).toEqual(["bueno-1", "bueno-2"])
    expect(r.sobrantes.map((c) => c.contactId)).toEqual(["bueno-3"])
    expect(r.skipped).toHaveLength(3)
  })

  it("los que quedan fuera del tope NO son descartes: son sobrantes", () => {
    // La diferencia importa para el informe: un sobrante se consigue repitiendo
    // la tool; un descartado, no. Mezclarlos haría creer que no califican.
    const r = decidirPedidos([califica("a"), califica("b")], 1)

    expect(r.sobrantes.map((c) => c.contactId)).toEqual(["b"])
    expect(r.skipped).toEqual([])
  })

  it("sin sobrantes cuando el tope alcanza para todos", () => {
    const r = decidirPedidos([califica("a"), califica("b")], 50)

    expect(r.pedir).toHaveLength(2)
    expect(r.sobrantes).toEqual([])
  })

  it("lista vacía no pide nada", () => {
    const r = decidirPedidos([], 50)

    expect(r.pedir).toEqual([])
    expect(r.sobrantes).toEqual([])
    expect(r.skipped).toEqual([])
  })
})
