import { generateText } from "ai"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadDictionary } from "./dictionary"
import { getRadarFindings } from "./radar"
import { MODELS, type Scorecard } from "./types"

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
  const [profileRes, findings, contactsRes, signalsRes] = await Promise.all([
    admin
      .schema("v3")
      .from("workspace_value_profiles")
      .select("profile_summary, target_technologies, target_processes, target_industries")
      .eq("workspace_id", input.workspaceId)
      .maybeSingle(),
    getRadarFindings(input.companyId, { limit: 100 }),
    admin
      .from("apollo_contacts_cache")
      .select("id, title, seniority", { count: "exact" })
      .eq("company_id", input.companyId)
      .limit(50),
    admin
      .from("signals")
      .select("id, signal_type, created_at")
      .eq("company_id", input.companyId)
      .limit(100),
  ])

  const profile = profileRes.data
  const targetTechs: string[] = Array.isArray(profile?.target_technologies)
    ? (profile?.target_technologies as string[])
    : []
  const targetProcs: string[] = Array.isArray(profile?.target_processes)
    ? (profile?.target_processes as string[])
    : []

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
  const fitScore =
    totalTargets > 0
      ? clamp(((techMatches.length + procMatches.length) / Math.min(totalTargets, 6)) * 100)
      : detectedTechNames.size > 0
        ? 50 // sin perfil definido: fit neutro si hay stack detectado
        : 30

  // ── BUYING SIGNALS: hallazgos ponderados por nivel de evidencia ──
  const explicitCount = findings.filter((f) => f.evidence_level === "explicit").length
  const inferredCount = findings.filter((f) => f.evidence_level === "inferred").length
  const legacySignals = signalsRes.data?.length ?? 0
  const buyingSignalsScore = clamp(explicitCount * 12 + inferredCount * 5 + Math.min(legacySignals, 10) * 2)

  // ── ACCESSIBILITY: contactos alcanzables en cache ──
  const contactCount = contactsRes.data?.length ?? 0
  const seniorCount = (contactsRes.data ?? []).filter((c) =>
    ["c_suite", "vp", "director", "head", "owner", "founder"].includes((c.seniority ?? "").toLowerCase())
  ).length
  const accessibilityScore = clamp(contactCount * 10 + seniorCount * 10)

  // ── TIMING: recencia de hallazgos (90 días) ──
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000
  const recentFindings = findings.filter((f) => {
    const d = f.source_date ? new Date(f.source_date).getTime() : new Date(f.detected_at).getTime()
    return d >= ninetyDaysAgo
  }).length
  const timingScore = clamp(recentFindings * 15)

  const score = clamp(
    fitScore * 0.35 + buyingSignalsScore * 0.35 + accessibilityScore * 0.15 + timingScore * 0.15
  )

  // ── Rationale con IA (barato; falla en silencio a un rationale básico) ──
  let rationale = `Fit ${fitScore}/100 (${techMatches.length + procMatches.length} coincidencias con el perfil), señales ${buyingSignalsScore}/100 (${explicitCount} explícitas, ${inferredCount} inferidas), accesibilidad ${accessibilityScore}/100 (${contactCount} contactos), timing ${timingScore}/100 (${recentFindings} hallazgos recientes).`
  try {
    const topFindings = findings
      .slice(0, 8)
      .map((f) => `- [${f.evidence_level}] ${f.title}: ${f.summary ?? ""}`)
      .join("\n")
    const { text } = await generateText({
      model: MODELS.STRUCTURER,
      prompt: `Redactá en español un rationale de 2-4 oraciones explicando por qué la cuenta "${input.companyName}" tiene un score de ${score}/100 para este vendor.

Perfil del vendor: ${profile?.profile_summary ?? "sin perfil definido"}
Tecnologías objetivo: ${targetTechs.join(", ") || "ninguna"}
Coincidencias detectadas: ${[...techMatches, ...procMatches].join(", ") || "ninguna"}
Sub-scores: fit ${fitScore}, señales de compra ${buyingSignalsScore}, accesibilidad ${accessibilityScore} (${contactCount} contactos), timing ${timingScore}.

Hallazgos principales:
${topFindings || "(sin hallazgos)"}

Sé concreto y accionable, sin relleno. Solo el texto del rationale.`,
      temperature: 0.2,
      maxOutputTokens: 300,
    })
    if (text.trim()) rationale = text.trim()
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
