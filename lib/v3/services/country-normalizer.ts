import "server-only"
import { GoogleGenerativeAI } from "@google/generative-ai"

/**
 * FASE 5: Normalización de países con IA + heurística
 * Procesa valores como "Greater Buenos Aires", "New York, NY" → ISO alpha-2
 *
 * Estrategia:
 * 1. Heurística pura: regex de US states, LATAM regions, diccionario de países
 * 2. Fallback a Gemini: batch de 20 valores ambiguos, con sistema prompt
 *    que entiende que debe devolver JSON {country: string, iso: string}
 */

interface CountryMapping {
  country: string
  iso: string
  confidence: "high" | "medium" | "low"
}

// Diccionario de países ISO 3166-1 alpha-2 (completo)
const COUNTRY_ISO_DICT: Record<string, string> = {
  argentina: "AR",
  chile: "CL",
  colombia: "CO",
  mexico: "MX",
  peru: "PE",
  brazil: "BR",
  brasil: "BR",
  paraguay: "PY",
  uruguay: "UY",
  bolivia: "BO",
  ecuador: "EC",
  panama: "PA",
  venezuela: "VE",
  costa_rica: "CR",
  el_salvador: "SV",
  guatemala: "GT",
  honduras: "HN",
  nicaragua: "NI",
  dominican_republic: "DO",
  cuba: "CU",
  puerto_rico: "PR",
  jamaica: "JM",
  haiti: "HT",
  trinidad_and_tobago: "TT",
  barbados: "BB",
  bahamas: "BS",
  belize: "BZ",
  bermuda: "BM",
  spain: "ES",
  españa: "ES",
  united_kingdom: "GB",
  uk: "GB",
  england: "GB",
  france: "FR",
  germany: "DE",
  alemania: "DE",
  italy: "IT",
  portugal: "PT",
  netherlands: "NL",
  belgium: "BE",
  switzerland: "CH",
  suiza: "CH",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  poland: "PL",
  czechia: "CZ",
  czech_republic: "CZ",
  austria: "AT",
  romania: "RO",
  greece: "GR",
  grecia: "GR",
  hungary: "HU",
  slovenia: "SI",
  slovakia: "SK",
  croatia: "HR",
  serbia: "RS",
  bulgaria: "BG",
  estonia: "EE",
  latvia: "LV",
  lithuania: "LT",
  russia: "RU",
  russian_federation: "RU",
  ukraine: "UA",
  belarus: "BY",
  moldova: "MD",
  united_states: "US",
  usa: "US",
  us: "US",
  america: "US",
  canada: "CA",
  mexico: "MX",
  china: "CN",
  japan: "JP",
  south_korea: "KR",
  korea: "KR",
  india: "IN",
  singapore: "SG",
  hong_kong: "HK",
  thailand: "TH",
  vietnam: "VN",
  philippines: "PH",
  malaysia: "MY",
  indonesia: "ID",
  australia: "AU",
  new_zealand: "NZ",
  south_africa: "ZA",
  egypt: "EG",
  nigeria: "NG",
  saudi_arabia: "SA",
  united_arab_emirates: "AE",
  uae: "AE",
  israel: "IL",
  turkey: "TR",
  turquía: "TR",
  luxembourg: "LU",
  malta: "MT",
  iceland: "IS",
  cyprus: "CY",
}

// US States → ISO
const US_STATES: Record<string, string> = {
  "new york": "US", ny: "US",
  "california": "US", ca: "US",
  "texas": "US", tx: "US",
  "florida": "US", fl: "US",
  "pennsylvania": "US", pa: "US",
  "illinois": "US", il: "US",
  "ohio": "US", oh: "US",
  "georgia": "US", ga: "US",
  "massachusetts": "US", ma: "US",
  "washington": "US", wa: "US", dc: "US",
  "virginia": "US", va: "US",
  "maryland": "US", md: "US",
  "colorado": "US", co: "US",
  "arizona": "US", az: "US",
  "oregon": "US", or: "US",
  "utah": "US", ut: "US",
  "nevada": "US", nv: "US",
  "minnesota": "US", mn: "US",
  "michigan": "US", mi: "US",
  "wisconsin": "US", wi: "US",
  "indiana": "US", in: "US",
  "tennessee": "US", tn: "US",
  "north carolina": "US", nc: "US",
  "south carolina": "US", sc: "US",
  "alabama": "US", al: "US",
  "louisiana": "US", la: "US",
  "missouri": "US", mo: "US",
  "kansas": "US", ks: "US",
  "oklahoma": "US", ok: "US",
  "new mexico": "US", nm: "US",
  "connecticut": "US", ct: "US",
  "new jersey": "US", nj: "US",
  "vermont": "US", vt: "US",
  "new hampshire": "US", nh: "US",
  "maine": "US", me: "US",
  "rhode island": "US", ri: "US",
  "hawaii": "US", hi: "US",
  "alaska": "US", ak: "US",
  "idaho": "US", id: "US",
  "montana": "US", mt: "US",
  "wyoming": "US", wy: "US",
  "iowa": "US", ia: "US",
  "arkansas": "US", ar: "US",
  "mississippi": "US", ms: "US",
  "nebraska": "US", ne: "US",
  "south dakota": "US", sd: "US",
  "north dakota": "US", nd: "US",
}

// Regiones metropolitanas LATAM
const LATAM_REGIONS: Record<string, string> = {
  "greater buenos aires": "AR",
  "buenos aires": "AR",
  "lima metropolitan area": "PE",
  "lima": "PE",
  "santiago metropolitan area": "CL",
  "santiago": "CL",
  "bogotá": "CO",
  "bogota": "CO",
  "mexico city": "MX",
  "ciudad de méxico": "MX",
  "são paulo": "BR",
  "sao paulo": "BR",
  "rio de janeiro": "BR",
  "brasília": "BR",
  "brasilia": "BR",
  "montevideo": "UY",
  "asunción": "PY",
  "asuncion": "PY",
  "la paz": "BO",
  "quito": "EC",
  "panama city": "PA",
  "caracas": "VE",
}

/**
 * Heurística: intenta normalizar sin IA
 * Retorna el ISO si encuentra match de alta confianza, null en caso contrario
 */
export function tryHeuristicNormalization(locationString: string): CountryMapping | null {
  if (!locationString || typeof locationString !== "string") return null

  const norm = locationString.toLowerCase().trim()

  // 1. Check LATAM regions first (most specific)
  for (const [region, iso] of Object.entries(LATAM_REGIONS)) {
    if (norm === region || norm.startsWith(region)) {
      return { country: locationString, iso, confidence: "high" }
    }
  }

  // 2. Check full country names
  for (const [country, iso] of Object.entries(COUNTRY_ISO_DICT)) {
    if (norm === country.replace(/_/g, " ") || norm === country.replace(/_/g, "_")) {
      return { country: locationString, iso, confidence: "high" }
    }
  }

  // 3. Check US states / cities
  for (const [state, iso] of Object.entries(US_STATES)) {
    if (norm.includes(state)) {
      return { country: locationString, iso, confidence: "high" }
    }
  }

  // 4. Fuzzy: si termina con "Metropolitan Area" y contiene algo conocido
  if (norm.includes("metropolitan area")) {
    for (const [region, iso] of Object.entries(LATAM_REGIONS)) {
      if (norm.includes(region.split(" ")[0])) {
        return { country: locationString, iso, confidence: "medium" }
      }
    }
  }

  // No match heurístico
  return null
}

/**
 * Fase 5 con IA: procesa batch de valores que la heurística no pudo resolver
 * Usa Gemini con system prompt que asegura JSON válido
 */
export async function normalizeWithAI(ambiguousLocations: string[]): Promise<CountryMapping[]> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) {
    console.error("[country-normalizer] GOOGLE_GENERATIVE_AI_API_KEY no disponible")
    return []
  }

  const client = new Google({ apiKey })
  const model = client.getGenerativeModel({ model: "gemini-1.5-flash" })

  const results: CountryMapping[] = []

  // Batch de máx 10 a la vez para evitar sobrecargar y mantener latencia baja
  for (let i = 0; i < ambiguousLocations.length; i += 10) {
    const batch = ambiguousLocations.slice(i, i + 10)
    const batchStr = batch.map((loc, idx) => `${idx + 1}. "${loc}"`).join("\n")

    const prompt = `You are an expert geopolitical AI that normalizes geographic locations to ISO 3166-1 alpha-2 country codes.

Given these ambiguous locations, determine the country ISO code for each. Be conservative: if unsure, return null.

Locations:
${batchStr}

Respond ONLY with valid JSON array, NO other text. Each item must be:
{ "original": "string", "iso": "XX" or null, "confidence": "high"|"medium"|"low" }

Example:
[
  { "original": "Greater Buenos Aires", "iso": "AR", "confidence": "high" },
  { "original": "Annapolis Junction, MD", "iso": "US", "confidence": "high" },
  { "original": "Unknown Place", "iso": null, "confidence": "low" }
]`

    try {
      const response = await model.generateContent(prompt)
      const text = response.response.text().trim()

      // Extract JSON from markdown if needed
      let jsonStr = text
      if (text.includes("```json")) {
        const match = text.match(/```json\s*([\s\S]*?)\s*```/)
        jsonStr = match ? match[1] : text
      } else if (text.includes("```")) {
        const match = text.match(/```\s*([\s\S]*?)\s*```/)
        jsonStr = match ? match[1] : text
      }

      const parsed = JSON.parse(jsonStr)
      if (!Array.isArray(parsed)) throw new Error("Response is not an array")

      for (const item of parsed) {
        if (item.iso && item.original) {
          results.push({
            country: item.original,
            iso: item.iso.toUpperCase(),
            confidence: item.confidence || "medium",
          })
        }
      }
    } catch (e) {
      console.error(`[country-normalizer] Error procesando batch ${i / 10 + 1}:`, e)
      // Continúa con el siguiente batch
    }
  }

  return results
}

/**
 * Orquesta el flujo completo: heurística → IA para los fallidos
 */
export async function normalizeCountries(locations: string[]): Promise<CountryMapping[]> {
  const results: CountryMapping[] = []
  const needsAI: string[] = []

  // Fase 1: Heurística
  for (const loc of locations) {
    const heuristic = tryHeuristicNormalization(loc)
    if (heuristic) {
      results.push(heuristic)
    } else {
      needsAI.push(loc)
    }
  }

  // Fase 2: IA para fallidos
  if (needsAI.length > 0) {
    const aiResults = await normalizeWithAI(needsAI)
    results.push(...aiResults)
  }

  return results
}
