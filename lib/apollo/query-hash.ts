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

  // ─── Campos incorporados en el hash v2 ───
  /**
   * Cantidad de resultados pedidos. DEBE entrar en el hash: el cache es hit
   * binario, asi que sin esto una busqueda de 10 contactos servia como hit
   * para un pedido posterior de 50 y devolvia solo 10 filas.
   */
  maxResults?: number
  /** Revelar email cambia el costo y la forma de la respuesta de Apollo. */
  revealEmail?: boolean
  /** Revelar telefono idem. */
  revealPhone?: boolean
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
    // El default es `false` para coincidir con el request real: search.ts solo
    // envia include_similar_titles cuando es === true. Antes el default era `true`,
    // asi que `undefined` y `false` producian hashes DISTINTOS para requests
    // IDENTICOS: cache fragmentado y busquedas pagas duplicadas contra Apollo.
    ist: params.includeSimilarTitles === true,
    uol: params.useOrganizationLocation ?? false,
    // Campos nuevos del hash v2.
    mr: params.maxResults ?? null,
    re: params.revealEmail === true,
    rp: params.revealPhone === true,
  }
  return JSON.stringify(canon)
}

/**
 * SHA-256 truncado a 32 chars. Probabilidad de colision despreciable para
 * el volumen esperado (decenas de miles de queries).
 */
export function hashSearchParams(params: SearchParams): string {
  const key = buildCanonicalKey(params)
  // Prefijo de version: los hashes v1 guardados por v2 siguen sirviendo hasta que
  // expiren por TTL, pero nunca colisionan con los v2. Asi se corrige el default de
  // includeSimilarTitles y se suman maxResults/reveals sin invalidar de golpe el
  // cache de produccion (que obligaria a cada usuario de v2 a pagar de nuevo).
  return `v2:${createHash("sha256").update(key).digest("hex").slice(0, 29)}`
}
