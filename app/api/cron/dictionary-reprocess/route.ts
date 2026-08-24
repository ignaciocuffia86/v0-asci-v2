import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { assertCron } from "@/lib/cron-auth"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// ═══════════════════════════════════════════════════════════
// Libera los recálculos de co-ocurrencia diferidos.
//
// Cambiar keywords_contexto o keywords_excluye de una keyword existente obliga
// a rehacer sus señales, porque las viejas se generaron con las reglas
// anteriores. Ese trabajo es pesado (reprocesar "Exchange" toca ~5.000
// contactos) y no lo está esperando nadie, así que el diálogo lo encola como
// 'deferred' en vez de 'pending'.
//
// Este cron NO procesa: solo pasa esos jobs a 'pending'. De ahí los drena el
// cron de cada minuto, que es el que ya sabe bombear un job por fases dentro
// del maxDuration. Duplicar acá esa lógica sería mantener dos motores.
//
// Lo que sí importa es lo que este endpoint NO hace: no toca created_at. El
// par remove → add de cada keyword se encoló con un milisegundo de diferencia
// y el cron ordena por created_at; reescribir la fecha acá pondría en riesgo
// ese orden y un add corriendo antes que su remove dejaría la keyword borrada.
// ═══════════════════════════════════════════════════════════

export async function GET(request: Request) {
  const denied = assertCron(request)
  if (denied) return denied

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: execution } = await supabase
    .from("cron_executions")
    .insert({
      cron_name: "dictionary-reprocess",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  const executionId = execution?.id

  try {
    const { data: liberados, error } = await supabase.rpc("release_deferred_dictionary_jobs")
    if (error) throw new Error(error.message)

    const total = typeof liberados === "number" ? liberados : 0
    console.log(`[Cron Dictionary Reprocess] ${total} job(s) diferidos liberados a pending`)

    if (executionId) {
      await supabase
        .from("cron_executions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          records_processed: total,
        })
        .eq("id", executionId)
    }

    return NextResponse.json({ success: true, liberados: total })
  } catch (err: any) {
    console.error("[Cron Dictionary Reprocess] Error:", err)

    if (executionId) {
      await supabase
        .from("cron_executions")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: err.message,
        })
        .eq("id", executionId)
    }

    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
