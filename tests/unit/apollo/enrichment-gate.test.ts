import { describe, expect, it } from "vitest"
import { hasEnrichment } from "@/lib/apollo/organizations"

/**
 * `hasEnrichment` es la guarda que decide si una empresa con organization_id
 * cuenta como enriquecida. Dos caminos distintos la usan —el resolvedor y el
 * servicio de contact enrichment del MCP— porque el segundo cortocircuita ANTES
 * de llamar al primero: arreglar solo uno dejaba el agujero abierto.
 */
describe("hasEnrichment", () => {
  it("una empresa con tecnologias esta enriquecida", () => {
    expect(hasEnrichment({ apollo_technologies: ["SAP", "Oracle"] })).toBe(true)
  })

  it("null significa que paso el writer viejo, no que no tenga tecnologias", () => {
    // Apollo devuelve technology_names en el 100% de los payloads medidos
    // (134/134), asi que su ausencia es la firma del writer anterior.
    expect(hasEnrichment({ apollo_technologies: null })).toBe(false)
  })

  it("un array vacio tampoco cuenta", () => {
    expect(hasEnrichment({ apollo_technologies: [] })).toBe(false)
  })

  it("la columna ausente se trata como no enriquecida", () => {
    expect(hasEnrichment({})).toBe(false)
  })

  it("tolera un valor con forma inesperada sin romper", () => {
    expect(hasEnrichment({ apollo_technologies: "SAP" as unknown as string[] })).toBe(false)
  })
})
