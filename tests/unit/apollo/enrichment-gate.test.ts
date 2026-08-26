import { describe, expect, it } from "vitest"
import { hasEnrichment } from "@/lib/apollo/organizations"

/**
 * `hasEnrichment` es la guarda que decide si una empresa con organization_id
 * guardado hay que volver a pedirsela a Apollo. Un falso positivo deja la
 * empresa vacia para siempre; un falso negativo la vuelve a pedir y paga un
 * credito de gusto. Los dos casos ya pasaron en produccion.
 */
describe("hasEnrichment", () => {
  it("con tecnologias, enriquecida", () => {
    expect(hasEnrichment({ apollo_technologies: ["SAP", "Oracle"] })).toBe(true)
  })

  /**
   * El caso que rompio la version anterior de esta guarda.
   * `organizations/bulk_enrich` NO devuelve technology_names —0 de 183 payloads
   * crudos del primer lote del cron lo traen— pero si devuelve headcount por
   * area, facturacion e industrias. Con el testigo viejo, las 179 empresas de
   * ese lote se veian como "sin enriquecer".
   */
  it("sin tecnologias pero con headcount por area, enriquecida", () => {
    expect(
      hasEnrichment({
        apollo_technologies: null,
        apollo_departmental_head_count: { information_technology: 83, engineering: 210 },
      }),
    ).toBe(true)
  })

  it("alcanza con la facturacion", () => {
    expect(hasEnrichment({ apollo_technologies: null, apollo_annual_revenue: 3378000000 })).toBe(true)
  })

  it("alcanza con las industrias", () => {
    expect(hasEnrichment({ apollo_technologies: null, apollo_industries: ["retail"] })).toBe(true)
  })

  it("sin ninguno de los testigos, NO enriquecida", () => {
    expect(hasEnrichment({ apollo_technologies: null })).toBe(false)
    expect(hasEnrichment({})).toBe(false)
  })

  /** Los vacios son ausencia de dato, no dato: si no, la guarda deja pasar filas vacias. */
  it("colecciones vacias no cuentan", () => {
    expect(
      hasEnrichment({
        apollo_technologies: [],
        apollo_industries: [],
        apollo_departmental_head_count: {},
      }),
    ).toBe(false)
  })

  it("no explota con formas inesperadas", () => {
    expect(hasEnrichment({ apollo_technologies: "SAP" as unknown as string[] })).toBe(false)
    expect(hasEnrichment({ apollo_departmental_head_count: "nope" })).toBe(false)
    expect(hasEnrichment({ apollo_departmental_head_count: null })).toBe(false)
  })
})
