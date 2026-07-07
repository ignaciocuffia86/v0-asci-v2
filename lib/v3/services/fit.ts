import { createAdminClient } from "@/lib/supabase/admin"
import { loadDictionary, matchTextAgainstDictionary } from "./dictionary"
import { getRadarFindings } from "./radar"

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
 * Resume las señales en cache de una empresa y calcula cuáles son fit
 * para el workspace. Determinístico, sin IA.
 */
export async function summarizeCachedSignals(
  companyId: string,
  workspaceId: string
): Promise<CachedSignalsSummary> {
  const admin = createAdminClient()

  const [findings, dictionary, profileRes, lastRunRes] = await Promise.all([
    getRadarFindings(companyId, { limit: 100 }),
    loadDictionary(),
    admin
      .schema("v3")
      .from("workspace_value_profiles")
      .select("target_technologies, target_processes")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    admin
      .from("radar_research_runs")
      .select("created_at")
      .eq("company_id", companyId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const profile = profileRes.data
  const targetTerms: string[] = [
    ...(Array.isArray(profile?.target_technologies) ? (profile?.target_technologies as string[]) : []),
    ...(Array.isArray(profile?.target_processes) ? (profile?.target_processes as string[]) : []),
  ].filter((t) => typeof t === "string" && t.trim().length >= 3)
  const targetTermsLower = targetTerms.map((t) => t.toLowerCase().trim())

  const productNameById = new Map(dictionary.products.map((p) => [p.id, p.name]))
  const processNameById = new Map(dictionary.processes.map((p) => [p.id, p.name]))

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
      const dictMatches = matchTextAgainstDictionary(text, dictionary)
      for (const m of dictMatches) {
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

  const lastResearchAt = lastRunRes.data?.created_at ?? null
  const isFresh = lastResearchAt
    ? Date.now() - new Date(lastResearchAt).getTime() < FRESH_DAYS * 24 * 60 * 60 * 1000
    : false

  return {
    companyId,
    totalSignals: findings.length,
    fitCount: fitSignals.length,
    fitSignals: fitSignals.slice(0, 20),
    topMatches,
    lastResearchAt,
    isFresh,
    hasVendorProfile: targetTermsLower.length > 0,
  }
}
