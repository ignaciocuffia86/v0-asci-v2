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
  // ── Campos agregados en la Fase 1 de Apollo (26-ago-2026) ──
  // Apollo devuelve ~45 campos por empresa y solo leiamos 8. Estos son los que
  // tienen destino en `companies`; el resto vive en el payload crudo del
  // checkpoint (v3.apollo_company_enrichment).
  logoUrl: string | null
  description: string | null
  foundedYear: number | null
  annualRevenue: number | null
  /** technology_names[] — insumo complementario: NO reemplaza al tech radar propio */
  technologies: string[]
  keywords: string[]
  publiclyTradedSymbol: string | null
  publiclyTradedExchange: string | null
  /** Crecimiento de headcount a 6/12/24 meses; Apollo solo lo manda a veces */
  headcountGrowth: Record<string, number> | null
  // ── Fase 1.2: campos medidos con alta cobertura sobre payloads reales ──
  /** Headcount por area. 100% de cobertura; el campo mas valioso del payload */
  departmentalHeadCount: Record<string, number> | null
  phone: string | null
  /** Todas las industrias; `industry` guarda la principal */
  industries: string[]
  naicsCodes: string[]
  sicCodes: string[]
  city: string | null
  state: string | null
  /** ID numerico de LinkedIn — alimenta linkedin_company_id si esta vacia */
  linkedinUid: number | null
}

/** Lista de strings defensiva: Apollo a veces manda null y a veces objetos. */
function strArray(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const clean = item.trim()
    if (clean) out.push(clean)
    if (out.length >= cap) break
  }
  return out
}

function numOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function strOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null
  const clean = value.trim()
  return clean === "" ? null : clean
}

/**
 * Agrupa el crecimiento de headcount. Apollo manda tres claves sueltas
 * (six/twelve/twenty_four) y solo para ~18% de las empresas; devolvemos null
 * si no vino ninguna para no llenar la columna de objetos vacios.
 */
function parseHeadcountGrowth(org: Record<string, unknown>): Record<string, number> | null {
  const windows: Array<[string, string]> = [
    ["six_month", "organization_headcount_six_month_growth"],
    ["twelve_month", "organization_headcount_twelve_month_growth"],
    ["twenty_four_month", "organization_headcount_twenty_four_month_growth"],
  ]
  const out: Record<string, number> = {}
  for (const [key, apolloKey] of windows) {
    const n = numOrNull(org[apolloKey])
    if (n !== null) out[key] = n
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Headcount por area. Apollo lo manda como objeto plano
 * {"information_technology": 700, "engineering": 472, ...} con 100% de
 * cobertura sobre los payloads medidos. Se filtran las claves no numericas
 * porque el shape ya cambio antes sin aviso.
 */
function parseDepartmentalHeadCount(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = numOrNull(v)
    if (n !== null) out[k] = n
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * El telefono viene anidado: {number, source, sanitized_number}. Preferimos el
 * sanitizado, que es el unico apto para discar sin limpiar.
 */
function parsePhone(value: unknown): string | null {
  if (typeof value === "string") return strOrNull(value)
  if (!value || typeof value !== "object") return null
  const p = value as Record<string, unknown>
  return strOrNull(p.sanitized_number) ?? strOrNull(p.number)
}

// Apollo devuelve hasta ~160 keywords por empresa (medido en produccion).
// Guardamos las primeras 50: vienen por relevancia y el resto queda intacto en
// el payload crudo del checkpoint.
const MAX_KEYWORDS = 50
// Tope de seguridad, no de recorte: la mediana ronda las 55 tecnologias por
// empresa pero Carrefour trae 221 (medido en produccion). Se deja holgado para
// no truncar en silencio; el payload crudo del checkpoint queda igual completo.
const MAX_TECHNOLOGIES = 500

export function parseOrganizationResponse(resp: unknown): ApolloOrganization | null {
  if (!resp || typeof resp !== "object") return null
  const r = resp as Record<string, unknown>
  const org = (r.organization as Record<string, unknown> | undefined) || r
  if (!org || typeof org !== "object") return null
  const id = org.id as string | undefined
  if (!id) return null
  // Facturacion: `organization_revenue` cubre el 100% de los payloads medidos
  // contra el 53% de `annual_revenue`, y cuando ambos existen NUNCA difieren
  // (verificado sobre 134 payloads reales). Se prefiere el que mas cubre.
  const revenue = numOrNull(org.annual_revenue) ?? numOrNull(org.organization_revenue)
  return {
    id,
    name: (org.name as string | undefined) || null,
    primaryDomain: (org.primary_domain as string | undefined) || null,
    websiteUrl: (org.website_url as string | undefined) || null,
    industry: (org.industry as string | undefined) || null,
    employeesCount: (org.estimated_num_employees as number | undefined) || null,
    linkedinUrl: (org.linkedin_url as string | undefined) || null,
    country: (org.country as string | undefined) || null,
    logoUrl: strOrNull(org.logo_url),
    description: strOrNull(org.short_description),
    foundedYear: numOrNull(org.founded_year),
    annualRevenue: revenue === null ? null : Math.round(revenue),
    technologies: strArray(org.technology_names, MAX_TECHNOLOGIES),
    keywords: strArray(org.keywords, MAX_KEYWORDS),
    publiclyTradedSymbol: strOrNull(org.publicly_traded_symbol),
    publiclyTradedExchange: strOrNull(org.publicly_traded_exchange),
    headcountGrowth: parseHeadcountGrowth(org),
    departmentalHeadCount: parseDepartmentalHeadCount(org.departmental_head_count),
    phone: parsePhone(org.primary_phone) ?? strOrNull(org.sanitized_phone),
    industries: strArray(org.industries, 20),
    naicsCodes: strArray(org.naics_codes, 20),
    sicCodes: strArray(org.sic_codes, 20),
    city: strOrNull(org.city),
    state: strOrNull(org.state),
    linkedinUid: numOrNull(org.linkedin_uid),
  }
}

/**
 * Cuenta los creditos que cobra un enrichment de organizaciones.
 *
 * Apollo cobra 1 credito POR CUENTA RESUELTA, no por request: un
 * `bulk_enrich` con 10 dominios de los que matchean 6 cuesta 6, no 10 ni 1.
 * Un dominio que no matchea no se cobra.
 *
 * Sirve para las dos formas de respuesta: `{organization:{...}}` del enrich
 * simple y `{organizations:[...]}` del bulk.
 *
 * NOTA: esto es nuestra contabilidad, no la de Apollo. La unica forma de
 * confirmarla es reconciliar contra el contador real de la cuenta. Por eso el
 * logger tambien guarda cuantos dominios se enviaron (metadata.bulk_size):
 * si Apollo cobrara por request y no por cuenta, la diferencia entre ambos
 * numeros deja el error a la vista en vez de esconderlo.
 */
export function countEnrichCredits(resp: unknown): number {
  if (!resp || typeof resp !== "object") return 0
  const r = resp as Record<string, unknown>
  if (Array.isArray(r.organizations)) {
    return r.organizations.filter((o) => parseOrganizationResponse(o) !== null).length
  }
  return parseOrganizationResponse(resp) !== null ? 1 : 0
}

/**
 * Parsea el response de /organizations/bulk_enrich.
 *
 * Apollo devuelve `{ organizations: [...] }` en el MISMO orden en que se
 * pidieron los dominios, con huecos para los que no matchearon. Preservar ese
 * orden es lo que permite al caller mapear cada resultado a su company_id, asi
 * que devolvemos un array con `null` en los huecos en vez de filtrarlos.
 */
export function parseBulkOrganizationResponse(resp: unknown): Array<ApolloOrganization | null> {
  if (!resp || typeof resp !== "object") return []
  const r = resp as Record<string, unknown>
  const list = r.organizations
  if (!Array.isArray(list)) return []
  return list.map((item) => parseOrganizationResponse(item))
}
