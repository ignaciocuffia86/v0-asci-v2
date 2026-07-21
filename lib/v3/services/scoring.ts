import { generateText } from "ai"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadDictionary } from "./dictionary"
import { getRadarFindings } from "./radar"
import { MODELS, type Scorecard } from "./types"
import { logAiUsage } from "@/lib/v3/usage"
import { renderPrompt } from "@/lib/v3/prompts"
import { getCanonicalContacts } from "./contact-provider"
import { getWorkspaceFitProfile } from "./workspace-fit-profile"

// ═══════════════════════════════════════════════════════════
// Scorecard de cuenta (0-100) por workspace:
//   score = 35% fit + 35% buying signals + 15% accesibilidad + 15% timing
//
// - fit: intersección entre el value profile del workspace (tecnologías y
//   procesos objetivo) y lo detectado en la cuenta (diccionario canonizado).
// - buying_signals: cantidad y calidad de hallazgos de radar + inferencias
//   de vacantes (explicit pesa más que inferred).
// - accessibility: contactos disponibles en cache de Apollo.
// - timing: recencia de los hallazgos (últimos 90 días pesan más).
//
// El cálculo es determinístico; la IA solo redacta el rationale.
// ═══════════════════════════════════════════════════════════

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

// ── Timing ponderado: peso por tipo de evento + decaimiento por antigüedad ──

export interface TimingEvent {
  title: string
  eventType: string
  weight: number
  decay: number
  points: number
  date: string | null
}

const TIMING_RULES: { type: string; weight: number; patterns: RegExp }[] = [
  {
    type: "Expansión / inversión",
    weight: 25,
    patterns:
      /expansi[oó]n|inversi[oó]n|planta|f[aá]brica|apertura|nuevo mercado|adquisici[oó]n|fusi[oó]n|m&a|centro de distribuci[oó]n|licitaci[oó]n|rfp/i,
  },
  {
    type: "Cambio ejecutivo",
    weight: 20,
    patterns: /\bcio\b|\bcto\b|\bcdo\b|\bcfo\b|\bceo\b|nombramiento|nuevo director|nueva director|gerente de|ejecutiv/i,
  },
  {
    type: "Implementación tecnológica",
    weight: 15,
    patterns: /implementaci[oó]n|migraci[oó]n|moderniza|transformaci[oó]n digital|erp|crm|sap|oracle|cloud|nube/i,
  },
]

function classifyTimingEvent(title: string, summary: string | null, evidenceLevel: string | null) {
  if (evidenceLevel === "inferred") return { type: "Inferido", weight: 5 }
  const text = `${title} ${summary ?? ""}`
  for (const rule of TIMING_RULES) {
    if (rule.patterns.test(text)) return { type: rule.type, weight: rule.weight }
  }
  return { type: "Noticia general", weight: 8 }
}

function timingDecay(dateMs: number): number {
  const ageDays = (Date.now() - dateMs) / (24 * 60 * 60 * 1000)
  if (ageDays <= 30) return 1.0
  if (ageDays <= 60) return 0.7
  if (ageDays <= 90) return 0.4
  return 0
}

export interface ScoreInput {
  workspaceId: string
  companyId: string
  companyName: string
  researchJobId?: string | null
}

export async function computeScorecard(input: ScoreInput): Promise<Scorecard | null> {
  const admin = createAdminClient()
  const dictionary = await loadDictionary()

  // ── Contexto: value profile del workspace + señales de la cuenta ──
  const [profile, findings, contactsResult, signalsRes] = await Promise.all([
    getWorkspaceFitProfile(input.workspaceId),
    getRadarFindings(input.companyId, { limit: 100 }),
    getCanonicalContacts({ companyId: input.companyId, limit: 50 }),
    admin
      .from("signals")
      .select("id, signal_type, created_at")
      .eq("company_id", input.companyId)
      .limit(100),
  ])

  const targetTechs = profile.targetTechnologies
  const targetProcs = profile.targetProcesses

  // ── FIT: intersección diccionario detectado vs. perfil del workspace ──
  const productNameById = new Map(dictionary.products.map((p) => [p.id, p.name.toLowerCase()]))
  const processNameById = new Map(dictionary.processes.map((p) => [p.id, p.name.toLowerCase()]))

  const detectedTechNames = new Set<string>()
  const detectedProcNames = new Set<string>()
  for (const f of findings) {
    for (const pid of f.dictionary_product_ids ?? []) {
      const name = productNameById.get(pid)
      if (name) detectedTechNames.add(name)
    }
    for (const pid of f.dictionary_process_ids ?? []) {
      const name = processNameById.get(pid)
      if (name) detectedProcNames.add(name)
    }
  }

  const targetTechsLower = targetTechs.map((t) => t.toLowerCase())
  const targetProcsLower = targetProcs.map((t) => t.toLowerCase())
  const techMatches = targetTechsLower.filter((t) =>
    [...detectedTechNames].some((d) => d.includes(t) || t.includes(d))
  )
  const procMatches = targetProcsLower.filter((t) =>
    [...detectedProcNames].some((d) => d.includes(t) || t.includes(d))
  )

  const totalTargets = targetTechsLower.length + targetProcsLower.length
  const fitEvaluated = profile.available && totalTargets > 0
  const fitScore = fitEvaluated
    ? clamp(((techMatches.length + procMatches.length) / Math.min(totalTargets, 6)) * 100)
    : null

  // ── BUYING SIGNALS: hallazgos ponderados por nivel de evidencia ──
  const explicitCount = findings.filter((f) => f.evidence_level === "explicit").length
  const inferredCount = findings.filter((f) => f.evidence_level === "inferred").length
  const legacySignals = signalsRes.data?.length ?? 0
  const buyingSignalsScore = clamp(explicitCount * 12 + inferredCount * 5 + Math.min(legacySignals, 10) * 2)

  // ── ACCESSIBILITY: contactos alcanzables en cache ──
  const contactCount = contactsResult.contacts.length
  const seniorCount = contactsResult.contacts.filter((contact) =>
    ["c_suite", "vp", "director", "head", "owner", "founder"].includes((contact.seniority ?? "").toLowerCase())
  ).length
  const accessibilityScore = clamp(contactCount * 10 + seniorCount * 10)

  // ── TIMING: eventos ponderados por tipo con decaimiento por antigüedad ──
  const timingEvents: TimingEvent[] = []
  for (const f of findings) {
    const dateStr = f.source_date ?? f.detected_at
    const dateMs = new Date(dateStr).getTime()
    if (Number.isNaN(dateMs)) continue
    const decay = timingDecay(dateMs)
    if (decay === 0) continue
    const { type, weight } = classifyTimingEvent(f.title, f.summary ?? null, f.evidence_level ?? null)
    timingEvents.push({
      title: f.title,
      eventType: type,
      weight,
      decay,
      points: Math.round(weight * decay * 10) / 10,
      date: f.source_date ?? null,
    })
  }
  timingEvents.sort((a, b) => b.points - a.points)
  const timingScore = clamp(timingEvents.reduce((sum, e) => sum + e.points, 0))
  const recentFindings = timingEvents.length

  const score = fitScore === null
    ? null
    : clamp(fitScore * 0.35 + buyingSignalsScore * 0.35 + accessibilityScore * 0.15 + timingScore * 0.15)

  // ── Rationale con IA solo cuando el fit puede evaluarse ──
  let rationale = fitScore === null
    ? `Fit no evaluado: falta completar la propuesta de valor. Hay ${explicitCount} señales explícitas, ${inferredCount} inferidas y ${contactCount} contactos disponibles.`
    : `Fit ${fitScore}/100 (${techMatches.length + procMatches.length} coincidencias con el perfil), señales ${buyingSignalsScore}/100 (${explicitCount} explícitas, ${inferredCount} inferidas), accesibilidad ${accessibilityScore}/100 (${contactCount} contactos), timing ${timingScore}/100 (${recentFindings} hallazgos recientes).`
  try {
    if (score === null) throw new Error("Fit no evaluado")
    const topFindings = findings
      .slice(0, 8)
      .map((f) => `- [${f.evidence_level}] ${f.title}: ${f.summary ?? ""}`)
      .join("\n")
    const prompt = await renderPrompt("scoring.rationale", {
      companyName: input.companyName,
      score,
      vendorProfile: profile.summary ?? "sin perfil definido",
      targetTechnologies: targetTechs.join(", ") || "ninguna",
      matches: [...techMatches, ...procMatches].join(", ") || "ninguna",
      subScores: `fit ${fitScore}, señales de compra ${buyingSignalsScore}, accesibilidad ${accessibilityScore} (${contactCount} contactos), timing ${timingScore}`,
      topFindings: topFindings || "(sin hallazgos)",
    })
    const { text, usage } = await generateText({
      model: MODELS.STRUCTURER,
      prompt,
      temperature: 0.2,
      maxOutputTokens: 300,
    })
    if (text.trim()) rationale = text.trim()
    await logAiUsage({
      workspaceId: input.workspaceId,
      feature: "scoring",
      model: MODELS.STRUCTURER,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      companyId: input.companyId,
    })
  } catch {
    // rationale determinístico como fallback
  }

  // ── Persistir scorecard (histórico: siempre inserta) ──
  const { data, error } = await admin
    .schema("v3")
    .from("account_scorecards")
    .insert({
      workspace_id: input.workspaceId,
      company_id: input.companyId,
      research_job_id: input.researchJobId ?? null,
      score_stage: "final",
      fit_status: fitEvaluated ? "evaluated" : "fit_not_evaluated",
      profile_version: profile.version,
      score,
      fit_score: fitScore,
      buying_signals_score: buyingSignalsScore,
      accessibility_score: accessibilityScore,
      timing_score: timingScore,
      rationale,
      dictionary_matches: {
        technologies: techMatches,
        processes: procMatches,
        detected_technologies: [...detectedTechNames].slice(0, 20),
      },
      signals_snapshot: {
        explicit: explicitCount,
        inferred: inferredCount,
        legacy_signals: legacySignals,
        contacts: contactCount,
        recent_findings: recentFindings,
        // Desglose auditable por pilar (para los tooltips del scorecard)
        breakdown: {
          fit: {
            target_total: totalTargets,
            matches: [...techMatches, ...procMatches],
            detected_technologies: [...detectedTechNames].slice(0, 12),
            no_profile: totalTargets === 0,
          },
          signals: {
            explicit: explicitCount,
            inferred: inferredCount,
            legacy: legacySignals,
            formula: `${explicitCount} explícitas ×12 + ${inferredCount} inferidas ×5 + ${Math.min(legacySignals, 10)} legacy ×2`,
            top_titles: findings.slice(0, 5).map((f) => f.title),
          },
          accessibility: {
            contacts: contactCount,
            senior: seniorCount,
            formula: `${contactCount} contactos ×10 + ${seniorCount} senior ×10`,
          },
          timing: {
            events: timingEvents.slice(0, 8),
            total_events: timingEvents.length,
          },
        },
      },
    })
    .select("*")
    .single()

  if (error) {
    console.error("[v3] Error guardando scorecard:", error.message)
    return null
  }
  return data as Scorecard
}

/** Último scorecard de una cuenta para el workspace. */
export async function getLatestScorecard(
  workspaceId: string,
  companyId: string
): Promise<Scorecard | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .schema("v3")
    .from("account_scorecards")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as Scorecard) ?? null
}

/** Histórico de scores (para tendencia en la vista de cuenta). */
export async function getScorecardHistory(
  workspaceId: string,
  companyId: string,
  limit = 12
): Promise<Scorecard[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .schema("v3")
    .from("account_scorecards")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit)
  return (data as Scorecard[]) ?? []
}
