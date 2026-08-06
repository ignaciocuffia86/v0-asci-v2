import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createResearchBatch, runResearchJob } from "@/lib/v3/services/research-pipeline"
import { buildDigestData, sendAccountDigest } from "@/lib/v3/services/digest"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// ═══════════════════════════════════════════════════════════
// Refresh MENSUAL de cuentas seguidas.
//
// Cada cuenta tiene un refresh_day (1-28) y solo se procesa el día del mes que
// le toca: eso reparte la carga (y el costo de Opus) a lo largo del mes.
//
// ── Por qué este archivo cambió (bugs medidos, no hipotéticos) ──
// La versión anterior volvió a investigar la MISMA empresa + MISMO bundle hasta
// 19 veces: 51 de 107 corridas pagas de Opus fueron desperdicio (48%). Eran tres
// fallas encadenadas:
//
//   1. `last_refreshed_at` se escribía SOLO si el job terminaba `completed`. La
//      cuenta que fallaba quedaba en NULL y volvía a entrar en la selección.
//      Y falla seguido: 6 micro-agentes Opus en serie no entran en maxDuration,
//      así que la función se muere por timeout — momento en el que ya NO puede
//      escribir nada. De ahí que el intento se marque ANTES de investigar: es el
//      único registro que sobrevive a que nos mate el runtime.
//   2. `forceRefresh: true` fijo anulaba el cache de 30 días en cada corrida.
//      Ahora el cron NO fuerza: si el radar está fresco, no se paga de nuevo.
//      Forzar quedó como acción explícita de super-admin (`?force=1`).
//   3. Sin lock, y con schedule en 3 horarios (6/7/8 h), se disparaba en pares
//      separados por 6-57 segundos sobre la misma cuenta.
//
// Ahora: UNA cuenta por invocación (nunca se acerca al timeout) + lock + el
// intento marcado por adelantado. Los micro-agentes ya completados dentro del
// TTL se saltean en `runMicroAgents`, así que reintentar no re-paga lo ya hecho.
// ═══════════════════════════════════════════════════════════

/**
 * Una sola cuenta por invocación. Antes eran 3, y con ~6 micro-agentes Opus en
 * serie por cuenta el timeout de 300 s era inevitable: la función moría a mitad
 * dejando el trabajo pago sin registrar.
 */
const MAX_ACCOUNTS_PER_RUN = 1

/** Intentos fallidos consecutivos antes de dejar la cuenta para el mes próximo. */
const MAX_REFRESH_ATTEMPTS = 3

/**
 * Espera mínima antes de volver a tomar una cuenta ya intentada.
 *
 * No es "una vez por día": si una cuenta se corta por timeout a mitad de sus
 * micro-agentes, queremos que la próxima invocación la retome pronto para
 * TERMINARLA. Y retomarla es barato porque los agentes ya completados dentro del
 * TTL se saltean por cache — se pagan solo los que faltan.
 */
const RETRY_GAP_MS = 15 * 60_000

/** Presupuesto por debajo de maxDuration para cerrar el registro antes del corte. */
const BUDGET_MS = 270_000

const LOCK_NAME = "v3-refresh-accounts"
const LOCK_TTL_SECS = 600

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (!isAuthorized && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  // Forzar re-investigación ignorando el cache es una acción de super-admin, no
  // el comportamiento por defecto del cron. Va detrás del CRON_SECRET.
  const forceRefresh = url.searchParams.get("force") === "1"
  const dryRun = url.searchParams.get("dryRun") === "1"

  const admin = createAdminClient()
  const startedAtMs = Date.now()
  const today = new Date().getDate()

  // Días 29-31: no hay refresh programado (refresh_day va de 1 a 28)
  if (today > 28) {
    return NextResponse.json({ success: true, processed: 0, note: "Sin refresh programado hoy" })
  }

  // ── Lock con lease: sin esto se disparaba en pares a 6-57 s de distancia ──
  const holder = `${LOCK_NAME}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: gotLock, error: lockError } = await admin.rpc("acquire_cron_lock", {
    p_lock_name: LOCK_NAME,
    p_holder: holder,
    p_ttl_secs: LOCK_TTL_SECS,
  })
  if (lockError) {
    console.error("[v3-cron] error tomando el lock:", lockError.message)
    return NextResponse.json({ success: false, error: lockError.message }, { status: 500 })
  }
  if (!gotLock) {
    return NextResponse.json({ success: true, skipped: "otra corrida en curso" })
  }

  const { data: execution } = await admin
    .from("cron_executions")
    .insert({ cron_name: LOCK_NAME, status: "running" })
    .select("id")
    .single()

  const results: Array<{ accountId: string; status: string }> = []

  try {
    // Selección: cuentas cuyo día es hoy, que no se intentaron en los últimos
    // RETRY_GAP_MS y que no agotaron los intentos. Antes el filtro era sobre
    // `last_refreshed_at` (solo éxitos), así que la cuenta que fallaba volvía a
    // entrar en los 3 horarios del día pagando Opus completo cada vez.
    const retryCutoff = new Date(Date.now() - RETRY_GAP_MS).toISOString()

    const { data: allAccounts, error } = await admin
      .schema("v3")
      .from("followed_accounts")
      .select("id, workspace_id, company_id, followed_by, last_refreshed_at, refresh_attempts")
      .eq("is_active", true)
      .eq("refresh_day", today)
      .lt("refresh_attempts", MAX_REFRESH_ATTEMPTS)
      .or(`last_refresh_attempt_at.is.null,last_refresh_attempt_at.lt.${retryCutoff}`)
      // Las que nunca se intentaron van primero; después las más viejas.
      .order("last_refresh_attempt_at", { ascending: true, nullsFirst: true })
      .limit(MAX_ACCOUNTS_PER_RUN * 5)

    if (error) {
      console.error("[v3-cron] Error listando cuentas:", error.message)
      throw new Error(error.message)
    }

    // El refresh automático es solo para planes pagos: excluir workspaces trial
    let accounts = allAccounts ?? []
    if (accounts.length > 0) {
      const workspaceIds = [...new Set(accounts.map((a) => a.workspace_id))]
      const { data: workspaces } = await admin
        .schema("v3")
        .from("workspaces")
        .select("id, plan")
        .in("id", workspaceIds)
      const cronEnabled = new Set(
        (workspaces ?? []).filter((w) => w.plan !== "trial").map((w) => w.id)
      )
      accounts = accounts
        .filter((a) => cronEnabled.has(a.workspace_id))
        .slice(0, MAX_ACCOUNTS_PER_RUN)
    }

    if (dryRun) {
      // Cerrar el registro de ejecución: si se saliera con un return pelado,
      // la fila quedaría en "running" para siempre y el monitor la contaría
      // como una corrida colgada.
      if (execution) {
        await admin
          .from("cron_executions")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            records_processed: 0,
            details: { dry_run: true, candidatas: accounts.length },
          })
          .eq("id", execution.id)
      }
      return NextResponse.json({
        success: true,
        dryRun: true,
        forceRefresh,
        candidatas: accounts.length,
        cuentas: accounts.map((a) => ({ id: a.id, intentos: a.refresh_attempts ?? 0 })),
      })
    }

    for (const account of accounts) {
      if (Date.now() - startedAtMs > BUDGET_MS) {
        results.push({ accountId: account.id, status: "sin-presupuesto" })
        break
      }

      // ── Marcar el intento ANTES de investigar ──
      // El modo de falla es que el runtime nos mate por timeout, y en ese
      // momento ya no corre ningún código. Si el intento se marcara al final,
      // una cuenta que timeoutea nunca quedaría registrada y se reintentaría
      // para siempre, que es exactamente el bug que causó las 19 corridas.
      await admin
        .schema("v3")
        .from("followed_accounts")
        .update({
          last_refresh_attempt_at: new Date().toISOString(),
          refresh_attempts: (account.refresh_attempts ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id)

      try {
        const { data: company } = await admin
          .from("companies")
          .select("name")
          .eq("id", account.company_id)
          .maybeSingle()

        if (!company) {
          results.push({ accountId: account.id, status: "empresa-no-encontrada" })
          continue
        }

        const sinceLastRefresh = account.last_refreshed_at

        const batch = await createResearchBatch({
          workspaceId: account.workspace_id,
          userId: account.followed_by,
          inputs: [company.name],
          // Sin forzar: el cache de 30 días protege el gasto. El refresh es
          // mensual, así que en el caso normal el cache ya venció y se
          // investiga igual — pero si algo ya se investigó (por ejemplo un
          // reintento del día anterior), no se vuelve a pagar.
          forceRefresh,
          source: "cron",
        })

        if ("error" in batch) {
          results.push({ accountId: account.id, status: `error: ${batch.error}` })
          continue
        }

        // Fijar company_id directamente para evitar re-resolución ambigua
        await admin
          .schema("v3")
          .from("research_jobs")
          .update({ company_id: account.company_id })
          .eq("id", batch.jobs[0].id)

        const job = await runResearchJob(batch.jobs[0].id)

        if (job?.status !== "completed") {
          // El intento ya quedó marcado arriba, así que esta cuenta no se
          // reintenta hoy. Al mes siguiente arranca de nuevo, y los agentes
          // que sí completaron se saltean por cache.
          results.push({ accountId: account.id, status: `job-fallido: ${job?.error ?? "?"}` })
          continue
        }

        const digestData = await buildDigestData({
          followedAccountId: account.id,
          workspaceId: account.workspace_id,
          companyId: account.company_id,
          since: sinceLastRefresh,
        })

        let digestStatus = "sin-digest"
        if (digestData) {
          const { sent, recipientCount } = await sendAccountDigest(digestData)
          digestStatus = sent ? `digest-enviado(${recipientCount})` : `digest-log(${recipientCount})`
        }

        // Éxito: sella el refresh y resetea el contador de intentos.
        await admin
          .schema("v3")
          .from("followed_accounts")
          .update({
            last_refreshed_at: new Date().toISOString(),
            refresh_attempts: 0,
            updated_at: new Date().toISOString(),
          })
          .eq("id", account.id)

        results.push({ accountId: account.id, status: `ok · ${digestStatus}` })
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error"
        console.error(`[v3-cron] Error refrescando cuenta ${account.id}:`, message)
        results.push({ accountId: account.id, status: `excepcion: ${message}` })
      }
    }

    if (execution) {
      await admin
        .from("cron_executions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          records_processed: results.length,
          details: { results, force_refresh: forceRefresh },
        })
        .eq("id", execution.id)
    }

    console.log("[v3-cron] Refresh mensual:", JSON.stringify(results))
    return NextResponse.json({ success: true, processed: results.length, results })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    if (execution) {
      await admin
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
    await admin.rpc("release_cron_lock", { p_lock_name: LOCK_NAME, p_holder: holder })
  }
}
