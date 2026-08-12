import { describe, expect, it } from "vitest"
import { hashSearchParams, buildCanonicalKey, normalizeTitle } from "@/lib/apollo/query-hash"

describe("normalizeTitle", () => {
  it("lowercase + trim + colapsa espacios", () => {
    expect(normalizeTitle("  Chief Financial   Officer  ")).toBe("chief financial officer")
  })

  it("normaliza smart quotes", () => {
    expect(normalizeTitle("Marketing \u2018Senior\u2019")).toBe("marketing 'senior'")
  })
})

describe("hashSearchParams", () => {
  const base = {
    organizationId: "org_123",
    domain: "acme.com",
    jobTitles: ["CFO", "Finance Director"],
    country: "Argentina",
    includeSimilarTitles: true,
  }

  it("es determinista", () => {
    expect(hashSearchParams(base)).toBe(hashSearchParams(base))
  })

  it("es independiente del orden de titles", () => {
    const h1 = hashSearchParams({ ...base, jobTitles: ["CFO", "Finance Director"] })
    const h2 = hashSearchParams({ ...base, jobTitles: ["Finance Director", "CFO"] })
    expect(h1).toBe(h2)
  })

  it("es independiente del casing de titles", () => {
    const h1 = hashSearchParams({ ...base, jobTitles: ["CFO"] })
    const h2 = hashSearchParams({ ...base, jobTitles: ["cfo"] })
    expect(h1).toBe(h2)
  })

  it("ignora domain cuando hay organization_id", () => {
    const h1 = hashSearchParams({ ...base, domain: "acme.com" })
    const h2 = hashSearchParams({ ...base, domain: "otra.com" })
    expect(h1).toBe(h2)
  })

  it("cambia si cambia el pais", () => {
    const h1 = hashSearchParams({ ...base, country: "Argentina" })
    const h2 = hashSearchParams({ ...base, country: "Mexico" })
    expect(h1).not.toBe(h2)
  })

  it("cambia si cambia includeSimilarTitles", () => {
    const h1 = hashSearchParams({ ...base, includeSimilarTitles: true })
    const h2 = hashSearchParams({ ...base, includeSimilarTitles: false })
    expect(h1).not.toBe(h2)
  })

  it("cambia si cambian seniorities", () => {
    const h1 = hashSearchParams({ ...base, seniorities: ["c_suite"] })
    const h2 = hashSearchParams({ ...base, seniorities: ["director"] })
    expect(h1).not.toBe(h2)
  })

  it("es independiente del orden de seniorities", () => {
    const h1 = hashSearchParams({ ...base, seniorities: ["c_suite", "vp"] })
    const h2 = hashSearchParams({ ...base, seniorities: ["vp", "c_suite"] })
    expect(h1).toBe(h2)
  })

  it("genera un hash versionado (prefijo v2: + 29 hex, 32 chars en total)", () => {
    expect(hashSearchParams(base)).toMatch(/^v2:[a-f0-9]{29}$/)
    expect(hashSearchParams(base)).toHaveLength(32)
  })
})

describe("buildCanonicalKey", () => {
  it("incluye todos los campos semanticamente relevantes", () => {
    const key = buildCanonicalKey({
      organizationId: "org_1",
      domain: null,
      jobTitles: ["CFO"],
      country: "AR",
      seniorities: ["c_suite"],
      departments: ["finance"],
    })
    const obj = JSON.parse(key)
    expect(obj.o).toBe("org_1")
    expect(obj.t).toEqual(["cfo"])
    expect(obj.c).toBe("ar")
    expect(obj.s).toEqual(["c_suite"])
    expect(obj.de).toEqual(["finance"])
  })
})
