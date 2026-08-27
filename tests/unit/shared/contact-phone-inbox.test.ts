import { describe, expect, it, vi, beforeEach } from "vitest"

// vi.hoisted corre antes que los imports, así que el doble ya existe cuando el
// servicio resuelve su import del cliente admin.
const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }))

import { receivePhoneForV3 } from "@/lib/v3/services/contact-phone-inbox"

// ═══════════════════════════════════════════════════════════════════════════
// El camino de vuelta del teléfono tiene dos reglas que NO son obvias, y las dos
// se rompen sin que nada falle:
//
//   1. El ESTADO solo se toca donde hay un pedido abierto (`pending`). Pedir es
//      por workspace. Marcarle `received` a un workspace que no pidió nada
//      afirma un pedido que no existió.
//   2. La FECHA de verificación se toca en todas las filas de esa persona. Ese
//      campo describe el dato, no el pedido — y sin él `get_company_contacts`
//      cuenta el teléfono como `never_verified` teniendo el número en la mano.
//
// Las dos viven en cómo se arma la consulta, así que el test mira los filtros
// que se aplicaron. Es lo único que las distingue de la versión rota.
// ═══════════════════════════════════════════════════════════════════════════

type Llamada = {
  ruta: string
  op: "select" | "update"
  payload: Record<string, unknown> | null
  filtros: Array<[string, unknown]>
}

/** Doble encadenable del cliente. Registra todo y responde lo que le digan. */
function admindoble(responder: (c: Llamada) => { data?: unknown; error?: unknown }) {
  const llamadas: Llamada[] = []

  const builder = (schema: string, table: string) => {
    const call: Llamada = { ruta: `${schema}.${table}`, op: "select", payload: null, filtros: [] }
    const chain: Record<string, unknown> = {
      select(_cols?: string) {
        if (call.op !== "update") call.op = "select"
        return chain
      },
      update(payload: Record<string, unknown>) {
        call.op = "update"
        call.payload = payload
        return chain
      },
      eq(col: string, value: unknown) {
        call.filtros.push([col, value])
        return chain
      },
      in(col: string, value: unknown) {
        call.filtros.push([col, value])
        return chain
      },
      then(resolve: (r: unknown) => void) {
        llamadas.push(call)
        resolve(responder(call))
      },
    }
    return chain
  }

  const client = {
    from: (table: string) => builder("public", table),
    schema: (schema: string) => ({ from: (table: string) => builder(schema, table) }),
  }
  return { client, llamadas }
}

const CACHE = "public.apollo_contacts_cache"
const CONTACTS = "v3.account_contacts"

beforeEach(() => createAdminClient.mockReset())

describe("receivePhoneForV3 — dónde aterriza cada cosa", () => {
  it("el número va al caché COMPARTIDO, nunca a account_contacts", async () => {
    // Es la diferencia con v2, que guarda el número en la fila del usuario. En
    // v3 eso duplicaría el mismo teléfono por cada workspace.
    const { client, llamadas } = admindoble((c) =>
      c.ruta === CACHE && c.op === "select" ? { data: [{ id: "cache-1", phone: null, mobile_phone: null }] } : { data: [] },
    )
    createAdminClient.mockReturnValue(client)

    await receivePhoneForV3({ apolloPersonId: "p1", linkedinUrl: null, phone: "+56 9 1111", isMobile: true })

    const escrituraCache = llamadas.find((c) => c.ruta === CACHE && c.op === "update")
    expect(escrituraCache?.payload).toMatchObject({ mobile_phone: "+56 9 1111" })

    for (const c of llamadas.filter((x) => x.ruta === CONTACTS && x.op === "update")) {
      expect(Object.keys(c.payload ?? {})).not.toContain("phone")
      expect(Object.keys(c.payload ?? {})).not.toContain("mobile_phone")
    }
  })

  it("un número que ya estaba NO se pisa", async () => {
    // Misma regla que v2: un número cargado a mano vale más que uno que vuelve a
    // llegar de Apollo.
    const { client, llamadas } = admindoble((c) =>
      c.ruta === CACHE && c.op === "select"
        ? { data: [{ id: "ya-tiene", phone: null, mobile_phone: "+56 9 9999" }] }
        : { data: [] },
    )
    createAdminClient.mockReturnValue(client)

    const r = await receivePhoneForV3({ apolloPersonId: "p1", linkedinUrl: null, phone: "+56 9 1111", isMobile: true })

    expect(r.cacheRowsWritten).toBe(0)
    expect(llamadas.find((c) => c.ruta === CACHE && c.op === "update")).toBeUndefined()
  })
})

describe("las dos reglas que no son obvias", () => {
  function correr(phone: string | null) {
    const { client, llamadas } = admindoble((c) =>
      c.ruta === CACHE && c.op === "select" ? { data: [{ id: "c1", phone: null, mobile_phone: null }] } : { data: [{ id: "a1" }] },
    )
    createAdminClient.mockReturnValue(client)
    return receivePhoneForV3({ apolloPersonId: "p1", linkedinUrl: null, phone, isMobile: false }).then((r) => ({ r, llamadas }))
  }

  it("el ESTADO se toca SOLO donde el pedido estaba abierto", async () => {
    const { llamadas } = await correr("+56 9 1111")
    const estado = llamadas.find((c) => c.ruta === CONTACTS && c.op === "update" && "phone_status" in (c.payload ?? {}))
    expect(estado).toBeDefined()
    // La guarda: sin este filtro, un workspace que nunca pidió el teléfono
    // aparecería como si lo hubiera pedido y recibido.
    expect(estado!.filtros).toContainEqual(["phone_status", "pending"])
    expect(estado!.filtros).toContainEqual(["apollo_person_id", "p1"])
  })

  it("la FECHA se toca en TODAS las filas de esa persona, sin filtrar por pedido", async () => {
    const { llamadas } = await correr("+56 9 1111")
    const fecha = llamadas.find(
      (c) => c.ruta === CONTACTS && c.op === "update" && "phone_last_verified_at" in (c.payload ?? {}),
    )
    expect(fecha).toBeDefined()
    expect(fecha!.filtros).toContainEqual(["apollo_person_id", "p1"])
    // Justo lo contrario del anterior: acá filtrar por `pending` dejaría el dato
    // sin fecha para todo el que no lo pidió, y `withUsablePhone` daría 0.
    expect(fecha!.filtros.map(([col]) => col)).not.toContain("phone_status")
  })

  it("sin teléfono no se escribe fecha: no hay nada verificado", async () => {
    const { r, llamadas } = await correr(null)
    expect(r.status).toBe("not_available")
    expect(r.verifiedRowsTouched).toBe(0)
    expect(
      llamadas.find((c) => c.ruta === CONTACTS && "phone_last_verified_at" in (c.payload ?? {})),
    ).toBeUndefined()
  })

  it("sin teléfono el estado igual cierra en `not_available`", async () => {
    // El pedido se pagó. Dejarlo en `pending` para siempre es el 11,3% que se
    // cuelga y que nadie vuelve a mirar.
    const { llamadas } = await correr(null)
    const estado = llamadas.find((c) => c.ruta === CONTACTS && "phone_status" in (c.payload ?? {}))
    expect(estado?.payload).toMatchObject({ phone_status: "not_available" })
  })
})

describe("el webhook nunca se cae por esto", () => {
  it("un error de la base vuelve como resultado, no como excepción", async () => {
    // Apollo reintenta ante cualquier error y un reintento no recupera el
    // crédito: el webhook tiene que devolver 200 igual.
    const { client } = admindoble(() => ({ error: { message: "conexión caída" } }))
    createAdminClient.mockReturnValue(client)

    const r = await receivePhoneForV3({ apolloPersonId: "p1", linkedinUrl: null, phone: "+56 9 1111", isMobile: false })
    expect(r.error).toContain("conexión caída")
    expect(r.cacheRowsWritten).toBe(0)
  })

  it("sin ningún identificador no toca la base y lo dice", async () => {
    const { client, llamadas } = admindoble(() => ({ data: [] }))
    createAdminClient.mockReturnValue(client)

    const r = await receivePhoneForV3({ apolloPersonId: null, linkedinUrl: null, phone: "+56 9 1111", isMobile: false })
    expect(llamadas).toHaveLength(0)
    expect(r.skipped).toContain("sin identificador")
  })

  it("con linkedin pero sin apolloPersonId: el número entra al caché y el estado se declara irresoluble", async () => {
    // `account_contacts` no tiene linkedin_url. Adivinar a quién corresponde el
    // estado sería peor que decir que no se pudo.
    const { client, llamadas } = admindoble((c) =>
      c.ruta === CACHE && c.op === "select" ? { data: [{ id: "c1", phone: null, mobile_phone: null }] } : { data: [] },
    )
    createAdminClient.mockReturnValue(client)

    const r = await receivePhoneForV3({
      apolloPersonId: null,
      linkedinUrl: "https://linkedin.com/in/x",
      phone: "+56 9 1111",
      isMobile: false,
    })

    expect(r.cacheRowsWritten).toBe(1)
    expect(r.statusRowsUpdated).toBe(0)
    expect(r.skipped).toContain("sin apolloPersonId")
    expect(llamadas.some((c) => c.ruta === CONTACTS)).toBe(false)
    // Y el caché se matcheó por la URL, que es el único identificador que quedaba.
    expect(llamadas[0].filtros).toContainEqual(["linkedin_url", "https://linkedin.com/in/x"])
  })
})
