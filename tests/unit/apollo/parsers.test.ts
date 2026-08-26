import { describe, expect, it } from "vitest"
import {
  normalizePerson,
  parseSearchResponse,
  parseOrganizationResponse,
  parseBulkOrganizationResponse,
  countEnrichCredits,
  pickBestPhone,
} from "@/lib/apollo/parsers"

describe("pickBestPhone", () => {
  it("prefiere mobile sobre work", () => {
    const phones = [
      { raw_number: "+1 555 000 1111", type: "work" },
      { raw_number: "+1 555 000 2222", type: "mobile" },
    ]
    expect(pickBestPhone(phones, "mobile")).toBe("+1 555 000 2222")
  })

  it("usa sanitized_number si esta presente", () => {
    const phones = [{ raw_number: "(555) 0000", sanitized_number: "+15550000", type: "mobile" }]
    expect(pickBestPhone(phones)).toBe("+15550000")
  })

  it("devuelve null para array vacio o null", () => {
    expect(pickBestPhone([])).toBeNull()
    expect(pickBestPhone(null)).toBeNull()
    expect(pickBestPhone(undefined)).toBeNull()
  })

  it("prefiere verified sobre no-verificado", () => {
    const phones = [
      { raw_number: "+1 1", type: "mobile", status: "unverified" },
      { raw_number: "+1 2", type: "mobile", status: "verified" },
    ]
    expect(pickBestPhone(phones)).toBe("+1 2")
  })

  it("puede forzar work como preferido", () => {
    const phones = [
      { raw_number: "+1 mobile", type: "mobile" },
      { raw_number: "+1 work", type: "work" },
    ]
    expect(pickBestPhone(phones, "work")).toBe("+1 work")
  })
})

describe("normalizePerson", () => {
  it("devuelve null sin id", () => {
    expect(normalizePerson({})).toBeNull()
    expect(normalizePerson(null)).toBeNull()
  })

  it("construye fullName desde first+last si falta name", () => {
    const p = normalizePerson({ id: "x", first_name: "Juan", last_name: "Perez" })
    expect(p?.fullName).toBe("Juan Perez")
  })

  it("fallback a Desconocido sin nombre", () => {
    const p = normalizePerson({ id: "x" })
    expect(p?.fullName).toBe("Desconocido")
  })

  it("extrae mobile y work por separado", () => {
    const p = normalizePerson({
      id: "x",
      phone_numbers: [
        { raw_number: "+1 mobile", type: "mobile" },
        { raw_number: "+1 work", type: "work" },
      ],
    })
    expect(p?.mobilePhone).toBe("+1 mobile")
    expect(p?.workPhone).toBe("+1 work")
  })

  it("fallback a sanitized_phone cuando phone_numbers vacio", () => {
    const p = normalizePerson({ id: "x", sanitized_phone: "+15550000" })
    expect(p?.mobilePhone).toBe("+15550000")
  })
})

describe("parseSearchResponse", () => {
  it("maneja response vacio sin romper", () => {
    expect(parseSearchResponse(null)).toEqual({
      people: [],
      totalEntries: 0,
      page: 1,
      perPage: 0,
    })
    expect(parseSearchResponse({})).toMatchObject({ people: [], totalEntries: 0 })
  })

  it("extrae total_entries de pagination", () => {
    const r = parseSearchResponse({
      people: [{ id: "1", first_name: "A" }],
      pagination: { total_entries: 42, page: 2, per_page: 25 },
    })
    expect(r.totalEntries).toBe(42)
    expect(r.page).toBe(2)
    expect(r.perPage).toBe(25)
  })

  it("filtra personas sin id", () => {
    const r = parseSearchResponse({
      people: [{ id: "1", first_name: "A" }, { first_name: "SinId" }],
    })
    expect(r.people).toHaveLength(1)
  })
})

describe("parseOrganizationResponse", () => {
  it("extrae de { organization }", () => {
    const r = parseOrganizationResponse({
      organization: { id: "org_1", name: "Acme", primary_domain: "acme.com" },
    })
    expect(r?.id).toBe("org_1")
    expect(r?.name).toBe("Acme")
  })

  it("devuelve null sin id", () => {
    expect(parseOrganizationResponse({ organization: {} })).toBeNull()
  })

  it("acepta payload plano (sin wrapping)", () => {
    const r = parseOrganizationResponse({ id: "org_2", name: "Beta" })
    expect(r?.id).toBe("org_2")
  })
})

describe("parseOrganizationResponse — campos de la Fase 1 (ago-2026)", () => {
  // Shape real observado en produccion (apollo_api_calls, 26-ago-2026).
  const RESPUESTA_REAL = {
    organization: {
      id: "org_pluspetrol",
      name: "Pluspetrol",
      primary_domain: "pluspetrol.net",
      website_url: "http://www.pluspetrol.net",
      linkedin_url: "http://www.linkedin.com/company/pluspetrol",
      country: "Argentina",
      industry: "oil & energy",
      estimated_num_employees: 3200,
      founded_year: 1977,
      annual_revenue: 573000000.0,
      short_description: "Pluspetrol is an independent energy company",
      logo_url: "https://cdn.apollo.io/pluspetrol.png",
      technology_names: ["SAP", "Salesforce", "Oracle"],
      keywords: ["oil", "gas", "energy"],
      publicly_traded_symbol: null,
      organization_headcount_twelve_month_growth: 0.08,
    },
  }

  it("extrae los campos nuevos del payload real", () => {
    const r = parseOrganizationResponse(RESPUESTA_REAL)!
    expect(r.foundedYear).toBe(1977)
    expect(r.annualRevenue).toBe(573000000)
    expect(r.technologies).toEqual(["SAP", "Salesforce", "Oracle"])
    expect(r.keywords).toEqual(["oil", "gas", "energy"])
    expect(r.description).toBe("Pluspetrol is an independent energy company")
    expect(r.logoUrl).toBe("https://cdn.apollo.io/pluspetrol.png")
    expect(r.headcountGrowth).toEqual({ twelve_month: 0.08 })
  })

  it("redondea annual_revenue: la columna destino es bigint", () => {
    const r = parseOrganizationResponse({ organization: { id: "o", annual_revenue: 1234.7 } })!
    expect(r.annualRevenue).toBe(1235)
  })

  it("devuelve null en headcountGrowth cuando Apollo no lo manda", () => {
    expect(parseOrganizationResponse({ organization: { id: "o" } })!.headcountGrowth).toBeNull()
  })

  it("tolera arrays sucios sin romper", () => {
    const r = parseOrganizationResponse({
      organization: { id: "o", technology_names: ["SAP", null, 42, "  ", "Oracle"] },
    })!
    expect(r.technologies).toEqual(["SAP", "Oracle"])
  })

  it("recorta las keywords a 50: Apollo manda hasta ~160", () => {
    const muchas = Array.from({ length: 160 }, (_, i) => `kw${i}`)
    const r = parseOrganizationResponse({ organization: { id: "o", keywords: muchas } })!
    expect(r.keywords).toHaveLength(50)
    expect(r.keywords[0]).toBe("kw0")
  })

  it("devuelve listas vacias (no undefined) cuando faltan los campos", () => {
    const r = parseOrganizationResponse({ organization: { id: "o" } })!
    expect(r.technologies).toEqual([])
    expect(r.keywords).toEqual([])
  })
})

describe("parseBulkOrganizationResponse", () => {
  it("preserva el orden y los huecos para poder re-emparejar por indice", () => {
    const r = parseBulkOrganizationResponse({
      organizations: [{ id: "a" }, null, { id: "c" }],
    })
    expect(r).toHaveLength(3)
    expect(r[0]?.id).toBe("a")
    expect(r[1]).toBeNull()
    expect(r[2]?.id).toBe("c")
  })

  it("devuelve [] ante respuestas invalidas", () => {
    expect(parseBulkOrganizationResponse(null)).toEqual([])
    expect(parseBulkOrganizationResponse({})).toEqual([])
    expect(parseBulkOrganizationResponse({ organizations: "nope" })).toEqual([])
  })
})

describe("countEnrichCredits — Apollo cobra por cuenta resuelta", () => {
  it("cobra 1 por el enrich simple que matchea", () => {
    expect(countEnrichCredits({ organization: { id: "o" } })).toBe(1)
  })

  it("no cobra cuando no matchea", () => {
    expect(countEnrichCredits({ organization: null })).toBe(0)
    expect(countEnrichCredits({})).toBe(0)
  })

  it("en bulk cobra por los que matchearon, NO por los dominios enviados", () => {
    // 5 dominios enviados, 3 matchean -> 3 creditos
    const resp = { organizations: [{ id: "a" }, null, { id: "c" }, null, { id: "e" }] }
    expect(countEnrichCredits(resp)).toBe(3)
  })

  it("un bulk sin ningun match no cuesta nada", () => {
    expect(countEnrichCredits({ organizations: [null, null] })).toBe(0)
  })

  it("no explota con respuestas invalidas", () => {
    expect(countEnrichCredits(null)).toBe(0)
    expect(countEnrichCredits("nope")).toBe(0)
    expect(countEnrichCredits({ organizations: "nope" })).toBe(0)
  })
})

describe("parseOrganizationResponse — campos de alto valor (Fase 1.2)", () => {
  it("prefiere organization_revenue, que cubre el doble que annual_revenue", () => {
    // Medido: annual_revenue esta en 53% de los payloads, organization_revenue
    // en 100%, y cuando ambos existen nunca difieren.
    const soloOrg = parseOrganizationResponse({
      organization: { id: "o", organization_revenue: 880000000 },
    })!
    expect(soloOrg.annualRevenue).toBe(880000000)

    const ambos = parseOrganizationResponse({
      organization: { id: "o", annual_revenue: 500, organization_revenue: 500 },
    })!
    expect(ambos.annualRevenue).toBe(500)
  })

  it("extrae el headcount por area", () => {
    const r = parseOrganizationResponse({
      organization: {
        id: "o",
        departmental_head_count: { information_technology: 700, engineering: 472 },
      },
    })!
    expect(r.departmentalHeadCount).toEqual({
      information_technology: 700,
      engineering: 472,
    })
  })

  it("descarta claves no numericas del headcount sin romper", () => {
    const r = parseOrganizationResponse({
      organization: { id: "o", departmental_head_count: { it: 5, basura: "x", nulo: null } },
    })!
    expect(r.departmentalHeadCount).toEqual({ it: 5 })
  })

  it("saca el telefono del objeto anidado, prefiriendo el sanitizado", () => {
    const r = parseOrganizationResponse({
      organization: {
        id: "o",
        primary_phone: { number: "+33 1 64 50 66 34", sanitized_number: "+33164506634" },
      },
    })!
    expect(r.phone).toBe("+33164506634")
  })

  it("cae a `number` si no hay sanitized_number", () => {
    const r = parseOrganizationResponse({
      organization: { id: "o", primary_phone: { number: "+5411 5000-0000" } },
    })!
    expect(r.phone).toBe("+5411 5000-0000")
  })

  it("extrae linkedin_uid como numero", () => {
    expect(
      parseOrganizationResponse({ organization: { id: "o", linkedin_uid: "3046" } })!.linkedinUid,
    ).toBe(3046)
  })
})
