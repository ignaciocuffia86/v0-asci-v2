import { describe, expect, it } from "vitest"

import { aliasScore, selectAliases, type AliasCandidate, type AliasStrategy } from "@/lib/v3/services/company-signal-summary"

// Los casos salen del screening de Power BI sobre 61 cuentas chilenas
// (24-ago-2026): "Consorcio" consolidó 15 entidades homónimas, todas con
// confidence 1, e infló las señales de la aseguradora de 6 a 24.
const CONSORCIO: AliasCandidate = { id: "c-seguros", name: "Consorcio", website: "https://www.consorcio.cl", country: "Chile", industry: null }

const HOMONIMOS: AliasCandidate[] = [
  { id: "c-persa", name: "Consorcio Persa", website: null, country: "Chile", industry: null },
  { id: "c-cdz", name: "Consorcio CDZ", website: null, country: "Argentina", industry: null },
  { id: "c-cotienne", name: "Consorcio Cotienne-Arespa", website: null, country: "Argentina", industry: null },
  { id: "c-urubamba", name: "Graña y Montero Consorcio Río Urubamba", website: null, country: "Perú", industry: null },
  // El peor caso: homónimo EXACTO. Ningún umbral de similitud lo frena, porque
  // el nombre es literalmente el mismo. Solo lo frena la guarda de token único.
  { id: "c-exacto", name: "Consorcio", website: "https://consorcio-constructora.com.ar", country: "Argentina", industry: null },
]

const idsOf = (candidate: AliasCandidate, pool: AliasCandidate[], strategy: AliasStrategy) =>
  selectAliases(candidate, pool, strategy).map((alias) => alias.id)

describe("aliasScore", () => {
  it("es simétrico: penaliza los tokens que el candidato agrega", () => {
    // La versión anterior hacía shared/canonical.size = 1/1 = 1.0 para todos estos.
    expect(aliasScore("Consorcio", "Consorcio Cotienne-Arespa", null, null).nameScore).toBeCloseTo(0.5)
    expect(aliasScore("Consorcio", "Consorcio Persa", null, null).nameScore).toBeCloseTo(2 / 3)
    expect(aliasScore("Consorcio", "Graña y Montero Consorcio Río Urubamba", null, null).nameScore).toBeLessThan(0.5)
  })

  it("el dominio en común prueba identidad y satura el score", () => {
    const scored = aliasScore("Consorcio", "Consorcio Seguros Generales", "https://www.consorcio.cl", "http://consorcio.cl/vida")
    expect(scored.domainMatch).toBe(true)
    expect(scored.score).toBe(1)
  })

  it("reconoce la identidad legacy BBVA Argentina / BBVA Banco Francés", () => {
    expect(aliasScore("BBVA Argentina", "BBVA Banco Francés", null, null).nameScore).toBe(1)
  })
})

describe("selectAliases", () => {
  it("strict no consolida homónimos de una canónica de un solo token", () => {
    const ids = idsOf(CONSORCIO, HOMONIMOS, "strict")
    expect(ids).toEqual(["c-seguros"])
  })

  it("strict tampoco consolida un homónimo de nombre EXACTO con otro dominio", () => {
    expect(idsOf(CONSORCIO, [HOMONIMOS[4]], "strict")).not.toContain("c-exacto")
  })

  it("balanced mantiene la guarda de token único: es el bug, no una preferencia", () => {
    expect(idsOf(CONSORCIO, HOMONIMOS, "balanced")).toEqual(["c-seguros"])
  })

  it("broad es la salida explícita para cuentas fragmentadas y sí los trae", () => {
    const ids = idsOf(CONSORCIO, HOMONIMOS, "broad")
    expect(ids).toContain("c-persa")
    expect(ids).toContain("c-exacto")
  })

  it("consolida siempre por dominio en común, aunque el nombre sea de un token", () => {
    const mismaCasa: AliasCandidate = { id: "c-vida", name: "Consorcio Vida", website: "https://consorcio.cl/vida", country: "Chile", industry: null }
    expect(idsOf(CONSORCIO, [mismaCasa], "strict")).toContain("c-vida")
  })

  it("no cruza países cuando los dos son conocidos", () => {
    const ccuChile: AliasCandidate = { id: "ccu-cl", name: "Compañía Cervecerías Unidas", website: null, country: "Chile", industry: null }
    const ccuArg: AliasCandidate = { id: "ccu-ar", name: "Compañía Cervecerías Unidas", website: null, country: "Argentina", industry: null }
    expect(idsOf(ccuChile, [ccuArg], "strict")).toEqual(["ccu-cl"])
  })

  it("país desconocido no fragmenta: pasa el filtro", () => {
    const sinPais: AliasCandidate = { id: "ccu-x", name: "Compañía Cervecerías Unidas", website: null, country: null, industry: null }
    const ccuChile: AliasCandidate = { id: "ccu-cl", name: "Compañía Cervecerías Unidas", website: null, country: "Chile", industry: null }
    expect(idsOf(ccuChile, [sinPais], "strict")).toContain("ccu-x")
  })

  it("la entidad pedida va siempre primera y no se puede caer", () => {
    const [primera] = selectAliases(CONSORCIO, HOMONIMOS, "broad")
    expect(primera.id).toBe("c-seguros")
    expect(primera.reason).toBe("entidad pedida")
  })

  it("informa POR QUÉ se consolidó cada entidad", () => {
    const [, ...consolidadas] = selectAliases(CONSORCIO, HOMONIMOS, "broad")
    expect(consolidadas.every((alias) => alias.reason.length > 0)).toBe(true)
  })
})
