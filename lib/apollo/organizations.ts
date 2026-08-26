/**
 * Resolución de Apollo organization_id para una `companies` row.
 *
 * Estrategia:
 * 1. Si `apollo_organization_id` ya está en DB y `apollo_org_synced_at` es
 *    reciente (< 60d), devolverlo cacheado.
 * 2. Si está marcado como `NOT_FOUND` y el TTL (7d) no expiró, no reintentar.
 * 3. Normalizar el domain con `normalizeDomain` y llamar `/organizations/enrich`.
 * 4. Si falla, reintentar con los fallbacks (subdominio regional).
 * 5. Persistir el resultado (id, industry, employees, status).
 */

import { createAdminClient } from "@/lib/supabase/admin"
import { apolloRequest } from "./client"
import { normalizeDomain } from "./domain"
import { countEnrichCredits, parseOrganizationResponse, type ApolloOrganization } from "./parsers"
import { applyCompanyEnrichment, buildNotFoundUpdate, type CompanyEnrichTarget } from "./company-writer"

const ORG_TTL_DAYS = 60
const NOT_FOUND_TTL_DAYS = 7

type Company = CompanyEnrichTarget & {
  name: string | null
  apollo_organization_id: string | null
  apollo_org_status: string | null
  apollo_org_synced_at: string | null
}

export type ResolvedOrganization =
  | { status: "found"; organizationId: string; organization: ApolloOrganization | null }
  | { status: "not_found"; reason: string }
  | { status: "error"; reason: string; statusCode: number }

function isFresh(syncedAt: string | null, days: number): boolean {
  if (!syncedAt) return false
  const ts = new Date(syncedAt).getTime()
  if (Number.isNaN(ts)) return false
  return Date.now() - ts < days * 24 * 60 * 60 * 1000
}

export async function resolveCompanyOrganizationId(
  companyId: string,
  opts: { userId: string | null; bookmarkId?: string | null; forceRefresh?: boolean } = { userId: null },
): Promise<ResolvedOrganization> {
  const supabase = createAdminClient()

  const { data: company, error } = await supabase
    .from("companies")
    .select(
      "id,name,website,linkedin_url,country,logo_url,description,apollo_organization_id,apollo_org_status,apollo_org_synced_at",
    )
    .eq("id", companyId)
    .single<Company>()

  if (error || !company) {
    return { status: "error", reason: "Empresa no encontrada en DB", statusCode: 0 }
  }

  // Cache hit
  if (!opts.forceRefresh) {
    if (
      company.apollo_organization_id &&
      company.apollo_org_status === "found" &&
      isFresh(company.apollo_org_synced_at, ORG_TTL_DAYS)
    ) {
      return {
        status: "found",
        organizationId: company.apollo_organization_id,
        organization: null,
      }
    }
    if (company.apollo_org_status === "not_found" && isFresh(company.apollo_org_synced_at, NOT_FOUND_TTL_DAYS)) {
      return {
        status: "not_found",
        reason: "Empresa no indexada en Apollo (cached)",
      }
    }
  }

  const normalized = normalizeDomain(company.website)
  const domains: string[] = []
  if (normalized) {
    domains.push(normalized.primary, ...normalized.fallbacks)
  }

  if (domains.length === 0 && !company.name) {
    return { status: "error", reason: "La empresa no tiene dominio ni nombre", statusCode: 0 }
  }

  let found: ApolloOrganization | null = null
  // Con que dominio matcheo y que devolvio Apollo: los necesita el checkpoint
  // para poder promover campos nuevos sin volver a llamar a la API.
  let foundWithDomain: string | null = null
  let foundRaw: unknown = null
  let lastStatus = 0
  let lastError = ""

  for (const domain of domains.length > 0 ? domains : [null]) {
    const requestBody: Record<string, unknown> = {}
    if (domain) requestBody.domain = domain
    else if (company.name) requestBody.name = company.name

    const result = await apolloRequest<unknown>({
      endpoint: "organizations/enrich",
      method: "POST",
      userId: opts.userId,
      bookmarkId: opts.bookmarkId,
      companyId,
      requestBody,
      // Apollo cobra 1 credito por cuenta resuelta. Antes esto decia
      // `0, // enrich no consume credits`: esa suposicion venia de confundir el
      // cupo interno de ASCI por plan (que si es 0 para este paso) con la
      // facturacion de Apollo, y dejaba el ledger de apollo_api_calls —el que
      // alimenta get_ai_usage y el dashboard de admin— ciego al gasto real.
      creditsEstimated: countEnrichCredits,
    })

    if (!result.ok) {
      lastStatus = result.status
      lastError = result.error
      continue
    }

    found = parseOrganizationResponse(result.data)
    if (found) {
      foundWithDomain = domain
      foundRaw = result.data
      break
    }
  }

  if (found) {
    // Antes se escribian 5 columnas y se tiraba el resto del payload (tecnologias,
    // facturacion, LinkedIn, descripcion...). applyCompanyEnrichment persiste todo
    // respetando la precedencia: apollo_* siempre, genericas solo si estan vacias.
    await applyCompanyEnrichment(supabase, company, found, foundWithDomain, foundRaw)

    return { status: "found", organizationId: found.id, organization: found }
  }

  // Not found: marcamos con TTL para no reintentar
  if (lastStatus === 404 || (lastStatus >= 200 && lastStatus < 300)) {
    await supabase.from("companies").update(buildNotFoundUpdate()).eq("id", companyId)

    await supabase
      .schema("v3")
      .from("apollo_company_enrichment")
      .upsert(
        {
          company_id: companyId,
          requested_domain: domains[0] ?? null,
          status: "not_found",
          processed_at: new Date().toISOString(),
        },
        { onConflict: "company_id" },
      )

    return { status: "not_found", reason: "Empresa no indexada en Apollo" }
  }

  return {
    status: "error",
    reason: lastError || `Apollo error ${lastStatus}`,
    statusCode: lastStatus,
  }
}
