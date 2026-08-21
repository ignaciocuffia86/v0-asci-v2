import { describe, expect, it } from "vitest"
import {
  classifyNewsEvent,
  computeNewsRelevance,
  recencyMultiplier,
  uncoveredTerms,
} from "@/lib/v3/services/news-rules"

/** Fecha fija para que los tests no dependan del reloj. */
const NOW = new Date("2026-08-21T00:00:00Z").getTime()
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()

describe("classifyNewsEvent", () => {
  it("detecta expansión", () => {
    const r = classifyNewsEvent("Omarsa inaugura una planta en Durán")
    expect(r.direction).toBe("expansion")
    expect(r.weight).toBe(25)
  })

  it("la contracción gana sobre expansión aunque compartan vocabulario", () => {
    // "vende la unidad de negocio" contiene "unidad"/"negocio" (expansión) pero
    // es una desinversión: la regla de contracción se evalúa primero.
    const r = classifyNewsEvent("La empresa vende su unidad de negocio agrícola")
    expect(r.direction).toBe("contraccion")
  })

  it("cierre de planta es contracción, no expansión", () => {
    expect(classifyNewsEvent("Cierre de planta en Rosario").direction).toBe("contraccion")
  })

  it("cambio ejecutivo es neutro", () => {
    const r = classifyNewsEvent("Nombran nuevo CIO en el banco")
    expect(r.eventType).toBe("Cambio ejecutivo")
    expect(r.direction).toBe("neutro")
  })

  it("sin match es noticia general", () => {
    const r = classifyNewsEvent("La compañía celebró su aniversario")
    expect(r.eventType).toBe("Noticia general")
    expect(r.weight).toBe(8)
  })
})

describe("recencyMultiplier", () => {
  it("decae por tramos y muere a los 120 días", () => {
    expect(recencyMultiplier(daysAgo(10), NOW)).toBe(1)
    expect(recencyMultiplier(daysAgo(45), NOW)).toBe(0.7)
    expect(recencyMultiplier(daysAgo(75), NOW)).toBe(0.4)
    expect(recencyMultiplier(daysAgo(100), NOW)).toBe(0.2)
    expect(recencyMultiplier(daysAgo(200), NOW)).toBe(0)
  })

  it("sin fecha o fecha rota es 0", () => {
    expect(recencyMultiplier(null, NOW)).toBe(0)
    expect(recencyMultiplier("no es fecha", NOW)).toBe(0)
  })

  it("una fecha futura no puntúa (dato roto)", () => {
    expect(recencyMultiplier(new Date(NOW + 86400000).toISOString(), NOW)).toBe(0)
  })
})

describe("computeNewsRelevance", () => {
  const base = { title: "", summary: null, publishedAt: daysAgo(10), matchedTerms: [], now: NOW }

  it("con match de propuesta es 'propuesta' y puntúa el doble que sin match", () => {
    const conMatch = computeNewsRelevance({
      ...base,
      title: "Banco Ripley anuncia proyecto de innovación con nuevo datacenter",
      matchedTerms: ["datacenter"],
    })
    const sinMatch = computeNewsRelevance({
      ...base,
      title: "Banco Ripley anuncia proyecto de innovación con nuevo datacenter",
    })
    expect(conMatch.type).toBe("propuesta")
    expect(sinMatch.type).toBe("negocio")
    expect(conMatch.score).toBe(sinMatch.score * 2)
  })

  it("expansión sin match es contexto de negocio (para staffing también sirve)", () => {
    const r = computeNewsRelevance({ ...base, title: "OMARSA prepara adquisiciones en Centroamérica" })
    expect(r.type).toBe("negocio")
    expect(r.score).toBeGreaterThan(0)
  })

  it("noticia general reciente sin match es ruido", () => {
    const r = computeNewsRelevance({ ...base, title: "La compañía celebró su aniversario" })
    expect(r.type).toBe("ruido")
    expect(r.score).toBe(0)
  })

  it("fuera de la ventana es ruido aunque matchee la propuesta", () => {
    const r = computeNewsRelevance({
      ...base,
      title: "Proyecto de datacenter",
      publishedAt: daysAgo(300),
      matchedTerms: ["datacenter"],
    })
    expect(r.type).toBe("ruido")
    expect(r.score).toBe(0)
  })

  it("una noticia más vieja puntúa menos que la misma noticia reciente", () => {
    const reciente = computeNewsRelevance({ ...base, title: "Inaugura planta", publishedAt: daysAgo(10) })
    const vieja = computeNewsRelevance({ ...base, title: "Inaugura planta", publishedAt: daysAgo(75) })
    expect(reciente.score).toBeGreaterThan(vieja.score)
  })

  it("conserva la dirección para que el semáforo pueda restar la contracción", () => {
    const r = computeNewsRelevance({ ...base, title: "Cierre de planta y despidos" })
    expect(r.direction).toBe("contraccion")
  })

  it("el score nunca se va de 0-100", () => {
    const r = computeNewsRelevance({
      ...base,
      title: "Expansión con inversión en nueva planta",
      matchedTerms: ["planta"],
    })
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(100)
  })
})

describe("uncoveredTerms", () => {
  it("devuelve los targets sin cobertura, con la grafía original", () => {
    expect(uncoveredTerms(["Datacenter", "SAP", "Power BI"], ["sap"])).toEqual(["Datacenter", "Power BI"])
  })

  it("deduplica y ignora vacíos", () => {
    expect(uncoveredTerms(["SAP", "sap", "  ", "Cloud"], [])).toEqual(["SAP", "Cloud"])
  })

  it("sin targets devuelve lista vacía", () => {
    expect(uncoveredTerms([], ["sap"])).toEqual([])
  })
})
