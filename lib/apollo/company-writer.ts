/**
 * Escritura del resultado de Apollo sobre `public.companies`.
 *
 * ── Precedencia (decision del dueño del proyecto, 26-ago-2026) ──
 * Las señales propias mandan. Apollo es una fuente de relleno:
 *
 *   columnas apollo_*        -> se escriben SIEMPRE (namespace propio de Apollo)
 *   columnas genericas       -> solo si estan VACIAS (NULL o '')
 *   is_public / ticker / cik -> NUNCA se tocan (son de la pipeline de SEC EDGAR;
 *                               la version de Apollo va a apollo_publicly_traded_*)
 *   country_normalized,
 *   master_industry_id       -> NUNCA se escriben a mano: los derivan triggers
 *
 * `industry` es el caso mas delicado: la taxonomia de Apollo es lowercase
 * ("oil & energy") y la nuestra es la de LinkedIn en Title Case ("Oil and Gas").
 * Mezclarlas romperia el mapeo a master_industry_id, asi que la industria de
 * Apollo va SIEMPRE a `apollo_industry` y jamas a `industry`.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { ApolloOrganization } from "./parsers"

/** Fila de companies con lo justo para decidir que columnas rellenar. */
export type CompanyEnrichTarget = {
  id: string
  linkedin_url: string | null
  website: string | null
  country: string | null
  logo_url: string | null
  description: string | null
}

/** '' cuenta como vacio: hay ~66k filas historicas con string vacio. */
function isEmpty(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === ""
}

export type ApolloCompanyUpdate = {
  /** Columnas a escribir, listas para .update() */
  patch: Record<string, unknown>
  /** Nombres de las columnas genericas que este enrichment completo (para auditoria) */
  filledColumns: string[]
}

/**
 * Arma el patch de un enrichment. Funcion pura: no toca la base, para poder
 * testear la regla de precedencia sin Supabase.
 */
export function buildCompanyUpdate(
  current: CompanyEnrichTarget,
  org: ApolloOrganization,
  now: Date = new Date(),
): ApolloCompanyUpdate {
  const filledColumns: string[] = []

  const patch: Record<string, unknown> = {
    // ── Namespace de Apollo: siempre se pisa con lo ultimo que dijo Apollo ──
    apollo_organization_id: org.id,
    apollo_org_status: "found",
    apollo_org_synced_at: now.toISOString(),
    apollo_employees_count: org.employeesCount,
    apollo_industry: org.industry,
    apollo_annual_revenue: org.annualRevenue,
    apollo_founded_year: org.foundedYear,
    apollo_technologies: org.technologies.length > 0 ? org.technologies : null,
    apollo_keywords: org.keywords.length > 0 ? org.keywords : null,
    apollo_headcount_growth: org.headcountGrowth,
    apollo_publicly_traded_symbol: org.publiclyTradedSymbol,
    apollo_publicly_traded_exchange: org.publiclyTradedExchange,
  }

  // ── Columnas genericas: solo huecos ──
  // linkedin_url es la mas valiosa: destraba la cola de APIFY para empresas que
  // hoy solo tienen website.
  if (isEmpty(current.linkedin_url) && !isEmpty(org.linkedinUrl)) {
    patch.linkedin_url = org.linkedinUrl
    filledColumns.push("linkedin_url")
  }
  if (isEmpty(current.website) && !isEmpty(org.websiteUrl)) {
    patch.website = org.websiteUrl
    filledColumns.push("website")
  }
  // El trigger trg_normalize_country deriva country_normalized desde aca.
  if (isEmpty(current.country) && !isEmpty(org.country)) {
    patch.country = org.country
    filledColumns.push("country")
  }
  if (isEmpty(current.logo_url) && !isEmpty(org.logoUrl)) {
    patch.logo_url = org.logoUrl
    filledColumns.push("logo_url")
  }
  if (isEmpty(current.description) && !isEmpty(org.description)) {
    patch.description = org.description
    filledColumns.push("description")
  }

  return { patch, filledColumns }
}

/** Patch para una empresa que Apollo no encontro. Marca el TTL de no-reintento. */
export function buildNotFoundUpdate(now: Date = new Date()): Record<string, unknown> {
  return {
    apollo_organization_id: null,
    apollo_org_status: "not_found",
    apollo_org_synced_at: now.toISOString(),
  }
}

/**
 * Normaliza el payload del checkpoint a UNA sola forma: el objeto
 * `organization` pelado.
 *
 * `/organizations/enrich` responde `{ organization: {...} }` y `bulk_enrich`
 * devuelve los objetos sueltos dentro de un array. Si guardamos cada uno como
 * viene, la tabla termina con dos shapes y toda query de promocion futura
 * (`payload->>'technology_names'`) falla en silencio para la mitad de las
 * filas. Guardar siempre el objeto interno hace que el checkpoint sea
 * consultable de una sola manera.
 */
export function unwrapOrganization(rawPayload: unknown): unknown {
  if (!rawPayload || typeof rawPayload !== "object") return null
  const r = rawPayload as Record<string, unknown>
  const inner = r.organization
  if (inner && typeof inner === "object") return inner
  return rawPayload
}

/**
 * Aplica el enrichment y deja el rastro en el checkpoint.
 * Devuelve las columnas genericas que se llenaron.
 */
export async function applyCompanyEnrichment(
  supabase: SupabaseClient,
  current: CompanyEnrichTarget,
  org: ApolloOrganization,
  requestedDomain: string | null,
  rawPayload: unknown,
): Promise<string[]> {
  const { patch, filledColumns } = buildCompanyUpdate(current, org)

  const { error } = await supabase.from("companies").update(patch).eq("id", current.id)
  if (error) throw new Error(`No se pudo actualizar companies ${current.id}: ${error.message}`)

  await supabase
    .schema("v3")
    .from("apollo_company_enrichment")
    .upsert(
      {
        company_id: current.id,
        requested_domain: requestedDomain,
        status: "found",
        apollo_organization_id: org.id,
        payload: unwrapOrganization(rawPayload),
        filled_columns: filledColumns,
        error_message: null,
        processed_at: new Date().toISOString(),
      },
      { onConflict: "company_id" },
    )

  return filledColumns
}
