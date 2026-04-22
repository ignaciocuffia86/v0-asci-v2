import { describe, expect, it } from "vitest"
import {
  normalizePerson,
  parseSearchResponse,
  parseOrganizationResponse,
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
