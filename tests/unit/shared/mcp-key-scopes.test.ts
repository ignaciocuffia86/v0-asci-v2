import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { SCOPES_BY_TYPE, keyTypeFromScopes, effectiveApiKeyScopes, type ApiKeyType } from "@/lib/v3/mcp-key-scopes"

/**
 * Qué scopes exige realmente cada MCP, leídos DEL CÓDIGO.
 *
 * El test lee las fuentes a propósito, y esa es su razón de ser: el bug que vino a
 * arreglar fue exactamente un desfasaje entre las tools registradas y el catálogo
 * de scopes de la key. Una lista hardcodeada acá se habría desfasado igual. Si
 * alguien agrega una tool con un scope nuevo, este test falla hasta que el scope
 * entre en SCOPES_BY_TYPE — que es lo que nadie hizo cuando se agregaron
 * save_account, el enrichment de contactos y el flujo de documentos.
 *
 * Se leen también las libs porque no todos los requirePaidMcp están en el route:
 * el de contactos vive en lib/v3/services/mcp-contact-enrichment.ts, y es
 * justamente uno de los que faltaban.
 */
function scopesRequiredBy(...files: string[]): string[] {
  const found = new Set<string>()
  for (const file of files) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8")
    for (const match of source.matchAll(/requirePaidMcp\(\s*\w+\s*,\s*"([^"]+)"/g)) found.add(match[1])
  }
  return [...found].sort()
}

const SERVER_FILES: Record<Exclude<ApiKeyType, never>, string[]> = {
  standard: [
    "lib/v3/mcp-server-tools.ts",
    "lib/v3/services/mcp-contact-enrichment.ts",
  ],
  explore: ["app/api/v3/mcp/explore/[transport]/route.ts"],
  profiles: ["app/api/v3/mcp/profiles/[transport]/route.ts"],
  // Admin registra EXACTAMENTE las mismas tools que standard —una sola función
  // las registra para los dos perfiles—, así que apunta al mismo archivo. Si
  // alguna vez se bifurcan, este test lo va a notar.
  admin: [
    "lib/v3/mcp-server-tools.ts",
    "lib/v3/services/mcp-contact-enrichment.ts",
  ],
}

describe("catálogo de scopes por tipo de key", () => {
  for (const [type, files] of Object.entries(SERVER_FILES) as [ApiKeyType, string[]][]) {
    it(`la key "${type}" alcanza TODAS las tools de su MCP`, () => {
      const required = scopesRequiredBy(...files)
      const granted = SCOPES_BY_TYPE[type].scopes
      const missing = required.filter((scope) => !granted.includes(scope))
      expect(missing, `scopes que el MCP ${type} exige y la key no otorga: ${missing.join(", ")}`).toEqual([])
    })
  }

  it("no otorga scopes de un MCP que la key no usa", () => {
    // Una key standard no debe poder entrar a explore ni a perfiles: son productos
    // distintos y cada uno se habilita con su propia key.
    expect(SCOPES_BY_TYPE.standard.scopes).not.toContain("explore:read")
    expect(SCOPES_BY_TYPE.standard.scopes).not.toContain("profiles:read")
    expect(SCOPES_BY_TYPE.profiles.scopes).not.toContain("companies:read")
  })

  it("el tipo se deriva por el marcador exclusivo de cada MCP", () => {
    expect(keyTypeFromScopes(SCOPES_BY_TYPE.profiles.scopes)).toBe("profiles")
    expect(keyTypeFromScopes(SCOPES_BY_TYPE.explore.scopes)).toBe("explore")
    expect(keyTypeFromScopes(SCOPES_BY_TYPE.standard.scopes)).toBe("standard")
    expect(keyTypeFromScopes(null)).toBe("standard")
  })
})

describe("effectiveApiKeyScopes", () => {
  it("completa una key standard YA EMITIDA con los scopes que le faltaban", () => {
    // Lo que tiene guardado una key creada antes del fix.
    const emitida = ["companies:read", "signals:read", "accounts:read", "research:run", "research:prepare", "research:submit", "icebreakers:generate", "icebreakers:prepare", "icebreakers:submit", "usage:read"]
    const efectivos = effectiveApiKeyScopes(emitida)
    expect(efectivos).toContain("accounts:write")
    expect(efectivos).toContain("contacts:write")
    expect(efectivos).toContain("documents:read")
    expect(efectivos).toContain("recommendations:read")
  })

  it("NO amplía una key legacy de solo lectura", () => {
    // El caso peligroso: accounts:write corre en modo "read", así que allowedModes
    // no lo frenaría. Completar una key legacy por tipo le daría permiso para
    // ocupar lugares del plan a una credencial que alguien limitó a propósito.
    const efectivos = effectiveApiKeyScopes(["read"])
    expect(efectivos).toContain("companies:read")
    expect(efectivos).not.toContain("accounts:write")
    expect(efectivos).not.toContain("contacts:write")
    expect(efectivos).not.toContain("research:run")
  })

  it("la key legacy de escritura conserva exactamente lo que otorgaba antes", () => {
    const efectivos = effectiveApiKeyScopes(["read", "write"])
    expect(efectivos).toContain("accounts:write")
    expect(efectivos).toContain("research:run")
    // Nunca otorgó Apollo ni documentos, y no se los agrega ahora.
    expect(efectivos).not.toContain("contacts:write")
    expect(efectivos).not.toContain("documents:write")
  })

  it("una key sin scopes guardados queda en solo lectura", () => {
    expect(effectiveApiKeyScopes([])).toEqual(effectiveApiKeyScopes(null))
    expect(effectiveApiKeyScopes(null)).not.toContain("accounts:write")
  })

  it("no toca explore ni profiles: su set ya era el correcto", () => {
    for (const type of ["explore", "profiles"] as const) {
      expect(effectiveApiKeyScopes(SCOPES_BY_TYPE[type].scopes).sort()).toEqual([...SCOPES_BY_TYPE[type].scopes].sort())
    }
  })

  it("es idempotente", () => {
    const once = effectiveApiKeyScopes(SCOPES_BY_TYPE.standard.scopes)
    expect(effectiveApiKeyScopes(once).sort()).toEqual(once.sort())
  })
})
