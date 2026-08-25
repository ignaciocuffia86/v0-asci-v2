import { describe, expect, it } from "vitest"
import {
  extractConsistentLinkedinCompanyId,
  parseLinkedinCompanyId,
} from "@/lib/v3/services/linkedin-company-id"

describe("parseLinkedinCompanyId", () => {
  it("acepta numéricos como string o número", () => {
    expect(parseLinkedinCompanyId("321888")).toBe(321888)
    expect(parseLinkedinCompanyId(382280)).toBe(382280)
  })

  it("rechaza lo no numérico, vacío, cero y desbordes", () => {
    expect(parseLinkedinCompanyId("ypf")).toBeNull()
    expect(parseLinkedinCompanyId("")).toBeNull()
    expect(parseLinkedinCompanyId(null)).toBeNull()
    expect(parseLinkedinCompanyId("0")).toBeNull()
    expect(parseLinkedinCompanyId("12.5")).toBeNull()
    expect(parseLinkedinCompanyId("1234567890123456")).toBeNull()
  })
})

describe("extractConsistentLinkedinCompanyId", () => {
  it("aprende cuando todas las aceptadas coinciden en un ID", () => {
    const result = extractConsistentLinkedinCompanyId([
      { companyId: "321888", title: "a" },
      { companyId: 321888, title: "b" },
      { title: "sin id" },
    ])
    expect(result).toEqual({ id: 321888, mixed: false })
  })

  it("NO aprende con IDs mezclados (posible falso positivo de atribución)", () => {
    const result = extractConsistentLinkedinCompanyId([
      { companyId: "321888" },
      { companyId: "999999" },
    ])
    expect(result).toEqual({ id: null, mixed: true })
  })

  it("sin ningún ID no aprende ni marca mezcla", () => {
    expect(extractConsistentLinkedinCompanyId([{ title: "x" }])).toEqual({ id: null, mixed: false })
  })
})

describe("[459] el `id` del payload del actor de enrichment", () => {
  // El enrichment lee item.id y lo escribe en companies.linkedin_company_id.
  // harvestapi lo manda como STRING, no como número: si eso cambiara, el
  // backfill y el cron dejarían de aprender el ID en silencio.
  it("parsea el id tal como viene en el payload guardado", () => {
    const item = { id: "9425834", name: "Laminadora Los Angeles S.A." }
    expect(parseLinkedinCompanyId(item.id)).toBe(9425834)
  })

  it("no aprende nada de un payload sin id o con id basura", () => {
    expect(parseLinkedinCompanyId(undefined)).toBeNull()
    expect(parseLinkedinCompanyId("urn:li:fsd_company:9425834")).toBeNull()
  })
})
