/**
 * Tests del flujo de enrichment + phone reveal.
 *
 * Se enfoca en el bug reportado: Apollo puede devolver el telefono inline
 * en el response sincronico del segundo people/match, y antes lo ignoramos.
 *
 * Mockea global.fetch y verifica el comportamiento de enrichPerson.
 */

import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"
import { enrichPerson } from "@/lib/apollo/enrich"
import type { ApolloPersonNormalized } from "@/lib/apollo/parsers"

// Silenciar el logger (que toca supabase)
vi.mock("@/lib/apollo/logger", () => ({
  logApolloCall: vi.fn().mockResolvedValue(undefined),
}))

const basePerson: ApolloPersonNormalized = {
  apolloId: "p_1",
  firstName: "Juan",
  lastName: "Perez",
  fullName: "Juan Perez",
  title: "CFO",
  headline: null,
  email: null,
  emailStatus: null,
  linkedinUrl: null,
  photoUrl: null,
  city: null,
  state: null,
  country: null,
  seniority: "c_suite",
  departments: [],
  mobilePhone: null,
  workPhone: null,
  organizationId: null,
}

const baseOpts = {
  userId: "u_1",
  bookmarkId: "b_1",
  companyId: "c_1",
}

describe("enrichPerson", () => {
  const originalFetch = global.fetch
  const originalApiKey = process.env.APOLLO_API_KEY

  beforeEach(() => {
    process.env.APOLLO_API_KEY = "test-key"
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env.APOLLO_API_KEY = originalApiKey
    vi.restoreAllMocks()
  })

  it("merge email del primer people/match", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        person: {
          id: "p_1",
          first_name: "Juan",
          last_name: "Perez",
          email: "juan@acme.com",
          email_status: "verified",
        },
      }),
    })

    const result = await enrichPerson(basePerson, { ...baseOpts, revealEmail: true, revealPhone: false })
    expect(result.email).toBe("juan@acme.com")
    expect(result.emailStatus).toBe("verified")
    expect(result.enrichmentStatus).toBe("ok")
    expect(global.fetch).toHaveBeenCalledTimes(1) // solo el primero, sin phone
  })

  it("FIX: lee phone_numbers del response sync del segundo people/match", async () => {
    const calls: Array<{ url: string; body: unknown }> = []

    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      calls.push({ url: String(url), body })

      // Primer match (email)
      if (!body.reveal_phone_number) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            person: { id: "p_1", email: "juan@acme.com" },
          }),
        }
      }

      // Segundo match (phone) — devuelve telefono inline, NO async webhook
      return {
        ok: true,
        status: 200,
        json: async () => ({
          person: {
            id: "p_1",
            phone_numbers: [
              { raw_number: "+54 11 1234 5678", type: "mobile", status: "verified" },
            ],
          },
        }),
      }
    })

    const result = await enrichPerson(basePerson, {
      ...baseOpts,
      revealEmail: true,
      revealPhone: true,
    })

    expect(result.mobilePhone).toBe("+54 11 1234 5678")
    expect(result.phoneAwaitingWebhook).toBe(false)
    expect(calls).toHaveLength(2)
  })

  it("si phone reveal devuelve vacio, marca phoneAwaitingWebhook=true", async () => {
    global.fetch = vi.fn().mockImplementation(async (_, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      if (!body.reveal_phone_number) {
        return { ok: true, status: 200, json: async () => ({ person: { id: "p_1" } }) }
      }
      return { ok: true, status: 200, json: async () => ({ person: { id: "p_1" } }) }
    })

    const result = await enrichPerson(basePerson, {
      ...baseOpts,
      revealPhone: true,
    })

    expect(result.mobilePhone).toBeNull()
    expect(result.phoneAwaitingWebhook).toBe(true)
  })

  it("opt-in off: no hace segunda llamada a people/match", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ person: { id: "p_1", email: "j@acme.com" } }),
    })
    global.fetch = fetchMock

    await enrichPerson(basePerson, { ...baseOpts, revealPhone: false })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("enriquecimiento parcial si primer match falla", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
      json: async () => ({}),
    })

    const result = await enrichPerson(basePerson, {
      ...baseOpts,
      revealPhone: false,
    })

    expect(result.enrichmentStatus).toBe("failed")
    expect(result.apolloId).toBe("p_1") // conserva los datos del search
  })

  it("incluye webhook_url cuando se provee", async () => {
    const calls: Array<{ body: Record<string, unknown> }> = []
    global.fetch = vi.fn().mockImplementation(async (_, init) => {
      const body = init?.body ? JSON.parse(init.body as string) : {}
      calls.push({ body })
      return { ok: true, status: 200, json: async () => ({ person: { id: "p_1" } }) }
    })

    await enrichPerson(basePerson, {
      ...baseOpts,
      revealPhone: true,
      webhookUrl: "https://example.com/api/webhooks/apollo",
    })

    const phoneCall = calls.find((c) => c.body.reveal_phone_number)
    expect(phoneCall?.body.webhook_url).toBe("https://example.com/api/webhooks/apollo")
  })
})
