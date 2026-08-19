import { describe, expect, it } from "vitest"
import {
  decideScrape,
  SCRAPE_COOLDOWN_DAYS,
  type CompanyScrapeFacts,
} from "@/lib/v3/services/job-scrape-eligibility"

const NOW = new Date("2026-08-19T12:00:00Z")

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS).toISOString()

function facts(overrides: Partial<CompanyScrapeFacts> = {}): CompanyScrapeFacts {
  return {
    hasAnyBatch: false,
    latestNonFailedAt: null,
    failedSinceLastSuccess: 0,
    dueToday: false,
    ...overrides,
  }
}

describe("decideScrape", () => {
  it("alta nueva sin ningún batch → primera pasada", () => {
    expect(decideScrape(facts(), NOW)).toEqual({ eligible: true, reason: "first_pass" })
  })

  it("run en vuelo (marcador uploading = batch no fallido reciente) NO se repite", () => {
    const decision = decideScrape(
      facts({ hasAnyBatch: true, latestNonFailedAt: daysAgo(0), dueToday: true }),
      NOW,
    )
    expect(decision).toEqual({ eligible: false, skip: "cooldown" })
  })

  it("scrapeada hoy y con refresh_day hoy: el corredor no la repite en todo el día", () => {
    const decision = decideScrape(
      facts({ hasAnyBatch: true, latestNonFailedAt: daysAgo(0), dueToday: true }),
      NOW,
    )
    expect(decision.eligible).toBe(false)
  })

  it("refresh mensual: due hoy y cooldown vencido → monthly", () => {
    const decision = decideScrape(
      facts({ hasAnyBatch: true, latestNonFailedAt: daysAgo(SCRAPE_COOLDOWN_DAYS + 1), dueToday: true }),
      NOW,
    )
    expect(decision).toEqual({ eligible: true, reason: "monthly" })
  })

  it("cooldown vencido pero NO es su día → not_due", () => {
    const decision = decideScrape(
      facts({ hasAnyBatch: true, latestNonFailedAt: daysAgo(SCRAPE_COOLDOWN_DAYS + 5), dueToday: false }),
      NOW,
    )
    expect(decision).toEqual({ eligible: false, skip: "not_due" })
  })

  it("solo fallidos: reintenta como primera pasada hasta agotar los 3", () => {
    expect(
      decideScrape(facts({ hasAnyBatch: true, failedSinceLastSuccess: 2 }), NOW),
    ).toEqual({ eligible: true, reason: "first_pass" })
    expect(
      decideScrape(facts({ hasAnyBatch: true, failedSinceLastSuccess: 3 }), NOW),
    ).toEqual({ eligible: false, skip: "attempts" })
  })

  it("mensual con reintentos agotados desde el último éxito → attempts", () => {
    const decision = decideScrape(
      facts({
        hasAnyBatch: true,
        latestNonFailedAt: daysAgo(SCRAPE_COOLDOWN_DAYS + 1),
        failedSinceLastSuccess: 3,
        dueToday: true,
      }),
      NOW,
    )
    expect(decision).toEqual({ eligible: false, skip: "attempts" })
  })
})
