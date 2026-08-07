import { createAdminClient } from "@/lib/supabase/admin"
import type { TechRadarRunResult } from "@/lib/tech-radar"

/**
 * Registro de corridas del Tech Radar en `v3.tech_radar_runs`.
 *
 * Es el equivalente, POR CORRIDA, a lo que las noticias dejan por artículo: quién
 * disparó el radar, cuándo, con qué señales, cuánto costó y cuántos hallazgos
 * produjo. Además es la base para que el MCP consuma el Tech Radar como una nueva
 * fuente de señales de tecnología (una fila por ejecución, indexando los hallazgos
 * que viven en `public.company_implementations`).
 *
 * Vive fuera de `lib/tech-radar.ts` a propósito: el core (`runTechRadar`) solo
 * atribuye el gasto de IA fila por fila en `ai_usage_log` y DEVUELVE el uso
 * agregado; la fila de la corrida la maneja el caller, que es quien conoce el
 * origen (drilldown vs campaña) y sus referencias (bookmark / campaign_account).
 *
 * Ninguna de las dos funciones lanza: el monitoreo no debe tumbar la feature. Si
 * el insert falla, el radar corre igual y el gasto igual queda en `ai_usage_log`.
 */

export type TechRadarRunCaller = "drilldown" | "campaign"

/** Handle opaco de una corrida abierta. `null` si no se pudo abrir la fila. */
export type TechRadarRunHandle = { id: string; startedAt: number }

export async function startTechRadarRun(input: {
  companyId?: string | null
  companyName: string
  workspaceId?: string | null
  userId?: string | null
  caller: TechRadarRunCaller
  campaignAccountId?: string | null
  bookmarkId?: string | null
  keywords?: string[]
}): Promise<TechRadarRunHandle | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .schema("v3")
      .from("tech_radar_runs")
      .insert({
        company_id: input.companyId ?? null,
        company_name: input.companyName,
        workspace_id: input.workspaceId ?? null,
        user_id: input.userId ?? null,
        caller: input.caller,
        campaign_account_id: input.campaignAccountId ?? null,
        bookmark_id: input.bookmarkId ?? null,
        keywords: input.keywords ?? [],
        status: "running",
      })
      .select("id")
      .single()

    if (error) {
      console.error("[v3][tech-radar-runs] no se pudo abrir la corrida:", error.message)
      return null
    }
    return { id: data.id as string, startedAt: Date.now() }
  } catch (e) {
    console.error("[v3][tech-radar-runs] error inesperado abriendo corrida:", e)
    return null
  }
}

export async function finishTechRadarRun(
  run: TechRadarRunHandle | null,
  outcome:
    | { status: "completed"; result: TechRadarRunResult }
    | { status: "failed"; errorMessage: string },
): Promise<void> {
  if (!run) return
  try {
    const admin = createAdminClient()
    const base = {
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - run.startedAt,
    }

    if (outcome.status === "failed") {
      await admin
        .schema("v3")
        .from("tech_radar_runs")
        .update({ ...base, status: "failed", error_message: outcome.errorMessage.slice(0, 1000) })
        .eq("id", run.id)
      return
    }

    const r = outcome.result
    await admin
      .schema("v3")
      .from("tech_radar_runs")
      .update({
        ...base,
        status: "completed",
        model: r.usage.model,
        web_searches: r.usage.webSearches,
        sources_count: r.usage.sourcesCount,
        findings_count: r.findings.length,
        input_tokens: r.usage.inputTokens,
        output_tokens: r.usage.outputTokens,
        cost_usd: r.usage.costUsd,
        digest: r.digest,
        ai_provider: r.ai_provider,
      })
      .eq("id", run.id)
  } catch (e) {
    console.error("[v3][tech-radar-runs] error inesperado cerrando corrida:", e)
  }
}
