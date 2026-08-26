import { describe, expect, it } from "vitest"

import {
  apifyNote,
  defaultPeriodStart,
  sumAi,
  sumApollo,
  sumApify,
  totalUsd,
  type ApifyCost,
  type CostBreakdown,
} from "@/lib/v3/services/mcp-cost-summary"

// ═══════════════════════════════════════════════════════════════════════════
// Lo que se prueba acá es UNA idea: que un número que no tenemos no se
// convierta en cero por el camino.
//
// Es el error que este módulo existe para no cometer. Un informe que reporta
// "costó US$ 3" cuando en realidad son 3 más lo que gastó Apify es peor que uno
// que no reporta nada: el primero se usa para decidir un precio.
// ═══════════════════════════════════════════════════════════════════════════

describe("sumAi", () => {
  it("suma costo y tokens, y cuenta las llamadas", () => {
    const result = sumAi([
      { cost_usd: 0.04, input_tokens: 1000, output_tokens: 200 },
      { cost_usd: "0.06", input_tokens: 500, output_tokens: 100 },
    ])
    expect(result.costUsd).toBeCloseTo(0.1)
    expect(result.inputTokens).toBe(1500)
    expect(result.calls).toBe(2)
  })

  it("un cost_usd nulo cuenta como cero, no rompe la suma", () => {
    // `cost_usd` es numeric y puede venir null en filas viejas. NaN acá
    // envenenaría el total entero.
    const result = sumAi([{ cost_usd: null, input_tokens: null, output_tokens: null }])
    expect(result.costUsd).toBe(0)
    expect(Number.isNaN(result.costUsd)).toBe(false)
  })
})

describe("sumApollo", () => {
  it("valoriza los créditos a la tarifa contratada", () => {
    const result = sumApollo([{ credits_spent: 40, contacts_found: 40, cache_hit: false }])
    expect(result.credits).toBe(40)
    expect(result.costUsd).toBeCloseTo(0.4) // 1.000 créditos = US$ 10
  })

  it("cuenta las corridas servidas de CACHÉ por separado", () => {
    // Es la diferencia entre "buscamos 40 contactos" y "pagamos 40 contactos".
    const result = sumApollo([
      { credits_spent: 10, contacts_found: 10, cache_hit: false },
      { credits_spent: 0, contacts_found: 8, cache_hit: true },
    ])
    expect(result.runs).toBe(2)
    expect(result.cacheHits).toBe(1)
    expect(result.credits).toBe(10)
    expect(result.contactsFound).toBe(18)
  })
})

describe("sumApify", () => {
  it("suma las filas ingestadas que dejó el commit de la reserva", () => {
    const result = sumApify([{ metadata: { queued: 12 } }, { metadata: { queued: 30 } }])
    expect(result.runs).toBe(2)
    expect(result.rowsIngested).toBe(42)
  })

  it("suma el costo que Apify reportó por cada corrida", () => {
    // El número real de una corrida verificada contra la API: 35 vacantes por
    // US$ 0,0142511 (`usageTotalUsd` del objeto del run).
    const result = sumApify([
      { metadata: { queued: 35, usageTotalUsd: 0.01425110013586978 } },
      { metadata: { queued: 10, usageTotalUsd: 0.008 } },
    ])
    expect(result.costUsd).toBeCloseTo(0.0223, 4)
    expect(result.runsWithCost).toBe(2)
  })

  it("sin ninguna corrida con costo, el costo es null, NUNCA cero", () => {
    // Cero significa "no gastó". null significa "no sabemos". Es la diferencia
    // entre un informe sin scraping y un informe cuyo scraping no se pudo medir.
    expect(sumApify([{ metadata: { queued: 5 } }]).costUsd).toBeNull()
    expect(sumApify([]).costUsd).toBeNull()
  })

  it("una corrida sin costo NO se cuenta como cero: baja runsWithCost", () => {
    // El caso de verdad: las corridas viejas no tienen el campo, y un `null` es
    // el resultado de no haber podido leerlo. Sumar 0 por ellas daría un total
    // con cara de completo. Acá el total es un PISO y runsWithCost lo dice.
    const result = sumApify([
      { metadata: { queued: 35, usageTotalUsd: 0.014 } },
      { metadata: { queued: 20 } },
      { metadata: { queued: 5, usageTotalUsd: null } },
    ])
    expect(result.runs).toBe(3)
    expect(result.runsWithCost).toBe(1)
    expect(result.costUsd).toBeCloseTo(0.014, 4)
  })

  it("un costo que no es número finito no entra al total", () => {
    // Un string "0.01" sumaría como concatenación y un NaN envenenaría el total
    // entero: cualquier suma con NaN es NaN, así que el costo de IA y el de
    // Apollo también se perderían.
    const result = sumApify([
      { metadata: { queued: 1, usageTotalUsd: "0.01" } },
      { metadata: { queued: 1, usageTotalUsd: Number.NaN } },
      { metadata: { queued: 1, usageTotalUsd: -3 } },
    ])
    expect(result.runsWithCost).toBe(0)
    expect(result.costUsd).toBeNull()
  })

  it("una reserva sin `queued` no inventa filas", () => {
    expect(sumApify([{ metadata: null }, { metadata: { batchId: "x" } }]).rowsIngested).toBe(0)
  })
})

const breakdown = (over: Partial<CostBreakdown> = {}): CostBreakdown => ({
  ai: { costUsd: 3, inputTokens: 0, outputTokens: 0, calls: 1 },
  apollo: { credits: 100, costUsd: 1, runs: 1, contactsFound: 100, cacheHits: 0 },
  apify: { runs: 0, runsWithCost: 0, rowsIngested: 0, costUsd: null },
  ...over,
})

describe("totalUsd", () => {
  it("sin scraping, el total está completo", () => {
    const result = totalUsd(breakdown())
    expect(result.usd).toBeCloseTo(4)
    expect(result.partial).toBe(false)
    expect(result.missing).toEqual([])
  })

  it("CON scraping y sin su costo, el total se declara parcial y nombra lo que falta", () => {
    // El caso que importa: el total sigue siendo 4, pero ya no es "el costo".
    const result = totalUsd(breakdown({ apify: { runs: 3, runsWithCost: 0, rowsIngested: 90, costUsd: null } }))
    expect(result.usd).toBeCloseTo(4)
    expect(result.partial).toBe(true)
    expect(result.missing).toEqual(["apify"])
  })

  it("declara la calidad de cada concepto", () => {
    const result = totalUsd(breakdown({ apify: { runs: 1, runsWithCost: 0, rowsIngested: 10, costUsd: null } }))
    expect(result.quality.ai).toBe("measured")
    expect(result.quality.apollo).toBe("estimated")
    expect(result.quality.apify).toBe("unavailable")
  })

  it("con el costo de TODAS las corridas, entra al total y deja de faltar", () => {
    const result = totalUsd(breakdown({ apify: { runs: 2, runsWithCost: 2, rowsIngested: 40, costUsd: 0.5 } }))
    expect(result.usd).toBeCloseTo(4.5)
    expect(result.partial).toBe(false)
    expect(result.missing).toEqual([])
    expect(result.quality.apify).toBe("measured")
  })

  it("con SOLO ALGUNAS corridas medidas, el total sigue siendo parcial", () => {
    // La trampa que este test cierra: el costo de Apify deja de ser null —hay un
    // número— y con la regla vieja (`costUsd === null`) el total se habría dado
    // por completo escondiendo dos corridas sin medir. El número entra al total,
    // pero el total se declara piso y dice cuántas faltan.
    const result = totalUsd(breakdown({ apify: { runs: 3, runsWithCost: 1, rowsIngested: 45, costUsd: 0.014 } }))
    expect(result.usd).toBeCloseTo(4.014)
    expect(result.partial).toBe(true)
    expect(result.missing).toEqual(["apify (2 de 3 corridas)"])
    expect(result.quality.apify).toBe("partial")
  })
})

describe("apifyNote", () => {
  const apify = (over: Partial<ApifyCost>): ApifyCost => ({ runs: 0, runsWithCost: 0, rowsIngested: 0, costUsd: null, ...over })

  it("sin scraping lo dice y no habla de costos", () => {
    expect(apifyNote(apify({}))).toBe("No hubo scraping de vacantes en este alcance.")
  })

  it("con scraping sin medir, prohíbe estimarlo", () => {
    expect(apifyNote(apify({ runs: 2, rowsIngested: 40 }))).toContain("No lo estimes")
  })

  it("con todo medido, aclara que el alquiler mensual del actor queda afuera", () => {
    // Si no se dice, el número se lee como la factura de Apify. No lo es: el
    // actor se alquila a US$ 29,99 por mes se scrapee o no.
    const note = apifyNote(apify({ runs: 1, runsWithCost: 1, rowsIngested: 35, costUsd: 0.0143 }))
    expect(note).toContain("0.0143")
    expect(note).toContain("29,99")
  })

  it("con algunas medidas, la palabra es PISO", () => {
    const note = apifyNote(apify({ runs: 3, runsWithCost: 1, rowsIngested: 45, costUsd: 0.014 }))
    expect(note).toContain("PISO")
    expect(note).toContain("1 de las 3")
  })
})

describe("defaultPeriodStart", () => {
  it("es el primer día del mes en curso, en UTC", () => {
    expect(defaultPeriodStart(new Date("2026-08-26T17:45:00Z"))).toBe("2026-08-01T00:00:00.000Z")
  })

  it("no se corre de mes con una fecha del día 1 a la madrugada", () => {
    expect(defaultPeriodStart(new Date("2026-08-01T00:30:00Z"))).toBe("2026-08-01T00:00:00.000Z")
  })
})
