import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { assertCron } from "@/lib/cron-auth"
import { runApolloDomainLookup, DEFAULT_LIMIT } from "@/lib/apollo/domain-lookup-runner"

/**
 * CRON: resolucion de dominio por nombre contra Apollo (organizations/search).
 *
 * Drena `v3.apollo_domain_lookup`, la cola sembrada con las ~421.000 companies
 * sin `website` y con nombre buscable. El endpoint es gratuito, asi que a
 * diferencia de v3-apollo-org-enrichment esta cola SI puede estar llena de
 * entrada: sembrarla no compromete plata.
 *
 * Lo que si consume es cuota: 400 llamadas/hora del plan de Apollo sobre ese
 * endpoint. El runner usa 350 y deja 50 libres para trabajo manual, y cuenta lo
 * gastado leyendo `apollo_api_calls`, no un contador propio: asi la reserva
 * sobrevive a que alguien llame por fuera de este cron.
 *
 * Corre cada 10 minutos con lote chico (~58), igual que los otros crons de
 * Apollo: el trabajo queda repartido, un fallo puntual se recupera en 10
 * minutos y la corrida nunca se acerca al limite de duracion de la funcion.
 *
 * A 350/hora el barrido completo son ~50 dias. Es el precio de la cuota, no una
 * lentitud del proceso: por eso existe el checkpoint.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Presupuesto por debajo de maxDuration, para cerrar el registro antes del corte. */
const BUDGET_MS = 45_000

const LOCK_NAME = "v3-apollo-domain-lookup"
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

  // Lock con lease: dos corridas solapadas se comerian entre las dos la reserva
  // horaria y dejarian al trabajo manual sin cuota.
  const holder = `${LOCK_NAME}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: gotLock, error: lockError } = await db.rpc("acquire_cron_lock", {
    p_lock_name: LOCK_NAME,
    p_holder: holder,
    p_ttl_secs: LOCK_TTL_SECS,
  })

  if (lockError) {
    console.error("[apollo-domain] error tomando el lock:", lockError.message)
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
    const result = await runApolloDomainLookup({ limit, budgetMs: BUDGET_MS, dryRun })

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
            hourly_budget_left: result.hourlyBudgetLeft,
            auto_ok: result.autoOk,
            revisar: result.revisar,
            descartado: result.descartado,
            match_sin_dominio: result.matchSinDominio,
            sin_match: result.sinMatch,
            calls: result.calls,
            filled: result.filled,
            stopped_for_budget: result.stoppedForBudget,
            stopped_for_quota: result.stoppedForQuota,
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
    console.error("[apollo-domain] error:", message)

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
