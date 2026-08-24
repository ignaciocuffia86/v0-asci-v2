import { createAdminClient } from "@/lib/supabase/admin"
import { resolveCompany, resolveOrCreateCompany } from "./company-resolver"
import { runMicroAgents, isRadarCacheFresh } from "./radar"
import { selectMicroAgentsForWorkspace } from "./agent-selection"
import { interpretJobPostings } from "./jobs-interpreter"
import { computeScorecard } from "./scoring"
import { buildInternalAccountSnapshot } from "./internal-account-snapshot"
import { computePreliminaryFit } from "./preliminary-fit"
import { buildFinalAccountBrief } from "./final-account-brief"
import { runMeasuredStage } from "./research-stage-run"
import type { CanonicalCompanyIdentity } from "./job-posting-provider"
import { LIMITS, type ResearchJob } from "./types"

// ═══════════════════════════════════════════════════════════
// Pipeline de research por cuenta (orquestador):
//   1. Resolver empresa (cache global public.companies)
//   2. Cache-first: si el radar está fresco (<30 días) y no hay
//      force_refresh, salta la investigación Opus
//   3. Radar (3 bundles Opus + estructurador)
//   4. Intérprete de vacantes (Capa 2 + Capa 3)
//   5. Scorecard por workspace
// El progreso se persiste en v3.research_jobs para que el chat
// pueda hacer polling y mostrar avance en vivo.
// ═══════════════════════════════════════════════════════════

export interface BlockedResearchInput {
  input: string
  reason: string
}

/**
 * Presupuesto para la etapa de radar dentro de una invocación.
 *
 * El pipeline corre en una función de maxDuration=300 s y el radar es la etapa
 * larga (micro-agentes en serie). Cortar en 180 s deja margen para el scorecard
 * y el brief final; los agentes que no entran quedan pendientes y los retoma la
 * próxima invocación salteando por cache los ya hechos. Morir por timeout es
 * peor: se pierde el trabajo del agente en curso DESPUÉS de haberlo pagado.
 */
const RADAR_BUDGET_MS = 180_000

/**
 * Crea los jobs de un lote (hasta MAX_BATCH_SIZE cuentas).
 * source="user" aplica las cuotas del plan del workspace; source="cron"
 * las omite (el refresh automático no consume cupo del tenant).
 */
export async function createResearchBatch(params: {
  workspaceId: string
  userId: string
  conversationId?: string | null
  inputs: string[]
  forceRefresh?: boolean
  source?: "user" | "cron"
  quotaMode?: "partial" | "all_or_nothing"
}): Promise<
  | { batchId: string; jobs: ResearchJob[]; blocked: BlockedResearchInput[] }
  | { error: string; blocked?: BlockedResearchInput[] }
> {
  const admin = createAdminClient()
  const source = params.source ?? "user"
  let inputs = params.inputs
    .map((i) => i.trim())
    .filter(Boolean)
    .slice(0, LIMITS.MAX_BATCH_SIZE)

  if (inputs.length === 0) return { error: "No se recibieron cuentas para investigar" }

  const blocked: BlockedResearchInput[] = []

  if (source === "user") {
    // ── Cuotas del plan: resolver companyId best-effort por nombre exacto ──
    const { checkResearchQuota } = await import("@/lib/v3/plans")
    const companies = await Promise.all(
      inputs.map(async (input) => {
        const { data } = await admin
          .from("companies")
          .select("id")
          .ilike("name", input)
          .limit(1)
          .maybeSingle()
        return { input, companyId: (data?.id as string) ?? null }
      })
    )

    const quota = await checkResearchQuota({ workspaceId: params.workspaceId, companies })
    for (const item of quota.items) {
      if (!item.allowed && item.reason) blocked.push({ input: item.input, reason: item.reason })
    }
    if (params.quotaMode === "all_or_nothing" && blocked.length > 0) {
      return { error: blocked[0]?.reason ?? "El lote excede la cuota disponible", blocked }
    }
    const allowedInputs = new Set(quota.items.filter((i) => i.allowed).map((i) => i.input))
    inputs = inputs.filter((i) => allowedInputs.has(i))

    if (inputs.length === 0) {
      return {
        error: blocked[0]?.reason ?? "El plan del workspace no permite investigar estas cuentas",
        blocked,
      }
    }
  }

  const batchId = crypto.randomUUID()
  const rows = inputs.map((input) => ({
    workspace_id: params.workspaceId,
    conversation_id: params.conversationId ?? null,
    batch_id: batchId,
    company_input: input,
    force_refresh: params.forceRefresh ?? false,
    requested_by: params.userId,
    source,
  }))

  const { data, error } = await admin
    .schema("v3")
    .from("research_jobs")
    .insert(rows)
    .select("*")

  if (error || !data) {
    console.error("[v3] Error creando batch de research:", error?.message)
    return { error: "No se pudo crear el lote de investigación", blocked }
  }
  return { batchId, jobs: data as ResearchJob[], blocked }
}

async function updateJob(
  jobId: string,
  patch: Partial<{
    status: string
    current_step: string
    progress: number
    company_id: string
    resolved_domain: string | null
    resolved_country: string | null
    error: string | null
    started_at: string
    finished_at: string
    phase: "internal" | "external" | "finalizing"
    heartbeat_at: string
    lease_expires_at: string
    worker_id: string | null
    attempt_count: number
    error_code: string | null
    last_error_at: string
    next_retry_at: string | null
    preliminary_ready_at: string
    external_started_at: string
    original_company_id: string | null
    resolution_matched_by: "company_id" | "domain" | "alias" | "exact_name" | "ranked"
    resolution_confidence: number
    resolution_reason: string
  }>
) {
  const admin = createAdminClient()
  await admin
    .schema("v3")
    .from("research_jobs")
    .update({ heartbeat_at: new Date().toISOString(), ...patch })
    .eq("id", jobId)
}

/**
 * Ejecuta un research job completo. Idempotente sobre jobs 'pending'.
 * Diseñado para correr dentro del request del chat (por cuenta) o desde
 * el cron de refresh mensual.
 */
export async function runResearchJob(jobId: string): Promise<ResearchJob | null> {
  const admin = createAdminClient()

  const { data: job } = await admin
    .schema("v3")
    .from("research_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle()

  if (!job || (job.status !== "pending" && job.status !== "failed")) {
    return (job as ResearchJob) ?? null
  }

  const workerId = crypto.randomUUID()
  const startedAt = new Date()
  await updateJob(jobId, {
    status: "running",
    phase: "internal",
    current_step: "resolving_company",
    progress: 5,
    started_at: startedAt.toISOString(),
    heartbeat_at: startedAt.toISOString(),
    lease_expires_at: new Date(startedAt.getTime() + 15 * 60_000).toISOString(),
    worker_id: workerId,
    attempt_count: (job.attempt_count ?? 0) + 1,
    error: null,
    error_code: null,
    next_retry_at: null,
  })

  try {
    // ── 1. Resolver empresa ──
    let companyId = job.company_id as string | null
    let companyName = job.company_input as string
    let domain: string | null = null
    let country: string | null = null
    let industry: string | null = null

    const resolution = await resolveCompany(job.company_input, job.workspace_id)
    if (resolution.candidates.length > 0) {
      await updateJob(jobId, {
        status: "failed_terminal",
        current_step: "company_ambiguous",
        error_code: "COMPANY_AMBIGUOUS",
        error: `Empresa ambigua: ${resolution.candidates.map((candidate) => candidate.name).join(" / ")}`,
        resolution_reason: resolution.resolutionReason,
        finished_at: new Date().toISOString(),
      })
      return await getResearchJob(jobId)
    }

    const previousCompanyId = companyId
    if (resolution.companyId) {
      companyId = resolution.companyId
      companyName = resolution.name ?? job.company_input
      domain = resolution.domain
      country = resolution.country
      industry = resolution.industry
    } else if (!companyId) {
      // [455] Puede devolver una empresa existente: upsert_company matchea por
      // nucleo del nombre, que es mas laxo que resolveCompany.
      const resuelta = await resolveOrCreateCompany({ name: job.company_input })
      if ("error" in resuelta) throw new Error(resuelta.error)
      companyId = resuelta.companyId
    } else {
      const { data: company } = await admin.from("companies").select("name,website,country,industry").eq("id", companyId).maybeSingle()
      if (company) {
        companyName = company.name
        domain = company.website
        country = company.country
        industry = company.industry
      }
    }

    await updateJob(jobId, {
      company_id: companyId,
      original_company_id: previousCompanyId !== companyId ? previousCompanyId : undefined,
      resolved_domain: domain,
      resolved_country: country,
      resolution_matched_by: resolution.matchedBy,
      resolution_confidence: resolution.confidence,
      resolution_reason: resolution.resolutionReason,
      progress: 10,
    })

    // ── 2. Quick win: snapshot interno + fit preliminar ──
    await updateJob(jobId, { current_step: "analyzing_internal_data", progress: 18 })
    const canonicalCompany: CanonicalCompanyIdentity = {
      id: companyId!,
      name: companyName,
      domain,
      country,
      industry,
    }
    const snapshot = await runMeasuredStage({
      researchJobId: jobId,
      stage: "internal_snapshot",
      execute: () => buildInternalAccountSnapshot({
        workspaceId: job.workspace_id,
        company: canonicalCompany,
        researchJobId: jobId,
      }),
    })
    const preliminary = await runMeasuredStage({
      researchJobId: jobId,
      stage: "preliminary_fit",
      execute: () => computePreliminaryFit({
        workspaceId: job.workspace_id,
        snapshot,
        researchJobId: jobId,
      }),
    })
    const preliminaryReadyAt = new Date().toISOString()
    await updateJob(jobId, {
      status: "preliminary_ready",
      current_step: "preliminary_ready",
      progress: 32,
      preliminary_ready_at: preliminaryReadyAt,
      heartbeat_at: preliminaryReadyAt,
    })

    // ── 3. Continuación automática: research externo cache-first ──
    const externalStartedAt = new Date().toISOString()
    await updateJob(jobId, {
      status: "running",
      phase: "external",
      current_step: "researching_external_signals",
      progress: 35,
      external_started_at: externalStartedAt,
      heartbeat_at: externalStartedAt,
      lease_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    })
    void preliminary
    const fresh = await isRadarCacheFresh(companyId!, LIMITS.CACHE_TTL_DAYS)
    const skipResearch = fresh && !job.force_refresh

    // ── 3. Radar (Opus + búsqueda web real + estructurador) ──
    //
    // Se llama SIEMPRE, incluso con cache fresco. Antes había una puerta gruesa
    // (`if (!skipResearch)`) y eso ocultaba un agujero: `isRadarCacheFresh` da
    // true con UNA sola corrida completada, así que una cuenta que se cortó por
    // timeout en el agente 1 de 6 quedaba marcada como "lista" y los otros 5
    // nunca corrían — el research salía incompleto y nadie se enteraba.
    //
    // Ahora la decisión es por agente dentro de `runMicroAgents`: los que ya
    // completaron dentro del TTL se saltean sin pagar, y los que faltan se
    // terminan. Con todo fresco no se gasta un peso, igual que antes.
    {
      // Selección dinámica de micro-agentes según la propuesta de valor y los
      // tags de los documentos del workspace (foco en lo que le interesa al usuario).
      const { agents } = await selectMicroAgentsForWorkspace(job.workspace_id)
      const total = agents.length || 1
      const summaries = await runMicroAgents(
        { companyId: companyId!, companyName, domain, country, industry, workspaceId: job.workspace_id, researchJobId: jobId },
        agents,
        async (agentKey, index) => {
          await updateJob(jobId, {
            current_step: `radar:${agentKey}`,
            progress: 10 + Math.round(((index + 1) / (total + 2)) * 70),
          })
        },
        {
          forceRefresh: job.force_refresh ?? false,
          // Presupuesto para cerrar el job antes del corte del runtime. Lo que
          // no entra queda pendiente y lo retoma la próxima invocación.
          budgetMs: RADAR_BUDGET_MS,
        }
      )

      const pendientes = summaries.filter((s) => s.skipped === "sin-presupuesto").length
      if (pendientes > 0) {
        // El job no está completo: dejarlo reintentable para que el cron lo
        // retome y termine los agentes que faltan (sin re-pagar los hechos).
        await updateJob(jobId, {
          current_step: `radar-parcial:faltan-${pendientes}`,
          progress: 75,
        })
      }
      if (skipResearch) {
        await updateJob(jobId, { current_step: "cache-hit", progress: 60 })
      }
    }

    // ── 4. Intérprete de vacantes ──
    await updateJob(jobId, { current_step: "vacantes", progress: 80 })
    if (!skipResearch) {
      await interpretJobPostings(companyId!, companyName, { workspaceId: job.workspace_id, researchJobId: jobId })
    }

    // ── 6. Scorecard final por workspace (siempre se recalcula) ──
    await updateJob(jobId, { phase: "finalizing", current_step: "finalizing", progress: 90 })
    await runMeasuredStage({
      researchJobId: jobId,
      stage: "final_scorecard",
      execute: () => computeScorecard({
        workspaceId: job.workspace_id,
        companyId: companyId!,
        companyName,
        researchJobId: jobId,
      }),
    })
    await runMeasuredStage({
      researchJobId: jobId,
      stage: "final_brief",
      execute: () => buildFinalAccountBrief({
        workspaceId: job.workspace_id,
        companyId: companyId!,
        companyName,
        researchJobId: jobId,
      }),
    })

    await updateJob(jobId, {
      status: "completed",
      current_step: "completed",
      progress: 100,
      heartbeat_at: new Date().toISOString(),
      worker_id: null,
      finished_at: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    const retryable = /timeout|rate|fetch|network|temporar|provider/i.test(message)
    const attempt = (job.attempt_count ?? 0) + 1
    const canRetry = retryable && attempt < (job.max_attempts ?? 3)
    console.error(`[v3] Research job ${jobId} falló:`, message)
    await updateJob(jobId, {
      status: canRetry ? "failed_retriable" : "failed_terminal",
      error: message,
      error_code: retryable ? "PROVIDER_TRANSIENT" : "PIPELINE_ERROR",
      last_error_at: new Date().toISOString(),
      next_retry_at: canRetry ? new Date(Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** attempt)).toISOString() : null,
      worker_id: null,
      finished_at: canRetry ? undefined as never : new Date().toISOString(),
    })
  }

  return getResearchJob(jobId)
}

/** Lee un research job. */
export async function getResearchJob(jobId: string): Promise<ResearchJob | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .schema("v3")
    .from("research_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle()
  return (data as ResearchJob) ?? null
}

/** Estado de un lote completo (para polling desde el chat). */
export async function getBatchStatus(
  batchId: string,
  workspaceId: string
): Promise<ResearchJob[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .schema("v3")
    .from("research_jobs")
    .select("*")
    .eq("batch_id", batchId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
  return (data as ResearchJob[]) ?? []
}
