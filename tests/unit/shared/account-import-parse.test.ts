import { describe, expect, it } from "vitest"
import {
  ACCOUNT_IMPORT_MAX_ROWS,
  canonicalLinkedinUrl,
  detectHeaderMapping,
  linkedinCompanySlug,
  mapAndDedupeRows,
  normalizeHeader,
  normalizeWebsite,
} from "@/lib/v3/services/account-import-parse"

describe("normalizeHeader", () => {
  it("normaliza acentos, mayúsculas y separadores", () => {
    expect(normalizeHeader("Razón Social")).toBe("razon_social")
    expect(normalizeHeader("  LinkedIn URL ")).toBe("linkedin_url")
    expect(normalizeHeader("País")).toBe("pais")
  })
})

describe("detectHeaderMapping", () => {
  it("mapea headers del template canónico", () => {
    const { mapping, missingRequired } = detectHeaderMapping([
      "company_name", "linkedin_url", "website", "country", "notes",
    ])
    expect(missingRequired).toBe(false)
    expect(mapping.get("company_name")).toBe("company_name")
    expect(mapping.get("linkedin_url")).toBe("linkedin_url")
    expect(mapping.get("notes")).toBe("notes")
  })

  it("acepta headers en español con acentos", () => {
    const { mapping, missingRequired } = detectHeaderMapping(["Empresa", "LinkedIn", "Sitio Web", "País"])
    expect(missingRequired).toBe(false)
    expect(mapping.get("Empresa")).toBe("company_name")
    expect(mapping.get("LinkedIn")).toBe("linkedin_url")
    expect(mapping.get("Sitio Web")).toBe("website")
    expect(mapping.get("País")).toBe("country")
  })

  it("'url' a secas es website, no linkedin", () => {
    const { mapping } = detectHeaderMapping(["nombre", "url"])
    expect(mapping.get("url")).toBe("website")
  })

  it("marca missingRequired sin columna de nombre", () => {
    const { missingRequired } = detectHeaderMapping(["linkedin_url", "website"])
    expect(missingRequired).toBe(true)
  })

  it("el primer header que matchea gana; los desconocidos se ignoran", () => {
    const { mapping } = detectHeaderMapping(["empresa", "company", "columna_rara"])
    expect(mapping.get("empresa")).toBe("company_name")
    expect(mapping.has("company")).toBe(false)
    expect(mapping.has("columna_rara")).toBe(false)
  })
})

describe("linkedinCompanySlug / canonicalLinkedinUrl", () => {
  it("extrae el slug en variantes reales", () => {
    expect(linkedinCompanySlug("https://www.linkedin.com/company/banco-galicia")).toBe("banco-galicia")
    expect(linkedinCompanySlug("linkedin.com/company/YPF/")).toBe("ypf")
    expect(linkedinCompanySlug("https://ar.linkedin.com/company/arcor?originalSubdomain=ar")).toBe("arcor")
  })

  it("rechaza perfiles personales y URLs ajenas", () => {
    expect(linkedinCompanySlug("https://www.linkedin.com/in/juan-perez")).toBeNull()
    expect(linkedinCompanySlug("https://ypf.com")).toBeNull()
  })

  it("canonicaliza a una sola forma", () => {
    expect(canonicalLinkedinUrl("linkedin.com/company/Banco-Galicia/")).toBe(
      "https://www.linkedin.com/company/banco-galicia",
    )
  })
})

describe("normalizeWebsite", () => {
  it("reduce a dominio comparable", () => {
    expect(normalizeWebsite("https://www.bancogalicia.com/personas")).toBe("bancogalicia.com")
    expect(normalizeWebsite("YPF.COM")).toBe("ypf.com")
  })
  it("descarta lo que no parece dominio", () => {
    expect(normalizeWebsite("no es un dominio")).toBeNull()
  })
})

describe("mapAndDedupeRows", () => {
  const mapping = detectHeaderMapping(["nombre", "linkedin", "web", "pais"]).mapping

  it("mapea filas válidas a campos canónicos", () => {
    const { rows, skipped } = mapAndDedupeRows(
      [{ nombre: "Banco Galicia", linkedin: "linkedin.com/company/banco-galicia", web: "bancogalicia.com", pais: "Argentina" }],
      mapping,
    )
    expect(skipped).toHaveLength(0)
    expect(rows[0]).toEqual({
      company_name: "Banco Galicia",
      linkedin_url: "https://www.linkedin.com/company/banco-galicia",
      linkedin_company_id: null,
      website: "bancogalicia.com",
      country: "Argentina",
      notes: null,
    })
  })

  it("acepta el linkedin_company_id numérico opcional y descarta typos sin invalidar la fila", () => {
    const withId = detectHeaderMapping(["nombre", "linkedin_id"]).mapping
    const { rows } = mapAndDedupeRows(
      [
        { nombre: "YPF Sociedad Anónima", linkedin_id: "321888" },
        { nombre: "Empresa Typo", linkedin_id: "no-numérico" },
      ],
      withId,
    )
    expect(rows[0].linkedin_company_id).toBe("321888")
    expect(rows[1].linkedin_company_id).toBeNull()
    expect(rows).toHaveLength(2)
  })

  it("descarta filas sin nombre o con nombre corto, con número de fila humano", () => {
    const { rows, skipped } = mapAndDedupeRows(
      [
        { nombre: "", linkedin: "linkedin.com/company/x-co" },
        { nombre: "AB" },
        { nombre: "Empresa Válida" },
      ],
      mapping,
    )
    expect(rows).toHaveLength(1)
    expect(skipped).toEqual([
      { rowNumber: 2, reason: "Falta el nombre de la empresa" },
      { rowNumber: 3, reason: "Nombre demasiado corto" },
    ])
  })

  it("descarta LinkedIn que no es URL de company", () => {
    const { rows, skipped } = mapAndDedupeRows(
      [{ nombre: "Empresa X", linkedin: "https://www.linkedin.com/in/perfil-personal" }],
      mapping,
    )
    expect(rows).toHaveLength(0)
    expect(skipped[0].reason).toMatch(/LinkedIn/)
  })

  it("deduplica dentro del archivo por slug y por nombre normalizado", () => {
    const { rows, skipped } = mapAndDedupeRows(
      [
        { nombre: "Arcor", linkedin: "linkedin.com/company/arcor" },
        { nombre: "Grupo Arcor", linkedin: "https://www.linkedin.com/company/arcor/" },
        { nombre: "YPF S.A." },
        { nombre: "ypf sa" },
      ],
      mapping,
    )
    expect(rows).toHaveLength(2)
    expect(skipped.map((s) => s.reason)).toEqual(["Duplicada dentro del archivo", "Duplicada dentro del archivo"])
  })

  it("saltea filas totalmente vacías sin avisar", () => {
    const { rows, skipped } = mapAndDedupeRows([{ nombre: "" }, { nombre: "Empresa Real" }], mapping)
    expect(rows).toHaveLength(1)
    expect(skipped).toHaveLength(0)
  })

  it("corta en el máximo y reporta el excedente", () => {
    const records = Array.from({ length: ACCOUNT_IMPORT_MAX_ROWS + 7 }, (_, i) => ({
      nombre: `Empresa Número ${i}`,
    }))
    const { rows, truncated } = mapAndDedupeRows(records, mapping)
    expect(rows).toHaveLength(ACCOUNT_IMPORT_MAX_ROWS)
    expect(truncated).toBe(7)
  })
})
