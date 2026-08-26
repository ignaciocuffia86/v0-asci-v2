import "server-only"

import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { principalColumns, type McpPrincipal } from "@/lib/v3/mcp-usage"
import { saveAccount } from "@/lib/v3/mcp-account-lifecycle"
import { createResearchBatch, runResearchJob } from "./research-pipeline"

// ═══════════════════════════════════════════════════════════════════════════
// Ejecución de un lote autorizado por UN batchPlanHash.
//
// Lo que este módulo NO hace es tan importante como lo que hace: no construye
// una máquina de estados de research. `v3.research_jobs` ya tiene lease,
// heartbeat, reintentos y estados de recuperación, y el cron v3-research-watchdog
// levanta cada 5 minutos lo que quedó colgado. La reanudación que pedía el diseño
// ya existía; duplicarla habría creado una segunda máquina que se desincroniza
// con la primera.
// ═══════════════════════════════════════════════════════════════════════════

/** Estados de research_jobs que cuentan como "esta cuenta ya está lista". */
const RESEARCH_DONE = new Set(["completed", "preliminary_ready"])
const RESEARCH_FAILED = new Set(["failed_terminal"])

export type BatchJobItemState = {
  companyId: string
  companyName: string | null
  savedByJob: boolean
  research: "pending" | "running" | "done" | "failed" | "not_started"
  enrichment: string
  error: string | null
}

/**
 * Ejecuta un plan cotizado. Idempotente por `batchPlanHash`: reejecutar el mismo
 * plan devuelve el lote que ya existe en vez de volver a ocupar lugares del plan.
 * Sin eso, un reintento del cliente MCP —que es normal ante un timeout— gastaría
 * el cupo dos veces, y el cupo de cuentas no se recupera solo.
 */
export async function createBatchJob(
  principal: McpPrincipal,
  params: { batchPlanHash: string; userConfirmed: boolean },
) {
  if (!params.userConfirmed) {
    throw new Error(
      "USER_CONFIRMATION_REQUIRED:Mostrale al usuario los números de estimate_batch (lugares del plan, unidades de research, créditos y costo) y pedile confirmación antes de ejecutar.",
    )
  }

  const admin = createAdminClient()

  const { data: existing } = await admin
    .schema("v3")
    .from("mcp_batch_jobs")
    .select("id")
    .eq("workspace_id", principal.workspaceId)
    .eq("batch_plan_hash", params.batchPlanHash)
    .maybeSingle()
  if (existing) return { ...(await getBatchJob(principal, existing.id)), idempotent: true }

  const { data: plan, error: planError } = await admin
    .schema("v3")
    .from("mcp_batch_plans")
    .select("id, operation, plan_payload, estimate, status, expires_at")
    .eq("workspace_id", principal.workspaceId)
    .eq("batch_plan_hash", params.batchPlanHash)
    .maybeSingle()

  if (planError) throw new Error(`BATCH_PLAN_READ_FAILED:${planError.message}`)
  if (!plan) {
    throw new Error(
      "BATCH_PLAN_NOT_FOUND:Ese batchPlanHash no existe en este workspace. Volvé a llamar estimate_batch: no cuesta nada y devuelve un hash nuevo.",
    )
  }
  if (new Date(plan.expires_at) < new Date()) {
    throw new Error(
      "BATCH_PLAN_EXPIRED:La cotización venció. Volvé a llamar estimate_batch y mostrale los números otra vez al usuario: los cupos y los créditos pueden haber cambiado desde entonces.",
    )
  }

  const payload = plan.plan_payload as {
    companyIds: string[]
    roles: string[] | null
    contactsPerAccount: number | null
  }
  const companyIds = payload.companyIds ?? []
  if (!companyIds.length) throw new Error("BATCH_PLAN_EMPTY:El plan no tiene cuentas.")

  const wantsEnrichment = plan.operation !== "research"
  const wantsResearch = plan.operation !== "enrichment"

  const cols = principalColumns(principal)
  const { data: job, error: jobError } = await admin
    .schema("v3")
    .from("mcp_batch_jobs")
    .insert({
      workspace_id: principal.workspaceId,
      user_id: principal.userId,
      api_key_id: cols.api_key_id,
      oauth_token_id: cols.oauth_token_id,
      batch_plan_hash: params.batchPlanHash,
      operation: plan.operation,
      enrichment_roles: wantsEnrichment ? payload.roles : null,
      contacts_per_account: wantsEnrichment ? payload.contactsPerAccount : null,
      accounts_total: companyIds.length,
    })
    .select("id")
    .single()
  if (jobError) throw new Error(`BATCH_JOB_CREATE_FAILED:${jobError.message}`)

  // ── Guardar las cuentas ────────────────────────────────────────────────────
  // Ocupa lugares del plan, y está autorizado: `estimate_batch` mostró
  // `slotsNeeded` y el usuario confirmó ESE hash. Se registra cuáles guardó el
  // lote (`saved_by_job`) para poder revertir sin tocar las que ya estaban.
  const { data: companies } = await admin.from("companies").select("id,name").in("id", companyIds)
  const nameById = new Map((companies ?? []).map((row) => [row.id, row.name as string]))

  let savedByJob = 0
  const blocked: Array<{ companyId: string; reason: string }> = []
  for (const companyId of companyIds) {
    try {
      const result = await saveAccount(principal, { companyId, userConfirmed: true })
      if (!result.saved) {
        blocked.push({ companyId, reason: result.blockedReason ?? "No se pudo guardar la cuenta." })
        continue
      }
      if (!result.idempotent) savedByJob += 1
      await admin.schema("v3").from("mcp_batch_job_items").insert({
        batch_job_id: job.id,
        company_id: companyId,
        company_name: nameById.get(companyId) ?? null,
        saved_by_job: !result.idempotent,
        enrichment_status: wantsEnrichment ? "awaiting_research" : "not_requested",
      })
    } catch (error) {
      blocked.push({ companyId, reason: error instanceof Error ? error.message : "Error desconocido" })
    }
  }

  const runnable = companyIds.filter((id) => !blocked.some((item) => item.companyId === id))

  // ── Research ───────────────────────────────────────────────────────────────
  let researchBatchId: string | null = null
  if (wantsResearch && runnable.length) {
    const result = await createResearchBatch({
      workspaceId: principal.workspaceId,
      userId: principal.userId,
      inputs: runnable,
      source: "user",
      quotaMode: "partial",
      unrestricted: principal.unrestricted,
    })
    if ("error" in result) {
      await admin
        .schema("v3")
        .from("mcp_batch_jobs")
        .update({ status: "failed", error: result.error, finished_at: new Date().toISOString() })
        .eq("id", job.id)
      throw new Error(`BATCH_RESEARCH_FAILED:${result.error}`)
    }
    researchBatchId = result.batchId
    for (const researchJob of result.jobs) {
      if (!researchJob.company_id) continue
      await admin
        .schema("v3")
        .from("mcp_batch_job_items")
        .update({ research_job_id: researchJob.id, updated_at: new Date().toISOString() })
        .eq("batch_job_id", job.id)
        .eq("company_id", researchJob.company_id)
    }
    // Se disparan acá y, si la request muere, los levanta el watchdog. Ese es el
    // mecanismo de reanudación: no hace falta uno propio.
    after(async () => {
      for (const researchJob of result.jobs) {
        await runResearchJob(researchJob.id).catch((error) => console.error("[v3][batch] research job", error))
      }
    })
  }

  await admin
    .schema("v3")
    .from("mcp_batch_jobs")
    .update({ research_batch_id: researchBatchId, accounts_saved_by_job: savedByJob })
    .eq("id", job.id)

  await admin
    .schema("v3")
    .from("mcp_batch_plans")
    .update({ status: "consumed", consumed_at: new Date().toISOString() })
    .eq("id", plan.id)

  const state = await getBatchJob(principal, job.id)
  return { ...state, blocked, slotsConsumed: savedByJob }
}

export async function getBatchJob(principal: McpPrincipal, jobId: string) {
  const admin = createAdminClient()

  const { data: job, error } = await admin
    .schema("v3")
    .from("mcp_batch_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("workspace_id", principal.workspaceId)
    .maybeSingle()
  if (error) throw new Error(`BATCH_JOB_READ_FAILED:${error.message}`)
  if (!job) throw new Error("BATCH_JOB_NOT_FOUND:Ese jobId no existe en este workspace.")

  const { data: items } = await admin
    .schema("v3")
    .from("mcp_batch_job_items")
    .select("company_id, company_name, saved_by_job, research_job_id, enrichment_status, enrichment_plan_hash, error")
    .eq("batch_job_id", jobId)

  const researchIds = (items ?? []).map((item) => item.research_job_id).filter(Boolean) as string[]
  const { data: researchJobs } = researchIds.length
    ? await admin.schema("v3").from("research_jobs").select("id, status, progress, error").in("id", researchIds)
    : { data: [] }
  const researchById = new Map((researchJobs ?? []).map((row) => [row.id, row]))

  const rows: BatchJobItemState[] = (items ?? []).map((item) => {
    const research = item.research_job_id ? researchById.get(item.research_job_id) : null
    const status = research?.status as string | undefined
    const researchState: BatchJobItemState["research"] = !item.research_job_id
      ? "not_started"
      : status && RESEARCH_DONE.has(status)
        ? "done"
        : status && RESEARCH_FAILED.has(status)
          ? "failed"
          : status === "running"
            ? "running"
            : "pending"

    // La cuenta pasa a "lista para preparar" recién cuando su research terminó.
    // Antes de eso preparar el enrichment sería tirar la preparación a la basura:
    // vive 30 minutos y el research del lote tarda más que eso.
    const enrichment =
      item.enrichment_status === "awaiting_research" && researchState === "done"
        ? "ready_to_prepare"
        : item.enrichment_status

    return {
      companyId: item.company_id,
      companyName: item.company_name,
      savedByJob: item.saved_by_job,
      research: researchState,
      enrichment,
      error: item.error ?? research?.error ?? null,
    }
  })

  const done = rows.filter((row) => row.research === "done").length
  const failed = rows.filter((row) => row.research === "failed").length
  const pending = rows.length - done - failed
  const readyToPrepare = rows.filter((row) => row.enrichment === "ready_to_prepare")

  const status = pending > 0 ? "running" : failed === 0 ? "completed" : done > 0 ? "partial" : "failed"
  if (status !== "running" && job.status === "running") {
    await admin
      .schema("v3")
      .from("mcp_batch_jobs")
      .update({ status, finished_at: new Date().toISOString() })
      .eq("id", jobId)
  }

  return {
    jobId,
    status,
    operation: job.operation,
    batchPlanHash: job.batch_plan_hash,
    accounts: { total: rows.length, researchDone: done, researchFailed: failed, researchPending: pending },
    slots: { consumedByThisJob: job.accounts_saved_by_job },
    enrichment: job.enrichment_roles
      ? {
          roles: job.enrichment_roles,
          contactsPerAccount: job.contacts_per_account,
          readyToPrepare: readyToPrepare.length,
          note: "Los enrichments NO se preparan por adelantado: una preparación vive 30 minutos y el research del lote tarda más, así que vencerían todas y dejarían créditos de Apollo reservados sin usarse. Se preparan cuando la cuenta está lista.",
        }
      : null,
    rows,
    nextAction: nextActionFor({ status, pending, failed, readyToPrepare: readyToPrepare.length }),
    interpretationGuidance: [
      "El research se reanuda solo: si un job queda colgado, el watchdog lo recupera cada 5 minutos. NO relances el lote por eso — volvé a consultar este jobId.",
      "`research: \"failed\"` es terminal para esa cuenta: ya agotó sus reintentos. Las demás siguen.",
      "El gasto en Apollo NO está autorizado por el batchPlanHash: es Tier 3 e irreversible, y necesita su propia confirmación por cuenta con prepare_contact_enrichment → run_contact_enrichment.",
      "`slots.consumedByThisJob` son los lugares del plan que ocupó ESTE lote. Las cuentas que ya estaban guardadas no volvieron a consumir.",
    ].join("\n"),
  }
}

function nextActionFor(state: { status: string; pending: number; failed: number; readyToPrepare: number }) {
  if (state.status === "running") {
    return `Todavía hay ${state.pending} cuenta(s) en curso. Volvé a consultar este jobId en unos minutos; no hace falta hacer nada.`
  }
  const parts: string[] = []
  if (state.failed) {
    parts.push(`${state.failed} cuenta(s) fallaron de forma terminal: mirá su \`error\` antes de reintentarlas de a una.`)
  }
  if (state.readyToPrepare) {
    parts.push(
      `${state.readyToPrepare} cuenta(s) ya tienen research y están listas para buscar contactos: llamá prepare_contact_enrichment para cada una y confirmá el gasto con el usuario.`,
    )
  }
  if (!parts.length) parts.push("El lote terminó. Si querés la tabla como archivo, usá create_export.")
  return parts.join(" ")
}
