/**
 * Normalization helpers for company domains before sending them to Apollo.
 *
 * Apollo indexes companies by a registrable domain (ej. acme.com, acme.com.ar).
 * Hoy hacemos `url.hostname.replace("www.", "")` que NO maneja subdominios
 * regionales (ar.acme.com), paths (https://acme.com/about), ni strings sin
 * protocolo (acme.com.ar). Este modulo centraliza la logica y genera variantes
 * para reintento cuando Apollo no encuentra la empresa al primer intento.
 */

export type NormalizedDomain = {
  /** Mejor apuesta — registrable domain (ej: acme.com.ar) */
  primary: string
  /** Variantes a probar en orden si el primario falla */
  fallbacks: string[]
}

/**
 * Sufijos compuestos que deben tratarse como TLD completo.
 * No usamos `tldts` para evitar dependencias; cubrimos los casos mas comunes
 * que vemos en LATAM/ES.
 */
const COMPOUND_TLDS = new Set([
  "com.ar",
  "com.br",
  "com.mx",
  "com.uy",
  "com.pe",
  "com.co",
  "com.ve",
  "com.ec",
  "com.bo",
  "com.py",
  "com.cl",
  "co.uk",
  "co.nz",
  "co.jp",
  "co.kr",
  "co.il",
  "co.za",
  "com.au",
])

/**
 * Extrae el registrable domain de un string que puede ser una URL completa,
 * un hostname, o algo con path. Devuelve null si es irreparable.
 */
export function normalizeDomain(input: string | null | undefined): NormalizedDomain | null {
  if (!input) return null

  let raw = String(input).trim().toLowerCase()
  if (!raw) return null

  // Sanear espacios accidentales
  raw = raw.split(/\s+/)[0]

  // Prepender protocolo si falta
  if (!/^https?:\/\//.test(raw)) {
    raw = `https://${raw}`
  }

  let host: string
  try {
    host = new URL(raw).hostname
  } catch {
    return null
  }

  if (!host) return null

  // Remover trailing dot, puertos (URL ya los saca pero defensive)
  host = host.replace(/\.$/, "")

  // No es un dominio valido (IP, localhost, etc.)
  if (!/\./.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null

  const parts = host.split(".")
  if (parts.length < 2) return null

  // Detectar compound TLD
  const lastTwo = parts.slice(-2).join(".")
  const lastThree = parts.slice(-3).join(".")
  let registrable: string

  if (parts.length >= 3 && COMPOUND_TLDS.has(lastTwo)) {
    // ej: ar.acme.com.ar -> acme.com.ar
    registrable = lastThree
  } else {
    registrable = lastTwo
  }

  const fallbacks: string[] = []
  // Si hay subdominio distinto a www, probarlo tambien
  const stripped = host.replace(/^www\./, "")
  if (stripped !== registrable) {
    fallbacks.push(stripped)
  }

  return { primary: registrable, fallbacks }
}

/**
 * Extrae el vanity handle de un perfil de company en LinkedIn.
 * "https://www.linkedin.com/company/acme-inc/" -> "acme-inc"
 */
export function extractLinkedinCompanySlug(url: string | null | undefined): string | null {
  if (!url) return null
  const match = url.match(/linkedin\.com\/company\/([^/?#]+)/i)
  return match ? match[1].toLowerCase() : null
}
