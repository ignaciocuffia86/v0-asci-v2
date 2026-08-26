import "server-only"

import { randomUUID } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { runLinkedinJobsActor, companyNameVariants } from "./apify-client"
import { ingestApifyJobPostings, apifyBatchFilenamePrefix } from "./apify-job-ingest"
import { recordApifyRun, type ApifyRunSource } from "./spend-ledger"

// ═══════════════════════════════════════════════════════════
// Runner compartido de scraping de vacantes (Fase 4).
// Lo usan el corredor (cron v3-scrape-job-postings) y el kick del follow.
//
// Regla central (diseño 6.3.b): el intento se marca ANTES de gastar. Acá se
// crea un batch `apify://<companyId>/pending-…` en `uploading` ANTES de lanzar
// el run, y se finaliza después:
//   - la ingesta creó su batch real (hubo filas) → el marcador se borra, el
//     batch real es el registro del intento;
//   - el run volvió sin filas utilizables → el marcador pasa a `completed`
//     vacío con el runId real: sin esto, una cuenta sin vacantes matchearía
//     "sin batch" para siempre y el corredor la re-correría cada 10 minutos;
//   - el run falló → el marcador pasa a `failed` (no bloquea cooldown, pero
//     cuenta para el tope de reintentos).
// El marcador en `uploading` es además lo que cierra la carrera entre el kick
// del follow y el corredor: el run en vuelo ya dejó batch, así que el corredor
// ve la marca y saltea. `uploading` es invisible para el ETL (solo mira
// pending/processing), así que el marcador no puede ser procesado por error.
// ═══════════════════════════════════════════════════════════

export interface ScrapeRunResult {
  ok: boolean
  runId: string | null
  queued: number
  skippedOtherCompany: number
  warnings: string[]
  error: string | null
}

export async function scrapeCompanyJobPostings(params: {
  companyId: string
  /** Dueño del batch (FK a auth.users): el que siguió la cuenta, o quien dispara. */
  userId: string
  /** null = sin límite de fecha (primera pasada); 30 = novedades del mes. */
  windowDays: number | null
  maxRows?: number
  /**
   * Quién disparó esto, para el ledger de gasto.
   *
   * Lo pasa el llamador y no se infiere de `windowDays`, aunque hoy
   * correlacionen: el día que el cron mensual necesite otra ventana, inferirlo
   * atribuiría el gasto al origen equivocado sin que nadie lo note.
   */
  source: ApifyRunSource
}): Promise<ScrapeRunResult> {
  const admin = createAdminClient()

  const { data: company } = await admin
    .from("companies")
    .select("id, name, linkedin_url, country, linkedin_company_id")
    .eq("id", params.companyId)
    .maybeSingle()
  if (!company) return { ok: false, runId: null, queued: 0, skippedOtherCompany: 0, warnings: [], error: "COMPANY_NOT_FOUND" }

  // ── Marca del intento, ANTES del gasto ──
  const { data: marker, error: markerError } = await admin
    .from("import_batches")
    .insert({
      user_id: params.userId,
      filename: `${apifyBatchFilenamePrefix(params.companyId)}pending-${randomUUID().slice(0, 8)}`,
      batch_type: "job_postings",
      status: "uploading",
      total_rows: 0,
    })
    .select("id")
    .single()
  if (markerError || !marker) {
    return { ok: false, runId: null, queued: 0, skippedOtherCompany: 0, warnings: [], error: `MARKER_FAILED:${markerError?.message}` }
  }

  try {
    const run = await runLinkedinJobsActor({
      companyNames: companyNameVariants(company.name, company.linkedin_url),
      linkedinCompanyId: company.linkedin_company_id ?? null,
      // `||` y no `??`: hay filas con country = "" (string vacío).
      location: company.country?.trim() || undefined,
      windowDays: params.windowDays,
      maxRows: params.maxRows ?? 200,
    })

    const ingest = await ingestApifyJobPostings({
      companyId: params.companyId,
      userId: params.userId,
      runId: run.runId,
      items: run.items,
    })

    if (ingest.batchId) {
      // El batch real ya registra el intento; el marcador sobra.
      await admin.from("import_batches").delete().eq("id", marker.id)
    } else {
      // Sin filas: el marcador ES el registro del intento (completed vacío).
      await admin
        .from("import_batches")
        .update({
          filename: `${apifyBatchFilenamePrefix(params.companyId)}${run.runId}`,
          status: "completed",
        })
        .eq("id", marker.id)
    }

    // El gasto queda registrado ACÁ y no en el cron: este es el único punto por
    // el que pasan los dos llamadores (el corredor y el kick de la UI), así que
    // ninguno puede olvidarse. `workspaceId` va en null a propósito — el cron
    // deduplica por empresa y esta corrida sirve a todos los que la siguen.
    await recordApifyRun({
      runId: run.runId,
      source: params.source,
      companyId: params.companyId,
      userId: params.userId,
      costUsd: run.usageTotalUsd,
      rowsIngested: ingest.queued,
      status: "SUCCEEDED",
    })

    return {
      ok: true,
      runId: run.runId,
      queued: ingest.queued,
      skippedOtherCompany: ingest.skippedOtherCompany,
      warnings: ingest.warnings,
      error: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido"
    await admin
      .from("import_batches")
      .update({ status: "failed", error_message: message.slice(0, 500) })
      .eq("id", marker.id)
    return { ok: false, runId: null, queued: 0, skippedOtherCompany: 0, warnings: [], error: message }
  }
}

/**
 * Kick de primera pasada al seguir una cuenta desde la UI. Corre DESPUÉS de
 * responder el alta (next/server after()), así que no bloquea nada; si acá
 * falla, el corredor la levanta en su próxima pasada (≤10 min).
 */
export async function kickFirstScrapeIfNeeded(companyId: string, userId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("import_batches")
    .select("id")
    .like("filename", `${apifyBatchFilenamePrefix(companyId)}%`)
    .limit(1)
    .maybeSingle()
  if (existing) return // ya scrapeada o en vuelo: la cadencia la maneja el corredor

  const result = await scrapeCompanyJobPostings({ companyId, userId, windowDays: null, source: "ui_kick" })
  if (!result.ok) {
    console.warn(`[v3] Kick de scraping para ${companyId} falló (${result.error}); el corredor reintenta.`)
  }
}
