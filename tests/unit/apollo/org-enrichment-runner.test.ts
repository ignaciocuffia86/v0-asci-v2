import { describe, expect, it, vi, beforeEach } from "vitest"

// vi.hoisted corre antes que los imports, asi que el doble ya existe cuando
// bulkEnrichOrganizations resuelve su import de client.
const { apolloRequest } = vi.hoisted(() => ({ apolloRequest: vi.fn() }))
vi.mock("@/lib/apollo/client", () => ({ apolloRequest }))

import { bulkEnrichOrganizations } from "@/lib/apollo/bulk-organizations"
import { crudoEnIndice } from "@/lib/apollo/org-enrichment-runner"

/**
 * El checkpoint empareja el payload crudo con la empresa POR POSICION. Si esa
 * invariante se rompe, cada empresa queda con el payload de otra: nada falla,
 * pero los datos quedan cruzados en silencio. De ahi que se testee explicito.
 */
describe("crudoEnIndice", () => {
  const raw = { organizations: [{ id: "a" }, null, { id: "c" }] }

  it("devuelve la organizacion de esa posicion", () => {
    expect(crudoEnIndice(raw, 0)).toEqual({ id: "a" })
    expect(crudoEnIndice(raw, 2)).toEqual({ id: "c" })
  })

  it("devuelve null en los huecos y fuera de rango", () => {
    expect(crudoEnIndice(raw, 1)).toBeNull()
    expect(crudoEnIndice(raw, 9)).toBeNull()
  })

  it("no explota con formas inesperadas", () => {
    expect(crudoEnIndice(null, 0)).toBeNull()
    expect(crudoEnIndice({ organizations: "nope" }, 0)).toBeNull()
    expect(crudoEnIndice("texto", 0)).toBeNull()
  })
})

describe("alineacion posicional de bulkEnrichOrganizations", () => {
  beforeEach(() => {
    apolloRequest.mockReset()
  })

  it("mantiene items[i] alineado con organizations[i] y manda los skipped al final", async () => {
    apolloRequest.mockResolvedValue({
      ok: true,
      status: 200,
      latencyMs: 10,
      rateLimits: { minute: {}, hourly: {}, daily: {}, retryAfterSeconds: null, raw: {} },
      // Hueco en el medio: Apollo no resolvio el segundo dominio.
      data: {
        organizations: [
          { id: "org_uno", primary_domain: "uno.com" },
          null,
          { id: "org_tres", primary_domain: "tres.com" },
        ],
      },
    })

    const result = await bulkEnrichOrganizations([
      { companyId: "c1", website: "https://uno.com" },
      // Sin dominio parseable: no se envia, tiene que quedar al final.
      { companyId: "c-sin-dominio", website: "  " },
      { companyId: "c2", website: "https://dos.com" },
      { companyId: "c3", website: "https://tres.com" },
    ])

    expect(result.ok).toBe(true)
    expect(result.items.map((i) => i.companyId)).toEqual(["c1", "c2", "c3", "c-sin-dominio"])
    expect(result.items.map((i) => i.status)).toEqual(["found", "not_found", "found", "skipped"])

    // Lo que de verdad importa: el crudo que se guarda por posicion es el de esa empresa.
    expect(crudoEnIndice(result.raw, 0)).toMatchObject({ id: "org_uno" })
    expect(crudoEnIndice(result.raw, 2)).toMatchObject({ id: "org_tres" })
    expect(result.items[2].organization?.id).toBe("org_tres")
  })

  it("Apollo puede responder con otro primary_domain que el pedido", async () => {
    // El motivo por el que el emparejamiento NO puede ser por dominio.
    apolloRequest.mockResolvedValue({
      ok: true,
      status: 200,
      latencyMs: 10,
      rateLimits: { minute: {}, hourly: {}, daily: {}, retryAfterSeconds: null, raw: {} },
      data: { organizations: [{ id: "org_arcor", primary_domain: "arcor.com" }] },
    })

    const result = await bulkEnrichOrganizations([{ companyId: "c1", website: "https://arcor.com.ar" }])

    expect(result.items[0].requestedDomain).toBe("arcor.com.ar")
    expect(result.items[0].organization?.id).toBe("org_arcor")
    expect(crudoEnIndice(result.raw, 0)).toMatchObject({ primary_domain: "arcor.com" })
  })
})
