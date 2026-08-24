import "server-only"

import { linkedinProfileBase } from "@/lib/shared/linkedin-profile"

import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeDomain } from "@/lib/apollo/domain"

export type ContactSource = "contacts-v2" | "apollo-cache"

export interface CanonicalContact {
  id: string
  source: ContactSource
  fullName: string
  title: string | null
  seniority: string | null
  departments: string[]
  email: string | null
  emailStatus: string | null
  linkedinUrl: string | null
  country: string | null
  freshness: string | null
  matchConfidence: "high" | "medium"
  rank: number
}

const SENIORITY_WEIGHT: Record<string, number> = {
  c_suite: 30,
  owner: 30,
  founder: 30,
  vp: 24,
  director: 20,
  head: 18,
  manager: 12,
}

/**
 * Clave de identidad para unir las dos fuentes.
 *
 * `contacts` y `apollo_contacts_cache` son tablas distintas con la misma
 * persona adentro, y Apollo no comparte el id de v2: lo único que las cruza es
 * el perfil de LinkedIn. La normalización floja de antes —bajar a minúsculas y
 * sacar el https— dejaba pasar como dos personas distintas al mismo perfil
 * scrapeado con la vanity URL y con el slug autogenerado, que es el mismo caso
 * que duplicaba filas en `contacts`. Se usa la base del slug para que las dos
 * formas caigan en la misma clave.
 */
function normalizeLinkedin(value: string | null | undefined) {
  return linkedinProfileBase(value)
}

function rank(contact: Omit<CanonicalContact, "rank">, recommendedTitles: string[]) {
  const title = contact.title?.toLowerCase() ?? ""
  const seniority = contact.seniority?.toLowerCase().replace(/[ -]/g, "_") ?? ""
  const titleMatch = recommendedTitles.some((item) => {
    const normalized = item.toLowerCase().trim()
    return normalized.length > 2 && (title.includes(normalized) || normalized.includes(title))
  })
  return (SENIORITY_WEIGHT[seniority] ?? 4) + (titleMatch ? 35 : 0) + (contact.email ? 8 : 0) + (contact.linkedinUrl ? 5 : 0)
}

export async function getCanonicalContacts(params: {
  companyId: string
  recommendedTitles?: string[]
  limit?: number
}): Promise<{ contacts: CanonicalContact[]; warnings: string[] }> {
  const admin = createAdminClient()
  const recommendedTitles = params.recommendedTitles ?? []
  const limit = params.limit ?? 8
  const warnings: string[] = []

  const { data: company } = await admin
    .from("companies")
    .select("website")
    .eq("id", params.companyId)
    .maybeSingle()
  const domain = normalizeDomain(company?.website)
  const domains = domain ? [domain.primary, ...domain.fallbacks] : []

  const [nativeResult, apolloResult] = await Promise.all([
    admin
      .from("contacts")
      .select("id, full_name, current_position_title, linkedin_url, country, updated_at")
      .eq("current_company_id", params.companyId)
      .limit(30),
    domains.length
      ? admin
          .from("apollo_contacts_cache")
          .select("id, full_name, title, seniority, departments, email, email_status, linkedin_url, country, updated_at")
          .in("company_domain", domains)
          .order("updated_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (nativeResult.error) warnings.push("No se pudieron leer todos los contactos vinculados de v2")
  if (apolloResult.error) warnings.push("No se pudo leer el cache de contactos de Apollo")

  const candidates: Omit<CanonicalContact, "rank">[] = [
    ...((nativeResult.data ?? []).map((row) => ({
      id: row.id,
      source: "contacts-v2" as const,
      fullName: row.full_name ?? "Sin nombre",
      title: row.current_position_title ?? null,
      seniority: null,
      departments: [],
      email: null,
      emailStatus: null,
      linkedinUrl: row.linkedin_url ?? null,
      country: row.country ?? null,
      freshness: row.updated_at ?? null,
      matchConfidence: "high" as const,
    }))),
    ...((apolloResult.data ?? []).map((row) => ({
      id: row.id,
      source: "apollo-cache" as const,
      fullName: row.full_name ?? "Sin nombre",
      title: row.title ?? null,
      seniority: row.seniority ?? null,
      departments: Array.isArray(row.departments) ? row.departments : [],
      email: row.email ?? null,
      emailStatus: row.email_status ?? null,
      linkedinUrl: row.linkedin_url ?? null,
      country: row.country ?? null,
      freshness: row.updated_at ?? null,
      matchConfidence: "medium" as const,
    }))),
  ]

  const deduped = new Map<string, CanonicalContact>()
  for (const contact of candidates) {
    const key = normalizeLinkedin(contact.linkedinUrl) ?? `${contact.fullName.toLowerCase()}|${contact.title?.toLowerCase() ?? ""}`
    const ranked = { ...contact, rank: rank(contact, recommendedTitles) }
    const current = deduped.get(key)
    if (!current || ranked.rank > current.rank || (ranked.email && !current.email)) deduped.set(key, ranked)
  }

  return {
    contacts: [...deduped.values()].sort((a, b) => b.rank - a.rank).slice(0, limit),
    warnings,
  }
}
