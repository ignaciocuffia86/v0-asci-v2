/**
 * Resolucion de DOMINIO A PARTIR DEL NOMBRE contra Apollo (endpoint gratuito).
 *
 * POR QUE EXISTE
 * ==============
 * 455.747 de las 517.790 filas de `public.companies` (88%) no tienen `website`.
 * Sin dominio no entran a ningun flujo de Apollo: `organizations/enrich` y
 * `bulk_enrich` reciben dominios, no nombres. Son cuentas ciegas.
 *
 * `organizations/search` con `display_mode: fuzzy_select_mode` devuelve
 * candidatos shallow (id, name, domain, website_url, logo_url) SIN consumir
 * creditos, asi que se puede correr sobre las ~420.750 candidatas con nombre
 * buscable. Es el unico camino gratuito de nombre -> dominio que tenemos.
 *
 * EL TECHO: 400 LLAMADAS POR HORA
 * Medido el 27-ago-2026. Apollo rechaza con "The maximum number of api calls
 * allowed for api/v1/organizations/search is 400 times per hour. Please upgrade
 * your plan". Es cuota DEL PLAN sobre ESE endpoint: no se levanta cambiando de
 * transporte. No confundirla con el x-rate-limit-minute: 1000 de
 * `organizations/enrich`, que es otro endpoint con otra cuota.
 *
 * EL MATCH POR NOMBRE ES DIFUSO Y ESTE MODULO NO LO DISIMULA
 * Un dominio equivocado no se nota al escribirlo: se nota cuando alguien
 * contacta a la empresa incorrecta. Por eso `classifyMatch` devuelve una clase
 * explicita y solo `auto_ok` es promovible sin ojo humano.
 */

import { apolloRequest } from "./client"

/** Cuota horaria del endpoint. Es del plan de Apollo, no nuestra. */
export const LOOKUP_CALLS_PER_HOUR = 400

/**
 * Cuota que este proceso de fondo puede gastar por hora. El resto queda
 * deliberadamente libre: si el barrido se comiera las 400, cualquier busqueda
 * manual —una cuenta puntual que alguien necesita mirar ahora— se encontraria
 * con un 429 provocado por un proceso que puede esperar. El barrido tiene
 * meses por delante; la persona que esta trabajando, no.
 */
export const LOOKUP_HOURLY_BUDGET = 350

export type LookupCandidate = {
  apolloOrganizationId: string | null
  name: string | null
  domain: string | null
  websiteUrl: string | null
  logoUrl: string | null
}

/**
 * Clases de resultado. Solo `auto_ok` se promueve a `companies` sin revision.
 */
export type LookupClass =
  | "auto_ok"
  | "revisar"
  | "descartado"
  | "match_sin_dominio"
  | "sin_match"
  | "error"

// ─────────────────────────────────────────────────────────── normalizacion

/**
 * Espejo en TS de `public.company_core_name()`. La query del runner ya pide el
 * nucleo normalizado a Postgres; esta version existe para comparar contra el
 * nombre que devuelve APOLLO, que llega crudo y con su propia forma legal.
 *
 * Sin esto, "Smurfit Kappa Argentina" (nuestro, via LinkedIn) contra "Smurfit
 * Kappa Argentina S.A." (el legal de Apollo) daria un match pobre y perderiamos
 * una resolucion correcta.
 */
const LEGAL_SUFFIX =
  /[\s,.]+\s*(s\.?a\.?i\.?c\.?f?\.?|s\.?a\.?c\.?i\.?|s\.?a\.?s\.?|s\.?a\.?u\.?|s\.?a\.?|s\.?r\.?l\.?|s\.?c\.?a\.?|s\.?l\.?|inc|llc|ltda?|corp|co|plc|gmbh|ag|nv|bv|spa|srl|pty|limited)\.?\s*$/

export function coreName(value: string | null | undefined): string {
  if (!value) return ""
  let result = String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/["'`]/g, "")
    .split("/")[0]
    .trim()
    .replace(/^(grupo|group|holding|the)\s+/, "")
  // Hasta 3 pasadas para combinaciones tipo "X SGPS S.A."
  for (let i = 0; i < 3; i++) {
    const before = result
    result = result.replace(LEGAL_SUFFIX, "").trim()
    if (result === before) break
  }
  return result.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

const tokensOf = (value: string | null | undefined): Set<string> =>
  new Set(coreName(value).split(" ").filter(Boolean))

/** Similitud de Jaccard sobre los tokens de los nucleos normalizados. */
export function jaccard(a: string | null | undefined, b: string | null | undefined): number {
  const ta = tokensOf(a)
  const tb = tokensOf(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const token of ta) if (tb.has(token)) inter++
  return inter / (ta.size + tb.size - inter)
}

/**
 * Cuanto del nombre mas corto esta contenido en el otro. Separa dos casos que
 * Jaccard solo confunde: "Cencosud" dentro de "Cencosud Retail S.A." (la misma
 * empresa con una division de mas) de "Support Chile" contra "Support
 * Argentina" (dos empresas distintas).
 */
export function containment(a: string | null | undefined, b: string | null | undefined): number {
  const ta = tokensOf(a)
  const tb = tokensOf(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inA = 0
  for (const token of tb) if (ta.has(token)) inA++
  let inB = 0
  for (const token of ta) if (tb.has(token)) inB++
  return Math.max(inA / tb.size, inB / ta.size)
}

/**
 * Tokens geograficos. NO son ruido de relleno: en este catalogo el lugar es
 * parte de la identidad de la fila —"Smurfit Kappa Argentina" es la filial, no
 * la matriz— y una ciudad de mas en el candidato suele significar OTRA empresa.
 *
 * Medido: "joyeria vasari" contra "JOYERIA VASARI MADRID SL" da similitud 0.67
 * y contencion 1.00. Sin esta guarda pasaba como match automatico, y la de
 * Madrid puede no ser la nuestra.
 */
const GEO_TOKENS = new Set([
  "argentina", "argentino", "chile", "chileno", "chilena", "colombia",
  "colombiano", "paraguay", "paraguayo", "mexico", "mexicano", "panama",
  "panameno", "bolivia", "boliviano", "ecuador", "ecuatoriano", "peru",
  "peruano", "uruguay", "uruguayo", "venezuela", "venezolano", "brasil",
  "brazil", "brasileno", "espana", "spain", "espanol", "guatemala", "honduras",
  "nicaragua", "salvador", "rica", "dominicana", "portugal", "francia",
  "france", "italia", "italy", "alemania", "germany", "usa", "eeuu",
  "americana", "latam", "latinoamerica", "sudamerica", "buenos", "aires",
  "santiago", "bogota", "lima", "quito", "caracas", "asuncion", "montevideo",
  "madrid", "barcelona", "miami", "york", "guadalajara", "monterrey",
  "medellin", "cali", "rosario", "cordoba", "valparaiso", "guayaquil", "sao",
  "paulo", "janeiro", "brasilia",
])

/** Tokens geograficos presentes en un nombre y ausentes en el otro. */
export function geoMismatch(a: string | null | undefined, b: string | null | undefined): string[] {
  const ta = tokensOf(a)
  const tb = tokensOf(b)
  const diff: string[] = []
  for (const token of ta) if (GEO_TOKENS.has(token) && !tb.has(token)) diff.push(token)
  for (const token of tb) if (GEO_TOKENS.has(token) && !ta.has(token)) diff.push(token)
  return diff
}

export type MatchScore = {
  similarity: number
  containment: number
  geoMismatch: string[]
  klass: LookupClass
}

/**
 * Umbrales deliberadamente conservadores: mandar una fila a revision cuesta un
 * minuto de alguien; escribir un dominio equivocado contamina todo lo que
 * despues lea esa columna y no avisa.
 */
export function classifyMatch(core: string, candidate: LookupCandidate | null): MatchScore {
  if (!candidate) {
    return { similarity: 0, containment: 0, geoMismatch: [], klass: "sin_match" }
  }
  const similarity = jaccard(core, candidate.name)
  const cont = containment(core, candidate.name)
  const geo = geoMismatch(core, candidate.name)

  if (!candidate.domain) {
    return { similarity, containment: cont, geoMismatch: geo, klass: "match_sin_dominio" }
  }
  // Un lugar que aparece de un solo lado tumba el match automatico por alto que
  // sea el score: es la diferencia entre la filial y la matriz, o entre dos
  // homonimas de paises distintos.
  const klass: LookupClass =
    geo.length === 0 && (similarity >= 0.85 || (similarity >= 0.6 && cont >= 0.99))
      ? "auto_ok"
      : similarity >= 0.4 || cont >= 0.75
        ? "revisar"
        : "descartado"

  return { similarity, containment: cont, geoMismatch: geo, klass }
}

// ──────────────────────────────────────────────────────────────── API

/** Las dos formas en que Apollo devuelve organizaciones segun el bucket. */
export function parseLookupResponse(data: unknown): LookupCandidate[] {
  if (!data || typeof data !== "object") return []
  const body = data as Record<string, unknown>
  const orgs = Array.isArray(body.organizations) ? body.organizations : []
  const accounts = Array.isArray(body.accounts) ? body.accounts : []

  return [...orgs, ...accounts]
    .map((raw): LookupCandidate | null => {
      if (!raw || typeof raw !== "object") return null
      const o = raw as Record<string, unknown>
      const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)
      return {
        // En el bucket `accounts` el `id` es de la CUENTA, no de la organizacion:
        // usar el equivocado hace que los filtros por organization_ids no
        // matcheen nada, en silencio.
        apolloOrganizationId: str(o.organization_id) ?? str(o.id),
        name: str(o.name),
        domain: str(o.primary_domain) ?? str(o.domain),
        websiteUrl: str(o.website_url),
        logoUrl: str(o.logo_url),
      }
    })
    .filter((c): c is LookupCandidate => c !== null && (c.name !== null || c.domain !== null))
}

/**
 * Prefiere el primer candidato QUE TRAIGA DOMINIO: un match sin dominio no
 * sirve para lo unico que este modulo vino a buscar.
 */
export function pickBestCandidate(candidates: LookupCandidate[]): LookupCandidate | null {
  return candidates.find((c) => c.domain) ?? candidates[0] ?? null
}

export type LookupResult =
  | { ok: true; candidates: LookupCandidate[] }
  | { ok: false; status: number; error: string; rateLimited: boolean }

/**
 * Una busqueda de organizaciones por nombre. `creditsEstimated: 0` no es una
 * suposicion comoda: el contrato del endpoint lo declara gratuito y el runner
 * lo verifica midiendo la cuota. Si algun dia deja de serlo, el ledger de
 * `apollo_api_calls` es lo primero que lo va a mostrar.
 */
export async function lookupOrganizationsByName(opts: {
  name: string
  companyId?: string | null
  /** Filtra por ubicacion EN LA QUERY. Ver el runner: por default no se usa. */
  location?: string | null
  perPage?: number
}): Promise<LookupResult> {
  const requestBody: Record<string, unknown> = {
    q_organization_fuzzy_name: opts.name,
    display_mode: "fuzzy_select_mode",
    per_page: opts.perPage ?? 3,
  }
  if (opts.location) requestBody.organization_locations = [opts.location]

  const result = await apolloRequest<unknown>({
    endpoint: "organizations/search",
    method: "POST",
    userId: null,
    companyId: opts.companyId ?? null,
    requestBody,
    creditsEstimated: 0,
  })

  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error: result.error,
      // 429 aca no es "esperá un segundo": es la cuota horaria agotada.
      rateLimited: result.status === 429,
    }
  }

  return { ok: true, candidates: parseLookupResponse(result.data) }
}
