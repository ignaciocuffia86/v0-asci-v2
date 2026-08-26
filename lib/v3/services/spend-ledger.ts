import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

// ═══════════════════════════════════════════════════════════════════════════
// El registro de lo que se gasta afuera, en un solo lugar.
//
// Antes de esto el gasto de Apify quedaba en la metadata de la reserva del MCP,
// y eso solo cubre el camino del MCP. El cron (`job-scrape-runner`) no tiene
// reserva, y es el que más va a correr cuando haya 100 usuarios: su costo no se
// registraba en ningún lado. El de `explore` tampoco.
//
// LA UNIDAD ES LA EMPRESA, NO EL USUARIO. El cron deduplica por empresa entre
// workspaces: una corrida sirve a todos los que siguen esa cuenta, y el userId
// del batch es el del primer seguidor que aparece — arbitrario. Cobrárselo a esa
// persona la haría ver cara por trabajo que aprovecharon todos. `userId` se
// guarda igual, pero como dato informativo.
// ═══════════════════════════════════════════════════════════════════════════

/** Quién disparó la corrida. Es la dimensión que permite mirar el costo del cron. */
export type ApifyRunSource =
  | "cron_first_pass"
  | "cron_monthly"
  | "ui_kick"
  | "mcp_tool"
  | "mcp_explore"

/**
 * Normaliza el costo antes de guardarlo.
 *
 * La regla es la misma que aplica el resumen al leerlo, y está acá para que no
 * haya dos criterios: solo un número finito y no negativo es un costo. Un
 * `undefined` de un actor que no lo reporte, un string, un `NaN` de una división
 * fallida — todo eso es "no sabemos", y "no sabemos" es null, nunca cero.
 *
 * Un NaN que entrara a la tabla sería peor que un null: envenenaría cualquier
 * `sum()` que lo toque, y con él el costo de IA y el de Apollo del mismo informe.
 */
export function normalizeCostUsd(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

export interface RecordApifyRunParams {
  runId: string
  source: ApifyRunSource
  companyId: string
  /** NULL cuando el gasto es compartido (el cron). Es la respuesta correcta, no un dato faltante. */
  workspaceId?: string | null
  /** Informativo. NO es a quién se le cobra. */
  userId?: string | null
  batchJobId?: string | null
  /** `usageTotalUsd` de Apify. Puede ser null: ver normalizeCostUsd. */
  costUsd?: number | null
  rowsIngested?: number
  status?: string | null
}

/**
 * Registra una corrida de Apify. NUNCA lanza.
 *
 * Es la misma decisión que toma `logAiUsage`: el trabajo ya ocurrió y las
 * vacantes ya están ingestadas, así que un fallo escribiendo el registro no
 * puede voltear la operación que lo produjo. Se pierde una fila de costo y se
 * deja rastro en el log; lo otro sería perder el trabajo pago.
 *
 * El insert es idempotente por el UNIQUE de `run_id`: reintentar no duplica el
 * costo. Un conflicto no es un error y no se reporta como tal.
 */
export async function recordApifyRun(params: RecordApifyRunParams): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin
      .schema("v3")
      .from("apify_runs")
      .upsert(
        {
          run_id: params.runId,
          source: params.source,
          company_id: params.companyId,
          workspace_id: params.workspaceId ?? null,
          user_id: params.userId ?? null,
          batch_job_id: params.batchJobId ?? null,
          cost_usd: normalizeCostUsd(params.costUsd),
          rows_ingested: Math.max(0, Math.round(params.rowsIngested ?? 0)),
          status: params.status ?? null,
        },
        { onConflict: "run_id", ignoreDuplicates: true },
      )
    if (error) console.error("[v3][ledger] no se pudo registrar la corrida de Apify:", error.message)
  } catch (e) {
    console.error("[v3][ledger] error inesperado registrando la corrida de Apify:", e)
  }
}
