import { describe, expect, it } from "vitest"

import {
  defaultPeriodStart,
  sumAi,
  sumApollo,
  sumApify,
  totalUsd,
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

  it("el costo es null, NUNCA cero", () => {
    // Cero significa "no gastó". null significa "no sabemos". Apify no nos
    // devuelve su consumo, así que la única respuesta honesta es null.
    expect(sumApify([{ metadata: { queued: 5 } }]).costUsd).toBeNull()
    expect(sumApify([]).costUsd).toBeNull()
  })

  it("una reserva sin `queued` no inventa filas", () => {
    expect(sumApify([{ metadata: null }, { metadata: { batchId: "x" } }]).rowsIngested).toBe(0)
  })
})

const breakdown = (over: Partial<CostBreakdown> = {}): CostBreakdown => ({
  ai: { costUsd: 3, inputTokens: 0, outputTokens: 0, calls: 1 },
  apollo: { credits: 100, costUsd: 1, runs: 1, contactsFound: 100, cacheHits: 0 },
  apify: { runs: 0, rowsIngested: 0, costUsd: null },
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
    const result = totalUsd(breakdown({ apify: { runs: 3, rowsIngested: 90, costUsd: null } }))
    expect(result.usd).toBeCloseTo(4)
    expect(result.partial).toBe(true)
    expect(result.missing).toEqual(["apify"])
  })

  it("declara la calidad de cada concepto", () => {
    const result = totalUsd(breakdown({ apify: { runs: 1, rowsIngested: 10, costUsd: null } }))
    expect(result.quality.ai).toBe("measured")
    expect(result.quality.apollo).toBe("estimated")
    expect(result.quality.apify).toBe("unavailable")
  })

  it("si Apify llegara a exponer su costo, entra al total y deja de faltar", () => {
    const result = totalUsd(breakdown({ apify: { runs: 2, rowsIngested: 40, costUsd: 0.5 } }))
    expect(result.usd).toBeCloseTo(4.5)
    expect(result.partial).toBe(false)
    expect(result.quality.apify).toBe("measured")
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
