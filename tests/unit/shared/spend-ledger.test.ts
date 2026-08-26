import { describe, expect, it } from "vitest"

import { normalizeCostUsd } from "@/lib/v3/services/spend-ledger"

// ═══════════════════════════════════════════════════════════════════════════
// La misma regla que aplica el resumen al LEER tiene que aplicarse al ESCRIBIR.
//
// Si el ledger acepta un NaN, el daño no queda contenido en la fila: cualquier
// `sum()` que la toque devuelve NaN, y con ella se pierde también el costo de IA
// y el de Apollo del mismo informe. Un null se muestra como "no lo sabemos" y no
// contamina nada.
// ═══════════════════════════════════════════════════════════════════════════

describe("normalizeCostUsd", () => {
  it("un costo real pasa tal cual", () => {
    // El valor medido de una corrida verificada contra la API de Apify.
    expect(normalizeCostUsd(0.01425110013586978)).toBe(0.01425110013586978)
  })

  it("cero es un costo válido: significa que no gastó", () => {
    // Distinto de null. Un run que no consumió nada no es un run sin medir.
    expect(normalizeCostUsd(0)).toBe(0)
  })

  it("lo que no es un número finito es null, NUNCA cero", () => {
    expect(normalizeCostUsd(undefined)).toBeNull()
    expect(normalizeCostUsd(null)).toBeNull()
    expect(normalizeCostUsd(Number.NaN)).toBeNull()
    expect(normalizeCostUsd(Number.POSITIVE_INFINITY)).toBeNull()
    // Un string numérico tampoco: entra a una columna numeric y se sumaría mal.
    expect(normalizeCostUsd("0.01")).toBeNull()
  })

  it("un costo negativo es null: no existe una corrida que devuelva plata", () => {
    expect(normalizeCostUsd(-0.5)).toBeNull()
  })
})
