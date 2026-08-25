import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { canonicalizeSignals, groupBySignal } from "@/lib/shared/canonical-signals"

const GENERIC_TOKENS = new Set(["banco", "bank", "argentina", "grupo", "group", "sa", "srl", "inc", "the", "de", "del", "y"])
const MAX_ALIASES = 15
const MAX_SIGNALS = 100
const MAX_IMPLEMENTATIONS = 30
const MAX_JOBS = 30

/** Fragmentos por término en `detail: "evidence"`. */
const EVIDENCE_SNIPPETS_PER_TERM = 2
/** Términos que devuelve `detail: "evidence"` cuando no se pidió uno puntual. */
const EVIDENCE_TERMS_WITHOUT_QUERY = 3
/** Recorte de cada fragmento en modo evidence. Sostiene el objetivo de <600 tokens por cuenta. */
const EVIDENCE_SNIPPET_CHARS = 300

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function identityTokens(value: string) {
  const normalized = normalize(value)
  const tokens = normalized.split(" ").filter((token) => token.length > 2 && !GENERIC_TOKENS.has(token))
  // BBVA Argentina es la identidad actual de BBVA Banco Francés en los datos legacy.
  if (normalized.includes("bbva") && normalized.includes("argentina")) tokens.push("frances")
  if (normalized.includes("frances")) tokens.push("bbva")
  return [...new Set(tokens)]
}

/**
 * Cuán agresiva es la consolidación de entidades homónimas.
 *
 * `strict` es el default desde el screening de Power BI sobre 61 cuentas chilenas,
 * donde "Consorcio" consolidó 15 entidades ajenas —Consorcio Persa, Consorcio CDZ,
 * varias UTEs de construcción argentinas y peruanas— y reportó 24 señales cuando la
 * aseguradora tenía 6. Atribuirle a un cliente la evidencia de otra empresa es el
 * peor error posible del producto, así que el default se corre al lado seguro: ante
 * la duda, no consolidar. `broad` queda para el caso inverso (una cuenta fragmentada
 * en varias entidades) y es una decisión explícita de quien llama.
 */
export type AliasStrategy = "strict" | "balanced" | "broad"

/**
 * Umbral de similitud de nombre por estrategia. No aplica cuando hay dominio en
 * común: ahí la identidad está probada y el nombre no aporta.
 */
const ALIAS_THRESHOLD: Record<AliasStrategy, number> = { strict: 0.85, balanced: 0.6, broad: 0.4 }

/**
 * Similitud de identidad entre dos entidades.
 *
 * EL BUG QUE ARREGLA. La versión anterior calculaba `shared.length / canonical.size`,
 * que NO es simétrico: no mira cuántos tokens tiene el candidato. Con una canónica de
 * UN token ("Consorcio" → ["consorcio"]) cualquier empresa que contuviera ese token
 * daba exactamente 1.0 y entraba con `confidence: 1`, indistinguible de un match
 * real. Así "Consorcio Cotienne-Arespa" y "Graña y Montero Consorcio Río Urubamba"
 * pasaban a ser la misma empresa que Consorcio Seguros.
 *
 * El coeficiente de Dice —2·|∩| / (|A|+|B|)— penaliza que el candidato traiga tokens
 * que la canónica no tiene: el mismo par da 0.5 y queda afuera de todos los umbrales
 * salvo `broad`. Es el mínimo cambio que rompe la equivalencia falsa.
 */
export function aliasScore(canonicalName: string, candidateName: string, canonicalWebsite: string | null, candidateWebsite: string | null) {
  const canonical = new Set(identityTokens(canonicalName))
  const candidate = new Set(identityTokens(candidateName))
  const shared = [...canonical].filter((token) => candidate.has(token))
  const total = canonical.size + candidate.size
  const nameScore = total ? (2 * shared.length) / total : 0
  const canonicalDomain = canonicalWebsite?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null
  const candidateDomain = candidateWebsite?.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null
  const domainMatch = Boolean(canonicalDomain && candidateDomain && canonicalDomain === candidateDomain)
  return { score: domainMatch ? 1 : nameScore, nameScore, sharedTokens: shared, domainMatch }
}

/**
 * Dos entidades de países distintos NO son la misma empresa.
 *
 * País vacío o desconocido pasa: en `companies` la cobertura es parcial y exigirlo
 * fragmentaría cuentas legítimas, que es el error inverso y también caro.
 */
function countryCompatible(canonicalCountry: string | null, candidateCountry: string | null) {
  const left = normalize(canonicalCountry ?? "")
  const right = normalize(candidateCountry ?? "")
  if (!left || !right) return true
  return left === right
}

export type AliasCandidate = {
  id: string
  name: string
  website: string | null
  country: string | null
  industry: string | null
}

export type SelectedAlias = AliasCandidate & {
  score: number
  nameScore: number
  sharedTokens: string[]
  domainMatch: boolean
  /** Por qué se consolidó. Va en el payload: un número sin motivo no es auditable. */
  reason: string
}

/**
 * Elige qué entidades homónimas se consolidan con la canónica.
 *
 * Función pura y exportada a propósito: es la regla que decide de quién es una
 * señal, y tiene que poder testearse sin base de datos.
 *
 * La regla que hace el trabajo pesado no es el umbral sino la GUARDA DE TOKEN
 * ÚNICO: si la canónica aporta un solo token discriminativo, el nombre no alcanza
 * como prueba de identidad y se exige dominio en común. Los nombres que rompieron
 * en producción —Consorcio, CCU, CGE, Melón, Masisa, EMIN, Colbún— son todos de un
 * token. Sin esta guarda, subir el umbral no los frena: por Dice, "Consorcio" contra
 * "Consorcio Persa" da 0.67, pero contra otra entidad llamada exactamente
 * "Consorcio" da 1.0 y pasa cualquier umbral.
 */
export function selectAliases(canonical: AliasCandidate, candidates: AliasCandidate[], strategy: AliasStrategy): SelectedAlias[] {
  const threshold = ALIAS_THRESHOLD[strategy]
  const canonicalTokens = identityTokens(canonical.name)
  const singleToken = canonicalTokens.length <= 1

  const selected = candidates
    .filter((candidate) => candidate.id !== canonical.id)
    .map((candidate) => ({ ...candidate, ...aliasScore(canonical.name, candidate.name, canonical.website, candidate.website) }))
    .filter((candidate) => {
      if (candidate.domainMatch) return true
      // `broad` es la salida de emergencia para cuentas fragmentadas: acepta el
      // parecido de nombre aunque la canónica sea de un token. Quien la pide sabe
      // lo que está pidiendo, y el payload lo informa.
      if (singleToken && strategy !== "broad") return false
      if (candidate.nameScore < threshold) return false
      if (strategy !== "broad" && !countryCompatible(canonical.country, candidate.country)) return false
      return true
    })
    .map((candidate) => ({
      ...candidate,
      reason: candidate.domainMatch
        ? "mismo dominio"
        : `nombre ${Math.round(candidate.nameScore * 100)}% (${candidate.sharedTokens.join(", ") || "sin tokens en común"})`,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, MAX_ALIASES - 1)

  return [
    { ...canonical, score: 1, nameScore: 1, sharedTokens: canonicalTokens, domainMatch: false, reason: "entidad pedida" },
    ...selected,
  ]
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

type SignalRow = {
  id: string
  company_id: string
  signal_type: string
  signal_id: string | null
  keyword_matched: string | null
  source_field: string | null
  snippet: string | null
  source_url: string | null
  job_posting_id: string | null
  job_posted_at: string | null
  created_at: string
  company_name?: string
  dictionary_name?: string | null
  contact?: { id: string; full_name: string | null; linkedin_url: string | null; email1: string | null; updated_at: string | null } | null
}

/**
 * Agrupa por TÉRMINO DE DICCIONARIO y cuenta ENTIDADES distintas.
 *
 * Antes agrupaba por `keyword_matched` y sumaba una por fila. Las dos cosas
 * inflaban: "Microsoft Intune" e "Intune" son la misma entrada de diccionario y
 * se contaban por separado, y una persona con dos filas en `contacts` (el mismo
 * perfil scrapeado con la vanity URL y con el slug autogenerado) contaba dos
 * veces. `count` es ahora personas + vacantes distintas, que es lo que el
 * vendedor cree que está leyendo.
 *
 * `countOwn` es de la Fase 3 y se conserva: cuántas de esas entidades son de la
 * empresa que se preguntó y no de un homónimo consolidado.
 */
function groupSignals(rows: Array<SignalRow & Record<string, unknown>>, canonicalId: string) {
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

  return groupBySignal(units)
    .map((group) => ({
      type: group.signalType,
      label: group.label,
      count: group.entities,
      // Una entidad es "propia" si alguna de sus menciones viene de la empresa
      // canónica. La entidad es la unidad, así que se cuenta una vez aunque
      // aparezca mencionada en varios homónimos.
      countOwn: group.units.filter((unit) => unit.mentions.some((m) => m.companyId === canonicalId)).length,
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
    .sort((a, b) => b.count - a.count)
}

export type SignalSummaryDetail = "compact" | "evidence" | "full"

export type SignalSummaryOptions = {
  /** Solo para `detail: "evidence"`: acota a un término del panorama. */
  term?: string
  aliasStrategy?: AliasStrategy
}

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
 * vieron por última vez— sin una sola cita textual. Alcanza para descartar.
 *
 * `evidence` es el nivel intermedio que faltaba, y es el que destraba el trabajo
 * por lotes. El circuito para citar evidencia era: save_account (ocupa 1 de 60
 * lugares del plan) → run_account_research (consume cuota) → recién ahí
 * get_account_evidence_detail devuelve algo, porque lee una tabla scopeada por
 * workspace que materializa el research. La alternativa sin research —"full"—
 * pesó ~15.000 tokens en una sola cuenta: por 42 cuentas son 630k, no entra.
 * `evidence` lee la MISMA evidencia cruda global que ya lee esta función, acotada
 * a un término y a dos fragmentos: <600 tokens por cuenta, sin cupo y sin
 * research previo. Es lo que convierte 42 cuentas en ~25k tokens.
 */
export async function getCompanySignalSummary(
  companyId: string,
  detail: SignalSummaryDetail = "compact",
  options: SignalSummaryOptions = {},
) {
  const admin = createAdminClient()
  const strategy: AliasStrategy = options.aliasStrategy ?? "strict"
  const { data: canonical, error: companyError } = await admin.from("companies").select("id,name,normalized_name,website,country,industry").eq("id", companyId).maybeSingle()
  if (companyError) throw new Error(`COMPANY_READ_FAILED:${companyError.message}`)
  if (!canonical) throw new Error("COMPANY_NOT_FOUND")

  const tokens = identityTokens(canonical.name)
  const searchTokens = tokens.length ? tokens.slice(0, 3) : normalize(canonical.name).split(" ").slice(0, 1)
  const filters = searchTokens.map((token) => `name.ilike.%${token.replaceAll(",", "")}%`).join(",")
  const { data: candidates, error: aliasError } = await admin.from("companies").select("id,name,website,country,industry").or(filters).limit(100)
  if (aliasError) throw new Error(`COMPANY_ALIAS_SEARCH_FAILED:${aliasError.message}`)

  const aliases = selectAliases(canonical, candidates ?? [], strategy)
  const companyIds = aliases.map((alias) => alias.id)
  const aliasNames = new Map(aliases.map((alias) => [alias.id, alias.name]))
  // El modo evidence no necesita implementaciones ni vacantes: su contrato es
  // "el fragmento que prueba ESTE término". Traerlas sería pagar el peso que el
  // modo viene a evitar.
  if (detail === "evidence") {
    return evidenceDetail({ canonical, aliases, aliasNames, companyIds, strategy, term: options.term })
  }

  const [signalsResult, implementationsResult, jobsResult] = await Promise.all([
    admin.from("signals").select("id,company_id,signal_type,signal_id,keyword_matched,source_field,snippet,source_url,job_posting_id,job_posted_at,created_at,contacts:contact_id ( id, full_name, linkedin_url, email1, updated_at )").in("company_id", companyIds).order("created_at", { ascending: false }).limit(MAX_SIGNALS),
    admin.from("company_implementations").select("id,company_id,title,provider_name,technology,summary,area,evidence_level,relevance_snippet,source_url,source_name,published_at,created_at").in("company_id", companyIds).order("created_at", { ascending: false }).limit(MAX_IMPLEMENTATIONS),
    admin.from("job_postings").select("id,company_id,title,description,location,posted_at,job_url,created_at").in("company_id", companyIds).order("posted_at", { ascending: false, nullsFirst: false }).limit(MAX_JOBS),
  ])
  if (signalsResult.error) throw new Error(`SIGNALS_READ_FAILED:${signalsResult.error.message}`)
  if (implementationsResult.error) throw new Error(`IMPLEMENTATIONS_READ_FAILED:${implementationsResult.error.message}`)
  if (jobsResult.error) throw new Error(`JOBS_READ_FAILED:${jobsResult.error.message}`)

  // El nombre de diccionario NO se puede traer con un embed: `signal_id` es
  // polimórfico (apunta a dictionary_products o a dictionary_processes según el
  // tipo) y no tiene FK. Sin él habría que agrupar por la keyword literal, que
  // es exactamente lo que duplicaba las señales.
  const dictionaryNames = await resolveDictionaryNames(admin, signalsResult.data ?? [])
  const signals: Array<SignalRow & Record<string, unknown>> = (signalsResult.data ?? []).map((row) => {
    // El embed llega como array o como objeto según cómo infiera el tipo el
    // cliente; se normaliza acá y no en el consumidor.
    const joined = (row as Record<string, unknown>).contacts
    const contact = (Array.isArray(joined) ? joined[0] : joined) as SignalRow["contact"]
    return {
      ...(row as unknown as SignalRow),
      company_name: aliasNames.get(row.company_id),
      dictionary_name: row.signal_id ? (dictionaryNames.get(row.signal_id) ?? null) : null,
      contact: contact ?? null,
    }
  })
  const linkedSignalIds = new Map<string, string[]>()
  for (const signal of signals) if (signal.job_posting_id) linkedSignalIds.set(signal.job_posting_id, [...(linkedSignalIds.get(signal.job_posting_id) ?? []), signal.id])
  const jobs = (jobsResult.data ?? []).map((job) => ({ id: job.id, companyId: job.company_id, companyName: aliasNames.get(job.company_id), title: job.title, location: job.location, postedAt: job.posted_at ?? job.created_at, jobUrl: job.job_url, descriptionSnippet: job.description?.slice(0, 500) ?? null, linkedSignalIds: linkedSignalIds.get(job.id) ?? [], interpretationStatus: linkedSignalIds.has(job.id) ? "classified_signal_available" : "raw_evidence_only" }))
  const grouped = groupSignals(signals, canonical.id)

  const implementations = implementationsResult.data ?? []
  const status = signals.length || implementations.length || jobs.length ? "evidence_available" : "empty"
  const aliasResolution = aliasResolutionBlock(aliases, strategy, canonical.id)

  // `signalsOwn` vs `signalsConsolidated`: sin esta separación no había forma de
  // saber cuánto del número es de la empresa que se preguntó. Se reportaban 24
  // señales de "Consorcio Seguros" cuando 6 eran suyas y 18 de otras 15 entidades.
  // Canónicos, no filas: es el mismo criterio que `count` de cada término.
  const signalCounts = {
    own: grouped.reduce((total, item) => total + item.countOwn, 0),
    consolidated: grouped.reduce((total, item) => total + item.count, 0),
  }

  if (detail === "compact") {
    const strip = (item: (typeof grouped)[number]) => ({ label: item.label, type: item.type, count: item.count, countOwn: item.countOwn, lastSeen: item.lastSeen })
    return {
      detail: "compact" as const,
      company: canonical,
      aliasResolution,
      summary: {
        status,
        technologies: grouped.filter((item) => item.type === "technology").map(strip),
        processes: grouped.filter((item) => item.type === "process").map(strip),
        signalsOwn: signalCounts.own,
        signalsConsolidated: signalCounts.consolidated,
        signalCount: signalCounts.consolidated,
        implementationCount: implementations.length,
        jobPostingCount: jobs.length,
      },
      // Solo identidad y frescura: sin `summary`, sin `relevance_snippet`, sin
      // `evidence_detail`. Esos tres campos son la mayor parte del peso.
      implementations: implementations.map((item) => ({ id: item.id, title: item.title, technology: item.technology, area: item.area, evidenceLevel: item.evidence_level, publishedAt: item.published_at ?? item.created_at })),
      // Las vacantes NO se listan: son 30 filas con 500 caracteres de
      // descripción cada una y no cambian la decisión de descartar la cuenta.
      // Sin activeCount: salía de job_postings.is_active, que está en true en TODAS las filas
      // del catálogo (incluidas vacantes de 2023) porque nadie la apaga. Informaba una vacante
      // abierta que nadie verificó. La fecha es lo único real que tenemos acá.
      jobPostings: { count: jobs.length, latestPostedAt: jobs[0]?.postedAt ?? null },
      interpretationGuidance:
        "Vista COMPACTA: hay conteos y fechas, no citas textuales. Sirve para decidir si la cuenta es relevante. " +
        "Para la cita textual de UN término (fragmento, fecha, link, y si la persona sigue en la empresa) usá detail=\"evidence\" con ese `term`: cuesta <600 tokens y NO necesita research previo. " +
        "Para el panorama entero con evidencia y vacantes, repetí esta tool con detail=\"full\".",
      limits: { aliases: MAX_ALIASES, signals: MAX_SIGNALS, implementations: MAX_IMPLEMENTATIONS, jobPostings: MAX_JOBS },
    }
  }

  return {
    detail: "full" as const,
    company: canonical,
    aliasResolution,
    summary: { status, technologies: grouped.filter((item) => item.type === "technology"), processes: grouped.filter((item) => item.type === "process"), signalsOwn: signalCounts.own, signalsConsolidated: signalCounts.consolidated, signalCount: signalCounts.consolidated, implementationCount: implementations.length, jobPostingCount: jobs.length },
    implementations: implementations.map((item) => ({ ...item, companyName: aliasNames.get(item.company_id) })),
    jobPostings: jobs,
    interpretationGuidance: "Resume solo lo observado. Distingue señales clasificadas, implementaciones y evidencia cruda de vacantes. Una vacante sin linkedSignalIds es indicio, no confirmación de tecnología o proceso implementado.",
    limits: { aliases: MAX_ALIASES, signals: MAX_SIGNALS, implementations: MAX_IMPLEMENTATIONS, jobPostings: MAX_JOBS },
  }
}

function aliasResolutionBlock(aliases: SelectedAlias[], strategy: AliasStrategy, canonicalId: string) {
  const consolidated = aliases.filter((alias) => alias.id !== canonicalId)
  return {
    strategy,
    aliasCount: aliases.length,
    // El warning anterior decía "se consolidaron entidades relacionadas" sin decir
    // CUÁLES. Con los nombres, quien lee puede ver de una que "Consorcio Persa" no
    // es la aseguradora y pedir otra estrategia.
    warning: consolidated.length
      ? `Se consolidaron ${consolidated.length} entidades además de la pedida: ${consolidated.map((alias) => alias.name).join(" · ")}. Cada evidencia conserva companyId y companyName de origen.`
      : null,
    consolidatedEntities: consolidated.map((alias) => ({ companyId: alias.id, name: alias.name, website: alias.website, country: alias.country, confidence: Number(alias.score.toFixed(2)), sharedTokens: alias.sharedTokens, domainMatch: alias.domainMatch, reason: alias.reason })),
    strategyNote:
      strategy === "strict"
        ? "Estrategia STRICT (default): un nombre de un solo token discriminativo no consolida sin dominio en común, y no se cruzan países. Si sospechás que la cuenta está fragmentada en varias entidades, repetí con aliasStrategy=\"balanced\" o \"broad\"."
        : strategy === "balanced"
          ? "Estrategia BALANCED: consolida por parecido de nombre a partir de 0.6, pero sigue exigiendo dominio en común cuando el nombre es de un solo token."
          : "Estrategia BROAD: consolida agresivamente, incluye nombres de un solo token y no exige país compatible. Los números pueden incluir entidades homónimas ajenas: verificá `consolidatedEntities` antes de usarlos con un cliente.",
  }
}

/**
 * `detail: "evidence"` — la cita textual sin research previo y sin ocupar cupo.
 *
 * El flag de empleado actual vs ex-empleado viaja SIEMPRE. En un lote de 42 filas
 * nadie revisa perfil por perfil, y un icebreaker construido sobre alguien que se
 * fue hace dos años es un error caro y difícil de detectar en una planilla.
 */
async function evidenceDetail(params: {
  canonical: { id: string; name: string; website: string | null; country: string | null; industry: string | null }
  aliases: SelectedAlias[]
  aliasNames: Map<string, string>
  companyIds: string[]
  strategy: AliasStrategy
  term?: string
}) {
  const admin = createAdminClient()
  let query = admin
    .from("signals")
    .select(
      `id, company_id, signal_type, signal_id, keyword_matched, snippet, source_field, source_url,
       contact_id, job_posting_id, job_posted_at, created_at, is_current_employee,
       contacts:contact_id ( full_name, current_position_title, headline, linkedin_url )`,
    )
    .in("company_id", params.companyIds)

  // El filtro va en la consulta y no en memoria: si la cuenta tiene 400 señales y
  // las de Power BI no están entre las 100 más nuevas, filtrar después devolvería
  // "no hay evidencia" siendo mentira.
  if (params.term) query = query.ilike("keyword_matched", `%${params.term}%`)

  const { data, error } = await query.order("created_at", { ascending: false }).limit(MAX_SIGNALS)
  if (error) throw new Error(`SIGNALS_READ_FAILED:${error.message}`)

  const rows = data ?? []
  const byTerm = new Map<string, typeof rows>()
  for (const row of rows) {
    const label = String(row.keyword_matched || row.signal_id || "Sin clasificar")
    byTerm.set(label, [...(byTerm.get(label) ?? []), row])
  }

  // Un mismo `term` pedido puede resolver a varias etiquetas distintas del
  // catálogo ("Power" trae "Power BI" y "PowerShell"). Se devuelven las de más
  // señales y se informa cuántas quedaron afuera: quedarse con una sola y no
  // decirlo haría desaparecer evidencia en silencio, que es el error que este
  // modo viene a evitar.
  const terms = [...byTerm.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, EVIDENCE_TERMS_WITHOUT_QUERY)
    .map(([label, termRows]) => ({
      term: label,
      kind: termRows[0].signal_type,
      signalsOwn: termRows.filter((row) => row.company_id === params.canonical.id).length,
      signalsConsolidated: termRows.length,
      // Desglose por ORIGEN sobre TODAS las filas del término, no sobre los dos
      // fragmentos que se muestran. Un icebreaker se decide con estos números:
      // un ex-empleado no prueba uso actual, y una vacante la publica la empresa.
      // Con solo las muestras, una cuenta con 9 señales de empleados actuales y 2
      // fragmentos de ex-empleados se leería como si no tuviera evidencia viva.
      fromCurrentEmployees: termRows.filter((row) => row.is_current_employee === true).length,
      fromFormerEmployees: termRows.filter((row) => row.contact_id && row.is_current_employee !== true).length,
      fromJobPostings: termRows.filter((row) => !row.contact_id).length,
      latestAt: termRows.reduce<string | null>((latest, row) => {
        const occurredAt = row.job_posted_at ?? row.created_at
        return occurredAt && (!latest || occurredAt > latest) ? occurredAt : latest
      }, null),
      evidence: termRows.slice(0, EVIDENCE_SNIPPETS_PER_TERM).map((row) => {
        const joined = (row as unknown as { contacts?: unknown }).contacts
        const contact = (Array.isArray(joined) ? joined[0] : joined) as
          | { full_name: string | null; current_position_title: string | null; headline: string | null; linkedin_url: string | null }
          | null
          | undefined
        return {
          snippet: row.snippet?.slice(0, EVIDENCE_SNIPPET_CHARS) ?? null,
          sourceField: row.source_field,
          sourceUrl: row.source_url,
          occurredAt: row.job_posted_at ?? row.created_at,
          entity: { companyId: row.company_id, companyName: params.aliasNames.get(row.company_id) ?? null, isRequestedEntity: row.company_id === params.canonical.id },
          person: contact
            ? {
                title: contact.current_position_title ?? contact.headline ?? null,
                linkedinUrl: contact.linkedin_url,
                // Default conservador: si el flag no está seteado, no afirmamos que
                // la persona siga en la empresa.
                isCurrentEmployee: row.is_current_employee === true,
                attribution: row.is_current_employee === true ? "Empleado actual" : "Ex-empleado: no prueba uso actual en la cuenta",
              }
            : null,
        }
      }),
    }))

  return {
    detail: "evidence" as const,
    company: { id: params.canonical.id, name: params.canonical.name, country: params.canonical.country, website: params.canonical.website },
    requestedTerm: params.term ?? null,
    matchedLabels: byTerm.size,
    omittedLabels: Math.max(0, byTerm.size - EVIDENCE_TERMS_WITHOUT_QUERY),
    aliasResolution: aliasResolutionBlock(params.aliases, params.strategy, params.canonical.id),
    terms,
    note: terms.length
      ? null
      : params.term
        ? `No hay señales de "${params.term}" en esta entidad. NO significa que el término no exista en ASCI: puede estar en otra entidad homónima (mirá aliasResolution) o la cuenta puede no tenerlo.`
        : "No hay señales cargadas para esta entidad.",
    interpretationGuidance:
      "Evidencia CRUDA global: no requiere research previo ni que la cuenta esté guardada. " +
      "`person.isCurrentEmployee` en false es un EX-empleado y no prueba uso actual: no construyas un icebreaker sobre esa señal sin decirlo. " +
      "`entity.isRequestedEntity` en false significa que la señal es de una entidad homónima consolidada, no de la empresa que preguntaste.",
    limits: { snippetsPerTerm: EVIDENCE_SNIPPETS_PER_TERM, snippetChars: EVIDENCE_SNIPPET_CHARS, signalsScanned: MAX_SIGNALS },
  }
}
