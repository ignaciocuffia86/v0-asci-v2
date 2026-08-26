import { describe, expect, it } from "vitest"

import { sanitizeTitleList } from "@/lib/apollo/title-validator"

// ═══════════════════════════════════════════════════════════════════════════
// Un recorte de cargos que nadie ve es una búsqueda más angosta que la que se
// autorizó.
//
// El caso real: se cotizó un lote con 18 cargos y el plan permite 10. El recorte
// pasaba en `prepare_contact_enrichment`, cuenta por cuenta, con el gasto ya
// autorizado por el batchPlanHash — y no aparecía en ninguna respuesta. Se supo
// por casualidad, mirando el tope del plan.
//
// La distinción que sostiene todo esto: `rejected` son cargos que NO SERVÍAN
// (inválidos); `dropped` son cargos que SÍ SERVÍAN y se perdieron por el tope.
// Mezclarlos esconde justo el que importa.
// ═══════════════════════════════════════════════════════════════════════════

const CARGOS = ["CIO", "IT Director", "Head of ERP", "SAP Program Manager", "CTO"]

describe("sanitizeTitleList — el tope", () => {
  it("dice CUÁLES cargos quedaron afuera, no solo que hubo recorte", () => {
    const r = sanitizeTitleList(CARGOS, { max: 3 })
    expect(r.accepted).toEqual(["CIO", "IT Director", "Head of ERP"])
    expect(r.dropped).toEqual(["SAP Program Manager", "CTO"])
    expect(r.truncated).toBe(true)
  })

  it("recorre la lista ENTERA: cortar el bucle era lo que ocultaba el recorte", () => {
    // Con `break` al llegar al tope no había forma de saber cuántos faltaban.
    const r = sanitizeTitleList(CARGOS, { max: 1 })
    expect(r.accepted).toHaveLength(1)
    expect(r.dropped).toHaveLength(4)
  })

  it("sin recorte, `dropped` viene vacío y `truncated` es false", () => {
    const r = sanitizeTitleList(CARGOS, { max: 10 })
    expect(r.dropped).toEqual([])
    expect(r.truncated).toBe(false)
  })

  it("`max: null` es SIN TOPE — la credencial del perfil admin", () => {
    // Distinto de omitir el parámetro, que aplica el default de 25.
    const muchos = Array.from({ length: 40 }, (_, i) => `Director de Area ${i}`)
    const r = sanitizeTitleList(muchos, { max: null })
    expect(r.accepted).toHaveLength(40)
    expect(r.truncated).toBe(false)
  })
})

describe("sanitizeTitleList — `truncated` mide el recorte REAL", () => {
  it("cargos inválidos NO cuentan como recorte", () => {
    // El bug de conteo: `truncated` era `titles.length > max`, que mira la
    // entrada cruda. Con 5 cargos de los cuales 3 son basura, entran 2 de un
    // tope de 3 —no se recortó nada— y aun así reportaba truncado. Un falso
    // aviso enseña a ignorar los avisos.
    const r = sanitizeTitleList(["CIO", "a", "!!", "  ", "IT Director"], { max: 3 })
    expect(r.rejected.length).toBeGreaterThan(0)
    expect(r.dropped).toEqual([])
    expect(r.truncated).toBe(false)
  })

  it("los duplicados tampoco cuentan como recorte", () => {
    const r = sanitizeTitleList(["CIO", "cio", "CIO ", "IT Director"], { max: 3 })
    expect(r.accepted).toEqual(["CIO", "IT Director"])
    expect(r.dropped).toEqual([])
    expect(r.truncated).toBe(false)
  })
})
