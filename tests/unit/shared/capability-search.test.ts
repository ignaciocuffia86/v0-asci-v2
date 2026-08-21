import { describe, expect, it } from "vitest"

import {
  decodeCursor,
  encodeCursor,
  exportAdvice,
  resolveCapabilityTerms,
  type CapabilitySearchParams,
} from "@/lib/v3/services/capability-search"
import { domainFromWebsite, firmographicsOf } from "@/lib/v3/mcp-read-tools"
import type { DictionaryData } from "@/lib/v3/services/types"

// Diccionario mínimo que reproduce los dos casos que rompieron en producción:
// una familia partida entre dos productos por keywords ("Dynamics 365") y un
// vendor con varios productos ("Oracle").
const DICT: DictionaryData = {
  vendors: [
    { id: "v-ms", name: "Microsoft" },
    { id: "v-oracle", name: "Oracle" },
  ],
  products: [
    { id: "p-d365-erp", vendor_id: "v-ms", name: "Dynamics 365 ERP", keywords: ["Dynamics 365", "D365"] },
    { id: "p-d365-crm", vendor_id: "v-ms", name: "Dynamics 365 CRM", keywords: ["Dynamics CRM"] },
    { id: "p-angular", vendor_id: null, name: "Angular", keywords: ["AngularJS"] },
    { id: "p-forms", vendor_id: "v-oracle", name: "Oracle Forms", keywords: ["Forms 6i"] },
    { id: "p-ebs", vendor_id: "v-oracle", name: "Oracle EBS", keywords: ["E-Business Suite"] },
  ],
  processes: [{ id: "pr-fin", name: "Control administrativo financiero", keywords: ["contabilidad"] }],
}

describe("resolveCapabilityTerms", () => {
  it("arma un grupo por TÉRMINO PEDIDO, no por entrada del diccionario", async () => {
    const result = await resolveCapabilityTerms(["Angular", "Oracle Forms"], DICT)
    expect(result.groups).toEqual([
      { term: "Angular", ids: ["p-angular"] },
      { term: "Oracle Forms", ids: ["p-forms"] },
    ])
  })

  it("mete las dos mitades de una familia partida en UN solo grupo", async () => {
    // Si cada mitad fuera su propio grupo, termsMode:'all' exigiría CRM Y ERP
    // para alguien que solo escribió "Dynamics 365".
    const result = await resolveCapabilityTerms(["Dynamics 365"], DICT)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].ids.sort()).toEqual(["p-d365-crm", "p-d365-erp"])
  })

  it("expande un vendor a todos sus productos dentro del mismo grupo", async () => {
    const result = await resolveCapabilityTerms(["Oracle"], DICT)
    expect(result.groups[0].ids.sort()).toEqual(["p-ebs", "p-forms"])
  })

  it("permite que un id caiga en más de un grupo cuando los términos se solapan", async () => {
    // "Oracle" incluye a EBS: una señal de EBS satisface los dos requisitos.
    const result = await resolveCapabilityTerms(["Oracle", "Oracle EBS"], DICT)
    expect(result.groups[0].ids).toContain("p-ebs")
    expect(result.groups[1].ids).toEqual(["p-ebs"])
  })

  it("no genera grupo para un término sin resolver", async () => {
    const result = await resolveCapabilityTerms(["Angular", "Cobol++"], DICT)
    expect(result.groups.map((g) => g.term)).toEqual(["Angular"])
    expect(result.unresolved).toEqual(["Cobol++"])
  })
})

describe("cursor de paginación", () => {
  const params: CapabilitySearchParams = {
    terms: ["Angular", "Oracle Forms"],
    countries: ["Argentina"],
    minSignals: 6,
    termsMode: "all",
    mode: "detail",
    limit: 25,
  }

  it("hace round-trip del offset", () => {
    expect(decodeCursor(encodeCursor(params, 50), params)).toBe(50)
  })

  it("ignora el orden y las mayúsculas de los filtros", () => {
    const reordered: CapabilitySearchParams = { ...params, terms: ["oracle forms", "ANGULAR"] }
    expect(decodeCursor(encodeCursor(params, 25), reordered)).toBe(25)
  })

  it("rechaza el cursor si cambió un filtro", () => {
    // El error más fácil de cometer: cambiar un país conservando el cursor y
    // recibir la página 3 de otra búsqueda, que parece plausible.
    const cursor = encodeCursor(params, 25)
    expect(() => decodeCursor(cursor, { ...params, countries: ["Chile"] })).toThrow(/CAPABILITY_CURSOR_MISMATCH/)
    expect(() => decodeCursor(cursor, { ...params, minSignals: 1 })).toThrow(/CAPABILITY_CURSOR_MISMATCH/)
    expect(() => decodeCursor(cursor, { ...params, termsMode: "any" })).toThrow(/CAPABILITY_CURSOR_MISMATCH/)
    expect(() => decodeCursor(cursor, { ...params, include: ["firmographics"] })).toThrow(/CAPABILITY_CURSOR_MISMATCH/)
  })

  it("no se rompe con basura", () => {
    expect(() => decodeCursor("no-es-un-cursor", params)).toThrow(/CAPABILITY_CURSOR_INVALID/)
    expect(() => decodeCursor(Buffer.from('{"o":-1}').toString("base64url"), params)).toThrow(/CAPABILITY_CURSOR_INVALID/)
  })
})

describe("firmográficos", () => {
  it("saca el dominio de una URL con esquema, www y path", () => {
    expect(domainFromWebsite("https://www.lasegunda.com.ar")).toBe("lasegunda.com.ar")
    expect(domainFromWebsite("https://careers-meli.mercadolibre.com/")).toBe("careers-meli.mercadolibre.com")
    expect(domainFromWebsite("HTTP://Galicia.ar/institucional")).toBe("galicia.ar")
    expect(domainFromWebsite(null)).toBeNull()
    expect(domainFromWebsite("  ")).toBeNull()
  })

  it("devuelve TODAS las claves con null explícito cuando falta el dato", () => {
    // Ausente y null no son lo mismo: sin la clave, el modelo no puede
    // distinguir "empresa chica" de "no lo sabemos".
    expect(firmographicsOf({ website: "https://acme.com" })).toEqual({
      linkedinUrl: null,
      domain: "acme.com",
      employeesApollo: null,
      isPublic: null,
      ticker: null,
      stockExchange: null,
    })
  })

  it("preserva un 0 de empleados en vez de convertirlo en null", () => {
    expect(firmographicsOf({ apollo_employees_count: 0 }).employeesApollo).toBe(0)
  })
})

describe("exportAdvice", () => {
  it("da el número concreto de llamadas cuando la lista entera entra", () => {
    const advice = exportAdvice(89, 50)
    expect(advice).toContain("2 llamadas")
    expect(advice).not.toContain("NO intentes")
  })

  it("concuerda el singular cuando es una sola llamada", () => {
    expect(exportAdvice(40, 50)).toContain("es UNA sola llamada y entra")
    // "son 1 llamada ... pedí las 1" era lo que salía antes.
    expect(exportAdvice(40, 50)).not.toMatch(/\b1 llamada\b|las 1\b/)
  })

  it("prohíbe paginar y prohíbe prometer una descarga cuando no entra", () => {
    // El caso que originó todo: 889 filas son 18 llamadas y ~130k tokens.
    const advice = exportAdvice(889, 50)
    expect(advice).toContain("NO intentes")
    expect(advice).toContain("18 llamadas")
    expect(advice).toMatch(/No le prometas un archivo ni una descarga/)
  })

  it("corta en 200, no en el límite de página", () => {
    expect(exportAdvice(200, 50)).not.toContain("NO intentes")
    expect(exportAdvice(201, 50)).toContain("NO intentes")
  })

  it("cuenta las páginas contra el límite MÁXIMO, no contra el que se usó", () => {
    // Visto en una corrida real por MCP: 59 empresas exploradas con limit 3
    // decían "son 20 llamadas", y el modelo iba a hacer 20. Con limit 50 son 2.
    const advice = exportAdvice(59, 3)
    expect(advice).toContain("2 llamadas")
    expect(advice).not.toContain("20 llamadas")
    expect(advice).toContain("subí limit a 50")
    expect(advice).toContain("venís usando 3")
  })

  it("no sugiere subir el límite si ya está en el máximo", () => {
    expect(exportAdvice(59, 50)).not.toContain("subí limit")
  })

  it("cuenta contra el máximo también en la banda alta", () => {
    // Con limit 25 (el default) 889 daría 36; el número honesto es 18.
    expect(exportAdvice(889, 25)).toContain("18 llamadas aun con limit 50")
  })
})
