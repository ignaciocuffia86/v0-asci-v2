import { describe, expect, it } from "vitest"
import { extractRateLimits, isNearLimit } from "@/lib/apollo/rate-limits"

const h = (obj: Record<string, string>) => new Headers(obj)

describe("extractRateLimits", () => {
  it("lee la familia x-rate-limit-* / x-*-requests-left de Apollo", () => {
    const r = extractRateLimits(
      h({
        "x-rate-limit-minute": "50",
        "x-minute-requests-left": "43",
        "x-minute-usage": "7",
        "x-rate-limit-hourly": "200",
        "x-hourly-requests-left": "150",
        "x-rate-limit-daily": "5000",
        "x-daily-requests-left": "4800",
      }),
    )
    expect(r.minute).toEqual({ limit: 50, remaining: 43, used: 7 })
    expect(r.hourly.limit).toBe(200)
    expect(r.daily.remaining).toBe(4800)
  })

  it("cae a los headers genericos X-RateLimit-* para la ventana corta", () => {
    const r = extractRateLimits(h({ "X-RateLimit-Limit": "100", "X-RateLimit-Remaining": "9" }))
    expect(r.minute.limit).toBe(100)
    expect(r.minute.remaining).toBe(9)
  })

  it("lee Retry-After de un 429", () => {
    expect(extractRateLimits(h({ "retry-after": "30" })).retryAfterSeconds).toBe(30)
  })

  it("no explota cuando no hay headers", () => {
    const r = extractRateLimits(null)
    expect(r.minute.limit).toBeNull()
    expect(r.retryAfterSeconds).toBeNull()
    expect(r.raw).toEqual({})
  })

  it("conserva en raw los headers de cuota que todavia no interpretamos", () => {
    const r = extractRateLimits(h({ "x-rate-limit-inventado": "7" }))
    expect(r.raw["x-rate-limit-inventado"]).toBe("7")
  })

  it("ignora un valor no numerico en vez de devolver NaN", () => {
    expect(extractRateLimits(h({ "x-rate-limit-minute": "unlimited" })).minute.limit).toBeNull()
  })
})

describe("isNearLimit", () => {
  it("avisa cuando alguna ventana se agota", () => {
    expect(isNearLimit(extractRateLimits(h({ "x-daily-requests-left": "2" })))).toBe(true)
  })
  it("no avisa con cupo de sobra", () => {
    expect(isNearLimit(extractRateLimits(h({ "x-minute-requests-left": "40" })))).toBe(false)
  })
  it("no avisa cuando no hay informacion", () => {
    expect(isNearLimit(extractRateLimits(null))).toBe(false)
  })
})
