import { describe, expect, it } from "vitest"
import { normalizeDomain, extractLinkedinCompanySlug } from "@/lib/apollo/domain"

describe("normalizeDomain", () => {
  it("devuelve null para inputs vacios", () => {
    expect(normalizeDomain(null)).toBeNull()
    expect(normalizeDomain("")).toBeNull()
    expect(normalizeDomain("   ")).toBeNull()
  })

  it("extrae hostname de URL completa con path", () => {
    expect(normalizeDomain("https://acme.com/about")?.primary).toBe("acme.com")
  })

  it("maneja strings sin protocolo", () => {
    expect(normalizeDomain("acme.com")?.primary).toBe("acme.com")
    expect(normalizeDomain("www.acme.com")?.primary).toBe("acme.com")
  })

  it("extrae compound TLDs (.com.ar, .com.br, .co.uk)", () => {
    expect(normalizeDomain("acme.com.ar")?.primary).toBe("acme.com.ar")
    expect(normalizeDomain("https://empresa.com.br/")?.primary).toBe("empresa.com.br")
    expect(normalizeDomain("firm.co.uk")?.primary).toBe("firm.co.uk")
  })

  it("identifica registrable domain desde subdominio regional", () => {
    const result = normalizeDomain("https://ar.acme.com.ar/contact")
    expect(result?.primary).toBe("acme.com.ar")
    expect(result?.fallbacks).toContain("ar.acme.com.ar")
  })

  it("elimina www sin crear fallback duplicado", () => {
    const result = normalizeDomain("https://www.acme.com")
    expect(result?.primary).toBe("acme.com")
    expect(result?.fallbacks).not.toContain("acme.com")
  })

  it("rechaza IPs", () => {
    expect(normalizeDomain("192.168.1.1")).toBeNull()
    expect(normalizeDomain("http://127.0.0.1:3000")).toBeNull()
  })

  it("rechaza strings sin punto", () => {
    expect(normalizeDomain("localhost")).toBeNull()
    expect(normalizeDomain("just-a-word")).toBeNull()
  })

  it("es case-insensitive", () => {
    expect(normalizeDomain("https://ACME.COM")?.primary).toBe("acme.com")
  })

  it("toma la primera parte si hay espacios accidentales", () => {
    expect(normalizeDomain("acme.com otra.com")?.primary).toBe("acme.com")
  })
})

describe("extractLinkedinCompanySlug", () => {
  it("extrae el slug de company", () => {
    expect(extractLinkedinCompanySlug("https://www.linkedin.com/company/acme-inc/")).toBe("acme-inc")
  })

  it("es case-insensitive", () => {
    expect(extractLinkedinCompanySlug("https://linkedin.com/company/ACME-Inc")).toBe("acme-inc")
  })

  it("devuelve null si no es url de company", () => {
    expect(extractLinkedinCompanySlug("https://linkedin.com/in/juan-perez")).toBeNull()
    expect(extractLinkedinCompanySlug(null)).toBeNull()
  })
})
