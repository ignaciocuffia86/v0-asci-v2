/**
 * Factory de fixtures para responses de Apollo.
 * Mantiene los tests legibles sin pegar JSONs gigantes en cada archivo.
 */

export type MakePersonOpts = {
  id?: string
  name?: string
  title?: string
  linkedin?: string | null
  withEmail?: boolean
  withPhone?: boolean
}

let personCounter = 0

export function makePerson(opts: MakePersonOpts = {}) {
  personCounter++
  const id = opts.id ?? `apol_${personCounter}`
  const [first, ...rest] = (opts.name ?? `Test Person ${personCounter}`).split(" ")
  return {
    id,
    first_name: first,
    last_name: rest.join(" ") || "Doe",
    name: opts.name ?? `${first} ${rest.join(" ") || "Doe"}`,
    title: opts.title ?? "Chief Executive Officer",
    linkedin_url: opts.linkedin === null ? null : opts.linkedin ?? `https://linkedin.com/in/test-${id}`,
    email: opts.withEmail ? `test-${id}@example.com` : null,
    email_status: opts.withEmail ? "verified" : null,
    phone_numbers: opts.withPhone
      ? [{ raw_number: "+54 9 11 5555 5555", sanitized_number: "+5491155555555", type: "mobile" }]
      : [],
    organization: { id: "org_test", name: "Acme Inc", website_url: "https://acme.com" },
  }
}

export function makeSearchResponse(opts: {
  count?: number
  totalEntries?: number
  page?: number
  perPage?: number
  withPhone?: boolean
} = {}) {
  const count = opts.count ?? 10
  const perPage = opts.perPage ?? 25
  return {
    people: Array.from({ length: count }, (_, i) =>
      makePerson({ id: `apol_search_${i}`, withEmail: true, withPhone: opts.withPhone ?? false }),
    ),
    pagination: {
      page: opts.page ?? 1,
      per_page: perPage,
      total_entries: opts.totalEntries ?? count,
      total_pages: Math.ceil((opts.totalEntries ?? count) / perPage),
    },
  }
}

export function makeMatchResponse(opts: MakePersonOpts = {}) {
  return { person: makePerson(opts) }
}

export function makeEnrichResponse(opts: { found?: boolean } = {}) {
  if (opts.found === false) return { organization: null }
  return {
    organization: {
      id: "org_acme_123",
      name: "Acme Inc",
      website_url: "https://acme.com",
      estimated_num_employees: 500,
      industry: "Software",
      linkedin_url: "https://linkedin.com/company/acme",
    },
  }
}

/**
 * Reset del counter para tests determinísticos.
 */
export function resetPersonCounter() {
  personCounter = 0
}
