/**
 * Parsing defensivo de responses de Apollo.
 *
 * Apollo cambia el shape de sus responses sin anuncio. Estos helpers aislan
 * el mapping para que cambios futuros se arreglen en un solo lugar y para
 * poder testear el parsing sin pegar a la API real.
 */

export type ApolloPhoneNumber = {
  raw_number?: string
  sanitized_number?: string
  type?: string
  status?: string
  position?: number
}

export type ApolloPersonRaw = {
  id?: string
  first_name?: string | null
  last_name?: string | null
  name?: string | null
  title?: string | null
  headline?: string | null
  email?: string | null
  email_status?: string | null
  linkedin_url?: string | null
  photo_url?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  seniority?: string | null
  departments?: string[] | null
  phone_numbers?: ApolloPhoneNumber[] | null
  sanitized_phone?: string | null
  organization?: {
    id?: string
    name?: string
    website_url?: string
    primary_domain?: string
  } | null
}

export type ApolloPersonNormalized = {
  apolloId: string
  firstName: string | null
  lastName: string | null
  fullName: string
  title: string | null
  headline: string | null
  email: string | null
  emailStatus: string | null
  linkedinUrl: string | null
  photoUrl: string | null
  city: string | null
  state: string | null
  country: string | null
  seniority: string | null
  departments: string[]
  mobilePhone: string | null
  workPhone: string | null
  organizationId: string | null
}

/**
 * Selecciona el mejor telefono de la lista.
 * Orden de preferencia: mobile > work > cualquier otro con status verified.
 * Devuelve el `sanitized_number` si esta, sino `raw_number`.
 */
export function pickBestPhone(
  phones: ApolloPhoneNumber[] | null | undefined,
  preferredType: "mobile" | "work" = "mobile",
): string | null {
  if (!Array.isArray(phones) || phones.length === 0) return null

  const score = (p: ApolloPhoneNumber) => {
    let s = 0
    if (p.type?.toLowerCase() === preferredType) s += 10
    if (p.type?.toLowerCase() === "mobile") s += 5
    if (p.type?.toLowerCase() === "work") s += 3
    if (p.status?.toLowerCase() === "verified") s += 2
    if (p.sanitized_number) s += 1
    return s
  }

  const sorted = [...phones].sort((a, b) => score(b) - score(a))
  const pick = sorted[0]
  return pick.sanitized_number || pick.raw_number || null
}

export function normalizePerson(raw: ApolloPersonRaw | null | undefined): ApolloPersonNormalized | null {
  if (!raw || !raw.id) return null

  const firstName = (raw.first_name || "").trim() || null
  const lastName = (raw.last_name || "").trim() || null
  const fullName = raw.name?.trim() || [firstName, lastName].filter(Boolean).join(" ").trim()

  return {
    apolloId: raw.id,
    firstName,
    lastName,
    fullName: fullName || "Desconocido",
    title: raw.title?.trim() || null,
    headline: raw.headline?.trim() || null,
    email: raw.email?.trim() || null,
    emailStatus: raw.email_status || null,
    linkedinUrl: raw.linkedin_url || null,
    photoUrl: raw.photo_url || null,
    city: raw.city || null,
    state: raw.state || null,
    country: raw.country || null,
    seniority: raw.seniority || null,
    departments: Array.isArray(raw.departments) ? raw.departments.filter(Boolean) : [],
    mobilePhone: pickBestPhone(raw.phone_numbers, "mobile") || raw.sanitized_phone || null,
    workPhone: pickBestPhone(raw.phone_numbers, "work"),
    organizationId: raw.organization?.id || null,
  }
}

/**
 * Parsea el response de /mixed_people/api_search (endpoint oficial de Apollo
 * para API callers).
 * Devuelve `{ people, totalEntries }` y no falla si faltan campos.
 */
export function parseSearchResponse(resp: unknown): {
  people: ApolloPersonNormalized[]
  totalEntries: number
  page: number
  perPage: number
} {
  if (!resp || typeof resp !== "object") {
    return { people: [], totalEntries: 0, page: 1, perPage: 0 }
  }
  const r = resp as Record<string, unknown>
  const rawPeople = (r.people as ApolloPersonRaw[] | undefined) || []
  const pagination = (r.pagination as Record<string, unknown> | undefined) || {}
  const totalEntries =
    (r.total_entries as number | undefined) ?? (pagination.total_entries as number | undefined) ?? rawPeople.length

  const people = rawPeople.map(normalizePerson).filter((p): p is ApolloPersonNormalized => p !== null)
  return {
    people,
    totalEntries: Number(totalEntries) || people.length,
    page: (pagination.page as number | undefined) ?? (r.page as number | undefined) ?? 1,
    perPage:
      (pagination.per_page as number | undefined) ??
      (r.per_page as number | undefined) ??
      people.length,
  }
}

/**
 * Parsea el response de /organizations/enrich.
 */
export type ApolloOrganization = {
  id: string
  name: string | null
  primaryDomain: string | null
  websiteUrl: string | null
  industry: string | null
  employeesCount: number | null
  linkedinUrl: string | null
  country: string | null
}

export function parseOrganizationResponse(resp: unknown): ApolloOrganization | null {
  if (!resp || typeof resp !== "object") return null
  const r = resp as Record<string, unknown>
  const org = (r.organization as Record<string, unknown> | undefined) || r
  if (!org || typeof org !== "object") return null
  const id = org.id as string | undefined
  if (!id) return null
  return {
    id,
    name: (org.name as string | undefined) || null,
    primaryDomain: (org.primary_domain as string | undefined) || null,
    websiteUrl: (org.website_url as string | undefined) || null,
    industry: (org.industry as string | undefined) || null,
    employeesCount: (org.estimated_num_employees as number | undefined) || null,
    linkedinUrl: (org.linkedin_url as string | undefined) || null,
    country: (org.country as string | undefined) || null,
  }
}
