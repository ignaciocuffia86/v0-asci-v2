import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { conConexionDirecta } from "@/lib/db/direct"
import type { McpPrincipal } from "@/lib/v3/mcp-usage"

/**
 * MCP Explore: embudo conversacional sobre la tabla CRUDA de contactos + vacantes,
 * SIN pasar por el diccionario de senales de v2.
 *
 * Corre en paralelo al MCP actual (mismo A/B: ambos loguean en v3.mcp_request_logs)
 * pero con su propio scope `explore:read`. Es de solo lectura sobre v2; el unico
 * punto que escribe en v2 es el scraping de Apify, que reusa el pipeline existente.
 *
 * POR QUE CONEXION DIRECTA
 * ------------------------
 * Las facetas y busquedas cruzan public.contacts (2,4 GB con indices GIN trigram)
 * y en frio pueden pasar los 8s que corta PostgREST (medido: faceta de pais 9,1s
 * cold). `conConexionDirecta` entra por debajo de ese limite (tope global 60s).
 * Las sesiones, que son filas chicas, van por el admin client normal.
 */

// -----------------------------------------------------------------------------
// Procesamiento de terminos. El cliente MCP (Claude) propone la "nube de tags"
// expandida (SAP -> SAP, S/4HANA, ABAP, ...). El server solo valida y arma las
// dos formas que necesita la busqueda: el ILIKE (indexable) y el limite de
// palabra (preciso). NO hay diccionario: el vocabulario lo trae el cliente.
// -----------------------------------------------------------------------------

/** Escapa comodines de LIKE para que un termino con % o _ no explote la busqueda. */
function escapeLike(term: string): string {
  return term.replace(/([%_\\])/g, "\\$1")
}

/** Escapa metacaracteres de regex para el refinado por limite de palabra. */
function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export interface PreparedTerms {
  /** Terminos crudos, tal como los mando el cliente (para mostrar y auditar). */
  raw: string[]
  /** Envueltos en % y escapados, para el ILIKE indexable. */
  like: string[]
  /** Regex-escapados, para el refinado ~* '\yterm\y'. */
  regex: string[]
}

/**
 * Valida y normaliza la lista de terminos.
 *
 * Regla de longitud minima: 3 caracteres. Las siglas de 2 (los modulos SAP: MM,
 * SD, PP) son inservibles sueltas por trigram y traen demasiado ruido; si el
 * usuario las quiere, tiene que combinarlas ("SAP MM"). Se deduplica sin
 * distinguir mayusculas.
 */
export function prepareTerms(terms: string[]): PreparedTerms {
  const cleaned = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 3))]
  if (cleaned.length === 0) {
    throw new Error("TERMS_REQUIRED:Pasá al menos un término de 3+ caracteres. Los de 2 letras (MM, SD) son ambiguos: combinalos, por ejemplo 'SAP MM'.")
  }
  if (cleaned.length > 25) {
    throw new Error("TOO_MANY_TERMS:Máximo 25 términos por búsqueda. Priorizá los más específicos.")
  }
  return {
    raw: cleaned,
    like: cleaned.map((t) => `%${escapeLike(t)}%`),
    regex: cleaned.map((t) => escapeRegex(t)),
  }
}

// -----------------------------------------------------------------------------
// Sesiones de exploracion. El server recuerda los cortes elegidos entre llamadas
// y devuelve un token; el concepto igual se arrastra embebido en cada consulta.
// -----------------------------------------------------------------------------

export type ExploreSource = "contacts" | "jobs"

export interface ExploreSession {
  id: string
  workspaceId: string
  userId: string
  concept: string | null
  terms: string[]
  country: string | null
  industryIds: string[]
  includeUnclassified: boolean
  sources: ExploreSource[]
}

function mapSession(row: Record<string, unknown>): ExploreSession {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    userId: row.user_id as string,
    concept: (row.concept as string | null) ?? null,
    terms: (row.terms as string[]) ?? [],
    country: (row.country as string | null) ?? null,
    industryIds: (row.industry_ids as string[]) ?? [],
    includeUnclassified: (row.include_unclassified as boolean) ?? true,
    sources: ((row.sources as string[]) ?? ["contacts", "jobs"]) as ExploreSource[],
  }
}

export async function createExploreSession(
  principal: McpPrincipal,
  input: { concept: string | null; terms: string[]; sources: ExploreSource[] }
): Promise<ExploreSession> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .schema("v3")
    .from("explore_sessions")
    .insert({
      workspace_id: principal.workspaceId,
      user_id: principal.userId,
      concept: input.concept,
      terms: input.terms,
      sources: input.sources,
    })
    .select("*")
    .single()
  if (error) throw new Error(`SESSION_CREATE_FAILED:${error.message}`)
  return mapSession(data)
}

export async function getExploreSession(principal: McpPrincipal, sessionId: string): Promise<ExploreSession> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .schema("v3")
    .from("explore_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("workspace_id", principal.workspaceId)
    .maybeSingle()
  if (error) throw new Error(`SESSION_LOOKUP_FAILED:${error.message}`)
  if (!data) throw new Error("SESSION_NOT_FOUND:El sessionId no existe o es de otro workspace. Empezá de nuevo con explore_start.")
  return mapSession(data)
}

export async function updateExploreSession(
  principal: McpPrincipal,
  sessionId: string,
  patch: Partial<{ country: string | null; industryIds: string[]; includeUnclassified: boolean; sources: ExploreSource[] }>
): Promise<ExploreSession> {
  const admin = createAdminClient()
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ("country" in patch) dbPatch.country = patch.country
  if ("industryIds" in patch) dbPatch.industry_ids = patch.industryIds
  if ("includeUnclassified" in patch) dbPatch.include_unclassified = patch.includeUnclassified
  if ("sources" in patch) dbPatch.sources = patch.sources
  const { data, error } = await admin
    .schema("v3")
    .from("explore_sessions")
    .update(dbPatch)
    .eq("id", sessionId)
    .eq("workspace_id", principal.workspaceId)
    .select("*")
    .maybeSingle()
  if (error) throw new Error(`SESSION_UPDATE_FAILED:${error.message}`)
  if (!data) throw new Error("SESSION_NOT_FOUND:El sessionId no existe o es de otro workspace.")
  return mapSession(data)
}

// -----------------------------------------------------------------------------
// Funciones de lectura del embudo. Todas van por conexion directa (ver arriba).
// -----------------------------------------------------------------------------

export interface GeoFacet {
  country: string
  personMatches: number
}

export async function geoFacets(terms: PreparedTerms, limit = 30): Promise<GeoFacet[]> {
  return conConexionDirecta(async (client) => {
    const { rows } = await client.query(
      "select country, person_matches from v3.explore_geo_facets($1,$2,$3)",
      [terms.like, terms.regex, limit]
    )
    return rows.map((r) => ({ country: r.country as string, personMatches: Number(r.person_matches) }))
  })
}

export interface IndustryFacet {
  masterIndustryId: string | null
  nameEs: string | null
  nameEn: string | null
  personMatches: number
}

export async function industryFacets(terms: PreparedTerms, country: string | null, limit = 30): Promise<IndustryFacet[]> {
  return conConexionDirecta(async (client) => {
    const { rows } = await client.query(
      "select master_industry_id, name_es, name_en, person_matches from v3.explore_industry_facets($1,$2,$3,$4)",
      [terms.like, terms.regex, country, limit]
    )
    return rows.map((r) => ({
      masterIndustryId: (r.master_industry_id as string | null) ?? null,
      nameEs: (r.name_es as string | null) ?? null,
      nameEn: (r.name_en as string | null) ?? null,
      personMatches: Number(r.person_matches),
    }))
  })
}

export interface CompanyMatch {
  companyId: string
  companyName: string
  country: string | null
  masterIndustryId: string | null
  industryNameEs: string | null
  personMatches: number
  jobMatches: number
  totalMatches: number
}

export async function searchCompanies(
  terms: PreparedTerms,
  filters: { country: string | null; industryIds: string[]; includeUnclassified: boolean; sources: ExploreSource[] },
  limit = 25
): Promise<CompanyMatch[]> {
  const searchContacts = filters.sources.includes("contacts")
  const searchJobs = filters.sources.includes("jobs")
  const industryIds = filters.industryIds.length ? filters.industryIds : null
  return conConexionDirecta(async (client) => {
    const { rows } = await client.query(
      "select * from v3.explore_search_companies($1,$2,$3,$4,$5,$6,$7,$8)",
      [terms.like, terms.regex, filters.country, industryIds, filters.includeUnclassified, searchContacts, searchJobs, limit]
    )
    return rows.map((r) => ({
      companyId: r.company_id as string,
      companyName: r.company_name as string,
      country: (r.country_normalized as string | null) ?? null,
      masterIndustryId: (r.master_industry_id as string | null) ?? null,
      industryNameEs: (r.industry_name_es as string | null) ?? null,
      personMatches: Number(r.person_matches),
      jobMatches: Number(r.job_matches),
      totalMatches: Number(r.total_matches),
    }))
  })
}

export interface PersonMatch {
  fullName: string | null
  currentPositionTitle: string | null
  headline: string | null
  linkedinUrl: string | null
  country: string | null
  matchedTerms: string[]
  email1: string | null
  phone1: string | null
}

export async function companyPeople(terms: PreparedTerms, companyId: string, limit = 25): Promise<PersonMatch[]> {
  return conConexionDirecta(async (client) => {
    const { rows } = await client.query(
      "select * from v3.explore_company_people($1,$2,$3,$4)",
      [terms.like, terms.regex, companyId, limit]
    )
    return rows.map((r) => ({
      fullName: (r.full_name as string | null) ?? null,
      currentPositionTitle: (r.current_position_title as string | null) ?? null,
      headline: (r.headline as string | null) ?? null,
      linkedinUrl: (r.linkedin_url as string | null) ?? null,
      country: (r.country_normalized as string | null) ?? null,
      matchedTerms: (r.matched_terms as string[]) ?? [],
      email1: (r.email1 as string | null) ?? null,
      phone1: (r.phone1 as string | null) ?? null,
    }))
  })
}
