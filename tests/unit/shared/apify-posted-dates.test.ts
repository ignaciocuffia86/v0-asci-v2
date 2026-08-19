import { describe, expect, it } from "vitest"
import { normalizePostedDate, normalizePostedDates } from "@/lib/v3/services/apify-posted-dates"

const NOW = new Date("2026-08-19T12:00:00.000Z")

describe("normalizePostedDate", () => {
  it("convierte fechas relativas del actor (el caso real del incidente)", () => {
    expect(normalizePostedDate("4 weeks ago", NOW)).toBe("2026-07-22T12:00:00.000Z")
    expect(normalizePostedDate("7 hours ago", NOW)).toBe("2026-08-19T05:00:00.000Z")
    expect(normalizePostedDate("1 week ago", NOW)).toBe("2026-08-12T12:00:00.000Z")
    expect(normalizePostedDate("5 days ago", NOW)).toBe("2026-08-14T12:00:00.000Z")
  })

  it("deja pasar fechas absolutas tal cual (el RPC ya las castea)", () => {
    expect(normalizePostedDate("2026-08-01T10:00:00Z", NOW)).toBe("2026-08-01T10:00:00Z")
    expect(normalizePostedDate("2026-08-01", NOW)).toBe("2026-08-01")
  })

  it("resuelve los atajos de LinkedIn", () => {
    expect(normalizePostedDate("yesterday", NOW)).toBe("2026-08-18T12:00:00.000Z")
    expect(normalizePostedDate("just now", NOW)).toBe(NOW.toISOString())
  })

  it("devuelve null para lo incasteable", () => {
    expect(normalizePostedDate("hace un mes", NOW)).toBeNull()
    expect(normalizePostedDate("", NOW)).toBeNull()
    expect(normalizePostedDate(42, NOW)).toBeNull()
  })
})

describe("normalizePostedDates", () => {
  it("sanea las tres claves que castea el RPC y elimina las incasteables", () => {
    const item = {
      title: "SAP Consultant",
      postedTime: "2 weeks ago",
      publishedAt: "2026-08-10",
      post_date: "algo raro",
    }
    const out = normalizePostedDates(item, NOW)
    expect(out.postedTime).toBe("2026-08-05T12:00:00.000Z")
    expect(out.publishedAt).toBe("2026-08-10")
    expect("post_date" in out).toBe(false)
    expect(out.title).toBe("SAP Consultant")
    // No muta el original
    expect(item.postedTime).toBe("2 weeks ago")
  })
})
