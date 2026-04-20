/**
 * Contract tests: pegan a la API real de Apollo para detectar breaking changes
 * del proveedor. Skipped por default. Para correrlos:
 *
 *   APOLLO_API_KEY=... npm run test:contract
 *
 * No valida valores puntuales (cambian), valida schema y shape.
 */

import { describe, expect, it } from "vitest"

const RUN = process.env.RUN_APOLLO_CONTRACT_TESTS === "1"
const hasKey = !!process.env.APOLLO_API_KEY

const runIf = RUN && hasKey ? describe : describe.skip

runIf("Apollo API contract", () => {
  it("organizations/enrich con dominio conocido devuelve organization.id", async () => {
    const res = await fetch("https://api.apollo.io/api/v1/organizations/enrich", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": process.env.APOLLO_API_KEY!,
      },
      body: JSON.stringify({ domain: "vercel.com" }),
    })
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(data.organization?.id).toBeTruthy()
  })

  it("mixed_people/search con organization_ids devuelve schema esperado", async () => {
    const res = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": process.env.APOLLO_API_KEY!,
      },
      body: JSON.stringify({
        q_organization_domains_list: ["vercel.com"],
        person_titles: ["CEO"],
        per_page: 1,
        page: 1,
      }),
    })
    expect(res.ok).toBe(true)
    const data = await res.json()
    expect(Array.isArray(data.people)).toBe(true)
    if (data.people.length > 0) {
      const p = data.people[0]
      expect(typeof p.id).toBe("string")
      // los campos de search minimal deberian existir aunque sea vacios
      expect("first_name" in p || "name" in p).toBe(true)
    }
  })
})

if (!RUN || !hasKey) {
  describe("Apollo API contract (skipped)", () => {
    it("no run — set RUN_APOLLO_CONTRACT_TESTS=1 y APOLLO_API_KEY", () => {
      expect(true).toBe(true)
    })
  })
}
