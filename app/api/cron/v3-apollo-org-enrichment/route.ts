import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { assertCron } from "@/lib/cron-auth"
import { runApolloOrgEnrichment, DEFAULT_LIMIT } from "@/lib/apollo/org-enrichment-runner"

/**
 * CRON: enrichment de companies contra Apollo (organizations/bulk_enrich).
 *
 * Drena la cola `v3.apollo_company_enrichment` con `status = 'pending'`. La cola
 * NO se llena sola: sembrar filas es un acto explicito y es lo que autoriza el
 * gasto, porque Apollo cobra 1 credito por cuenta resuelta. Con la cola vacia
 * esta corrida no llama a Apollo y no gasta nada.
 *
 * Corre cada 10 minutos con lote chico, igual que v3-enrich-companies-linkedin:
 * el gasto queda repartido, un fallo puntual se recupera en 10 minutos y la
 * corrida nunca se acerca al limite de duracion de la funcion.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Presupuesto por debajo de maxDuration, para cerrar el registro antes del corte. */
const BUDGET_MS = 45_000

const LOCK_NAME = "v3-apollo-org-enrichment"
const LOCK_TTL_SECS = 300

function admin() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function GET(request: Request) {
  const denied = assertCron(request)
  if (denied) return denied

  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dryRun") === "1"
  const limit = Number(url.searchParams.get("limit")) || DEFAULT_LIMIT

  const db = admin()

  // Lock con lease: dos invocaciones solapadas sobre la misma cola pagarian dos
  // veces por las mismas empresas. Mismo mecanismo que process-queue.
  const holder = `${LOCK_NAME}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: gotLock, error: lockError } = await db.rpc("acquire_cron_lock", {
    p_lock_name: LOCK_NAME,
    p_holder: holder,
    p_ttl_secs: LOCK_TTL_SECS,
  })

  if (lockError) {
    console.error("[apollo-org] error tomando el lock:", lockError.message)
    return NextResponse.json({ success: false, error: lockError.message }, { status: 500 })
  }
  if (!gotLock) {
    return NextResponse.json({ success: true, skipped: "otra corrida en curso" })
  }

  const { data: execution } = await db
    .from("cron_executions")
    .insert({ cron_name: LOCK_NAME, status: "running" })
    .select("id")
    .single()

  try {
    const result = await runApolloOrgEnrichment({ limit, budgetMs: BUDGET_MS, dryRun })

    if (execution) {
      await db
        .from("cron_executions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          records_processed: result.processed,
          records_failed: result.errors,
          details: {
            claimed: result.claimed,
            found: result.found,
            not_found: result.notFound,
            skipped: result.skipped,
            // El numero que factura Apollo: 1 por cuenta resuelta.
            credits: result.credits,
            calls: result.calls,
            filled: result.filled,
            stopped_for_budget: result.stoppedForBudget,
            stopped_for_rate_limit: result.stoppedForRateLimit,
            pending_left: result.pendingLeft,
            dry_run: dryRun,
          },
        })
        .eq("id", execution.id)
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[apollo-org] error:", message)

    if (execution) {
      await db
        .from("cron_executions")
        .update({ status: "failed", completed_at: new Date().toISOString(), error_message: message })
        .eq("id", execution.id)
    }

    return NextResponse.json({ success: false, error: message }, { status: 500 })
  } finally {
    await db.rpc("release_cron_lock", { p_lock_name: LOCK_NAME, p_holder: holder })
  }
}
