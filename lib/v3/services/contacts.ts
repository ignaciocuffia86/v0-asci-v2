import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeDomain } from "@/lib/apollo/domain"

export interface CachedContact {
  id: string
  apolloId: string | null
  fullName: string
  title: string | null
  seniority: string | null
  email: string | null
  emailStatus: string | null
  linkedinUrl: string | null
  city: string | null
  country: string | null
  departments: string[] | null
}

/**
 * Contactos (decision makers) desde el cache global de Apollo en public.
 * El cache se indexa por dominio de la empresa, no por company_id.
 */
export async function getCompanyCachedContacts(companyId: string, limit = 8): Promise<CachedContact[]> {
  const supabase = createAdminClient()

  const { data: company } = await supabase
    .from("companies")
    .select("website")
    .eq("id", companyId)
    .maybeSingle()

  const normalized = normalizeDomain(company?.website)
  if (!normalized) return []
  const domains = [normalized.primary, ...normalized.fallbacks]

  const { data: contacts } = await supabase
    .from("apollo_contacts_cache")
    .select(
      "id, apollo_id, full_name, title, seniority, email, email_status, linkedin_url, city, country, departments",
    )
    .in("company_domain", domains)
    .order("updated_at", { ascending: false })
    .limit(limit)

  return (contacts ?? []).map((c) => ({
    id: c.id,
    apolloId: c.apollo_id ?? null,
    fullName: c.full_name ?? "Sin nombre",
    title: c.title ?? null,
    seniority: c.seniority ?? null,
    email: c.email ?? null,
    emailStatus: c.email_status ?? null,
    linkedinUrl: c.linkedin_url ?? null,
    city: c.city ?? null,
    country: c.country ?? null,
    departments: Array.isArray(c.departments) ? c.departments : null,
  }))
}
