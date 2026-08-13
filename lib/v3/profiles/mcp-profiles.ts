import "server-only"

import { conConexionDirecta } from "@/lib/db/direct"
import { geoFacets, industryFacets, prepareTerms } from "@/lib/v3/explore/mcp-explore"

/**
 * MCP Perfiles: capa de lectura persona-first sobre la tabla CRUDA de contactos.
 *
 * Reusa del MCP Explore las FACETAS de pais e industria (geoFacets /
 * industryFacets: cuentan personas por termino) para el acotamiento del embudo.
 * Lo propio es searchPeople(), que llama a v3.profiles_search_people con:
 *
 *   A. HISTORIAL. includePast suma como 5ta "columna" el texto de los puestos
 *      ANTERIORES (public.contacts_prevpos_text, ya indexado). Recupera perfiles
 *      con experiencia pasada que la v1 perdia (~21.500 en SAP).
 *   B. GRUPOS AND. `groups` es una lista de requisitos: dentro de cada grupo OR
 *      (sinonimos), entre grupos AND (intersección). Ademas de precision, el
 *      planner interseca los bitmaps de cada grupo (BitmapAnd) antes del heap.
 *   C. TOKENS CON SIMBOLOS. Las anclas de palabra \y se agregan SOLO del lado que
 *      empieza/termina en caracter de palabra, asi ".NET" / "C#" / "C++" matchean
 *      (antes el \y inicial frente al "." tiraba ~70% de los .NET).
 *
 * Va por conexion directa (como Explore) porque cruza public.contacts (~2,4 GB
 * con indices GIN trigram) y en frio puede pasar el corte de 8s de PostgREST.
 */

// prepareTerms es el de Explore (regex SIN \y; su SQL lo agrega): lo usan las
// tools de facetas. prepareGroup (mas abajo) es el de Perfiles, con anclas ya
// bakeadas para .NET/C#. No confundirlos.
export { geoFacets, industryFacets, prepareTerms }

// -----------------------------------------------------------------------------
// Preparacion de terminos (propia del MCP Perfiles; NO reusa la de Explore porque
// necesita anclas inteligentes y aceptar tokens cortos con simbolo).
// -----------------------------------------------------------------------------

/** Escapa comodines de LIKE. */
function escapeLike(term: string): string {
  return term.replace(/([%_\\])/g, "\\$1")
}

/** Escapa metacaracteres de regex. */
function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// "Caracter de palabra" alineado con el \y de Postgres (ASCII alnum + _). Sirve
// para decidir de que lado poner el ancla: si el termino EMPIEZA en caracter de
// palabra, ancla al inicio; si TERMINA en caracter de palabra, ancla al final.
const STARTS_WORD = /^[A-Za-z0-9_]/
const ENDS_WORD = /[A-Za-z0-9_]$/
// Un token es util si tiene 3+ caracteres, o 2+ si incluye un simbolo (C#, F#):
// las siglas de 2 letras puras (MM, SD) son ruido por trigram, pero "C#" no.
const HAS_SYMBOL = /[^A-Za-z0-9_ ]/

/** Ancla \y solo del lado que empieza/termina en palabra (fix de .NET / C#). */
function anchoredRegex(term: string): string {
  const body = escapeRegex(term)
  const lead = STARTS_WORD.test(term) ? "\\y" : ""
  const trail = ENDS_WORD.test(term) ? "\\y" : ""
  return lead + body + trail
}

function keepTerm(term: string): boolean {
  return term.length >= 3 || (term.length >= 2 && HAS_SYMBOL.test(term))
}

export interface PreparedGroup {
  raw: string[]
  like: string[]
  regex: string[]
}

/**
 * Valida y arma un grupo de terminos (una "nube" que se OR-ea internamente).
 * Lanza TERMS_REQUIRED si el grupo queda sin terminos utiles.
 */
export function prepareGroup(terms: string[]): PreparedGroup {
  const cleaned = [...new Set(terms.map((t) => t.trim()).filter(keepTerm))]
  if (cleaned.length === 0) {
    throw new Error(
      "TERMS_REQUIRED:Cada requisito necesita al menos un término de 3+ caracteres (o 2+ con símbolo, como C#). Las siglas de 2 letras puras (MM, SD) son ambiguas: combinalas, por ejemplo 'SAP MM'."
    )
  }
  return {
    raw: cleaned,
    like: cleaned.map((t) => `%${escapeLike(t)}%`),
    regex: cleaned.map(anchoredRegex),
  }
}

// -----------------------------------------------------------------------------
// Busqueda de personas.
// -----------------------------------------------------------------------------

export interface ProfileFilters {
  country: string | null
  industryIds: string[]
  includeUnclassified: boolean
  /** Buscar tambien en los puestos anteriores. true = "experiencia" (con pasado). */
  includePast: boolean
  /** Nube opcional para acotar por cargo/seniority (solo titulo + headline). */
  titleTerms: string[]
  onlyContactable: boolean
}

export interface ProfileMatch {
  contactId: string | null
  fullName: string | null
  currentPositionTitle: string | null
  headline: string | null
  linkedinUrl: string | null
  country: string | null
  companyId: string | null
  companyName: string | null
  masterIndustryId: string | null
  industryNameEs: string | null
  matchedTerms: string[]
  personalEmail: string | null
  emailIsPersonal: boolean
  workEmail: string | null
  personalPhone: string | null
  personalPhoneType: string | null
  phoneAlt: string | null
  phoneAltType: string | null
}

/**
 * Busca personas por una lista de GRUPOS de requisitos (ANDeados) + filtros, y
 * resuelve su contacto personal.
 *
 * `groups` es un array de nubes de terminos: cada nube es un requisito y se ORea
 * internamente; los requisitos se intersecan (AND). Al menos un grupo con al
 * menos un termino valido, si no lanza TERMS_REQUIRED.
 */
export async function searchPeople(
  groups: string[][],
  filters: ProfileFilters,
  limit = 25,
  offset = 0
): Promise<ProfileMatch[]> {
  const prepared = groups
    .map((terms) => {
      try {
        return prepareGroup(terms)
      } catch {
        return null
      }
    })
    .filter((g): g is PreparedGroup => g !== null)

  if (prepared.length === 0) {
    throw new Error("TERMS_REQUIRED:Pasá al menos un requisito con términos válidos.")
  }

  const groupsJson = JSON.stringify(prepared.map((g) => ({ raw: g.raw, like: g.like, regex: g.regex })))
  const industryIds = filters.industryIds.length ? filters.industryIds : null

  // Cargo/seniority: opcional, misma preparacion pero un solo grupo. Si queda
  // vacio se ignora (no rompe la busqueda principal).
  let titleLike: string[] | null = null
  let titleRegex: string[] | null = null
  if (filters.titleTerms.length) {
    try {
      const t = prepareGroup(filters.titleTerms)
      titleLike = t.like
      titleRegex = t.regex
    } catch {
      titleLike = null
      titleRegex = null
    }
  }

  return conConexionDirecta(async (client) => {
    const { rows } = await client.query(
      "select * from v3.profiles_search_people($1::jsonb,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        groupsJson,
        filters.country,
        industryIds,
        filters.includeUnclassified,
        filters.includePast,
        titleLike,
        titleRegex,
        filters.onlyContactable,
        limit,
        offset,
      ]
    )
    return rows.map((r) => ({
      contactId: (r.contact_id as string | null) ?? null,
      fullName: (r.full_name as string | null) ?? null,
      currentPositionTitle: (r.current_position_title as string | null) ?? null,
      headline: (r.headline as string | null) ?? null,
      linkedinUrl: (r.linkedin_url as string | null) ?? null,
      country: (r.country_normalized as string | null) ?? null,
      companyId: (r.company_id as string | null) ?? null,
      companyName: (r.company_name as string | null) ?? null,
      masterIndustryId: (r.master_industry_id as string | null) ?? null,
      industryNameEs: (r.industry_name_es as string | null) ?? null,
      matchedTerms: (r.matched_terms as string[]) ?? [],
      personalEmail: (r.personal_email as string | null) ?? null,
      emailIsPersonal: Boolean(r.email_is_personal),
      workEmail: (r.work_email as string | null) ?? null,
      personalPhone: (r.personal_phone as string | null) ?? null,
      personalPhoneType: (r.personal_phone_type as string | null) ?? null,
      phoneAlt: (r.phone_alt as string | null) ?? null,
      phoneAltType: (r.phone_alt_type as string | null) ?? null,
    }))
  })
}
