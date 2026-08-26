import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { assertCron } from "@/lib/cron-auth"
import { isApifyConfigured } from "@/lib/v3/services/apify-client"
import { checkApifyQuota } from "@/lib/v3/services/linkedin-company-enrichment"
import { APIFY_FILENAME_PREFIX } from "@/lib/v3/services/apify-job-ingest"
import { scrapeCompanyJobPostings } from "@/lib/v3/services/job-scrape-runner"
import { decideScrape, type CompanyScrapeFacts } from "@/lib/v3/services/job-scrape-eligibility"

export const dynamic = "force-dynamic"
export const maxDuration = 300

// ═══════════════════════════════════════════════════════════
// Corredor de scraping de vacantes (Fase 4).
// Diseño: docs/feature-carga-masiva-cuentas-y-cron-jobpostings.md (Parte 3).
//
// UN solo cron scheduler-worker: cada invocación (cada 10 min) lee de la base
// qué compañías le tocan y lanza UN run de Apify POR compañía, secuencial.
// La membresía es la fila en v3.followed_accounts: el alta entra sola a la
// selección y una compañía sin follows activos sale sola — no hay registro de
// inscripción que administrar.
//
// Tres prioridades:
//   1. Primera pasada: seguidas sin NINGÚN batch apify:// (altas nuevas),
//      sin límite de fecha (todas las vacantes abiertas).
//   2. Vencidas (`stale`): último batch con 60+ días, o sea que se saltearon al
//      menos un ciclo mensual entero — el caso típico es una cuenta que se dejó
//      de seguir y se volvió a seguir. Van sin límite de fecha, porque una
//      ventana de 30 días nunca cubriría el hueco. No esperan al refresh_day.
//   3. Refresh mensual: refresh_day == hoy + cooldown de 25 días, ventana 30d.
// La regla anti-re-ejecución (marcar el intento antes de gastar, cooldown,
// tope de reintentos) vive en job-scrape-eligibility/runner, con tests.
// ═══════════════════════════════════════════════════════════

/** Un run tarda 1-3 min con proxy residencial: 2 secuenciales entran holgados
 *  en el presupuesto. 2 × 144 invocaciones/día ≈ 288 slots diarios. */
const MAX_COMPANIES_PER_RUN = 2
/** Presupuesto por debajo de maxDuration para cerrar la auditoría antes del corte. */
const BUDGET_MS = 270_000

const LOCK_NAME = "v3-scrape-job-postings"
const LOCK_TTL_SECS = 600

interface Candidate {
  companyId: string
  userId: string
  reason: "first_pass" | "stale" | "monthly"
}

export async function GET(request: Request) {
  const denied = assertCron(request)
  if (denied) return denied

  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dryRun") === "1"
  // Acción de super-admin detrás del CRON_SECRET: ignora cooldown y reintentos.
  const force = url.searchParams.get("force") === "1"

  const admin = createAdminClient()
  const startedAtMs = Date.now()

  if (!isApifyConfigured()) {
    return NextResponse.json({ success: true, skipped: "APIFY_TOKEN no configurado" })
  }

  // ── Lock con lease: dos invocaciones nunca se solapan ──
  const holder = `${LOCK_NAME}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: gotLock, error: lockError } = await admin.rpc("acquire_cron_lock", {
    p_lock_name: LOCK_NAME,
    p_holder: holder,
    p_ttl_secs: LOCK_TTL_SECS,
  })
  if (lockError) {
    console.error("[v3-scrape] error tomando el lock:", lockError.message)
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
    // ── Selección ──────────────────────────────────────────
    // 1. Follows activos (compañías deduplicadas entre workspaces). El userId
    //    del batch es el de algún seguidor: import_batches.user_id es NOT NULL
    //    con FK a auth.users, y "quién siguió la cuenta" es el dueño natural.
    const { data: follows, error: followsError } = await admin
      .schema("v3")
      .from("followed_accounts")
      .select("company_id, followed_by, refresh_day")
      .eq("is_active", true)
    if (followsError) throw new Error(followsError.message)

    const today = new Date().getUTCDate()
    const byCompany = new Map<string, { userId: string; dueToday: boolean }>()
    for (const f of follows ?? []) {
      const entry = byCompany.get(f.company_id) ?? { userId: f.followed_by, dueToday: false }
      if (f.refresh_day === today) entry.dueToday = true
      byCompany.set(f.company_id, entry)
    }

    // 2. Historia de batches apify:// agrupada por compañía. Se trae completa y
    //    se agrupa acá: el prefijo no es indexable por compañía sin parsear el
    //    filename, y a la escala actual (cientos de batches) es más barato que
    //    N queries. Si crece, se materializa en una columna.
    const { data: batches } = await admin
      .from("import_batches")
      .select("filename, status, created_at")
      .like("filename", `${APIFY_FILENAME_PREFIX}%`)
      .order("created_at", { ascending: true })

    const factsByCompany = new Map<string, CompanyScrapeFacts>()
    for (const b of batches ?? []) {
      const companyId = b.filename.slice(APIFY_FILENAME_PREFIX.length).split("/")[0]
      const facts = factsByCompany.get(companyId) ?? {
        hasAnyBatch: false,
        latestNonFailedAt: null,
        failedSinceLastSuccess: 0,
        dueToday: false,
      }
      facts.hasAnyBatch = true
      if (b.status === "failed") {
        facts.failedSinceLastSuccess++
      } else {
        // Orden ascendente: el último no-fallido queda al final y resetea la
        // cuenta de fallidos posteriores.
        facts.latestNonFailedAt = b.created_at
        facts.failedSinceLastSuccess = 0
      }
      factsByCompany.set(companyId, facts)
    }

    const now = new Date()
    const firstPass: Candidate[] = []
    const stale: Candidate[] = []
    const monthly: Candidate[] = []
    const skipped = { cooldown: 0, attempts: 0, not_due: 0 }

    for (const [companyId, info] of byCompany) {
      const facts: CompanyScrapeFacts = {
        ...(factsByCompany.get(companyId) ?? {
          hasAnyBatch: false,
          latestNonFailedAt: null,
          failedSinceLastSuccess: 0,
          dueToday: false,
        }),
        dueToday: info.dueToday,
      }
      const decision = force
        ? ({ eligible: true, reason: facts.hasAnyBatch ? "monthly" : "first_pass" } as const)
        : decideScrape(facts, now)

      if (decision.eligible) {
        const candidate: Candidate = { companyId, userId: info.userId, reason: decision.reason }
        if (decision.reason === "first_pass") firstPass.push(candidate)
        else if (decision.reason === "stale") stale.push(candidate)
        else monthly.push(candidate)
      } else {
        skipped[decision.skip]++
      }
    }

    // Orden: primero las que no tienen NADA, después las vencidas, y al final el
    // refresco del día. `stale` se autodrena (cada corrida deja marcador y saca a
    // esa compañía del bucket), así que no puede hambrear a `monthly` más que
    // transitoriamente.
    const queue = [...firstPass, ...stale, ...monthly].slice(0, MAX_COMPANIES_PER_RUN)

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        firstPass: firstPass.length,
        stale: stale.length,
        monthly: monthly.length,
        skipped,
        queue,
      })
    }

    // ── Cuota Apify: no arrancar un lote que se va a cortar sin margen ──
    if (queue.length > 0) {
      const quota = await checkApifyQuota(process.env.APIFY_TOKEN as string)
      if (quota && !quota.hasMargin) {
        return NextResponse.json({
          success: true,
          skipped: "sin margen de cuota Apify",
          usedUsd: quota.usedUsd,
          limitUsd: quota.limitUsd,
        })
      }
    }

    // ── Runs secuenciales, respetando el presupuesto ──
    for (const candidate of queue) {
      if (Date.now() - startedAtMs > BUDGET_MS) break
      const result = await scrapeCompanyJobPostings({
        companyId: candidate.companyId,
        userId: candidate.userId,
        // Primera pasada y vencidas: todas las vacantes abiertas. Mensual:
        // novedades 30d.
        windowDays: candidate.reason === "monthly" ? 30 : null,
      })
      if (!result.ok) failedCount++
      results.push({
        companyId: candidate.companyId,
        reason: candidate.reason,
        ok: result.ok,
        runId: result.runId,
        queued: result.queued,
        skippedOtherCompany: result.skippedOtherCompany,
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
          details: {
            firstPassPending: firstPass.length,
            stalePending: stale.length,
            monthlyPending: monthly.length,
            skipped,
            results,
          },
        })
        .eq("id", execution.id)
    }

    return NextResponse.json({ success: true, processed: results.length, failed: failedCount, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    console.error("[v3-scrape] error:", message)
    if (execution?.id) {
      await admin
        .from("cron_executions")
        .update({ status: "failed", records_failed: failedCount + 1, details: { error: message, results } })
        .eq("id", execution.id)
    }
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
