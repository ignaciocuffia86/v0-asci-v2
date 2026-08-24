import { describe, expect, it } from "vitest"

import { prepareAccounts, MAX_ACCOUNTS_PER_CALL } from "@/lib/v3/services/screen-account-list"

describe("prepareAccounts", () => {
  it("conserva el nombre TAL COMO LO MANDÓ EL CLIENTE", () => {
    // La fila vuelve con este texto para que se pueda cruzar contra la lista
    // original del cliente. Normalizarlo acá rompería ese cruce.
    const [row] = prepareAccounts([{ name: "  CIA PESQUERA CAMANCHACA  " }])
    expect(row.input).toBe("CIA PESQUERA CAMANCHACA")
  })

  it("normaliza el dominio a host pelado", () => {
    const rows = prepareAccounts([
      { name: "A", domain: "https://www.afphabitat.cl/personas" },
      { name: "B", domain: "AFPHabitat.CL" },
    ])
    expect(rows.map((row) => row.domain)).toEqual(["afphabitat.cl", "afphabitat.cl"])
  })

  it("deduplica el mismo nombre escrito con otra caja o espacios", () => {
    const rows = prepareAccounts([{ name: "Consorcio" }, { name: "CONSORCIO" }, { name: " consorcio " }])
    expect(rows).toHaveLength(1)
  })

  it("descarta nombres vacíos en vez de mandarlos a la base", () => {
    expect(prepareAccounts([{ name: "   " }, { name: "" }, { name: "Real" }])).toHaveLength(1)
  })

  it("dominio ausente o vacío queda en null, no en string vacío", () => {
    const rows = prepareAccounts([{ name: "A" }, { name: "B", domain: "  " }])
    expect(rows.every((row) => row.domain === null)).toBe(true)
  })

  it("el tope por llamada es el mismo que el de la RPC", () => {
    // 100, no 200: medido contra las 514.269 empresas reales, 200 nombres difusos
    // superaban el techo de 8 s de PostgREST.
    expect(MAX_ACCOUNTS_PER_CALL).toBe(100)
  })
})
