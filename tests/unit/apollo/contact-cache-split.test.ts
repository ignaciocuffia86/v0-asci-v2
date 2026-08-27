import { describe, expect, it, vi, beforeEach } from "vitest"

const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }))

import { splitByContactCache } from "@/lib/apollo/search-cache"

// ═══════════════════════════════════════════════════════════════════════════
// No volver a pagar por gente que ya tenemos.
//
// El caché de BÚSQUEDA acierta solo cuando la consulta entera se repite: mismo
// organization_id, mismos cargos, mismo maxResults. Cambiar un cargo la falla y
// se vuelve a enriquecer —y a pagar— a gente que ya está en la base.
//
// Medido sobre las 4.223 llamadas a `people/match` del historial:
//   923 fueron por una persona ya enriquecida antes
//   921 de esas 923 cayeron DENTRO de la ventana de frescura
//   677 el mismo día
//   solo 2 estaban fuera de los 90 días, o sea refresh legítimo
//
// A 1 crédito cada una, son 921 créditos pagados por datos que ya teníamos.
//
// La regla que fija este test: una fila en el caché significa que YA PAGAMOS —
// `writeSearchCache` solo inserta contactos ya enriquecidos—, así que dentro de
// la ventana no se vuelve a pedir. TENGA EMAIL O NO: que Apollo no lo tenga
// también es una respuesta por la que ya pagamos.
// ═══════════════════════════════════════════════════════════════════════════

type Consulta = { filtros: Array<[string, unknown]> }

function cacheDoble(respuesta: { data?: unknown; error?: unknown }) {
  const consultas: Consulta[] = []
  const chain = (c: Consulta): Record<string, unknown> => ({
    select: () => chain(c),
    in: (col: string, v: unknown) => {
      c.filtros.push([col, v])
      return chain(c)
    },
    gte: (col: string, v: unknown) => {
      c.filtros.push([col, v])
      return chain(c)
    },
    then: (resolve: (r: unknown) => void) => {
      consultas.push(c)
      resolve(respuesta)
    },
  })
  return {
    client: { from: () => chain({ filtros: [] } as Consulta) },
    consultas,
    ultima: () => consultas[consultas.length - 1],
  }
}

const fila = (apolloId: string, extra: Record<string, unknown> = {}) => ({
  apollo_id: apolloId,
  first_name: "Ana",
  last_name: "Pérez",
  full_name: "Ana Pérez",
  email: "ana@empresa.cl",
  email_status: "verified",
  ...extra,
})

beforeEach(() => createAdminClient.mockReset())

describe("splitByContactCache — a quién NO hay que volver a pagarle", () => {
  it("separa los que ya están de los que hay que pedir", async () => {
    const { client } = cacheDoble({ data: [fila("p1"), fila("p3")] })
    createAdminClient.mockReturnValue(client)

    const r = await splitByContactCache(["p1", "p2", "p3", "p4"], 90)

    expect(r.cached.map((c) => c.apolloId).sort()).toEqual(["p1", "p3"])
    expect([...r.missingIds].sort()).toEqual(["p2", "p4"])
  })

  it("una fila SIN email también cuenta como ya pagada", async () => {
    // Que Apollo no tenga el email es una respuesta, y ya la compramos. Volver a
    // preguntar dentro de la misma ventana es pagar dos veces por el mismo "no".
    const { client } = cacheDoble({ data: [fila("p1", { email: null, email_status: null })] })
    createAdminClient.mockReturnValue(client)

    const r = await splitByContactCache(["p1"], 90)
    expect(r.missingIds.size).toBe(0)
    expect(r.cached[0].email).toBeNull()
  })

  it("la frescura se filtra EN la consulta, no en memoria", async () => {
    // Filtrar después de traer todo daría hits con filas de hace dos años.
    const { client, ultima } = cacheDoble({ data: [] })
    createAdminClient.mockReturnValue(client)

    await splitByContactCache(["p1"], 90)

    const gte = ultima().filtros.find(([col]) => col === "updated_at")
    expect(gte).toBeDefined()
    const corte = new Date(String(gte![1])).getTime()
    const esperado = Date.now() - 90 * 86400000
    expect(Math.abs(corte - esperado)).toBeLessThan(60_000)
  })

  it("deduplica los ids pedidos", async () => {
    const { client, ultima } = cacheDoble({ data: [] })
    createAdminClient.mockReturnValue(client)

    await splitByContactCache(["p1", "p1", "p2"], 90)
    expect(ultima().filtros.find(([col]) => col === "apollo_id")?.[1]).toEqual(["p1", "p2"])
  })

  it("lista vacía no toca la base", async () => {
    const { client, consultas } = cacheDoble({ data: [] })
    createAdminClient.mockReturnValue(client)

    const r = await splitByContactCache([], 90)
    expect(consultas).toHaveLength(0)
    expect(r.cached).toEqual([])
  })
})

describe("ante la duda, se paga: nunca se devuelve un contacto vacío como hit", () => {
  it("un error de lectura manda TODO a pedir", async () => {
    // La dirección segura del error es gastar de más. Devolver un hit falso
    // significaría entregarle al usuario un contacto sin datos como si fuera
    // real, y encima sin haber preguntado.
    const { client } = cacheDoble({ error: { message: "timeout" } })
    createAdminClient.mockReturnValue(client)

    const r = await splitByContactCache(["p1", "p2"], 90)
    expect(r.cached).toEqual([])
    expect([...r.missingIds].sort()).toEqual(["p1", "p2"])
  })

  it("un id que el caché no devuelve queda como faltante, no como hit vacío", async () => {
    const { client } = cacheDoble({ data: [fila("p1")] })
    createAdminClient.mockReturnValue(client)

    const r = await splitByContactCache(["p1", "fantasma"], 90)
    expect(r.missingIds.has("fantasma")).toBe(true)
    expect(r.cached).toHaveLength(1)
  })
})
