import "server-only"

import { conConexionDirecta } from "@/lib/db/direct"
import {
  prepareTerms,
  geoFacets,
  industryFacets,
  type PreparedTerms,
} from "@/lib/v3/explore/mcp-explore"

/**
 * MCP Perfiles: capa de lectura persona-first sobre la tabla CRUDA de contactos.
 *
 * Es el tercer MCP y REUSA deliberadamente la infraestructura del MCP Explore:
 *   - prepareTerms: valida y arma la nube de terminos (ILIKE + refinado por
 *     limite de palabra). El vocabulario lo trae el cliente, no hay diccionario.
 *   - geoFacets / industryFacets: cuentan PERSONAS por termino (pais e industria).
 *     Ya eran persona-centricas, asi que se usan tal cual para el embudo de
 *     acotamiento; no se duplica nada.
 *
 * Lo unico propio es searchPeople(), que devuelve la LISTA GLOBAL de personas
 * (no acotada a una empresa como explore_company_people) con el contacto PERSONAL
 * resuelto por la funcion v3.profiles_search_people. Ver scripts/501_v3_profiles_mcp.sql.
 *
 * Va por conexion directa por lo mismo que Explore: las busquedas cruzan
 * public.contacts (~2,4 GB con indices GIN trigram) y en frio pueden pasar el
 * corte de 8s de PostgREST.
 */

// Se re-exportan para que el route del MCP Perfiles no tenga que importar de dos
// modulos: el helper de terminos y las facetas viven en Explore, pero forman
// parte de la superficie que consume este MCP.
export { prepareTerms, geoFacets, industryFacets }
export type { PreparedTerms }

export interface ProfileFilters {
  country: string | null
  industryIds: string[]
  includeUnclassified: boolean
  /** Nube de terminos, opcional, para acotar por cargo/seniority. */
  titleTerms: string[]
  /** Solo personas con al menos un mail o telefono. */
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
  /** Mail de dominio personal (gmail/hotmail/...). Null si no hay ninguno. */
  personalEmail: string | null
  /** true si personalEmail salio de un dominio personal real. */
  emailIsPersonal: boolean
  /** Fallback corporativo, etiquetado, cuando no hay mail personal. */
  workEmail: string | null
  /** Telefono priorizando el de tipo movil/personal. */
  personalPhone: string | null
  personalPhoneType: string | null
  phoneAlt: string | null
  phoneAltType: string | null
}

/**
 * Busca personas por concepto + filtros y resuelve su contacto personal.
 *
 * `terms` es obligatorio (sin concepto no hay busqueda: el predicado se fuerza a
 * 'false' del lado SQL para no escanear la tabla entera). `titleTerms` es el
 * filtro opcional de cargo; se prepara con la misma tecnica que el concepto.
 */
export async function searchPeople(
  terms: PreparedTerms,
  filters: ProfileFilters,
  limit = 25,
  offset = 0
): Promise<ProfileMatch[]> {
  const industryIds = filters.industryIds.length ? filters.industryIds : null
  // El filtro de cargo comparte la maquinaria de prepareTerms, pero es opcional:
  // si no hay terminos validos, se manda null y la funcion no restringe por cargo.
  let titleLike: string[] | null = null
  let titleRegex: string[] | null = null
  if (filters.titleTerms.length) {
    try {
      const preparedTitle = prepareTerms(filters.titleTerms)
      titleLike = preparedTitle.like
      titleRegex = preparedTitle.regex
    } catch {
      // Terminos de cargo invalidos (p.ej. todos <3 chars): se ignora el filtro
      // de cargo en vez de romper la busqueda principal.
      titleLike = null
      titleRegex = null
    }
  }

  return conConexionDirecta(async (client) => {
    const { rows } = await client.query(
      "select * from v3.profiles_search_people($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        terms.like,
        terms.regex,
        filters.country,
        industryIds,
        filters.includeUnclassified,
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
