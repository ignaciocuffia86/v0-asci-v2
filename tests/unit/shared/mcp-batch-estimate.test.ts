import { describe, expect, it } from "vitest"

import { averageCostPerResearch, classifyResearchQuota, roundUsd, MAX_ACCOUNTS_PER_BATCH, type QuotaItemLike } from "@/lib/v3/services/mcp-batch-estimate"

describe("averageCostPerResearch", () => {
  it("agrupa por research_job_id: la unidad de costo es el JOB, no la fila", () => {
    // Un research genera varias llamadas al modelo (scoring, estructura, síntesis,
    // interpretación de vacantes). Promediar filas daría el costo de UNA llamada.
    const rows = [
      { research_job_id: "job-1", cost_usd: 0.04 },
      { research_job_id: "job-1", cost_usd: 0.03 },
      { research_job_id: "job-1", cost_usd: 0.03 },
      { research_job_id: "job-2", cost_usd: 0.12 },
    ]
    const result = averageCostPerResearch(rows)
    expect(result.samples).toBe(2)
    // (0.10 + 0.12) / 2 = 0.11 — y no 0.055, que es el promedio por fila.
    expect(result.perAccountUsd).toBeCloseTo(0.11)
  })

  it("promediar por fila subestimaría, que es la dirección peligrosa", () => {
    const rows = [
      { research_job_id: "job-1", cost_usd: 0.05 },
      { research_job_id: "job-1", cost_usd: 0.05 },
      { research_job_id: "job-1", cost_usd: 0.05 },
    ]
    const porFila = rows.reduce((sum, row) => sum + Number(row.cost_usd), 0) / rows.length
    expect(averageCostPerResearch(rows).perAccountUsd!).toBeGreaterThan(porFila)
  })

  it("descarta las filas que no se pueden atribuir a una cuenta", () => {
    const result = averageCostPerResearch([
      { research_job_id: null, cost_usd: 99 },
      { research_job_id: "job-1", cost_usd: 0.1 },
    ])
    expect(result.samples).toBe(1)
    expect(result.perAccountUsd).toBeCloseTo(0.1)
  })

  it("sin muestras devuelve null, NUNCA cero", () => {
    // Un 0 en una pantalla de autorización de presupuesto se lee como "es gratis".
    expect(averageCostPerResearch([]).perAccountUsd).toBeNull()
    expect(averageCostPerResearch([{ research_job_id: null, cost_usd: 5 }]).perAccountUsd).toBeNull()
  })

  it("acepta numeric de Postgres, que llega como string", () => {
    const result = averageCostPerResearch([{ research_job_id: "job-1", cost_usd: "0.15" }])
    expect(result.perAccountUsd).toBeCloseTo(0.15)
  })

  it("tolera costo nulo o vacío sin romper el promedio", () => {
    const result = averageCostPerResearch([
      { research_job_id: "job-1", cost_usd: "" as unknown as number },
      { research_job_id: "job-2", cost_usd: 0.2 },
    ])
    expect(result.samples).toBe(2)
    expect(result.perAccountUsd).toBeCloseTo(0.1)
  })
})

describe("roundUsd", () => {
  it("redondea a centavos", () => {
    expect(roundUsd(4.2049)).toBe(4.2)
    expect(roundUsd(0.005)).toBe(0.01)
  })

  it("propaga null en vez de convertirlo en 0", () => {
    expect(roundUsd(null)).toBeNull()
  })
})

describe("topes", () => {
  it("el lote tiene el mismo techo que el screening de listas", () => {
    expect(MAX_ACCOUNTS_PER_BATCH).toBe(200)
  })
})

describe("classifyResearchQuota", () => {
  const item = (over: Partial<QuotaItemLike>): QuotaItemLike => ({
    companyId: "c", allowed: false, isRefresh: false, reason: null, nextAutoRefreshDate: null, ...over,
  })

  it("separa lo que abarata el lote de lo que lo bloquea", () => {
    // checkResearchQuota devuelve allowed:false por dos motivos OPUESTOS.
    const result = classifyResearchQuota([
      item({ allowed: true }),
      item({ isRefresh: true, reason: "en seguimiento", nextAutoRefreshDate: "2026-09-01" }),
      item({ isRefresh: true, reason: "cooldown de 30 días" }),
      item({ isRefresh: false, reason: "Alcanzaste el cupo de 60 investigaciones nuevas este mes" }),
    ])
    expect(result.needed).toHaveLength(1)
    expect(result.free).toHaveLength(2)
    expect(result.blockedByQuota).toHaveLength(1)
  })

  it("una cuenta en seguimiento NO es falta de cupo", () => {
    // El error inverso ya se cometió una vez en run_account_research: reportar
    // ACCOUNT_AUTO_REFRESHED como PLAN_QUOTA_EXCEEDED.
    const result = classifyResearchQuota([item({ isRefresh: true, nextAutoRefreshDate: "2026-09-01", reason: "en seguimiento" })])
    expect(result.blockedByQuota).toHaveLength(0)
    expect(result.free).toHaveLength(1)
  })

  it("una cuenta nueva sin cupo NO es un ahorro", () => {
    const result = classifyResearchQuota([item({ isRefresh: false, reason: "Alcanzaste el cupo" })])
    expect(result.free).toHaveLength(0)
    expect(result.blockedByQuota).toHaveLength(1)
  })

  it("las tres categorías particionan el lote sin perder ni duplicar cuentas", () => {
    const items = [item({ allowed: true }), item({ isRefresh: true }), item({}), item({ allowed: true })]
    const result = classifyResearchQuota(items)
    expect(result.needed.length + result.free.length + result.blockedByQuota.length).toBe(items.length)
  })
})
