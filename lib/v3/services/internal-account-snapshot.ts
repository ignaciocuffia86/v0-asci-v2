import "server-only"

import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadDictionary, matchTextAgainstDictionary } from "./dictionary"
import { getCanonicalContacts, type CanonicalContact } from "./contact-provider"
import { cacheV2JobPostingProvider, type CanonicalCompanyIdentity, type NormalizedJobPosting } from "./job-posting-provider"
import { getWorkspaceFitProfile } from "./workspace-fit-profile"
import { getLegacySignals, LEGACY_SIGNAL_ADAPTER_VERSION, type SignalPerson } from "./legacy-signal-provider"
import { strongestEvidenceLevel, toEvidenceLevel, type EvidenceLevel } from "./evidence-level"

/** Para ordenar el panorama por fuerza de evidencia antes que por volumen. */
const EVIDENCE_RANK: Record<EvidenceLevel, number> = { Confirmado: 3, Probable: 2, Inferido: 1 }

export interface InternalEvidenceSource {
  kind: "contact-signal" | "job-posting"
  /** Etiqueta de la fuente: keyword de la señal o título de la vacante. */
  title: string
  /**
   * Texto exacto que disparó ESTE término, tal como aparece en la fuente.
   * Sin este campo era imposible saber por qué un término estaba en la lista:
   * el título mostraba el keyword propio de la señal, no el término matcheado,
   * y una misma señal que matchea tres términos parecía evidencia sin relación.
   */
  matchedKeyword: string
  /** Contexto acotado alrededor del match, no el snippet completo de la fuente. */
  snippet: string | null
  date: string | null
  url: string | null
  /**
   * Persona de la que se desprende la señal, con su LinkedIn. Obligatorio para
   * poder citar la evidencia: "usan SAP" sin decir de quién sale es
   * incomprobable para el vendedor.
   */
  person: SignalPerson | null
  /** Nivel de esta fuente puntual. El del término es el más fuerte de las suyas. */
  evidenceLevel: EvidenceLevel
}

/**
 * Término del panorama.
 *
 * `sources` es opcional a propósito: el panorama liviano lo omite (solo tags con
 * conteo y nivel) y el drilldown lo incluye. Así el payload base no arrastra
 * snippets de 30 términos, que es lo que inflaba el contexto ×4 al re-serializarse
 * en cada etapa.
 */
export interface InternalEvidenceItem {
  id: string
  type: "technology" | "process"
  termId: string
  term: string
  count: number
  latestAt: string | null
  /** Nivel más fuerte entre las fuentes del término. */
  evidenceLevel: EvidenceLevel
  /** Cuántas de las menciones provienen de ex-empleados (no prueban uso actual). */
  formerEmployeeMentions: number
  sources?: InternalEvidenceSource[]
}

export interface InternalAccountSnapshot {
  version: 1
  id: string
  snapshotVersion: string
  profileVersion: string | null
  company: CanonicalCompanyIdentity
  generatedAt: string
  freshness: { signalsLatestAt: string | null; jobsLatestAt: string | null; contactsLatestAt: string | null }
  coverage: { signals: number; signalsMaterialized: number; technologies: number; processes: number; jobPostings: number; contacts: number }
  technologies: InternalEvidenceItem[]
  processes: InternalEvidenceItem[]
  jobPostings: NormalizedJobPosting[]
  contacts: CanonicalContact[]
  warnings: string[]
}

/**
 * Señales que se traen para hacer matching. Antes eran 200 mientras
 * coverage.signals informaba el total real (p. ej. 1.382), así que los counts de
 * cada término se calculaban sobre una fracción del universo sin avisarlo.
 */
const SIGNAL_MATCHING_LIMIT = 1000

const latest = (values: Array<string | null | undefined>) => values.filter(Boolean).sort().at(-1) ?? null
const text = (value: unknown) => typeof value === "string" ? value : value ? JSON.stringify(value) : ""

export async function buildInternalAccountSnapshot(params: {
  workspaceId: string
  company: CanonicalCompanyIdentity
  researchJobId: string | null
}): Promise<InternalAccountSnapshot> {
  const admin = createAdminClient()
  const generatedAt = new Date().toISOString()
  const profile = await getWorkspaceFitProfile(params.workspaceId)

  const [signalResult, dictionary, jobsResult, contactsResult] = await Promise.all([
    getLegacySignals(params.company.id, SIGNAL_MATCHING_LIMIT),
    loadDictionary(),
    cacheV2JobPostingProvider.fetch(params.company, { freshnessHours: 24, maxItems: 50, correlationId: params.researchJobId ?? `mcp-${params.company.id}` }),
    getCanonicalContacts({ companyId: params.company.id, recommendedTitles: profile.recommendedJobTitles, limit: 8 }),
  ])

  const warnings = [...jobsResult.warnings, ...contactsResult.warnings]
  if (signalResult.warning) warnings.push(signalResult.warning)
  const signals = signalResult.signals
  // Si aun así quedan señales afuera, hay que decirlo: los counts por término
  // son sobre las señales analizadas, no sobre el total de la empresa.
  if (signalResult.total > signals.length) {
    warnings.push(
      `Se analizaron las ${signals.length} señales más recientes de ${signalResult.total} totales. Las menciones por tecnología o proceso corresponden a esa muestra, no al total histórico.`
    )
  }
  const evidence = new Map<string, InternalEvidenceItem>()

  const add = (match: { id: string; name: string; type: "product" | "process" }, source: InternalEvidenceSource) => {
    const type = match.type === "product" ? "technology" : "process"
    const key = `${type}:${match.id}`
    const existing =
      evidence.get(key) ??
      {
        id: key,
        type,
        termId: match.id,
        term: match.name,
        count: 0,
        latestAt: null,
        evidenceLevel: "Inferido" as EvidenceLevel,
        formerEmployeeMentions: 0,
        sources: [] as InternalEvidenceSource[],
      }
    existing.count += 1
    existing.latestAt = latest([existing.latestAt, source.date])
    // El término hereda el nivel MÁS FUERTE de sus fuentes: una vacante citable
    // no queda degradada por diez inferencias de perfiles.
    existing.evidenceLevel = strongestEvidenceLevel([existing.evidenceLevel, source.evidenceLevel])
    if (source.person && !source.person.isCurrentEmployee) existing.formerEmployeeMentions += 1
    // Se guardan hasta 8 para que el drilldown tenga material; el panorama las
    // recorta antes de enviarlas.
    if ((existing.sources ?? []).length < 8) existing.sources!.push(source)
    evidence.set(key, existing)
  }

  // La evidencia de cada término tiene que ser el fragmento que disparó ESE
  // término (match.keyword / match.snippet), no el keyword ni el snippet de la
  // señal completa: eso es lo que hacía aparecer "Reporting" como fuente de SAP.
  for (const signal of signals) {
    const combined = [signal.keyword, signal.snippet, signal.sourceField].filter(Boolean).join(" · ")
    for (const match of matchTextAgainstDictionary(combined, dictionary)) {
      add(match, {
        kind: "contact-signal",
        title: signal.keyword ?? signal.type,
        matchedKeyword: match.keyword,
        snippet: match.snippet.slice(0, 280),
        date: signal.occurredAt,
        url: signal.sourceUrl,
        person: signal.person,
        // Una señal de perfil describe la experiencia de una persona, no un hecho
        // de la cuenta. Es "Probable" si sigue trabajando ahí, e "Inferido" si es
        // ex-empleado: en ese caso la tecnología puede no estar más en uso.
        evidenceLevel: signal.person
          ? signal.person.isCurrentEmployee
            ? "Probable"
            : "Inferido"
          : "Inferido",
      })
    }
  }

  for (const posting of jobsResult.postings) {
    const combined = `${posting.title}\n${posting.description ?? ""}`
    for (const match of matchTextAgainstDictionary(combined, dictionary)) {
      add(match, {
        kind: "job-posting",
        title: posting.title,
        matchedKeyword: match.keyword,
        snippet: match.snippet.slice(0, 280),
        date: posting.postedAt,
        url: posting.url,
        person: null,
        // La vacante la publica la empresa y es citable, así que Confirmado. Si no
        // tiene URL no se puede citar, y baja a Probable.
        evidenceLevel: posting.url ? "Confirmado" : "Probable",
      })
    }
  }

  // Orden por fuerza de evidencia y después por volumen: 40 menciones inferidas
  // de perfiles no deberían desplazar a una vacante citable de la empresa.
  const ranked = [...evidence.values()].sort(
    (a, b) =>
      EVIDENCE_RANK[b.evidenceLevel] - EVIDENCE_RANK[a.evidenceLevel] ||
      b.count - a.count ||
      (b.latestAt ?? "").localeCompare(a.latestAt ?? "")
  )
  const technologies = ranked.filter((item) => item.type === "technology").slice(0, 15)
  const processes = ranked.filter((item) => item.type === "process").slice(0, 15)

  // ── Panorama liviano vs. detalle ─────────────────────────────
  // El payload que viaja al cliente lleva SOLO tags (término, conteo, nivel), sin
  // snippets ni personas. El detalle se persiste en v3.account_evidence_details y
  // se recupera con get_account_evidence_detail cuando el usuario pide profundizar.
  const toTag = (item: InternalEvidenceItem): InternalEvidenceItem => ({
    id: item.id,
    type: item.type,
    termId: item.termId,
    term: item.term,
    count: item.count,
    latestAt: item.latestAt,
    evidenceLevel: item.evidenceLevel,
    formerEmployeeMentions: item.formerEmployeeMentions,
  })
  const snapshotVersion = createHash("sha256").update(JSON.stringify({
    adapter: LEGACY_SIGNAL_ADAPTER_VERSION,
    companyId: params.company.id,
    signals: signals.map((item) => [item.id, item.occurredAt]),
    jobs: jobsResult.dedupeKeys,
    contacts: contactsResult.contacts.map((item) => item.id),
  })).digest("hex").slice(0, 20)

  const payload = {
    workspace_id: params.workspaceId,
    company_id: params.company.id,
    research_job_id: params.researchJobId,
    snapshot_version: snapshotVersion,
    profile_version: profile.version,
    status: warnings.length ? "partial" : "ready",
    coverage: {
      signals: signalResult.total,
      signalsMaterialized: signals.length,
      technologies: technologies.length,
      processes: processes.length,
      jobPostings: jobsResult.postings.length,
      contacts: contactsResult.contacts.length,
    },
    freshness: { signalsLatestAt: signalResult.latestAt, jobsLatestAt: latest(jobsResult.postings.map((item) => item.postedAt)), contactsLatestAt: latest(contactsResult.contacts.map((item) => item.freshness)) },
    evidence: {
      sourceStatus: { legacySignals: signalResult.status },
      adapterVersion: LEGACY_SIGNAL_ADAPTER_VERSION,
      canonicalCompanyId: params.company.id,
      // El snapshot persistido SÍ guarda las fuentes: es la copia de trabajo del
      // servidor y no viaja al modelo.
      technologies,
      processes,
      jobPostings: jobsResult.postings,
    },
    contacts: contactsResult.contacts,
    warnings,
    generated_at: generatedAt,
  }

  const { data, error } = await admin.schema("v3").from("account_internal_snapshots").upsert(payload, { onConflict: "workspace_id,company_id,snapshot_version,profile_version" }).select("id").single()
  if (error) throw new Error(`No se pudo persistir el snapshot interno: ${error.message}`)

  // Detalle para el drilldown. Se escribe en su propia tabla para que el payload
  // del modelo no tenga que cargar con snippets ni perfiles.
  const detailRows = [...technologies, ...processes].map((item) => ({
    workspace_id: params.workspaceId,
    company_id: params.company.id,
    term_id: item.termId,
    term_kind: item.type === "technology" ? "product" : "process",
    term_name: item.term,
    evidence_level: item.evidenceLevel,
    mention_count: item.count,
    latest_at: item.latestAt,
    sources: item.sources ?? [],
  }))
  if (detailRows.length) {
    // Reemplazo explícito en vez de upsert. Un ON CONFLICT no puede usar un índice
    // único PARCIAL como árbitro sin repetir su predicado, y Supabase solo permite
    // pasar nombres de columnas en onConflict: el upsert fallaba en runtime.
    // Borrar-e-insertar además es la semántica correcta, porque regenerar el
    // snapshot reemplaza el detalle vigente y deja de arrastrar términos que ya no
    // tienen evidencia.
    const { error: cleanupError } = await admin
      .schema("v3")
      .from("account_evidence_details")
      .delete()
      .eq("workspace_id", params.workspaceId)
      .eq("company_id", params.company.id)
      .is("execution_id", null)

    const { error: detailError } = cleanupError
      ? { error: cleanupError }
      : await admin.schema("v3").from("account_evidence_details").insert(detailRows)

    // El detalle es auxiliar: si falla, el panorama sigue siendo válido y solo se
    // pierde la capacidad de profundizar.
    if (detailError) {
      console.error("[v3] No se pudo persistir el detalle de evidencia:", detailError.message)
      warnings.push("El detalle por término no pudo guardarse; el drilldown puede no estar disponible.")
    }
  }

  return {
    version: 1,
    id: data.id,
    snapshotVersion,
    profileVersion: profile.version,
    company: params.company,
    generatedAt,
    freshness: payload.freshness,
    coverage: payload.coverage,
    // Se devuelven como tags: sin fuentes. Quien necesite el detalle usa el
    // drilldown, que lee de account_evidence_details.
    technologies: technologies.map(toTag),
    processes: processes.map(toTag),
    jobPostings: jobsResult.postings,
    contacts: contactsResult.contacts,
    warnings,
  }
}

/**
 * Detalle de evidencia de un término puntual (drilldown).
 *
 * Es el complemento del panorama liviano: devuelve las fuentes con snippet, la
 * persona y su LinkedIn para que el vendedor pueda verificar y citar.
 */
export async function getAccountEvidenceDetail(params: {
  workspaceId: string
  companyId: string
  termIds?: string[]
  termQuery?: string
}): Promise<Array<{
  termId: string
  term: string
  termKind: "product" | "process"
  evidenceLevel: EvidenceLevel
  mentionCount: number
  latestAt: string | null
  sources: InternalEvidenceSource[]
}>> {
  const admin = createAdminClient()
  let query = admin
    .schema("v3")
    .from("account_evidence_details")
    .select("term_id, term_name, term_kind, evidence_level, mention_count, latest_at, sources")
    .eq("workspace_id", params.workspaceId)
    .eq("company_id", params.companyId)

  // Se puede pedir por id exacto o por nombre, porque el modelo suele tener el
  // nombre del tag ("SAP ECC") y no el uuid del término.
  if (params.termIds?.length) query = query.in("term_id", params.termIds)
  else if (params.termQuery) query = query.ilike("term_name", `%${params.termQuery}%`)

  const { data, error } = await query.order("mention_count", { ascending: false }).limit(10)
  if (error) throw new Error(`No se pudo leer el detalle de evidencia: ${error.message}`)

  return (data ?? []).map((row) => ({
    termId: row.term_id,
    term: row.term_name,
    termKind: row.term_kind as "product" | "process",
    evidenceLevel: toEvidenceLevel(row.evidence_level),
    mentionCount: row.mention_count,
    latestAt: row.latest_at,
    sources: (row.sources ?? []) as InternalEvidenceSource[],
  }))
}
