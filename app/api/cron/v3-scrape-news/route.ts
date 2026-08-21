import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertCron } from "@/lib/cron-auth"
import { scrapeCompanyNews, shouldScrapeNews, NEWS_SCRAPE_COOLDOWN_DAYS } from "@/lib/v3/services/news-scrape-runner"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// ═══════════════════════════════════════════════════════════
// Corredor de búsqueda de noticias de cuentas seguidas.
//
// Es el gemelo de `v3-scrape-job-postings` y existe por la misma razón: la
// membresía es la fila en `v3.followed_accounts`, así que el alta entra sola a
// la selección y una compañía sin follows activos sale sola.
//
// ── Por qué hizo falta (21-ago-2026) ──
// La búsqueda de noticias se disparaba en dos lugares: al marcar el bookmark y
// al ABRIRLO. El segundo hacía de auto-reparación para las cuentas seguidas de
// antes. Al pasar al bundle caro (~US$0,20 por cuenta) ese kick se retiró: con
// el bundle caro, abrir una cuenta vieja no puede disparar gasto. Sin este
// corredor, esas cuentas se quedaban sin noticias para siempre y el refresco
// mensual no existía en ningún lado.
//
// Dos prioridades, las dos resueltas por `shouldScrapeNews`:
//   1. Primera pasada: seguidas sin NINGÚN intento en `company_news_scrapes`.
//   2. Refresh: último intento más viejo que el cooldown de 30 días.
// La marca previa al gasto vive en el runner, así que dos corridas que se
// pisaran no pagarían la misma cuenta dos veces.
// ═══════════════════════════════════════════════════════════

/**
 * Cuentas por invocación. Cada scrape son DOS bundles en paralelo (~1-2 min)
 * más el chequeo de links vivos, así que 2 secuenciales entran en el
 * presupuesto con margen.
 */
const MAX_COMPANIES_PER_RUN = 2
/** Presupuesto por debajo de maxDuration para cerrar la auditoría antes del corte. */
const BUDGET_MS = 240_000

const LOCK_NAME = "v3-scrape-news"
const LOCK_TTL_SECS = 600

export async function GET(request: Request) {
  const denied = assertCron(request)
  if (denied) return denied

  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dryRun") === "1"
  // Acción de super-admin detrás del CRON_SECRET: ignora cooldown.
  const force = url.searchParams.get("force") === "1"

  const admin = createAdminClient()
  const startedAtMs = Date.now()

  // ── Lock con lease: dos invocaciones nunca se solapan ──
  const holder = `${LOCK_NAME}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: gotLock, error: lockError } = await admin.rpc("acquire_cron_lock", {
    p_lock_name: LOCK_NAME,
    p_holder: holder,
    p_ttl_secs: LOCK_TTL_SECS,
  })
  if (lockError) {
    console.error("[v3-scrape-news] error tomando el lock:", lockError.message)
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

  const results: Array<Record<string, unknown>> = []
  let failedCount = 0

  try {
    // ── Selección: compañías seguidas, deduplicadas entre workspaces ──
    // La noticia es un HECHO GLOBAL: si tres workspaces siguen YPF se paga un
    // solo scrape. El workspaceId que viaja es el de algún seguidor, y sirve
    // como atribución del gasto, no como filtro.
    const { data: follows, error: followsError } = await admin
      .schema("v3")
      .from("followed_accounts")
      .select("company_id, workspace_id, followed_by")
      .eq("is_active", true)
    if (followsError) throw new Error(followsError.message)

    const byCompany = new Map<string, { workspaceId: string; userId: string }>()
    for (const f of follows ?? []) {
      if (!byCompany.has(f.company_id)) {
        byCompany.set(f.company_id, { workspaceId: f.workspace_id, userId: f.followed_by })
      }
    }

    const due: Array<{ companyId: string; workspaceId: string; userId: string }> = []
    const skipped = { cooldown: 0, in_flight: 0 }

    for (const [companyId, info] of byCompany) {
      if (force) {
        due.push({ companyId, ...info })
        continue
      }
      const eligibility = await shouldScrapeNews(companyId)
      if (eligibility.due) due.push({ companyId, ...info })
      else if (eligibility.reason) skipped[eligibility.reason]++
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        seguidas: byCompany.size,
        due: due.length,
        skipped,
        cooldownDays: NEWS_SCRAPE_COOLDOWN_DAYS,
        queue: due.slice(0, MAX_COMPANIES_PER_RUN),
      })
    }

    // ── Scrapes secuenciales, respetando el presupuesto ──
    for (const candidate of due.slice(0, MAX_COMPANIES_PER_RUN)) {
      if (Date.now() - startedAtMs > BUDGET_MS) break
      const result = await scrapeCompanyNews(candidate.companyId, {
        force,
        workspaceId: candidate.workspaceId,
        userId: candidate.userId,
      })
      if (result.error) failedCount++
      results.push({
        companyId: candidate.companyId,
        ran: result.ran,
        inserted: result.inserted,
        skipped: result.skipped,
        error: result.error,
      })
    }

    if (execution?.id) {
      await admin
        .from("cron_executions")
        .update({
          status: "completed",
          records_processed: results.length,
          records_failed: failedCount,
          details: { seguidas: byCompany.size, duePending: due.length, skipped, results },
        })
        .eq("id", execution.id)
    }

    return NextResponse.json({ success: true, processed: results.length, failed: failedCount, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    console.error("[v3-scrape-news] error:", message)
    if (execution?.id) {
      await admin
        .from("cron_executions")
        .update({ status: "failed", records_failed: failedCount + 1, details: { error: message, results } })
        .eq("id", execution.id)
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
