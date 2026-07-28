import { generateText } from "ai"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadDictionary } from "./dictionary"
import { getRadarFindings } from "./radar"
import { MODELS, type Scorecard } from "./types"
import { logAiUsage } from "@/lib/v3/usage"
import { renderPrompt } from "@/lib/v3/prompts"
import { getCanonicalContacts } from "./contact-provider"
import { getWorkspaceFitProfile } from "./workspace-fit-profile"
import { toEvidenceLevel, EVIDENCE_WEIGHTS, toSignalDirection, type SignalDirection } from "./evidence-level"

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
  /** Dirección del evento. Un evento de contracción resta en vez de sumar. */
  direction: SignalDirection
}

const TIMING_RULES: { type: string; weight: number; direction: SignalDirection; patterns: RegExp }[] = [
  // ── Contracción: va PRIMERO porque comparte vocabulario con expansión ──
  // "venta de la unidad de negocio" o "cierre de planta" matchean los patrones de
  // expansión ("planta", "unidad"). Al evaluarse antes, la contracción gana el
  // desempate y no se cuenta como una buena noticia.
  {
    type: "Contracción / desinversión",
    weight: 22,
    direction: "contraccion",
    patterns:
      /cierre de (planta|f[aá]brica|operaciones)|cierra su|despido|desvincula|reestructuraci[oó]n|venta de (la )?(unidad|divisi[oó]n|negocio)|desinversi[oó]n|se retira de|salida de(l)? (pa[ií]s|mercado)|abandona el mercado|default|concurso de acreedores|quiebra|suspensi[oó]n de pagos|aumento de (la )?deuda|endeudamiento|p[eé]rdidas|ca[ií]da de (ventas|ingresos)|recorte/i,
  },
  {
    type: "Expansión / inversión",
    weight: 25,
    direction: "expansion",
    patterns:
      /expansi[oó]n|inversi[oó]n|planta|f[aá]brica|apertura|nuevo mercado|adquisici[oó]n|fusi[oó]n|m&a|centro de distribuci[oó]n|licitaci[oó]n|rfp/i,
  },
  {
    type: "Cambio ejecutivo",
    weight: 20,
    direction: "neutro",
    patterns: /\bcio\b|\bcto\b|\bcdo\b|\bcfo\b|\bceo\b|nombramiento|nuevo director|nueva director|gerente de|ejecutiv/i,
  },
  {
    type: "Implementación tecnológica",
    weight: 15,
    direction: "expansion",
    patterns: /implementaci[oó]n|migraci[oó]n|moderniza|transformaci[oó]n digital|erp|crm|sap|oracle|cloud|nube/i,
  },
]

/**
 * Clasifica un evento de timing. `storedDirection` es la dirección ya persistida
 * (company_news.direction); si viene, manda sobre la heurística de texto.
 */
function classifyTimingEvent(
  title: string,
  summary: string | null,
  evidenceLevel: string | null,
  storedDirection?: SignalDirection | null
) {
  const text = `${title} ${summary ?? ""}`
  const matched = TIMING_RULES.find((rule) => rule.patterns.test(text))
  const direction = storedDirection ?? matched?.direction ?? "neutro"

  // La evidencia inferida pesa poco, pero si apunta a contracción igual tiene que
  // restar: no queremos que una señal negativa débil sume timing.
  if (toEvidenceLevel(evidenceLevel) === "Inferido") {
    return { type: matched ? `${matched.type} (inferido)` : "Inferido", weight: 5, direction }
  }
  if (matched) return { type: matched.type, weight: matched.weight, direction }
  return { type: "Noticia general", weight: 8, direction }
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
  const [profile, findings, contactsResult, signalsRes, newsRes] = await Promise.all([
    getWorkspaceFitProfile(input.workspaceId),
    getRadarFindings(input.companyId, { limit: 100 }),
    getCanonicalContacts({ companyId: input.companyId, limit: 50 }),
    admin
      .from("signals")
      .select("id, signal_type, created_at")
      .eq("company_id", input.companyId)
      .limit(100),
    // Noticias con dirección ya clasificada: alimentan timing con signo.
    admin
      .from("company_news")
      .select("title, summary, published_at, direction, evidence_level")
      .eq("company_id", input.companyId)
      .order("published_at", { ascending: false })
      .limit(50),
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
  //
  // Se clasifica con toEvidenceLevel para que convivan los valores binarios
  // históricos ('explicit'/'inferred') y los canónicos nuevos. El nivel
  // intermedio (Probable) se pondera en 8: entre Confirmado (12) e Inferido (5),
  // así una cuenta con evidencia convergente no puntúa como si fuera una
  // corazonada del modelo ni como un hecho verificado.
  const byLevel = { Confirmado: 0, Probable: 0, Inferido: 0 }
  for (const finding of findings) byLevel[toEvidenceLevel(finding.evidence_level)] += 1
  // Alias retro-compatibles: el rationale y el breakdown ya los exponían así.
  const explicitCount = byLevel.Confirmado
  const probableCount = byLevel.Probable
  const inferredCount = byLevel.Inferido
  const legacySignals = signalsRes.data?.length ?? 0
  const buyingSignalsScore = clamp(
    explicitCount * EVIDENCE_WEIGHTS.Confirmado +
      probableCount * EVIDENCE_WEIGHTS.Probable +
      inferredCount * EVIDENCE_WEIGHTS.Inferido +
      Math.min(legacySignals, 10) * 2
  )

  // ── ACCESSIBILITY: contactos alcanzables en cache ──
  const contactCount = contactsResult.contacts.length
  const seniorCount = contactsResult.contacts.filter((contact) =>
    ["c_suite", "vp", "director", "head", "owner", "founder"].includes((contact.seniority ?? "").toLowerCase())
  ).length
  const accessibilityScore = clamp(contactCount * 10 + seniorCount * 10)

  // ── TIMING: eventos ponderados por tipo con decaimiento por antigüedad ──
  const timingEvents: TimingEvent[] = []
  const pushTimingEvent = (args: {
    title: string
    summary: string | null
    evidenceLevel: string | null
    dateStr: string | null
    storedDirection?: SignalDirection | null
  }) => {
    if (!args.dateStr) return
    const dateMs = new Date(args.dateStr).getTime()
    if (Number.isNaN(dateMs)) return
    const decay = timingDecay(dateMs)
    if (decay === 0) return
    const { type, weight, direction } = classifyTimingEvent(
      args.title,
      args.summary,
      args.evidenceLevel,
      args.storedDirection
    )
    // El signo es lo que hace que una cuenta en crisis no puntúe como una en
    // crecimiento. Antes TIMING_RULES solo sumaba y ambas quedaban igual.
    const sign = direction === "contraccion" ? -1 : 1
    timingEvents.push({
      title: args.title,
      eventType: type,
      weight,
      decay,
      points: Math.round(weight * decay * sign * 10) / 10,
      date: args.dateStr,
      direction,
    })
  }

  for (const f of findings) {
    pushTimingEvent({
      title: f.title,
      summary: f.summary ?? null,
      evidenceLevel: f.evidence_level ?? null,
      dateStr: f.source_date ?? f.detected_at,
    })
  }
  // Las noticias ya traen dirección clasificada y persistida, así que alimentan
  // timing sin volver a inferirla desde el texto.
  for (const news of newsRes.data ?? []) {
    pushTimingEvent({
      title: news.title,
      summary: news.summary ?? null,
      evidenceLevel: news.evidence_level ?? null,
      dateStr: news.published_at,
      storedDirection: news.direction ? toSignalDirection(news.direction) : null,
    })
  }

  timingEvents.sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
  // clamp acota a 0-100: una cuenta con contracción neta cae a 0, no a negativo.
  const timingRaw = timingEvents.reduce((sum, e) => sum + e.points, 0)
  const timingScore = clamp(timingRaw)
  const recentFindings = timingEvents.length
  const contractionEvents = timingEvents.filter((e) => e.direction === "contraccion")

  const score = fitScore === null
    ? null
    : clamp(fitScore * 0.35 + buyingSignalsScore * 0.35 + accessibilityScore * 0.15 + timingScore * 0.15)

  // ── Rationale con IA solo cuando el fit puede evaluarse ──
  // Aviso explícito de contracción: sin esto un timing bajo parecía falta de
  // novedades cuando en realidad hay señales negativas.
  const contractionNote = contractionEvents.length
    ? ` Atención: ${contractionEvents.length} señal(es) de contracción detectadas (${contractionEvents.slice(0, 2).map((e) => e.eventType).join(", ")}), que restan al timing.`
    : ""
  let rationale = fitScore === null
    ? `Fit no evaluado: falta completar la propuesta de valor. Hay ${explicitCount} señales confirmadas, ${probableCount} probables, ${inferredCount} inferidas y ${contactCount} contactos disponibles.${contractionNote}`
    : `Fit ${fitScore}/100 (${techMatches.length + procMatches.length} coincidencias con el perfil), señales ${buyingSignalsScore}/100 (${explicitCount} confirmadas, ${probableCount} probables, ${inferredCount} inferidas), accesibilidad ${accessibilityScore}/100 (${contactCount} contactos), timing ${timingScore}/100 (${recentFindings} eventos recientes).${contractionNote}`
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
        probable: probableCount,
        inferred: inferredCount,
        legacy_signals: legacySignals,
        contacts: contactCount,
        recent_findings: recentFindings,
        contraction_events: contractionEvents.length,
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
            probable: probableCount,
            inferred: inferredCount,
            legacy: legacySignals,
            formula: `${explicitCount} confirmadas ×${EVIDENCE_WEIGHTS.Confirmado} + ${probableCount} probables ×${EVIDENCE_WEIGHTS.Probable} + ${inferredCount} inferidas ×${EVIDENCE_WEIGHTS.Inferido} + ${Math.min(legacySignals, 10)} legacy ×2`,
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
            // raw puede ser negativo aunque el score final sea 0: deja ver que la
            // cuenta tiene contracción neta y no simplemente ausencia de señales.
            raw_points: Math.round(timingRaw * 10) / 10,
            expansion_events: timingEvents.filter((e) => e.direction === "expansion").length,
            contraction_events: contractionEvents.length,
            contraction_titles: contractionEvents.slice(0, 5).map((e) => e.title),
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
