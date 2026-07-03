import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createResearchBatch, runResearchJob } from "@/lib/v3/services/research-pipeline"
import { buildDigestData, sendAccountDigest } from "@/lib/v3/services/digest"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// ═══════════════════════════════════════════════════════════
// Cron diario que implementa el refresh MENSUAL de cuentas seguidas.
// Cada cuenta tiene un refresh_day (1-28); hoy se procesan las cuentas
// cuyo refresh_day coincide con el día del mes. Esto distribuye la
// carga (y el costo de Opus) a lo largo del mes.
//
// Por cuenta: research pipeline completo (force_refresh) → digest email.
// Procesa de a pocas por corrida para respetar maxDuration.
// ═══════════════════════════════════════════════════════════

const MAX_ACCOUNTS_PER_RUN = 3

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (
    authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
    process.env.NODE_ENV === "production"
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()
  const today = new Date().getDate()
  // Días 29-31: no hay refresh programado (refresh_day va de 1 a 28)
  if (today > 28) {
    return NextResponse.json({ success: true, processed: 0, note: "Sin refresh programado hoy" })
  }

  const cutoff = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()

  // Cuentas que tocan hoy y no fueron refrescadas en los últimos 20 días
  const { data: accounts, error } = await admin
    .schema("v3")
    .from("followed_accounts")
    .select("id, workspace_id, company_id, followed_by, last_refreshed_at")
    .eq("is_active", true)
    .eq("refresh_day", today)
    .or(`last_refreshed_at.is.null,last_refreshed_at.lt.${cutoff}`)
    .limit(MAX_ACCOUNTS_PER_RUN)

  if (error) {
    console.error("[v3-cron] Error listando cuentas:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ success: true, processed: 0 })
  }

  const results: Array<{ accountId: string; status: string }> = []

  for (const account of accounts) {
    try {
      // Nombre de la empresa para el input del pipeline
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

      // Research completo con force_refresh (ignora cache de 30 días)
      const batch = await createResearchBatch({
        workspaceId: account.workspace_id,
        userId: account.followed_by,
        inputs: [company.name],
        forceRefresh: true,
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
        results.push({ accountId: account.id, status: `job-fallido: ${job?.error ?? "?"}` })
        continue
      }

      // Digest con las novedades desde el último refresh
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

      await admin
        .schema("v3")
        .from("followed_accounts")
        .update({
          last_refreshed_at: new Date().toISOString(),
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

  console.log("[v3-cron] Refresh mensual:", JSON.stringify(results))
  return NextResponse.json({ success: true, processed: results.length, results })
}
