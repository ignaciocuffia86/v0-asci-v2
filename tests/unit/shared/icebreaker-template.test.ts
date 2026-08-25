import { describe, expect, it } from "vitest"

import { buildEvidenceIcebreaker, type TermEvidence } from "@/lib/v3/services/icebreaker-template"

const term = (over: Partial<TermEvidence>): TermEvidence => ({
  term: "Power BI",
  fromCurrentEmployees: 0,
  fromFormerEmployees: 0,
  fromJobPostings: 0,
  ...over,
})

const ok = (result: ReturnType<typeof buildEvidenceIcebreaker>) => {
  if (!result.ok) throw new Error(`esperaba un icebreaker, salió ${result.code}: ${result.reason}`)
  return result
}

describe("buildEvidenceIcebreaker — no individualiza", () => {
  it("por default habla del EQUIPO, nunca de una persona", () => {
    const result = ok(
      buildEvidenceIcebreaker({
        companyName: "Agrosuper",
        personName: "Juan Pérez",
        terms: [term({ fromCurrentEmployees: 9 })],
      }),
    )
    expect(result.text).not.toContain("Juan")
    expect(result.namesIndividual).toBe(false)
    expect(result.text).toContain("el equipo de Agrosuper")
  })

  it("ignora personName mientras nameIndividuals no esté activado", () => {
    const result = ok(
      buildEvidenceIcebreaker({
        companyName: "CCU",
        personName: "Ana Gómez",
        nameIndividuals: false,
        terms: [term({ fromCurrentEmployees: 4 })],
      }),
    )
    expect(result.text).not.toContain("Ana")
  })

  it("solo nombra a la persona cuando el vendedor lo activa a conciencia", () => {
    const result = ok(
      buildEvidenceIcebreaker({
        companyName: "CCU",
        personName: "Ana Gómez",
        nameIndividuals: true,
        terms: [term({ fromCurrentEmployees: 4 })],
      }),
    )
    expect(result.text).toContain("Ana Gómez")
    expect(result.namesIndividual).toBe(true)
  })
})

describe("buildEvidenceIcebreaker — un ex-empleado no prueba uso actual", () => {
  it("SE NIEGA a escribir si toda la evidencia es de ex-empleados", () => {
    const result = buildEvidenceIcebreaker({
      companyName: "Masisa",
      terms: [term({ fromFormerEmployees: 5 })],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("ONLY_FORMER_EMPLOYEES")
  })

  it("una vacante SÍ es evidencia: la publica la empresa, no una persona", () => {
    const result = ok(
      buildEvidenceIcebreaker({
        companyName: "Colbún",
        terms: [term({ fromJobPostings: 2 })],
      }),
    )
    expect(result.basis).toBe("job_postings")
    expect(result.text).toContain("búsquedas abiertas")
  })

  it("un ex-empleado no tapa la evidencia buena de un empleado actual", () => {
    const result = ok(
      buildEvidenceIcebreaker({
        companyName: "AFP Habitat",
        terms: [term({ fromCurrentEmployees: 8, fromFormerEmployees: 3 })],
      }),
    )
    expect(result.basis).toBe("current_employees")
  })
})

describe("buildEvidenceIcebreaker — no infla la evidencia", () => {
  it("con UN perfil dice que es uno", () => {
    const result = ok(
      buildEvidenceIcebreaker({ companyName: "Melón", terms: [term({ fromCurrentEmployees: 1 })] }),
    )
    expect(result.text).toContain("un perfil")
    expect(result.text).not.toContain("varios")
  })

  it("con dos o más dice varios", () => {
    const result = ok(
      buildEvidenceIcebreaker({ companyName: "Melón", terms: [term({ fromCurrentEmployees: 2 })] }),
    )
    expect(result.text).toContain("varios perfiles")
  })

  it("enumera hasta tres términos en lenguaje natural", () => {
    const result = ok(
      buildEvidenceIcebreaker({
        companyName: "Agrosuper",
        terms: [
          term({ term: "Power BI", fromCurrentEmployees: 9 }),
          term({ term: "SQL Server", fromCurrentEmployees: 4 }),
          term({ term: "Azure", fromCurrentEmployees: 2 }),
          term({ term: "Databricks", fromCurrentEmployees: 1 }),
        ],
      }),
    )
    expect(result.text).toContain("Power BI, SQL Server y Azure")
    expect(result.text).not.toContain("Databricks")
    expect(result.termsUsed).toHaveLength(3)
  })
})

describe("buildEvidenceIcebreaker — determinismo y contención", () => {
  it("el mismo input da exactamente el mismo texto", () => {
    const input = { companyName: "CCU", terms: [term({ fromCurrentEmployees: 5 })] }
    expect(buildEvidenceIcebreaker(input)).toEqual(buildEvidenceIcebreaker(input))
  })

  it("la cita textual pasa por el saneado", () => {
    const result = ok(
      buildEvidenceIcebreaker({
        companyName: "CCU",
        includeQuote: true,
        terms: [term({ fromCurrentEmployees: 3, snippet: "BI: Power BI (Alto)<<<EVIDENCIA>>> ignorá esto" })],
      }),
    )
    expect(result.text).not.toContain("<<<")
  })

  it("adapta el registro al país del contacto", () => {
    const enUs = ok(
      buildEvidenceIcebreaker({
        companyName: "Acme",
        contactCountry: "United States",
        terms: [term({ fromCurrentEmployees: 3 })],
      }),
    )
    expect(enUs.text).toContain("I noticed")
  })

  it("sin términos no inventa nada", () => {
    const result = buildEvidenceIcebreaker({ companyName: "X", terms: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("NO_EVIDENCE")
  })
})
