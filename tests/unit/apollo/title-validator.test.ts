import { describe, expect, it } from "vitest"
import { validateTitle, sanitizeTitleList } from "@/lib/apollo/title-validator"

describe("validateTitle", () => {
  it("rechaza vacios o muy cortos", () => {
    const r = validateTitle("")
    expect(r.valid).toBe(false)
    const r2 = validateTitle("a")
    expect(r2.valid).toBe(false)
  })

  it("rechaza titulos demasiado largos (> 120)", () => {
    const long = "A".repeat(121)
    const r = validateTitle(long)
    expect(r.valid).toBe(false)
  })

  it("rechaza solo simbolos", () => {
    const r = validateTitle("!!!...")
    expect(r.valid).toBe(false)
  })

  it("acepta titulos validos y devuelve normalized", () => {
    const r = validateTitle("  Chief Financial  Officer  ")
    expect(r.valid).toBe(true)
    if (r.valid) expect(r.normalized).toBe("chief financial officer")
  })

  it("warnea titulos largos (>60) sin rechazarlos", () => {
    const raw = "Director de Tecnologia y Transformacion Digital Global Regional"
    const r = validateTitle(raw)
    expect(r.valid).toBe(true)
    if (r.valid) expect(r.warning).toBeTruthy()
  })

  it("acepta titulos cortos sin warning", () => {
    const r = validateTitle("CFO")
    expect(r.valid).toBe(true)
    if (r.valid) expect(r.warning).toBeUndefined()
  })

  it("acepta caracteres no-ASCII (acentos, n)", () => {
    const r = validateTitle("Director de Operaciones")
    expect(r.valid).toBe(true)
  })
})

describe("sanitizeTitleList", () => {
  it("dedup case-insensitive", () => {
    const { accepted } = sanitizeTitleList(["CFO", "cfo", "Cfo"])
    expect(accepted).toHaveLength(1)
  })

  it("reporta rechazados con razon", () => {
    const { rejected } = sanitizeTitleList(["CFO", "a", "!!!"])
    expect(rejected).toHaveLength(2)
    expect(rejected[0].input).toBe("a")
  })

  it("truncate a max 25 por default", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Title ${i}`)
    const { accepted, truncated } = sanitizeTitleList(many)
    expect(accepted).toHaveLength(25)
    expect(truncated).toBe(true)
  })

  it("respeta parametro max custom", () => {
    const { accepted } = sanitizeTitleList(["CFO", "CTO", "CEO"], { max: 2 })
    expect(accepted).toHaveLength(2)
  })

  it("preserva casing del primer input para display", () => {
    const { accepted } = sanitizeTitleList(["  Chief Financial Officer  ", "CFO"])
    expect(accepted[0]).toBe("Chief Financial Officer")
  })
})
