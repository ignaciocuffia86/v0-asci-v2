/**
 * Mapa de países con acentos a sus versiones sin acentos
 * Usado para normalizar filtros de búsqueda
 */
const COUNTRY_ACCENT_MAP: Record<string, string> = {
  "México": "Mexico",
  "Panamá": "Panama",
  "Perú": "Peru",
  "España": "Espana",
  "República Dominicana": "Republica Dominicana",
}

/**
 * Elimina acentos de un texto
 */
export function removeAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

/**
 * Normaliza un nombre de país para búsqueda
 * Retorna tanto la versión con acento como sin acento para cubrir ambos casos en la DB
 */
export function normalizeCountryForSearch(country: string): string[] {
  const withoutAccent = COUNTRY_ACCENT_MAP[country] || removeAccents(country)
  
  // Si el país tiene acento, retornar ambas versiones
  if (withoutAccent !== country) {
    return [country, withoutAccent]
  }
  
  return [country]
}

/**
 * Normaliza un array de países para búsqueda
 * Expande cada país con acento a incluir su versión sin acento
 */
export function normalizeCountriesForSearch(countries: string[]): string[] {
  const normalized = new Set<string>()
  
  for (const country of countries) {
    const variants = normalizeCountryForSearch(country)
    variants.forEach(v => normalized.add(v))
  }
  
  return Array.from(normalized)
}
