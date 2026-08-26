import { describe, expect, it } from "vitest"
import {
  decideScrape,
  SCRAPE_COOLDOWN_DAYS,
  SCRAPE_STALE_DAYS,
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

describe("decideScrape · data vencida (re-follow)", () => {
  it("cuenta que se dejó de seguir 6 meses y se volvió a seguir: pasada completa YA, sin esperar su refresh_day", () => {
    // El caso que motivó la regla: import_batches es por compañía y sobrevive al
    // unfollow, así que sin `stale` esto caía en not_due y despues refrescaba con
    // ventana de 30 días, que nunca cubre el hueco de 6 meses.
    const decision = decideScrape(
      facts({ hasAnyBatch: true, latestNonFailedAt: daysAgo(180), dueToday: false }),
      NOW,
    )
    expect(decision).toEqual({ eligible: true, reason: "stale" })
  })

  it("vencida y además es su refresh_day → stale, no monthly (gana la ventana completa)", () => {
    const decision = decideScrape(
      facts({ hasAnyBatch: true, latestNonFailedAt: daysAgo(SCRAPE_STALE_DAYS + 1), dueToday: true }),
      NOW,
    )
    expect(decision).toEqual({ eligible: true, reason: "stale" })
  })

  it("la cadencia mensual normal NO cae en stale: un mes de antigüedad sigue siendo not_due", () => {
    // El margen entre el ciclo normal (~31d como máximo) y el umbral (60d) es lo
    // que evita que todas las cuentas sanas se rescrapeen completas cada mes.
    const decision = decideScrape(
      facts({ hasAnyBatch: true, latestNonFailedAt: daysAgo(31), dueToday: false }),
      NOW,
    )
    expect(decision).toEqual({ eligible: false, skip: "not_due" })
  })

  it("el umbral es inclusivo y no se dispara un día antes", () => {
    const justUnder = decideScrape(
      facts({ hasAnyBatch: true, latestNonFailedAt: daysAgo(SCRAPE_STALE_DAYS - 1), dueToday: false }),
      NOW,
    )
    expect(justUnder).toEqual({ eligible: false, skip: "not_due" })

    const atThreshold = decideScrape(
      facts({ hasAnyBatch: true, latestNonFailedAt: daysAgo(SCRAPE_STALE_DAYS), dueToday: false }),
      NOW,
    )
    expect(atThreshold).toEqual({ eligible: true, reason: "stale" })
  })

  it("vencida pero con los reintentos agotados → attempts: stale no saltea el tope de gasto", () => {
    const decision = decideScrape(
      facts({
        hasAnyBatch: true,
        latestNonFailedAt: daysAgo(365),
        failedSinceLastSuccess: 3,
        dueToday: false,
      }),
      NOW,
    )
    expect(decision).toEqual({ eligible: false, skip: "attempts" })
  })

  it("el marcador del run en vuelo la saca de stale: no se re-corre cada 10 min", () => {
    // El corredor marca el intento ANTES de gastar y ese batch `uploading` cuenta
    // como último no-fallido, así que la compañía deja de ser stale en la pasada
    // siguiente. Esto es lo que hace que `stale` no necesite su propio cooldown.
    const decision = decideScrape(
      facts({ hasAnyBatch: true, latestNonFailedAt: daysAgo(0), dueToday: false }),
      NOW,
    )
    expect(decision).toEqual({ eligible: false, skip: "not_due" })
  })
})
