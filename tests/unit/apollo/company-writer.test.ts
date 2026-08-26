import { describe, expect, it } from "vitest"
import {
  applyCompanyEnrichment,
  buildCompanyUpdate,
  buildNotFoundUpdate,
  unwrapOrganization,
} from "@/lib/apollo/company-writer"
import type { ApolloOrganization } from "@/lib/apollo/parsers"

const NOW = new Date("2026-08-26T12:00:00.000Z")

function org(overrides: Partial<ApolloOrganization> = {}): ApolloOrganization {
  return {
    id: "org_1",
    name: "Acme",
    primaryDomain: "acme.com",
    websiteUrl: "https://acme.com",
    industry: "oil & energy",
    employeesCount: 1200,
    linkedinUrl: "http://www.linkedin.com/company/acme",
    country: "Argentina",
    logoUrl: "https://cdn/acme.png",
    description: "Acme hace cosas",
    foundedYear: 1977,
    annualRevenue: 573_000_000,
    technologies: ["SAP", "Salesforce"],
    keywords: ["energia", "petroleo"],
    publiclyTradedSymbol: null,
    publiclyTradedExchange: null,
    headcountGrowth: { twelve_month: 0.12 },
    departmentalHeadCount: { information_technology: 700, engineering: 472 },
    phone: "+541150000000",
    industries: ["oil & energy", "utilities"],
    naicsCodes: ["211120"],
    sicCodes: ["1311"],
    city: "Buenos Aires",
    state: "CABA",
    linkedinUid: 3046,
    ...overrides,
  }
}

const VACIA = {
  id: "c1",
  linkedin_url: null,
  website: null,
  country: null,
  logo_url: null,
  description: null,
  linkedin_company_id: null,
}

describe("buildCompanyUpdate — namespace de Apollo", () => {
  it("escribe siempre las columnas apollo_*", () => {
    const { patch } = buildCompanyUpdate(VACIA, org(), NOW)
    expect(patch.apollo_organization_id).toBe("org_1")
    expect(patch.apollo_org_status).toBe("found")
    expect(patch.apollo_industry).toBe("oil & energy")
    expect(patch.apollo_employees_count).toBe(1200)
    expect(patch.apollo_annual_revenue).toBe(573_000_000)
    expect(patch.apollo_founded_year).toBe(1977)
    expect(patch.apollo_technologies).toEqual(["SAP", "Salesforce"])
    expect(patch.apollo_headcount_growth).toEqual({ twelve_month: 0.12 })
  })

  it("NUNCA escribe industry: la taxonomia de Apollo es otra", () => {
    const { patch } = buildCompanyUpdate(VACIA, org(), NOW)
    expect(patch).not.toHaveProperty("industry")
  })

  it("NUNCA escribe is_public ni ticker: son de SEC EDGAR", () => {
    const { patch } = buildCompanyUpdate(
      VACIA,
      org({ publiclyTradedSymbol: "ACME", publiclyTradedExchange: "NYSE" }),
      NOW,
    )
    expect(patch).not.toHaveProperty("is_public")
    expect(patch).not.toHaveProperty("ticker")
    expect(patch).not.toHaveProperty("stock_exchange")
    expect(patch.apollo_publicly_traded_symbol).toBe("ACME")
  })

  it("NUNCA escribe las columnas derivadas por trigger", () => {
    const { patch } = buildCompanyUpdate(VACIA, org(), NOW)
    expect(patch).not.toHaveProperty("country_normalized")
    expect(patch).not.toHaveProperty("master_industry_id")
  })

  it("deja las listas vacias en null en vez de guardar []", () => {
    const { patch } = buildCompanyUpdate(VACIA, org({ technologies: [], keywords: [] }), NOW)
    expect(patch.apollo_technologies).toBeNull()
    expect(patch.apollo_keywords).toBeNull()
  })
})

describe("buildCompanyUpdate — precedencia de las señales propias", () => {
  it("rellena las columnas genericas vacias", () => {
    const { patch, filledColumns } = buildCompanyUpdate(VACIA, org(), NOW)
    expect(patch.linkedin_url).toBe("http://www.linkedin.com/company/acme")
    expect(patch.country).toBe("Argentina")
    expect(patch.description).toBe("Acme hace cosas")
    expect(filledColumns).toEqual(
      expect.arrayContaining(["linkedin_url", "website", "country", "logo_url", "description"]),
    )
  })

  it("NO pisa un dato propio existente", () => {
    const propia = {
      ...VACIA,
      linkedin_url: "https://linkedin.com/company/el-nuestro",
      country: "Uruguay",
      description: "Nuestra descripcion",
    }
    const { patch, filledColumns } = buildCompanyUpdate(propia, org(), NOW)
    expect(patch).not.toHaveProperty("linkedin_url")
    expect(patch).not.toHaveProperty("country")
    expect(patch).not.toHaveProperty("description")
    expect(filledColumns).not.toContain("country")
  })

  it("trata el string vacio como hueco: son ~66k filas historicas", () => {
    const conVacios = { ...VACIA, country: "", logo_url: "   ", description: "" }
    const { patch, filledColumns } = buildCompanyUpdate(conVacios, org(), NOW)
    expect(patch.country).toBe("Argentina")
    expect(patch.logo_url).toBe("https://cdn/acme.png")
    expect(filledColumns).toContain("country")
    expect(filledColumns).toContain("logo_url")
  })

  it("no inventa valores cuando Apollo tampoco los tiene", () => {
    const { patch, filledColumns } = buildCompanyUpdate(
      VACIA,
      org({ linkedinUrl: null, country: null, description: null }),
      NOW,
    )
    expect(patch).not.toHaveProperty("linkedin_url")
    expect(patch).not.toHaveProperty("country")
    expect(filledColumns).not.toContain("linkedin_url")
  })
})

describe("buildNotFoundUpdate", () => {
  it("marca el TTL de no-reintento sin borrar nada mas", () => {
    const patch = buildNotFoundUpdate(NOW)
    expect(patch.apollo_org_status).toBe("not_found")
    expect(patch.apollo_organization_id).toBeNull()
    expect(Object.keys(patch)).toHaveLength(3)
  })
})

describe("unwrapOrganization — una sola forma en el checkpoint", () => {
  it("desenvuelve la respuesta de /organizations/enrich", () => {
    expect(unwrapOrganization({ organization: { id: "o", technology_names: ["SAP"] } })).toEqual({
      id: "o",
      technology_names: ["SAP"],
    })
  })

  it("deja pasar el objeto suelto de bulk_enrich", () => {
    expect(unwrapOrganization({ id: "o", technology_names: ["SAP"] })).toEqual({
      id: "o",
      technology_names: ["SAP"],
    })
  })

  it("las dos rutas convergen a la misma forma", () => {
    const suelto = { id: "o", technology_names: ["SAP"] }
    expect(unwrapOrganization({ organization: suelto })).toEqual(unwrapOrganization(suelto))
  })

  it("no explota con entradas invalidas", () => {
    expect(unwrapOrganization(null)).toBeNull()
    expect(unwrapOrganization("nope")).toBeNull()
    expect(unwrapOrganization({ organization: null })).toEqual({ organization: null })
  })
})

describe("buildCompanyUpdate — campos de alto valor (Fase 1.2)", () => {
  it("guarda el headcount por area, que es el campo mas util del payload", () => {
    const { patch } = buildCompanyUpdate(VACIA, org(), NOW)
    expect(patch.apollo_departmental_head_count).toEqual({
      information_technology: 700,
      engineering: 472,
    })
  })

  it("guarda telefono, industrias multiples, codigos y ubicacion", () => {
    const { patch } = buildCompanyUpdate(VACIA, org(), NOW)
    expect(patch.apollo_phone).toBe("+541150000000")
    expect(patch.apollo_industries).toEqual(["oil & energy", "utilities"])
    expect(patch.apollo_naics_codes).toEqual(["211120"])
    expect(patch.apollo_city).toBe("Buenos Aires")
  })

  it("completa linkedin_company_id cuando falta", () => {
    const { patch, filledColumns } = buildCompanyUpdate(VACIA, org(), NOW)
    expect(patch.linkedin_company_id).toBe(3046)
    expect(filledColumns).toContain("linkedin_company_id")
  })

  it("NO pisa un linkedin_company_id que ya tenemos", () => {
    const conId = { ...VACIA, linkedin_company_id: 99999 }
    const { patch, filledColumns } = buildCompanyUpdate(conId, org(), NOW)
    expect(patch).not.toHaveProperty("linkedin_company_id")
    expect(filledColumns).not.toContain("linkedin_company_id")
  })
})

describe("applyCompanyEnrichment — colision de linkedin_company_id", () => {
  // La columna tiene UNIQUE. Que Apollo devuelva un uid que otra fila ya tiene
  // significa duplicado o id mal asignado — no es motivo para perder la empresa
  // entera (y su credito) por un campo secundario.
  function fakeSupabase(fallaPrimerUpdate: boolean) {
    const updates: Array<Record<string, unknown>> = []
    let intentos = 0
    const upserts: Array<Record<string, unknown>> = []
    return {
      updates,
      upserts,
      client: {
        from() {
          return {
            update(patch: Record<string, unknown>) {
              updates.push(patch)
              intentos++
              const falla = fallaPrimerUpdate && intentos === 1
              return {
                eq: async () => ({ error: falla ? { code: "23505" } : null }),
              }
            },
          }
        },
        schema() {
          return {
            from() {
              return {
                upsert: async (row: Record<string, unknown>) => {
                  upserts.push(row)
                  return { error: null }
                },
              }
            },
          }
        },
      },
    }
  }

  it("reintenta sin el uid y guarda la empresa igual", async () => {
    const fake = fakeSupabase(true)
    const filled = await applyCompanyEnrichment(
      fake.client as never,
      VACIA,
      org(),
      "acme.com",
      null,
    )
    expect(fake.updates).toHaveLength(2)
    expect(fake.updates[0]).toHaveProperty("linkedin_company_id")
    expect(fake.updates[1]).not.toHaveProperty("linkedin_company_id")
    // el resto de los datos se escribe igual
    expect(fake.updates[1].apollo_technologies).toEqual(["SAP", "Salesforce"])
    expect(filled).not.toContain("linkedin_company_id")
  })

  it("deja la colision anotada en el checkpoint para poder revisarla", async () => {
    const fake = fakeSupabase(true)
    await applyCompanyEnrichment(fake.client as never, VACIA, org(), "acme.com", null)
    expect(String(fake.upserts[0].error_message)).toContain("3046")
    expect(String(fake.upserts[0].error_message)).toContain("duplicado")
  })

  it("no reintenta cuando no hay colision", async () => {
    const fake = fakeSupabase(false)
    const filled = await applyCompanyEnrichment(fake.client as never, VACIA, org(), "acme.com", null)
    expect(fake.updates).toHaveLength(1)
    expect(filled).toContain("linkedin_company_id")
    expect(fake.upserts[0].error_message).toBeNull()
  })
})
