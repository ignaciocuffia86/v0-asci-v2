/**
 * LATAM Financial Regulators API Integration
 *
 * Provides functions to search for public company filings in Latin American
 * stock exchange regulators:
 * - Argentina: CNV (Comisión Nacional de Valores)
 * - Chile: CMF (Comisión para el Mercado Financiero)
 * - Colombia: SFC (Superintendencia Financiera de Colombia)
 * - Mexico: CNBV (Comisión Nacional Bancaria y de Valores)
 * - Brazil: CVM (Comissão de Valores Mobiliários)
 * - Peru: SMV (Superintendencia del Mercado de Valores)
 */

// Country to regulator mapping
export const COUNTRY_REGULATOR_MAP: Record<
  string,
  { code: string; name: string; url: string; hasApi: boolean }
> = {
  argentina: {
    code: "CNV",
    name: "Comisión Nacional de Valores",
    url: "https://www.cnv.gob.ar",
    hasApi: false, // No public API, but has searchable website
  },
  chile: {
    code: "CMF",
    name: "Comisión para el Mercado Financiero",
    url: "https://www.cmfchile.cl",
    hasApi: true, // Has public API
  },
  colombia: {
    code: "SFC",
    name: "Superintendencia Financiera de Colombia",
    url: "https://www.superfinanciera.gov.co",
    hasApi: false,
  },
  mexico: {
    code: "CNBV",
    name: "Comisión Nacional Bancaria y de Valores",
    url: "https://www.gob.mx/cnbv",
    hasApi: false,
  },
  brazil: {
    code: "CVM",
    name: "Comissão de Valores Mobiliários",
    url: "https://www.gov.br/cvm",
    hasApi: true, // Has public API
  },
  peru: {
    code: "SMV",
    name: "Superintendencia del Mercado de Valores",
    url: "https://www.smv.gob.pe",
    hasApi: false,
  },
}

// Normalize country names to keys
export function normalizeCountry(country: string): string | null {
  const normalized = country.toLowerCase().trim()

  const countryMap: Record<string, string> = {
    // Argentina
    argentina: "argentina",
    ar: "argentina",
    arg: "argentina",
    // Chile
    chile: "chile",
    cl: "chile",
    chl: "chile",
    // Colombia
    colombia: "colombia",
    co: "colombia",
    col: "colombia",
    // Mexico
    mexico: "mexico",
    méxico: "mexico",
    mx: "mexico",
    mex: "mexico",
    // Brazil
    brazil: "brazil",
    brasil: "brazil",
    br: "brazil",
    bra: "brazil",
    // Peru
    peru: "peru",
    perú: "peru",
    pe: "peru",
    per: "peru",
    // US (for reference)
    "united states": "us",
    usa: "us",
    us: "us",
    "estados unidos": "us",
  }

  return countryMap[normalized] || null
}

/**
 * Check if a country has a LATAM regulator we can search
 */
export function hasLatamRegulator(country: string): boolean {
  const normalized = normalizeCountry(country)
  return normalized !== null && normalized !== "us" && COUNTRY_REGULATOR_MAP[normalized] !== undefined
}

/**
 * Get the regulator info for a country
 */
export function getRegulatorInfo(country: string) {
  const normalized = normalizeCountry(country)
  if (!normalized || normalized === "us") return null
  return COUNTRY_REGULATOR_MAP[normalized] || null
}

/**
 * Build search queries for a company in their local regulator
 * These queries are designed for web search to find filings
 */
export function buildRegulatorSearchQueries(
  companyName: string,
  country: string
): string[] {
  const normalized = normalizeCountry(country)
  if (!normalized || normalized === "us") return []

  const regulator = COUNTRY_REGULATOR_MAP[normalized]
  if (!regulator) return []

  // Common document types in Spanish/Portuguese
  const docTypes = {
    argentina: [
      "memoria anual",
      "estados contables",
      "prospecto",
      "hecho relevante",
      "información financiera",
    ],
    chile: [
      "memoria anual",
      "estados financieros",
      "hecho esencial",
      "prospecto de emisión",
    ],
    colombia: [
      "estados financieros",
      "informe de gestión",
      "prospecto",
      "información relevante",
    ],
    mexico: [
      "reporte anual",
      "estados financieros",
      "evento relevante",
      "prospecto de colocación",
    ],
    brazil: [
      "relatório anual",
      "demonstrações financeiras",
      "fato relevante",
      "prospecto",
    ],
    peru: [
      "memoria anual",
      "estados financieros",
      "hecho de importancia",
      "prospecto",
    ],
  }

  const types = docTypes[normalized as keyof typeof docTypes] || []

  return [
    // Direct regulator site search
    `site:${new URL(regulator.url).hostname} "${companyName}"`,
    // Document type searches
    `"${companyName}" ${types[0] || "informe anual"} ${new Date().getFullYear()}`,
    `"${companyName}" ${types[1] || "estados financieros"} ${regulator.code}`,
    // Investor relations
    `"${companyName}" relación con inversionistas ${normalized === "brazil" ? "ri" : "ir"}`,
  ]
}

/**
 * Map document type from LATAM terminology to our standard types
 */
export function mapLatamDocumentType(title: string, url: string): string {
  const combined = `${title} ${url}`.toLowerCase()

  if (
    combined.includes("memoria") ||
    combined.includes("anual") ||
    combined.includes("annual")
  ) {
    return "annual_report"
  }
  if (
    combined.includes("sustentab") ||
    combined.includes("sostenib") ||
    combined.includes("esg")
  ) {
    return "sustainability"
  }
  if (
    combined.includes("financier") ||
    combined.includes("contable") ||
    combined.includes("balance")
  ) {
    return "financial"
  }
  if (
    combined.includes("prospecto") ||
    combined.includes("emisión") ||
    combined.includes("oferta")
  ) {
    return "prospectus"
  }
  if (
    combined.includes("hecho") ||
    combined.includes("relevante") ||
    combined.includes("fato")
  ) {
    return "material_event"
  }
  if (combined.includes("trimest") || combined.includes("quarter")) {
    return "quarterly_report"
  }

  return "financial"
}

/**
 * Get list of local stock exchanges for a country
 */
export function getLocalExchanges(country: string): string[] {
  const normalized = normalizeCountry(country)
  if (!normalized) return []

  const exchanges: Record<string, string[]> = {
    argentina: ["BYMA", "Bolsas y Mercados Argentinos"],
    chile: ["BCS", "Bolsa de Comercio de Santiago"],
    colombia: ["BVC", "Bolsa de Valores de Colombia"],
    mexico: ["BMV", "Bolsa Mexicana de Valores"],
    brazil: ["B3", "Brasil Bolsa Balcão"],
    peru: ["BVL", "Bolsa de Valores de Lima"],
  }

  return exchanges[normalized] || []
}
