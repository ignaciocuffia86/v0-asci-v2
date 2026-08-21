import { createAdminClient } from "@/lib/supabase/admin"
import { loadDictionary, matchTextAgainstDictionary } from "./dictionary"

// ═══════════════════════════════════════════════════════════
// Fit determinístico de señales en cache vs. workspace.
//
// Una señal (radar_finding) es "fit" para el workspace si cumple
// al menos uno:
//  1. Match de diccionario: sus IDs canonizados o su texto matchean
//     productos/procesos del diccionario global (keywords).
//  2. Match de perfil del vendor: matchea tecnologías/procesos
//     objetivo del workspace_value_profile (derivado de los docs
//     de propuesta de valor).
//
// Sin llamadas de IA: gratis, rápido y reproducible. Se usa como
// devolución inicial ANTES de encolar un research y en la sección
// de cuentas investigadas.
// ═══════════════════════════════════════════════════════════

export interface FitSignal {
  id: string
  title: string
  category: string | null
  radarType: string | null
  evidenceLevel: string | null
  sourceDate: string | null
  matchedTerms: string[]
  matchSource: ("dictionary" | "vendor-profile")[]
}

export interface CachedSignalsSummary {
  companyId: string
  totalSignals: number
  fitCount: number
  fitSignals: FitSignal[]
  topMatches: string[]
  lastResearchAt: string | null
  isFresh: boolean
  hasVendorProfile: boolean
}

const FRESH_DAYS = 60

/**
 * Columnas que esta pantalla realmente usa. Antes se traía `select("*")`, que
 * arrastra columnas que nadie mira (supporting_sources, run_id, etc.).
 */
const FINDING_COLUMNS =
  "id, company_id, title, summary, category, radar_type, evidence_level, source_date, " +
  "dictionary_product_ids, dictionary_process_ids, payload"

/** Tope de findings por empresa, el mismo que usaba la versión de a una. */
const MAX_FINDINGS_PER_COMPANY = 100

type FindingRow = {
  id: string
  company_id: string
  title: string
  summary: string | null
  category: string | null
  radar_type: string | null
  evidence_level: string | null
  source_date: string | null
  dictionary_product_ids: string[] | null
  dictionary_process_ids: string[] | null
  payload: unknown
}

function emptySummary(companyId: string, hasVendorProfile: boolean): CachedSignalsSummary {
  return {
    companyId,
    totalSignals: 0,
    fitCount: 0,
    fitSignals: [],
    topMatches: [],
    lastResearchAt: null,
    isFresh: false,
    hasVendorProfile,
  }
}

/**
 * Resume las señales en cache de VARIAS empresas de una sola vez.
 *
 * ── Por qué en lote ──
 * La versión de a una hacía, por empresa, una query de findings y otra de la
 * última corrida, MÁS una consulta al perfil del workspace que es idéntica para
 * todas. Con N empresas eso son 3N idas y vueltas a São Paulo; el listado de
 * cuentas llama hasta 12 veces. Acá son 3, sin importar N.
 *
 * `loadDictionary()` no suma: tiene cache in-process de 5 minutos.
 *
 * El tope por empresa se aplica en memoria y no en SQL a propósito: un `limit`
 * global sobre el `IN` recortaría empresas enteras (las últimas del orden) en
 * vez de recortar findings de cada una.
 */
export async function summarizeCachedSignalsBatch(
  companyIds: string[],
  workspaceId: string,
): Promise<Map<string, CachedSignalsSummary>> {
  const out = new Map<string, CachedSignalsSummary>()
  const ids = [...new Set(companyIds.filter(Boolean))]
  if (ids.length === 0) return out

  const admin = createAdminClient()

  const [findingsRes, dictionary, profileRes, runsRes] = await Promise.all([
    admin
      .from("radar_findings")
      .select(FINDING_COLUMNS)
      .in("company_id", ids)
      .order("detected_at", { ascending: false }),
    loadDictionary(),
    admin
      .schema("v3")
      .from("workspace_value_profiles")
      .select("target_technologies, target_processes")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    admin
      .from("radar_research_runs")
      .select("company_id, created_at")
      .in("company_id", ids)
      .eq("status", "completed")
      .order("created_at", { ascending: false }),
  ])

  if (findingsRes.error) {
    console.error("[v3] Error leyendo radar_findings en lote:", findingsRes.error.message)
  }
  if (runsRes.error) {
    console.error("[v3] Error leyendo radar_research_runs en lote:", runsRes.error.message)
  }

  const profile = profileRes.data
  const targetTerms: string[] = [
    ...(Array.isArray(profile?.target_technologies) ? (profile?.target_technologies as string[]) : []),
    ...(Array.isArray(profile?.target_processes) ? (profile?.target_processes as string[]) : []),
  ].filter((t) => typeof t === "string" && t.trim().length >= 3)
  const targetTermsLower = targetTerms.map((t) => t.toLowerCase().trim())
  const hasVendorProfile = targetTermsLower.length > 0

  // Agrupación por empresa. Las dos listas vienen ordenadas por fecha
  // descendente, así que la primera corrida que se ve de cada empresa es la
  // última, y los findings quedan en el mismo orden que traía la query de a una.
  const findingsByCompany = new Map<string, FindingRow[]>()
  for (const row of (findingsRes.data ?? []) as unknown as FindingRow[]) {
    const list = findingsByCompany.get(row.company_id) ?? []
    if (list.length < MAX_FINDINGS_PER_COMPANY) list.push(row)
    findingsByCompany.set(row.company_id, list)
  }

  const lastRunByCompany = new Map<string, string>()
  for (const row of runsRes.data ?? []) {
    const cid = row.company_id as string
    if (!lastRunByCompany.has(cid)) lastRunByCompany.set(cid, row.created_at as string)
  }

  const productNameById = new Map(dictionary.products.map((p) => [p.id, p.name]))
  const processNameById = new Map(dictionary.processes.map((p) => [p.id, p.name]))

  for (const companyId of ids) {
    const findings = findingsByCompany.get(companyId) ?? []
    if (findings.length === 0) {
      const lastResearchAt = lastRunByCompany.get(companyId) ?? null
      out.set(companyId, {
        ...emptySummary(companyId, hasVendorProfile),
        lastResearchAt,
        isFresh: lastResearchAt
          ? Date.now() - new Date(lastResearchAt).getTime() < FRESH_DAYS * 24 * 60 * 60 * 1000
          : false,
      })
      continue
    }

    const fitSignals: FitSignal[] = []
    const termFrequency = new Map<string, number>()

    for (const f of findings) {
      const matchedTerms = new Set<string>()
      const matchSource = new Set<"dictionary" | "vendor-profile">()

      // 1a. IDs canonizados en el finding (ya resueltos por el radar)
      for (const pid of f.dictionary_product_ids ?? []) {
        const name = productNameById.get(pid)
        if (name) {
          matchedTerms.add(name)
          matchSource.add("dictionary")
        }
      }
      for (const pid of f.dictionary_process_ids ?? []) {
        const name = processNameById.get(pid)
        if (name) {
          matchedTerms.add(name)
          matchSource.add("dictionary")
        }
      }

      // Texto combinado del finding para matching por keywords
      const payload = (f.payload ?? {}) as { technologies?: string[]; processes?: string[] }
      const text = [
        f.title,
        f.summary,
        ...(Array.isArray(payload.technologies) ? payload.technologies : []),
        ...(Array.isArray(payload.processes) ? payload.processes : []),
      ]
        .filter(Boolean)
        .join(" · ")

      // 1b. Matching por keywords del diccionario (por si el finding no fue canonizado)
      if (matchSource.size === 0) {
        for (const m of matchTextAgainstDictionary(text, dictionary)) {
          matchedTerms.add(m.name)
          matchSource.add("dictionary")
        }
      }

      // 2. Matching contra el perfil del vendor (tecnologías/procesos objetivo)
      if (targetTermsLower.length > 0) {
        const textLower = text.toLowerCase()
        for (let i = 0; i < targetTermsLower.length; i++) {
          if (textLower.includes(targetTermsLower[i])) {
            matchedTerms.add(targetTerms[i])
            matchSource.add("vendor-profile")
          }
        }
      }

      if (matchedTerms.size > 0) {
        const terms = [...matchedTerms]
        for (const t of terms) {
          termFrequency.set(t, (termFrequency.get(t) ?? 0) + 1)
        }
        fitSignals.push({
          id: f.id,
          title: f.title,
          category: f.category ?? null,
          radarType: f.radar_type ?? null,
          evidenceLevel: f.evidence_level ?? null,
          sourceDate: f.source_date ?? null,
          matchedTerms: terms,
          matchSource: [...matchSource],
        })
      }
    }

    const topMatches = [...termFrequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([term]) => term)

    const lastResearchAt = lastRunByCompany.get(companyId) ?? null

    out.set(companyId, {
      companyId,
      totalSignals: findings.length,
      fitCount: fitSignals.length,
      fitSignals: fitSignals.slice(0, 20),
      topMatches,
      lastResearchAt,
      isFresh: lastResearchAt
        ? Date.now() - new Date(lastResearchAt).getTime() < FRESH_DAYS * 24 * 60 * 60 * 1000
        : false,
      hasVendorProfile,
    })
  }

  return out
}

/**
 * Resume las señales en cache de UNA empresa. Determinístico, sin IA.
 *
 * Delega en la versión de lote para que haya una sola implementación: cuando
 * esto era código aparte, cualquier ajuste al matching había que hacerlo dos
 * veces o quedaban divergiendo.
 */
export async function summarizeCachedSignals(
  companyId: string,
  workspaceId: string,
): Promise<CachedSignalsSummary> {
  const batch = await summarizeCachedSignalsBatch([companyId], workspaceId)
  return batch.get(companyId) ?? emptySummary(companyId, false)
}
