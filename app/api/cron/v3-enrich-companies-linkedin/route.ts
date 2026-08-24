import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { runLinkedInEnrichment } from "@/lib/v3/services/linkedin-company-enrichment"
import { assertCron } from "@/lib/cron-auth"

/**
 * CRON: enrichment incremental de companies via LinkedIn.
 *
 * Atiende el caso que motiva su existencia: el ETL de jobpostings y contactos
 * crea ~720 companies por dia, y las nuevas entran casi vacias. Este cron toma
 * las que traen `linkedin_url` (~49/dia, ~6.8%) y les completa las columnas que
 * v2 consume, mas el logo.
 *
 * Las que llegan solo con el nombre (93%) NO se tocan: requieren el modo
 * `searches` del actor, que no garantiza que devuelva la empresa correcta
 * (homonimos) y necesita un guardrail de matching aparte.
 *
 * Corre cada 10 minutos con lote chico en vez de una corrida grande diaria:
 * asi el gasto queda repartido, un fallo puntual se recupera en 10 minutos y
 * nunca se acerca al limite de duracion de la funcion.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Tope por corrida. Con 6 corridas/hora alcanza de sobra para las ~49 nuevas/dia. */
const LIMIT_POR_CORRIDA = 50
const BATCH_SIZE = 25

/** Presupuesto por debajo de maxDuration, para cerrar el registro antes del corte. */
const BUDGET_MS = 45_000

const LOCK_NAME = "v3-enrich-companies-linkedin"
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
  const limit = Number(url.searchParams.get("limit")) || LIMIT_POR_CORRIDA

  const db = admin()

  // Lock con lease: evita que dos invocaciones solapadas paguen dos veces por
  // las mismas empresas. Es el mismo mecanismo que usa process-queue.
  const holder = `${LOCK_NAME}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: gotLock, error: lockError } = await db.rpc("acquire_cron_lock", {
    p_lock_name: LOCK_NAME,
    p_holder: holder,
    p_ttl_secs: LOCK_TTL_SECS,
  })

  if (lockError) {
    console.error("[v3-enrich] error tomando el lock:", lockError.message)
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
    const result = await runLinkedInEnrichment({
      limit,
      batchSize: BATCH_SIZE,
      budgetMs: BUDGET_MS,
      dryRun,
    })

    // Quedarse sin cuota NO es un fallo, asi que va como "completed" y el motivo
    // queda en details.skipped_for_quota. No se usa un status propio ("skipped")
    // a proposito: cron_executions_status_check solo admite
    // running/completed/failed, y esa tabla es infra compartida con v2. Ampliar
    // su CHECK seria un cambio sobre v2 para nada, porque getCronHealth filtra
    // por una lista fija de 5 crons que no incluye a este.
    if (execution) {
      await db
        .from("cron_executions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          records_processed: result.processed,
          records_failed: result.errors,
          details: {
            ok: result.ok,
            no_hq: result.noHq,
            no_result: result.noResult,
            // [453] URLs que resultaron ser de otra empresa. Se registran para
            // revision y no se les escribio ninguna columna.
            identity_mismatch: result.identityMismatch,
            filled: result.filled,
            renamed: result.renamed,
            skipped_for_quota: result.skippedForQuota,
            stopped_for_budget: result.stoppedForBudget,
            quota: result.quota,
            dry_run: dryRun,
          },
        })
        .eq("id", execution.id)
    }

    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[v3-enrich] error:", message)

    if (execution) {
      await db
        .from("cron_executions")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: message,
        })
        .eq("id", execution.id)
    }

    return NextResponse.json({ success: false, error: message }, { status: 500 })
  } finally {
    await db.rpc("release_cron_lock", { p_lock_name: LOCK_NAME, p_holder: holder })
  }
}
