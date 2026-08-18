import { describe, expect, it } from "vitest"
import {
  buildEvidenceRow,
  evidenceDedupeHash,
  isProducedBy,
  normalizeSourceUrl,
  type EvidenceInput,
} from "@/lib/shared/evidence"

const COMPANY = "11111111-1111-1111-1111-111111111111"

function news(overrides: Partial<Extract<EvidenceInput, { kind: "news" }>> = {}) {
  return {
    kind: "news" as const,
    companyId: COMPANY,
    title: "Cencosud anuncia inversión en su plataforma",
    producedBy: "v2_research" as const,
    ...overrides,
  }
}

describe("normalizeSourceUrl", () => {
  it("colapsa variantes de la misma URL", () => {
    const canonical = normalizeSourceUrl("https://www.lanacion.com.ar/nota-1")
    expect(normalizeSourceUrl("http://lanacion.com.ar/nota-1/")).toBe(canonical)
    expect(normalizeSourceUrl("https://LANACION.com.ar/nota-1#seccion")).toBe(canonical)
    expect(normalizeSourceUrl("https://lanacion.com.ar/nota-1?utm_source=twitter")).toBe(canonical)
  })

  it("no colapsa URLs distintas", () => {
    expect(normalizeSourceUrl("https://medio.com/a")).not.toBe(normalizeSourceUrl("https://medio.com/b"))
  })

  it("preserva los parámetros que no son de tracking", () => {
    expect(normalizeSourceUrl("https://medio.com/nota?id=42")).toContain("id=42")
  })

  it("tolera basura sin romper", () => {
    expect(normalizeSourceUrl("no es una url")).toBe("no es una url")
    expect(normalizeSourceUrl(null)).toBeNull()
    expect(normalizeSourceUrl("   ")).toBeNull()
  })
})

describe("evidenceDedupeHash", () => {
  it("es estable para la misma nota escrita distinto", () => {
    const a = evidenceDedupeHash(news({ sourceUrl: "https://www.medio.com/x" }))
    const b = evidenceDedupeHash(news({ sourceUrl: "http://medio.com/x/", title: "Otro título, misma nota" }))
    expect(a).toBe(b)
  })

  it("separa por compañía", () => {
    const a = evidenceDedupeHash(news({ sourceUrl: "https://medio.com/x" }))
    const b = evidenceDedupeHash(news({ sourceUrl: "https://medio.com/x", companyId: "22222222-2222-2222-2222-222222222222" }))
    expect(a).not.toBe(b)
  })

  it("separa por tipo de evidencia", () => {
    const asNews = evidenceDedupeHash(news({ sourceUrl: "https://medio.com/x" }))
    const asRadar = evidenceDedupeHash({
      kind: "radar",
      radarType: "news",
      companyId: COMPANY,
      title: "t",
      sourceUrl: "https://medio.com/x",
      producedBy: "v3_radar",
    })
    expect(asNews).not.toBe(asRadar)
  })

  it("cae al título normalizado cuando no hay URL", () => {
    const a = evidenceDedupeHash(news({ title: "Cencosud  ABRIÓ  un centro" }))
    const b = evidenceDedupeHash(news({ title: "cencosud abrio un centro" }))
    expect(a).toBe(b)
  })
})

describe("buildEvidenceRow", () => {
  it("mapea una noticia a company_news", () => {
    const { table, row } = buildEvidenceRow(
      news({ sourceUrl: "https://medio.com/x", category: "expansion", occurredAt: "2026-08-01" }),
    )
    expect(table).toBe("company_news")
    expect(row.category).toBe("expansion")
    expect(row.published_at).toBe("2026-08-01T00:00:00.000Z")
    expect(row.produced_by).toBe("v2_research")
    expect(row.dedupe_hash).toEqual(expect.any(String))
  })

  it("guarda la URL original, no la normalizada", () => {
    const { row } = buildEvidenceRow(news({ sourceUrl: "http://www.medio.com/x?utm_source=x" }))
    expect(row.source_url).toBe("http://www.medio.com/x?utm_source=x")
  })

  it("renombra category a area en implementations", () => {
    const { table, row } = buildEvidenceRow({
      kind: "implementation",
      companyId: COMPANY,
      title: "Migración a SAP S/4HANA",
      category: "erp",
      technology: "SAP S/4HANA",
      providerName: "Accenture",
      producedBy: "mcp_client",
    })
    expect(table).toBe("company_implementations")
    expect(row.area).toBe("erp")
    expect(row).not.toHaveProperty("category")
    expect(row.technology).toBe("SAP S/4HANA")
  })

  it("renombra source_url a url y recorta la fecha en radar", () => {
    const { table, row } = buildEvidenceRow({
      kind: "radar",
      radarType: "tech",
      companyId: COMPANY,
      title: "Adopción de Snowflake",
      sourceUrl: "https://medio.com/x",
      occurredAt: "2026-08-01T15:30:00.000Z",
      producedBy: "v3_radar",
    })
    expect(table).toBe("radar_findings")
    expect(row.url).toBe("https://medio.com/x")
    expect(row).not.toHaveProperty("source_url")
    expect(row.source_date).toBe("2026-08-01")
    expect(row.radar_type).toBe("tech")
    // category es NOT NULL en la tabla: nunca puede salir nulo de acá.
    expect(row.category).toBe("general")
  })

  it("propaga la atribución del modelo colaborativo", () => {
    const ws = "33333333-3333-3333-3333-333333333333"
    const { row } = buildEvidenceRow(news({ sourcedByWorkspace: ws, requestedBy: COMPANY }))
    expect(row.sourced_by_workspace).toBe(ws)
    expect(row.requested_by).toBe(COMPANY)
  })

  it("rechaza un producedBy fuera del vocabulario", () => {
    expect(() =>
      // @ts-expect-error probamos justamente el caso que el tipo prohíbe
      buildEvidenceRow(news({ producedBy: "inventado" })),
    ).toThrow(/producedBy inválido/)
  })
})

describe("isProducedBy", () => {
  it("acepta el vocabulario y rechaza el resto", () => {
    expect(isProducedBy("mcp_client")).toBe(true)
    expect(isProducedBy("v2_research")).toBe(true)
    expect(isProducedBy("parallel")).toBe(false)
    expect(isProducedBy(null)).toBe(false)
  })
})
