/**
 * Hashing determinístico de los parametros de búsqueda para claves de cache.
 *
 * Requisitos:
 * - Mismos filtros en distinto orden producen el mismo hash.
 * - Titles con distinto casing / espacios producen el mismo hash.
 * - El hash cambia si cualquiera de los filtros semanticamente relevantes cambia.
 */

import { createHash } from "node:crypto"

export type SearchParams = {
  organizationId: string | null
  domain: string | null
  jobTitles: string[]
  country: string | null
  seniorities?: string[]
  departments?: string[]
  includeSimilarTitles?: boolean
  /** Si se filtra por ubicacion de la empresa en lugar de la persona */
  useOrganizationLocation?: boolean
}

export function normalizeTitle(t: string): string {
  return t
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u2018\u2019]/g, "'") // smart quotes
    .replace(/[\u201c\u201d]/g, '"')
}

export function normalizeStringArray(arr: string[] | undefined): string[] {
  if (!arr || arr.length === 0) return []
  const set = new Set(arr.map(normalizeTitle).filter(Boolean))
  return [...set].sort()
}

/**
 * Devuelve una cadena canonica estable a partir de los parametros.
 * Util para debugging y para construir el hash.
 */
export function buildCanonicalKey(params: SearchParams): string {
  const canon = {
    o: params.organizationId || null,
    d: params.organizationId ? null : params.domain || null, // si hay org_id, domain es redundante
    t: normalizeStringArray(params.jobTitles),
    c: params.country ? params.country.trim().toLowerCase() : null,
    s: normalizeStringArray(params.seniorities),
    de: normalizeStringArray(params.departments),
    ist: params.includeSimilarTitles ?? true,
    uol: params.useOrganizationLocation ?? false,
  }
  return JSON.stringify(canon)
}

/**
 * SHA-256 truncado a 32 chars. Probabilidad de colision despreciable para
 * el volumen esperado (decenas de miles de queries).
 */
export function hashSearchParams(params: SearchParams): string {
  const key = buildCanonicalKey(params)
  return createHash("sha256").update(key).digest("hex").slice(0, 32)
}
