// Helpers PUROS del import de cuentas: detección de headers, normalización de
// URLs de LinkedIn y deduplicación de filas. Sin "server-only" a propósito para
// que los tests unitarios puedan importarlos directo; acá no hay secretos ni
// acceso a datos.
//
// El template canónico y sus sinónimos están documentados en
// docs/feature-carga-masiva-cuentas-y-cron-jobpostings.md (sección 4.1).

export const ACCOUNT_IMPORT_MAX_ROWS = 500

export type CanonicalField = "company_name" | "linkedin_url" | "website" | "country" | "notes"

export interface CanonicalRow {
  company_name: string
  linkedin_url: string | null
  website: string | null
  country: string | null
  notes: string | null
}

/**
 * Sinónimos aceptados por columna, en español e inglés, ya normalizados
 * (minúsculas, sin acentos, no-alfanumérico colapsado a "_").
 *
 * "url" a secas mapea a website y no a linkedin_url: si el archivo trae una
 * sola columna de URL genérica, lo más probable es que sea el sitio de la
 * empresa; el LinkedIn se identifica por columnas que lo nombran.
 */
const FIELD_SYNONYMS: Record<CanonicalField, string[]> = {
  company_name: [
    "company_name", "nombre", "nombre_empresa", "empresa", "compania", "company",
    "cuenta", "account", "account_name", "razon_social", "name",
  ],
  linkedin_url: [
    "linkedin_url", "linkedin", "url_linkedin", "linkedin_company_url",
    "company_linkedin_url", "perfil_linkedin", "linkedin_empresa",
  ],
  website: ["website", "web", "sitio", "sitio_web", "dominio", "domain", "site", "url", "pagina", "pagina_web"],
  country: ["country", "pais"],
  notes: ["notes", "notas", "nota", "comentarios", "comments", "observaciones"],
}

/** Normaliza un header para compararlo contra los sinónimos. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

/**
 * Mapea los headers del archivo a los campos canónicos.
 *
 * Primer header que matchea un sinónimo gana el campo; los headers sin match
 * quedan sin mapear (se ignoran, no es un error: los archivos de clientes traen
 * columnas propias). El único campo obligatorio es company_name.
 */
export function detectHeaderMapping(headers: string[]): {
  mapping: Map<string, CanonicalField>
  missingRequired: boolean
} {
  const mapping = new Map<string, CanonicalField>()
  const taken = new Set<CanonicalField>()

  for (const header of headers) {
    const normalized = normalizeHeader(header)
    if (!normalized) continue
    for (const field of Object.keys(FIELD_SYNONYMS) as CanonicalField[]) {
      if (taken.has(field)) continue
      if (FIELD_SYNONYMS[field].includes(normalized)) {
        mapping.set(header, field)
        taken.add(field)
        break
      }
    }
  }

  return { mapping, missingRequired: !taken.has("company_name") }
}

/**
 * Extrae el slug de una URL de company de LinkedIn.
 * Acepta con/sin protocolo, con/sin www, y variantes de país (ar.linkedin.com).
 * Devuelve null si no es una URL de company (perfiles personales /in/ no valen).
 */
export function linkedinCompanySlug(url: string | null | undefined): string | null {
  if (!url) return null
  const match = url.trim().match(/linkedin\.com\/company\/([^/?#\s]+)/i)
  if (!match) return null
  const slug = match[1].toLowerCase().replace(/\/+$/, "")
  return slug || null
}

/** Forma canónica con la que se guarda/compara una URL de company. */
export function canonicalLinkedinUrl(url: string | null | undefined): string | null {
  const slug = linkedinCompanySlug(url)
  return slug ? `https://www.linkedin.com/company/${slug}` : null
}

/** Limpia un website a dominio comparable (sin protocolo, www ni path). */
export function normalizeWebsite(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned) ? cleaned : null
}

/**
 * Normalizador de nombre para deduplicar DENTRO del archivo.
 *
 * La puntuaci\u00f3n se limpia ANTES de quitar los sufijos legales: si no, "S.A."
 * nunca matchea el patr\u00f3n (los puntos cortan el \b) y "YPF S.A." no deduplica
 * contra "YPF SA". El matching contra el cat\u00e1logo usa su propio normalizador
 * (company-aliases); este solo decide igualdad entre filas del mismo archivo.
 */
export function normalizeCompanyNameForDedup(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(sa|s a|srl|s r l|llc|inc|ltd|corp|corporation|company|cia)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export interface MappedRowsResult {
  rows: CanonicalRow[]
  /** Filas descartadas en el parseo, con motivo (para avisar, no para frenar). */
  skipped: Array<{ rowNumber: number; reason: string }>
  /** Filas de más allá del tope, si el archivo lo excede. */
  truncated: number
}

/**
 * Convierte los registros crudos del archivo en filas canónicas válidas.
 *
 * - Filas sin nombre (o con nombre de 1-2 chars) se descartan con aviso.
 * - Duplicados DENTRO del archivo (mismo slug de LinkedIn, o mismo nombre
 *   normalizado si no hay slug) se descartan con aviso: la primera gana.
 * - Se corta en ACCOUNT_IMPORT_MAX_ROWS filas válidas.
 */
export function mapAndDedupeRows(
  records: Array<Record<string, unknown>>,
  mapping: Map<string, CanonicalField>,
): MappedRowsResult {
  const rows: CanonicalRow[] = []
  const skipped: Array<{ rowNumber: number; reason: string }> = []
  const seen = new Set<string>()
  let truncated = 0

  const readField = (record: Record<string, unknown>, field: CanonicalField): string | null => {
    for (const [header, mapped] of mapping) {
      if (mapped !== field) continue
      const value = record[header]
      if (typeof value === "string" && value.trim()) return value.trim()
      if (typeof value === "number") return String(value)
    }
    return null
  }

  records.forEach((record, index) => {
    const rowNumber = index + 2 // 1-indexado + fila de headers, como lo ve el usuario
    const name = readField(record, "company_name")

    const isEmpty = !name && !readField(record, "linkedin_url") && !readField(record, "website")
    if (isEmpty) return // filas en blanco: skip silencioso

    if (!name || name.length < 3) {
      skipped.push({ rowNumber, reason: name ? "Nombre demasiado corto" : "Falta el nombre de la empresa" })
      return
    }

    const linkedin = canonicalLinkedinUrl(readField(record, "linkedin_url"))
    const rawLinkedin = readField(record, "linkedin_url")
    if (rawLinkedin && !linkedin) {
      skipped.push({ rowNumber, reason: "El LinkedIn no es una URL de company válida" })
      return
    }

    const dedupKey = linkedin ? `li:${linkedinCompanySlug(linkedin)}` : `nm:${normalizeCompanyNameForDedup(name)}`
    if (seen.has(dedupKey)) {
      skipped.push({ rowNumber, reason: "Duplicada dentro del archivo" })
      return
    }

    if (rows.length >= ACCOUNT_IMPORT_MAX_ROWS) {
      truncated++
      return
    }

    seen.add(dedupKey)
    rows.push({
      company_name: name,
      linkedin_url: linkedin,
      website: readField(record, "website"),
      country: readField(record, "country"),
      notes: readField(record, "notes"),
    })
  })

  return { rows, skipped, truncated }
}

/** Contenido del template descargable, alineado con FIELD_SYNONYMS. */
export const ACCOUNT_IMPORT_TEMPLATE_CSV = [
  "company_name,linkedin_url,website,country,notes",
  '"Banco Galicia","https://www.linkedin.com/company/banco-galicia","bancogalicia.com","Argentina","Target Q2"',
  '"YPF S.A.","https://www.linkedin.com/company/ypf","ypf.com","Argentina",""',
].join("\n")
