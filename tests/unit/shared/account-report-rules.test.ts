import { describe, expect, it } from "vitest"
import {
  buildInputsFingerprint,
  buildScorecardRows,
  computeAccountStatus,
  type AccountStatusFacts,
  type ScorecardFacts,
} from "@/lib/v3/services/account-report-rules"

const NOW = new Date("2026-08-21T00:00:00Z").getTime()
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()

const noFacts: AccountStatusFacts = {
  newsWithProposalSignal: 0,
  newsWithBusinessSignal: 0,
  jobsWithProposalSignal: 0,
  personnelMovements: 0,
  latestContractionAt: null,
}

describe("computeAccountStatus", () => {
  it("sin nada en las ventanas es sin señal", () => {
    const r = computeAccountStatus(noFacts, NOW)
    expect(r.status).toBe("sin_senal")
  })

  it("un aviso con señal de la propuesta alcanza para abordar", () => {
    const r = computeAccountStatus({ ...noFacts, jobsWithProposalSignal: 1 }, NOW)
    expect(r.status).toBe("abordar")
    expect(r.reason).toContain("1 aviso con señal")
  })

  it("una noticia de propuesta alcanza para abordar", () => {
    const r = computeAccountStatus({ ...noFacts, newsWithProposalSignal: 2 }, NOW)
    expect(r.status).toBe("abordar")
  })

  it("solo movimientos de personal es seguir de cerca", () => {
    const r = computeAccountStatus({ ...noFacts, personnelMovements: 3 }, NOW)
    expect(r.status).toBe("seguir_de_cerca")
    expect(r.reason).toContain("ninguna señal directa")
  })

  it("solo noticias de negocio es seguir de cerca (caso staffing)", () => {
    const r = computeAccountStatus({ ...noFacts, newsWithBusinessSignal: 1 }, NOW)
    expect(r.status).toBe("seguir_de_cerca")
  })

  it("una contracción reciente baja de abordar a seguir de cerca", () => {
    const r = computeAccountStatus(
      { ...noFacts, jobsWithProposalSignal: 2, latestContractionAt: daysAgo(15) },
      NOW,
    )
    expect(r.status).toBe("seguir_de_cerca")
    expect(r.loweredByContraction).toBe(true)
    expect(r.reason).toContain("contracción")
  })

  it("una contracción reciente baja de seguir de cerca a sin señal", () => {
    const r = computeAccountStatus(
      { ...noFacts, personnelMovements: 2, latestContractionAt: daysAgo(30) },
      NOW,
    )
    expect(r.status).toBe("sin_senal")
    expect(r.loweredByContraction).toBe(true)
  })

  it("una contracción vieja (>60 días) ya no baja el estado", () => {
    const r = computeAccountStatus(
      { ...noFacts, jobsWithProposalSignal: 1, latestContractionAt: daysAgo(120) },
      NOW,
    )
    expect(r.status).toBe("abordar")
    expect(r.loweredByContraction).toBe(false)
  })

  it("una contracción no puede bajar más allá de sin señal", () => {
    const r = computeAccountStatus({ ...noFacts, latestContractionAt: daysAgo(5) }, NOW)
    expect(r.status).toBe("sin_senal")
    // No se marca como bajada: ya estaba en el piso.
    expect(r.loweredByContraction).toBe(false)
  })

  it("una fecha de contracción rota no rompe el cálculo", () => {
    const r = computeAccountStatus(
      { ...noFacts, jobsWithProposalSignal: 1, latestContractionAt: "no es fecha" },
      NOW,
    )
    expect(r.status).toBe("abordar")
  })
})

describe("buildScorecardRows", () => {
  const base: ScorecardFacts = {
    movementsTotal: 0,
    movementsNew: 0,
    movementsInternal: 0,
    decisionMakers: 0,
    targetProfiles: 0,
    jobsWithSignal: 0,
    jobsTotal: 0,
    newsProposal: 0,
    newsBusiness: 0,
    hasVendorProfile: true,
  }

  it("devuelve las 5 filas del informe", () => {
    expect(buildScorecardRows(base)).toHaveLength(5)
  })

  it("declara las ausencias en vez de dejar la lectura vacía", () => {
    const rows = buildScorecardRows(base)
    expect(rows[0].reading).toContain("Sin movimientos")
    expect(rows[3].reading).toContain("Sin avisos")
    expect(rows[4].reading).toContain("Sin señal pública")
  })

  it("desglosa ingresos y rotaciones", () => {
    const rows = buildScorecardRows({ ...base, movementsTotal: 3, movementsNew: 3, movementsInternal: 0 })
    expect(rows[0].reading).toBe("3 ingresos nuevos y 0 rotaciones internas")
  })

  it("los avisos con señal se leen sobre el total", () => {
    const rows = buildScorecardRows({ ...base, jobsTotal: 44, jobsWithSignal: 3 })
    expect(rows[3].reading).toBe("3 de 44 avisos mencionan lo que vendés")
  })

  it("avisos activos sin ninguna señal se dicen explícitamente", () => {
    const rows = buildScorecardRows({ ...base, jobsTotal: 44, jobsWithSignal: 0 })
    expect(rows[3].reading).toContain("ninguno menciona")
  })

  it("noticias de negocio sin propuesta avisan que no hay proyecto concreto", () => {
    const rows = buildScorecardRows({ ...base, newsBusiness: 2 })
    expect(rows[4].reading).toContain("sin proyecto concreto")
  })

  it("sin propuesta de valor cargada lo dice en vez de puntuar el foco", () => {
    const rows = buildScorecardRows({ ...base, hasVendorProfile: false })
    expect(rows[1].reading).toContain("Sin propuesta de valor")
  })
})

describe("buildInputsFingerprint", () => {
  const parts = {
    profileVersion: "abc123",
    lastJobScrapeAt: "2026-08-01T00:00:00Z",
    lastNewsScrapeAt: "2026-08-10T00:00:00Z",
    jobsTotal: 44,
    jobsWithSignal: 3,
    newsTotal: 5,
    movementsTotal: 3,
  }

  it("es estable con los mismos insumos", () => {
    expect(buildInputsFingerprint(parts)).toBe(buildInputsFingerprint({ ...parts }))
  })

  it("cambia si entran vacantes nuevas", () => {
    expect(buildInputsFingerprint({ ...parts, jobsTotal: 45 })).not.toBe(buildInputsFingerprint(parts))
  })

  it("cambia si cambia la propuesta de valor", () => {
    expect(buildInputsFingerprint({ ...parts, profileVersion: "otro" })).not.toBe(
      buildInputsFingerprint(parts),
    )
  })

  it("tolera insumos ausentes", () => {
    expect(
      buildInputsFingerprint({
        profileVersion: null,
        lastJobScrapeAt: null,
        lastNewsScrapeAt: null,
        jobsTotal: 0,
        jobsWithSignal: 0,
        newsTotal: 0,
        movementsTotal: 0,
      }),
    ).toBe("no-profile|no-jobs|no-news|0|0|0|0")
  })
})
