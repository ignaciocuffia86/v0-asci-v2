import { createAdminClient } from "@/lib/supabase/admin"
import { resolveCompany, createCompany } from "./company-resolver"
import { runAllRadarBundles, isRadarCacheFresh, listRadarBundles } from "./radar"
import { interpretJobPostings } from "./jobs-interpreter"
import { computeScorecard } from "./scoring"
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

/** Crea los jobs de un lote (hasta MAX_BATCH_SIZE cuentas). */
export async function createResearchBatch(params: {
  workspaceId: string
  userId: string
  conversationId?: string | null
  inputs: string[]
  forceRefresh?: boolean
}): Promise<{ batchId: string; jobs: ResearchJob[] } | { error: string }> {
  const admin = createAdminClient()
  const inputs = params.inputs
    .map((i) => i.trim())
    .filter(Boolean)
    .slice(0, LIMITS.MAX_BATCH_SIZE)

  if (inputs.length === 0) return { error: "No se recibieron cuentas para investigar" }

  const batchId = crypto.randomUUID()
  const rows = inputs.map((input) => ({
    workspace_id: params.workspaceId,
    conversation_id: params.conversationId ?? null,
    batch_id: batchId,
    company_input: input,
    force_refresh: params.forceRefresh ?? false,
    requested_by: params.userId,
  }))

  const { data, error } = await admin
    .schema("v3")
    .from("research_jobs")
    .insert(rows)
    .select("*")

  if (error || !data) {
    console.error("[v3] Error creando batch de research:", error?.message)
    return { error: "No se pudo crear el lote de investigación" }
  }
  return { batchId, jobs: data as ResearchJob[] }
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
    error: string
    started_at: string
    finished_at: string
  }>
) {
  const admin = createAdminClient()
  await admin.schema("v3").from("research_jobs").update(patch).eq("id", jobId)
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

  await updateJob(jobId, {
    status: "running",
    current_step: "resolviendo-empresa",
    progress: 5,
    started_at: new Date().toISOString(),
    error: undefined as never,
  })

  try {
    // ── 1. Resolver empresa ──
    let companyId = job.company_id as string | null
    let companyName = job.company_input as string
    let domain: string | null = null
    let country: string | null = null
    let industry: string | null = null

    if (!companyId) {
      const resolution = await resolveCompany(job.company_input, job.workspace_id)
      if (resolution.candidates.length > 0) {
        // Ambiguo: el chat debe desambiguar antes de re-encolar
        await updateJob(jobId, {
          status: "failed",
          current_step: "ambiguo",
          error: `Empresa ambigua: ${resolution.candidates.map((c) => c.name).join(" / ")}`,
          finished_at: new Date().toISOString(),
        })
        return await getResearchJob(jobId)
      }
      if (resolution.companyId) {
        companyId = resolution.companyId
        companyName = resolution.name ?? job.company_input
        domain = resolution.domain
        country = resolution.country
        industry = resolution.industry
      } else {
        // Empresa nueva → alta en cache global (aditivo)
        const created = await createCompany({ name: job.company_input })
        if ("error" in created) throw new Error(created.error)
        companyId = created.companyId
      }
      await updateJob(jobId, {
        company_id: companyId,
        resolved_domain: domain,
        resolved_country: country,
        progress: 10,
      })
    } else {
      const { data: company } = await admin
        .from("companies")
        .select("name, website, country, industry")
        .eq("id", companyId)
        .maybeSingle()
      if (company) {
        companyName = company.name
        domain = company.website
        country = company.country
        industry = company.industry
      }
    }

    // ── 2. Cache-first ──
    const fresh = await isRadarCacheFresh(companyId!, LIMITS.CACHE_TTL_DAYS)
    const skipResearch = fresh && !job.force_refresh

    // ── 3. Radar (Opus + estructurador) ──
    if (!skipResearch) {
      const total = listRadarBundles().length
      await runAllRadarBundles(
        { companyId: companyId!, companyName, domain, country, industry },
        async (bundle, index) => {
          await updateJob(jobId, {
            current_step: `radar:${bundle}`,
            progress: 10 + Math.round(((index + 1) / (total + 2)) * 70),
          })
        }
      )
    } else {
      await updateJob(jobId, { current_step: "cache-hit", progress: 60 })
    }

    // ── 4. Intérprete de vacantes ──
    await updateJob(jobId, { current_step: "vacantes", progress: 80 })
    if (!skipResearch) {
      await interpretJobPostings(companyId!, companyName)
    }

    // ── 5. Scorecard por workspace (siempre se recalcula) ──
    await updateJob(jobId, { current_step: "scoring", progress: 90 })
    await computeScorecard({
      workspaceId: job.workspace_id,
      companyId: companyId!,
      companyName,
      researchJobId: jobId,
    })

    await updateJob(jobId, {
      status: "completed",
      current_step: "completado",
      progress: 100,
      finished_at: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error(`[v3] Research job ${jobId} falló:`, message)
    await updateJob(jobId, {
      status: "failed",
      error: message,
      finished_at: new Date().toISOString(),
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
