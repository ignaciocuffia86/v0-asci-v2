import { describe, expect, it } from "vitest"

import { scanBlock } from "@/lib/v3/services/company-signal-summary"

// ═══════════════════════════════════════════════════════════════════════════
// Un panorama parcial que no se declara parcial es un panorama equivocado.
//
// El caso real: Santander Chile tiene 865 señales y la tool leía 100. El payload
// decía `signalsScanned: 100` sin decir de cuántas, así que "IBM Z, SQL Server y
// .NET" se leía como el inventario de la cuenta cuando era el 11,6% de la
// evidencia. Peor: al pedir la cita de cada una volvían con 0 señales, porque la
// muestra de esa llamada era otra.
//
// Lo que este bloque tiene que garantizar es la distinción entre tres estados que
// se parecen y significan cosas distintas: miré todo, miré una parte, y no sé
// cuánto había.
// ═══════════════════════════════════════════════════════════════════════════

describe("scanBlock — qué se puede afirmar con lo que se miró", () => {
  it("parcial: dice el total real y prohíbe leer la ausencia como negativa", () => {
    const scan = scanBlock(2000, 23600)
    expect(scan.complete).toBe(false)
    expect(scan.signalsTotal).toBe(23600)
    expect(scan.note).toContain("2000 de 23600")
    // La frase importa tanto como el número: sin ella, quien lee el panorama
    // concluye "esta cuenta no usa X" desde una muestra.
    expect(scan.note).toContain("NO prueba")
  })

  it("completo: sin aviso, porque no hay nada que advertir", () => {
    const scan = scanBlock(865, 865)
    expect(scan.complete).toBe(true)
    expect(scan.note).toBeNull()
  })

  it("total desconocido es null, NUNCA cero ni `completo`", () => {
    // Si el conteo falla, la tentación es asumir que lo leído es todo. Eso
    // convierte un error de lectura en una afirmación sobre la cuenta.
    const scan = scanBlock(100, null)
    expect(scan.signalsTotal).toBeNull()
    expect(scan.complete).toBeNull()
    expect(scan.note).toBeNull()
  })

  it("una cuenta sin señales está completa, no parcial", () => {
    const scan = scanBlock(0, 0)
    expect(scan.complete).toBe(true)
    expect(scan.note).toBeNull()
  })
})
