import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { canonicalizeSignals, groupBySignal } from "@/lib/shared/canonical-signals"

const GENERIC_TOKENS = new Set(["banco", "bank", "argentina", "grupo", "group", "sa", "srl", "inc", "the", "de", "del", "y"])
const MAX_ALIASES = 15
const MAX_SIGNALS = 100
const MAX_IMPLEMENTATIONS = 30
const MAX_JOBS = 30

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function identityTokens(value: string) {
  const normalized = normalize(value)
  const tokens = normalized.split(" ").filter((token) => token.length > 2 && !GENERIC_TOKENS.has(token))
  // BBVA Argentina es la identidad actual de BBVA Banco Francés en los datos legacy.
  if (normalized.includes("bbva") && normalized.includes("argentina")) tokens.push("frances")
  if (normalized.includes("frances")) tokens.push("bbva")
  return [...new Set(tokens)]
}

function aliasScore(canonicalName: string, candidateName: string, canonicalWebsite: string | null, candidateWebsite: string | null) {
  const canonical = new Set(identityTokens(canonicalName))
  const candidate = new Set(identityTokens(candidateName))
  const shared = [...canonical].filter((token) => candidate.has(token))
  const nameScore = canonical.size ? shared.length / canonical.size : 0
  const canonicalDomain = canonicalWebsite?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null
  const candidateDomain = candidateWebsite?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null
  const domainMatch = Boolean(canonicalDomain && candidateDomain && canonicalDomain === candidateDomain)
  return { score: domainMatch ? 1 : nameScore, sharedTokens: shared, domainMatch }
}

/**
 * Nombres de diccionario para los `signal_id` presentes, en dos consultas.
 *
 * Si el diccionario no responde se sigue igual: el término se muestra por su
 * keyword literal. Perder el nombre canónico degrada el agrupamiento, no la
 * lectura, y no vale romper el panorama entero de la cuenta por eso.
 */
async function resolveDictionaryNames(
  admin: ReturnType<typeof createAdminClient>,
  rows: Array<{ signal_type: string; signal_id: string | null }>,
): Promise<Map<string, string>> {
  const idsByType = { technology: new Set<string>(), process: new Set<string>() }
  for (const row of rows) {
    if (!row.signal_id) continue
    if (row.signal_type === "technology") idsByType.technology.add(row.signal_id)
    else if (row.signal_type === "process") idsByType.process.add(row.signal_id)
  }

  const names = new Map<string, string>()
  const [products, processes] = await Promise.all([
    idsByType.technology.size
      ? admin.from("dictionary_products").select("id,name").in("id", [...idsByType.technology])
      : Promise.resolve({ data: [], error: null }),
    idsByType.process.size
      ? admin.from("dictionary_processes").select("id,name").in("id", [...idsByType.process])
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const entry of [...(products.data ?? []), ...(processes.data ?? [])]) names.set(entry.id, entry.name)
  return names
}

/** Fila de `signals` con el perfil y el nombre de diccionario ya resueltos. */
interface SignalRow {
  id: string
  company_id: string | null
  company_name?: string | null
  signal_type: string
  signal_id: string | null
  keyword_matched: string | null
  source_field: string | null
  snippet: string | null
  source_url: string | null
  job_posting_id: string | null
  job_posted_at: string | null
  created_at: string | null
  dictionary_name: string | null
  contact: { id: string; full_name: string | null; linkedin_url: string | null; email1: string | null; updated_at: string | null } | null
}

/**
 * Agrupa las señales por TÉRMINO DE DICCIONARIO y cuenta ENTIDADES distintas.
 *
 * Antes agrupaba por `keyword_matched` y sumaba una por fila. Las dos cosas
 * inflaban: "Microsoft Intune" e "Intune" son la misma entrada de diccionario y
 * se contaban por separado, y una persona con dos filas en `contacts` (el mismo
 * perfil scrapeado con la vanity URL y con el slug autogenerado) contaba dos
 * veces. `count` es ahora personas + vacantes distintas, que es lo que el
 * vendedor cree que está leyendo.
 */
function groupSignals(rows: SignalRow[]) {
  const units = canonicalizeSignals(rows, (row) => ({
    rowId: row.id,
    signalType: row.signal_type,
    signalId: row.signal_id ?? null,
    label: row.dictionary_name ?? null,
    keyword: row.keyword_matched ?? null,
    sourceField: row.source_field ?? null,
    snippet: row.snippet ?? null,
    sourceUrl: row.source_url ?? null,
    // `lastSeen` es lo que separa una tecnología viva de una que aparece por un
    // perfil de 2019. En el modo compacto es la única señal de frescura que hay.
    occurredAt: row.job_posted_at ?? row.created_at ?? null,
    companyId: row.company_id ?? null,
    companyName: row.company_name ?? null,
    jobPostingId: row.job_posting_id ?? null,
    person: row.contact
      ? {
          contactId: row.contact.id,
          fullName: row.contact.full_name,
          linkedinUrl: row.contact.linkedin_url,
          email: row.contact.email1,
          updatedAt: row.contact.updated_at,
        }
      : null,
  }))

  return groupBySignal(units).map((group) => ({
    type: group.signalType,
    label: group.label,
    count: group.entities,
    people: group.people,
    jobPostings: group.jobPostings,
    lastSeen: group.lastSeen,
    evidence: group.units
      .flatMap((unit) => unit.mentions)
      .slice(0, 3)
      .map((mention) => ({
        signalId: mention.rowId,
        companyId: mention.companyId,
        companyName: mention.row.company_name,
        contactId: mention.contactId,
        sourceField: mention.sourceField,
        jobPostingId: mention.row.job_posting_id,
        snippet: mention.snippet,
        sourceUrl: mention.sourceUrl,
        occurredAt: mention.occurredAt,
      })),
  }))
}

export type SignalSummaryDetail = "compact" | "full"

/**
 * Panorama de evidencia de una cuenta.
 *
 * `detail` existe porque el modo completo era impagable para lo que más se usa.
 * Medido: COTO, una cuenta con 10 señales, devolvía ~10.000 tokens, porque trae
 * hasta 3 snippets por término, las implementaciones enteras y 30 vacantes con
 * 500 caracteres de descripción cada una. Con ese costo, validar las 20 cuentas
 * que salen de una búsqueda es inviable, y la validación termina delegada al
 * usuario ("revisá una por una"), que es justo el trabajo que la tool tendría
 * que hacer.
 *
 * `compact` devuelve la MISMA lectura —qué términos, cuántas señales, cuándo se
 * vieron por última vez— sin una sola cita textual. Alcanza para descartar: en
 * COTO se ve enseguida que las 10 señales de la búsqueda no incluyen Angular ni
 * Oracle Forms entre sus tecnologías principales. Cuando hace falta la cita, ya
 * existe get_account_evidence_detail, que va a un término puntual.
 */
export async function getCompanySignalSummary(companyId: string, detail: SignalSummaryDetail = "full") {
  const admin = createAdminClient()
  const { data: canonical, error: companyError } = await admin.from("companies").select("id,name,normalized_name,website,country,industry").eq("id", companyId).maybeSingle()
  if (companyError) throw new Error(`COMPANY_READ_FAILED:${companyError.message}`)
  if (!canonical) throw new Error("COMPANY_NOT_FOUND")

  const tokens = identityTokens(canonical.name)
  const searchTokens = tokens.length ? tokens.slice(0, 3) : normalize(canonical.name).split(" ").slice(0, 1)
  const filters = searchTokens.map((token) => `name.ilike.%${token.replaceAll(",", "")}%`).join(",")
  const { data: candidates, error: aliasError } = await admin.from("companies").select("id,name,website,country,industry").or(filters).limit(100)
  if (aliasError) throw new Error(`COMPANY_ALIAS_SEARCH_FAILED:${aliasError.message}`)

  const aliases = (candidates ?? [])
    .map((candidate) => ({ ...candidate, ...aliasScore(canonical.name, candidate.name, canonical.website, candidate.website) }))
    .filter((candidate) => candidate.id === canonical.id || candidate.domainMatch || candidate.score >= 0.6)
    .sort((a, b) => (a.id === canonical.id ? -1 : b.score - a.score))
    .slice(0, MAX_ALIASES)
  if (!aliases.some((alias) => alias.id === canonical.id)) aliases.unshift({ ...canonical, score: 1, sharedTokens: tokens, domainMatch: false })
  const companyIds = aliases.map((alias) => alias.id)
  const aliasNames = new Map(aliases.map((alias) => [alias.id, alias.name]))

  const [signalsResult, implementationsResult, jobsResult] = await Promise.all([
    // El join a contacts es lo que permite saber que dos filas son la misma
    // persona: sin el LinkedIn y el email, un perfil duplicado en `contacts`
    // cuenta dos veces la misma señal.
    admin.from("signals").select("id,company_id,signal_type,signal_id,keyword_matched,source_field,snippet,source_url,job_posting_id,job_posted_at,created_at,contacts:contact_id ( id, full_name, linkedin_url, email1, updated_at )").in("company_id", companyIds).order("created_at", { ascending: false }).limit(MAX_SIGNALS),
    admin.from("company_implementations").select("id,company_id,title,provider_name,technology,summary,area,evidence_level,relevance_snippet,source_url,source_name,published_at,created_at").in("company_id", companyIds).order("created_at", { ascending: false }).limit(MAX_IMPLEMENTATIONS),
    admin.from("job_postings").select("id,company_id,title,description,location,posted_at,is_active,job_url,created_at").in("company_id", companyIds).order("posted_at", { ascending: false, nullsFirst: false }).limit(MAX_JOBS),
  ])
  if (signalsResult.error) throw new Error(`SIGNALS_READ_FAILED:${signalsResult.error.message}`)
  if (implementationsResult.error) throw new Error(`IMPLEMENTATIONS_READ_FAILED:${implementationsResult.error.message}`)
  if (jobsResult.error) throw new Error(`JOBS_READ_FAILED:${jobsResult.error.message}`)

  // El nombre de diccionario NO se puede traer con un embed: `signal_id` es
  // polimórfico (apunta a dictionary_products o a dictionary_processes según el
  // tipo) y no tiene FK. Sin él habría que agrupar por la keyword literal, que
  // es exactamente lo que duplicaba las señales.
  const dictionaryNames = await resolveDictionaryNames(admin, signalsResult.data ?? [])
  const signals: SignalRow[] = (signalsResult.data ?? []).map((row) => {
    const joined = (row as Record<string, unknown>).contacts
    const contact = (Array.isArray(joined) ? joined[0] : joined) as SignalRow["contact"]
    return {
      ...(row as unknown as SignalRow),
      company_name: aliasNames.get(row.company_id) ?? null,
      dictionary_name: row.signal_id ? (dictionaryNames.get(row.signal_id) ?? null) : null,
      contact: contact ?? null,
    }
  })
  const linkedSignalIds = new Map<string, string[]>()
  for (const signal of signals) if (signal.job_posting_id) linkedSignalIds.set(signal.job_posting_id, [...(linkedSignalIds.get(signal.job_posting_id) ?? []), signal.id])
  const jobs = (jobsResult.data ?? []).map((job) => ({ id: job.id, companyId: job.company_id, companyName: aliasNames.get(job.company_id), title: job.title, location: job.location, postedAt: job.posted_at ?? job.created_at, isActive: job.is_active, jobUrl: job.job_url, descriptionSnippet: job.description?.slice(0, 500) ?? null, linkedSignalIds: linkedSignalIds.get(job.id) ?? [], interpretationStatus: linkedSignalIds.has(job.id) ? "classified_signal_available" : "raw_evidence_only" }))
  const grouped = groupSignals(signals)
  // Señales canónicas, no filas: `signals.length` contaba dos veces la misma
  // (término, persona) cuando el perfil estaba duplicado en `contacts`.
  const canonicalSignalCount = grouped.reduce((total, group) => total + group.count, 0)

  const implementations = implementationsResult.data ?? []
  const status = signals.length || implementations.length || jobs.length ? "evidence_available" : "empty"
  const aliasWarning = aliases.length > 1 ? "Se consolidaron entidades v2 relacionadas. Cada evidencia conserva companyId y companyName de origen." : null

  if (detail === "compact") {
    const strip = (item: (typeof grouped)[number]) => ({ label: item.label, type: item.type, count: item.count, lastSeen: item.lastSeen })
    return {
      detail: "compact" as const,
      company: canonical,
      aliasResolution: { strategy: "conservative_name_or_domain_overlap", aliasCount: aliases.length, warning: aliasWarning },
      summary: {
        status,
        technologies: grouped.filter((item) => item.type === "technology").map(strip),
        processes: grouped.filter((item) => item.type === "process").map(strip),
        signalCount: canonicalSignalCount,
        implementationCount: implementations.length,
        jobPostingCount: jobs.length,
      },
      // Solo identidad y frescura: sin `summary`, sin `relevance_snippet`, sin
      // `evidence_detail`. Esos tres campos son la mayor parte del peso.
      implementations: implementations.map((item) => ({ id: item.id, title: item.title, technology: item.technology, area: item.area, evidenceLevel: item.evidence_level, publishedAt: item.published_at ?? item.created_at })),
      // Las vacantes NO se listan: son 30 filas con 500 caracteres de
      // descripción cada una y no cambian la decisión de descartar la cuenta.
      jobPostings: { count: jobs.length, activeCount: jobs.filter((job) => job.isActive).length, latestPostedAt: jobs[0]?.postedAt ?? null },
      interpretationGuidance:
        "Vista COMPACTA: hay conteos y fechas, no citas textuales. Sirve para decidir si la cuenta es relevante. " +
        "Para ver de dónde sale un término (fragmento, fecha, link, y de qué persona se infiere) usá get_account_evidence_detail con ese término. " +
        "Para el panorama entero con evidencia y vacantes, repetí esta tool con detail=\"full\".",
      limits: { aliases: MAX_ALIASES, signals: MAX_SIGNALS, implementations: MAX_IMPLEMENTATIONS, jobPostings: MAX_JOBS },
    }
  }

  return {
    detail: "full" as const,
    company: canonical,
    aliasResolution: { strategy: "conservative_name_or_domain_overlap", aliases: aliases.map(({ id, name, website, score, sharedTokens, domainMatch }) => ({ companyId: id, name, website, confidence: Number(score.toFixed(2)), sharedTokens, domainMatch })), warning: aliasWarning },
    summary: { status, technologies: grouped.filter((item) => item.type === "technology"), processes: grouped.filter((item) => item.type === "process"), signalCount: canonicalSignalCount, implementationCount: implementations.length, jobPostingCount: jobs.length },
    implementations: implementations.map((item) => ({ ...item, companyName: aliasNames.get(item.company_id) })),
    jobPostings: jobs,
    interpretationGuidance: "Resume solo lo observado. Distingue señales clasificadas, implementaciones y evidencia cruda de vacantes. Una vacante sin linkedSignalIds es indicio, no confirmación de tecnología o proceso implementado.",
    limits: { aliases: MAX_ALIASES, signals: MAX_SIGNALS, implementations: MAX_IMPLEMENTATIONS, jobPostings: MAX_JOBS },
  }
}
