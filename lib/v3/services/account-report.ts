import "server-only"

import { z } from "zod/v3"
import { createAdminClient } from "@/lib/supabase/admin"
import { structure } from "@/lib/research/engine"
import { renderPrompt } from "@/lib/v3/prompts"
import { getWorkspaceFitProfile } from "./workspace-fit-profile"
import { listAccountJobPostings, type UiJobPosting } from "./job-posting-provider"
import { listPersonnelMovements, type PersonnelMovementsSummary } from "./personnel-movements"
import { getAccountNewsRadar, type AccountNewsRadar } from "./news-readings"
import { NEWS_SCRAPE_COOLDOWN_DAYS, NEWS_SCRAPE_STALE_MS, NEWS_WINDOW_MONTHS } from "./news-scrape-runner"
import { MOVEMENTS_WINDOW_MONTHS } from "./personnel-movements-rules"
import {
  buildInputsFingerprint,
  buildScorecardRows,
  computeAccountStatus,
  type AccountStatusResult,
  type ScorecardRow,
} from "./account-report-rules"

// ═══════════════════════════════════════════════════════════
// Fase 9 · Ensamblado de la radiografía comercial (diseño H)
//
// Junta lo que ya producen las fases anteriores (movimientos de personal,
// vacantes con tags, noticias con lectura por workspace) y le pone encima lo
// que faltaba: semáforo, scorecard operativo, partición señal/resto en
// vacantes, textos generados y método.
//
// Reparto de costos: TODO es determinístico y gratis salvo los tres textos
// (resumen, ángulos, riesgos), que se generan en UNA llamada batch cuando
// cambia la huella de insumos y quedan guardados en v3.account_reports.
// ═══════════════════════════════════════════════════════════

/** Ventana de las vacantes que cuentan como "activas" para el semáforo. */
const ACTIVE_JOBS_WINDOW_DAYS = 30

export interface JobWithSignal {
  posting: UiJobPosting
  /** Términos de la propuesta que aparecen en el aviso. */
  matchedTerms: string[]
  /** Fragmento del aviso donde aparece el primer término (H.4). */
  snippet: string | null
}

export interface AccountReportMethod {
  jobsLastScrapedAt: string | null
  newsLastScrapedAt: string | null
  newsWindowMonths: number
  movementsWindowMonths: number
  jobsRefreshDays: number
  newsRefreshDays: number
}

/**
 * Estado del scrape de noticias, para que la UI pueda avisar en vez de mostrar
 * un vacío que parece un error:
 *  - `pending`: la cuenta se acaba de marcar y el kick está por dispararse (el
 *    `after()` del alta corre DESPUÉS de responder, así que en el primer render
 *    todavía no hay ni fila de intento).
 *  - `running`: hay una búsqueda en vuelo.
 *  - `queued`: seguida pero sin ningún intento registrado, y el alta ya no es
 *    reciente. Son las cuentas anteriores a que el scrape existiera: no hay nada
 *    corriendo AHORA, pero `/api/cron/v3-scrape-news` las levanta en su próxima
 *    corrida. Decirlo evita que un "sin noticias" se lea como "no hay nada".
 *  - `idle`: ya se buscó (con o sin resultados) dentro de la ventana.
 */
export type NewsScrapeStatus = "pending" | "running" | "queued" | "idle"

export interface AccountReport {
  newsScrapeStatus: NewsScrapeStatus
  status: AccountStatusResult
  summaryPoints: string[]
  scorecard: ScorecardRow[]
  movements: PersonnelMovementsSummary
  jobs: { withSignal: JobWithSignal[]; others: UiJobPosting[]; total: number }
  news: AccountNewsRadar
  entryAngles: string[]
  risks: string[]
  method: AccountReportMethod
  hasVendorProfile: boolean
}

const NarrativeSchema = z.object({
  /** 4 puntos factuales; uno declara lo que NO se encontró. */
  summary_points: z.array(z.string().max(220)).min(1).max(4),
  entry_angles: z.array(z.string().max(220)).max(4),
  risks: z.array(z.string().max(220)).max(3),
})

function isWithinDays(iso: string | null, days: number): boolean {
  if (!iso) return false
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return false
  return Date.now() - ms <= days * 24 * 60 * 60 * 1000
}

/**
 * Arma la radiografía completa de una cuenta para un workspace.
 *
 * No dispara scrapes: los kicks de vacantes (fase 4) y noticias (fase 8) tienen
 * su propia regla de frescura. Acá solo se lee y se interpreta.
 */
export async function getAccountReport(
  companyId: string,
  workspaceId: string,
): Promise<AccountReport> {
  const admin = createAdminClient()

  const [profile, jobsResult, movements, news, jobScrape, lastNewsScrape, followRow] = await Promise.all([
    getWorkspaceFitProfile(workspaceId),
    listAccountJobPostings(companyId, 100),
    listPersonnelMovements(companyId, workspaceId),
    getAccountNewsRadar(companyId, workspaceId),
    // Último batch de scraping de vacantes: el filename lleva el prefijo
    // apify://<companyId>/<runId> desde la fase 4.
    admin
      .from("import_batches")
      .select("created_at")
      .like("filename", `apify://${companyId}/%`)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Último intento de scrape de noticias, en CUALQUIER estado: es lo que
    // permite distinguir "todavía buscando" de "ya buscamos y no había nada".
    admin
      .from("company_news_scrapes")
      .select("status, started_at")
      .eq("company_id", companyId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Cuándo se marcó el bookmark. El scrape se dispara AHÍ (no al abrir la
    // cuenta), así que es la única razón legítima para esperar sin fila.
    admin
      .schema("v3")
      .from("followed_accounts")
      .select("created_at")
      .eq("company_id", companyId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const newsScrapeStatus: NewsScrapeStatus = (() => {
    const row = lastNewsScrape.data
    if (row) {
      if (row.status !== "running") return "idle"
      // Un 'running' viejo es un scrape colgado, no uno en vuelo: mismo criterio
      // que usa la elegibilidad del runner.
      const ageMs = Date.now() - new Date(row.started_at).getTime()
      return ageMs < NEWS_SCRAPE_STALE_MS ? "running" : "idle"
    }
    // Sin intento registrado. El kick sale del alta y corre en `after()`, así
    // que justo después de marcar el bookmark todavía puede no haber fila.
    const followedAt = followRow.data?.created_at as string | undefined
    if (!followedAt) return "idle"
    if (Date.now() - new Date(followedAt).getTime() < NEWS_SCRAPE_STALE_MS) return "pending"
    // Alta vieja sin ningún intento: son las cuentas que ya estaban seguidas
    // antes de que el scrape existiera. No hay nada en vuelo, pero el corredor
    // las levanta igual, así que no es "idle" — es turno pendiente.
    return "queued"
  })()

  const targetTerms = [...profile.targetTechnologies, ...profile.targetProcesses]
  const targetTermsLower = targetTerms.map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3)

  // ── Vacantes: las que tocan la propuesta primero, con su fragmento ──
  const withSignal: JobWithSignal[] = []
  const others: UiJobPosting[] = []
  for (const posting of jobsResult.postings) {
    const matched: { term: string; snippet: string | null }[] = []
    for (const tag of posting.tags) {
      const tagLower = tag.name.trim().toLowerCase()
      if (targetTermsLower.some((t) => tagLower.includes(t) || t.includes(tagLower))) {
        matched.push({ term: tag.name, snippet: tag.snippet ?? null })
      }
    }
    if (matched.length > 0) {
      withSignal.push({
        posting,
        matchedTerms: matched.map((m) => m.term),
        snippet: matched.find((m) => m.snippet)?.snippet ?? null,
      })
    } else {
      others.push(posting)
    }
  }

  // ── Semáforo ──
  const jobsWithSignalActive = withSignal.filter((j) =>
    isWithinDays(j.posting.postedAt, ACTIVE_JOBS_WINDOW_DAYS),
  ).length
  const latestContraction = news.items
    .filter((n) => n.direction === "contraccion" && n.publishedAt)
    .map((n) => n.publishedAt as string)
    .sort()
    .at(-1) ?? null

  const status = computeAccountStatus({
    newsWithProposalSignal: news.counts.propuesta,
    newsWithBusinessSignal: news.counts.negocio,
    jobsWithProposalSignal: jobsWithSignalActive,
    personnelMovements: movements.counts.total,
    latestContractionAt: latestContraction,
  })

  const scorecard = buildScorecardRows({
    movementsTotal: movements.counts.total,
    movementsNew: movements.counts.ingresosNuevos,
    movementsInternal: movements.counts.rotacionesInternas,
    decisionMakers: movements.counts.decisores,
    targetProfiles: movements.counts.perfilesObjetivo,
    jobsWithSignal: withSignal.length,
    jobsTotal: jobsResult.total,
    newsProposal: news.counts.propuesta,
    newsBusiness: news.counts.negocio,
    hasVendorProfile: targetTermsLower.length > 0,
  })

  // ── Textos generados (o los guardados si los insumos no cambiaron) ──
  const fingerprint = buildInputsFingerprint({
    profileVersion: profile.version,
    lastJobScrapeAt: jobScrape.data?.created_at ?? null,
    lastNewsScrapeAt: news.lastScrapedAt,
    jobsTotal: jobsResult.total,
    jobsWithSignal: withSignal.length,
    newsTotal: news.items.length,
    movementsTotal: movements.counts.total,
  })

  const narrative = await getOrGenerateNarrative({
    companyId,
    workspaceId,
    fingerprint,
    profileSummary: profile.summary,
    targetTerms,
    scorecard,
    status,
    jobsWithSignal: withSignal,
    news,
    movements,
    available: profile.available,
  })

  return {
    newsScrapeStatus,
    status,
    summaryPoints: narrative.summaryPoints,
    scorecard,
    movements,
    jobs: { withSignal, others, total: jobsResult.total },
    news,
    entryAngles: narrative.entryAngles,
    risks: narrative.risks,
    method: {
      jobsLastScrapedAt: jobScrape.data?.created_at ?? null,
      newsLastScrapedAt: news.lastScrapedAt,
      newsWindowMonths: NEWS_WINDOW_MONTHS,
      movementsWindowMonths: MOVEMENTS_WINDOW_MONTHS,
      jobsRefreshDays: 30,
      newsRefreshDays: NEWS_SCRAPE_COOLDOWN_DAYS,
    },
    hasVendorProfile: targetTermsLower.length > 0,
  }
}

interface NarrativeResult {
  summaryPoints: string[]
  entryAngles: string[]
  risks: string[]
}

/**
 * Devuelve los textos guardados si la huella de insumos coincide; si no, los
 * genera en UNA llamada y los persiste. Es lo que hace que abrir la cuenta no
 * cueste nada mientras no entren datos nuevos (H.5).
 */
async function getOrGenerateNarrative(input: {
  companyId: string
  workspaceId: string
  fingerprint: string
  profileSummary: string | null
  targetTerms: string[]
  scorecard: ScorecardRow[]
  status: AccountStatusResult
  jobsWithSignal: JobWithSignal[]
  news: AccountNewsRadar
  movements: PersonnelMovementsSummary
  available: boolean
}): Promise<NarrativeResult> {
  const admin = createAdminClient()

  const { data: existing } = await admin
    .schema("v3")
    .from("account_reports")
    .select("summary_points, entry_angles, risks, inputs_fingerprint")
    .eq("workspace_id", input.workspaceId)
    .eq("company_id", input.companyId)
    .maybeSingle()

  if (existing && existing.inputs_fingerprint === input.fingerprint) {
    return {
      summaryPoints: existing.summary_points ?? [],
      entryAngles: existing.entry_angles ?? [],
      risks: existing.risks ?? [],
    }
  }

  // Sin propuesta de valor no hay con qué redactar ángulos ni riesgos: se
  // devuelve el scorecard como resumen y se evita gastar en una IA que no
  // tendría contra qué contrastar.
  if (!input.available) {
    return {
      summaryPoints: input.scorecard.map((row) => `${row.source}: ${row.reading}`),
      entryAngles: [],
      risks: [],
    }
  }

  const evidencia = [
    `ESTADO: ${input.status.status} — ${input.status.reason}`,
    "",
    "SCORECARD DE SEÑALES:",
    ...input.scorecard.map((r) => `- ${r.source}: ${r.volume} → ${r.reading}`),
    "",
    "MOVIMIENTOS DE PERSONAL:",
    ...(input.movements.movements.length === 0
      ? ["- (ninguno en la ventana)"]
      : input.movements.movements
          .slice(0, 8)
          .map((m) => `- ${m.title ?? "(sin cargo)"} desde ${m.startedOn} [${m.type}${m.focus ? `, ${m.focus}` : ""}]`)),
    "",
    "AVISOS CON SEÑAL DE LA PROPUESTA:",
    ...(input.jobsWithSignal.length === 0
      ? ["- (ninguno)"]
      : input.jobsWithSignal
          .slice(0, 8)
          .map((j) => `- ${j.posting.title} [${j.matchedTerms.join(", ")}]`)),
    "",
    "NOTICIAS:",
    ...(input.news.items.filter((n) => n.relevanceType !== "ruido").length === 0
      ? ["- (ninguna con relevancia)"]
      : input.news.items
          .filter((n) => n.relevanceType !== "ruido")
          .slice(0, 6)
          .map((n) => `- [${n.relevanceType}] ${n.title}${n.whyItMatters ? ` → ${n.whyItMatters}` : ""}`)),
    "",
    input.news.uncovered.length > 0
      ? `TÉRMINOS DE LA PROPUESTA SIN COBERTURA EN NOTICIAS: ${input.news.uncovered.slice(0, 10).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n")

  const fallback: NarrativeResult = {
    summaryPoints: input.scorecard.map((row) => `${row.source}: ${row.reading}`),
    entryAngles: [],
    risks: [],
  }

  let result: NarrativeResult = fallback
  try {
    const prompt = await renderPrompt("report.narrative", {
      vendorProfile: input.profileSummary ?? "sin perfil definido",
      targetTerms: input.targetTerms.join(", ") || "ninguno",
      evidence: evidencia,
    })

    const parsed = await structure({
      schema: NarrativeSchema,
      systemPrompt: "Sos un analista de inteligencia comercial B2B. Devolvés JSON válido y nada más.",
      userPrompt: prompt,
      temperature: 0.2,
      context: "account-report",
      tracking: { companyId: input.companyId, feature: "research-synthesis" },
    })

    result = {
      summaryPoints: parsed.summary_points.map((s) => s.trim()).filter(Boolean),
      entryAngles: parsed.entry_angles.map((s) => s.trim()).filter(Boolean),
      risks: parsed.risks.map((s) => s.trim()).filter(Boolean),
    }
  } catch (err) {
    // El informe sigue siendo útil sin los textos: el scorecard, las vacantes y
    // las noticias son determinísticos. Se persiste igual con la huella actual
    // para no reintentar en cada visita.
    console.error("[v3] No se pudo generar la narrativa del informe:", err)
  }

  const { error } = await admin
    .schema("v3")
    .from("account_reports")
    .upsert(
      {
        workspace_id: input.workspaceId,
        company_id: input.companyId,
        summary_points: result.summaryPoints,
        entry_angles: result.entryAngles,
        risks: result.risks,
        inputs_fingerprint: input.fingerprint,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,company_id" },
    )
  if (error) {
    console.error("[v3] Error guardando el informe de la cuenta:", error.message)
  }

  return result
}
