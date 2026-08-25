import { describe, expect, it } from "vitest"

import {
  SCREENING_COLUMNS,
  buildCsv,
  exportFileName,
  statusLabel,
  strengthLabel,
  ambiguityLabel,
  termsLabel,
  type ScreeningRow,
} from "@/lib/v3/services/mcp-export"

const row = (over: Partial<ScreeningRow> = {}): ScreeningRow => ({
  input: "AFP HABITAT",
  status: "matched",
  companyId: "e97582bf-a7ee-453a-a87a-6ff6fc287205",
  matchedName: "AFP HABITAT",
  matchConfidence: 0.95,
  domain: "http://www.afphabitat.cl",
  country: "Chile",
  industry: "Financial Services",
  signalsForTerms: 8,
  signalsOwn: 8,
  duplicateEntities: 3,
  signalStrength: "solid",
  ambiguityReason: null,
  candidateCount: 3,
  termHits: [{ term: "Power BI", signals: 8, fromCurrentEmployees: 8 }],
  ...over,
})

describe("etiquetas de la planilla", () => {
  it("distingue en castellano los dos estados que se confunden", () => {
    // En el JSON son inequívocos; en una planilla que lee un vendedor no, y
    // confundirlos invierte la decisión comercial.
    expect(statusLabel("matched_no_signal")).toBe("Está en ASCI, sin la señal")
    expect(statusLabel("no_match")).toBe("No está en ASCI")
    expect(statusLabel("matched_no_signal")).not.toBe(statusLabel("no_match"))
  })

  it("no oculta que una señal débil es una sola mención", () => {
    expect(strengthLabel("weak")).toContain("1 mención")
  })

  it("dice qué hacer con cada tipo de ambigüedad", () => {
    expect(ambiguityLabel("multiple_candidates", 3)).toBe("Elegir entre 3 candidatas")
    expect(ambiguityLabel("low_confidence", 1)).toContain("Confirmar")
    expect(ambiguityLabel(null, 0)).toBe("")
  })

  it("la evidencia muestra cuántas señales son de empleados actuales", () => {
    expect(termsLabel([{ term: "Power BI", signals: 8, fromCurrentEmployees: 5 }])).toBe(
      "Power BI (8, 5 de empleados actuales)",
    )
  })

  it("un estado desconocido se pasa tal cual en vez de perderse", () => {
    expect(statusLabel("estado_nuevo")).toBe("estado_nuevo")
  })
})

describe("buildCsv", () => {
  it("una fila por input, más el encabezado", () => {
    const csv = buildCsv([row(), row({ input: "CCU" })])
    expect(csv.split("\n")).toHaveLength(3)
  })

  it("escapa comas y comillas en vez de romper las columnas", () => {
    const csv = buildCsv([row({ industry: 'Retail, "mayorista"' })])
    const [, dataLine] = csv.split("\n")
    expect(dataLine).toContain('"Retail, ""mayorista"""')
    // El escapado tiene que preservar la cantidad de columnas.
    const cells = dataLine.match(/(".*?"|[^,]*)(,|$)/g)
    expect(cells!.length).toBeGreaterThanOrEqual(SCREENING_COLUMNS.length)
  })

  it("una lista vacía produce solo el encabezado, no un archivo roto", () => {
    expect(buildCsv([]).split("\n")).toHaveLength(1)
  })

  it("el encabezado tiene todas las columnas declaradas", () => {
    expect(buildCsv([]).split(",")).toHaveLength(SCREENING_COLUMNS.length)
  })
})

describe("exportFileName", () => {
  it("saca acentos y caracteres que rompen una descarga", () => {
    expect(exportFileName("Señales / Power BI *Chile*", "2026-08-24T21-00-00", "xlsx")).toBe(
      "Senales-Power-BI-Chile-2026-08-24T21-00-00.xlsx",
    )
  })

  it("nunca queda sin nombre", () => {
    expect(exportFileName("///", "stamp", "csv")).toBe("export-stamp.csv")
  })

  it("acota el largo del prefijo", () => {
    const name = exportFileName("a".repeat(200), "stamp", "xlsx")
    expect(name.length).toBeLessThan(90)
  })
})
