import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  // Security check
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === "production") {
    console.warn("[Cron Dictionary] Warning: Unauthorized attempt or missing CRON_SECRET")
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    global: {
      // 50s: mayor que el statement_timeout (40s) del driver (así la DB cancela
      // limpio antes de que aborte el cliente), pero < maxDuration (60s).
      fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(50_000) }),
    },
  })

  // Guard anti-solape global: si ya hay una ejecución de este cron corriendo
  // (iniciada hace < 90s), salir. Evita dos crons pisándose sobre signals
  // (deadlock / lock timeout).
  const { data: active } = await supabase
    .from("cron_executions")
    .select("id")
    .eq("cron_name", "process-dictionary")
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - 90_000).toISOString())
    .limit(1)

  if (active && active.length > 0) {
    console.log("[Cron Dictionary] Otra ejecución ya está corriendo, salteando este tick")
    return NextResponse.json({ skipped: true, reason: "already running" })
  }

  // Register cron execution start
  const { data: execution } = await supabase
    .from("cron_executions")
    .insert({
      cron_name: "process-dictionary",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  const executionId = execution?.id

  const startTime = Date.now()
  // No arrancar un nuevo paso si no quedan al menos ~45s de margen: un paso de
  // match pesado puede correr hasta 40s (statement_timeout) y debe caber dentro
  // del maxDuration=60. Los jobs rápidos (la mayoría) igual drenan de a muchos
  // por tick porque cada paso tarda milisegundos. Los pesados avanzan por fases
  // a lo largo de varios ticks (el cron corre cada minuto).
  const START_STEP_DEADLINE = 15000
  let totalJobsProcessed = 0
  let totalSignalsAffected = 0
  let consecutiveEmptyPolls = 0

  try {
    console.log("[Cron Dictionary] Starting dictionary jobs processing (focused mode)...")

    // Process ONE job at a time, pumping it until completed before moving to next.
    // This is much faster than round-robin across many jobs.
    while (Date.now() - startTime < START_STEP_DEADLINE) {
      // Pick the single oldest job, preferring ones already in progress
      const { data: job, error: jobsError } = await supabase
        .from("dictionary_jobs")
        .select("*")
        .in("status", ["processing", "pending"])
        .order("status", { ascending: false }) // 'processing' before 'pending'
        .order("created_at", { ascending: true })
        .limit(1)
        .single()

      if (jobsError || !job) {
        consecutiveEmptyPolls++
        if (consecutiveEmptyPolls >= 2) {
          console.log("[Cron Dictionary] No pending jobs, exiting early")
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }

      consecutiveEmptyPolls = 0
      console.log(`[Cron Dictionary] Focusing on job ${job.id} (${job.keyword}, ${job.phase || 'start'})...`)

      // Pump this single job repeatedly until it completes or we run out of time
      let jobDone = false
      while (!jobDone && Date.now() - startTime < START_STEP_DEADLINE) {
        try {
          const { data: result, error: rpcError } = await supabase.rpc("process_dictionary_job", {
            p_job_id: job.id,
            p_batch_size: 2000,
          })

          if (rpcError) {
            console.error(`[Cron Dictionary] RPC error for job ${job.id}:`, rpcError.message)
            await supabase
              .from("dictionary_jobs")
              .update({
                status: "failed",
                error_message: rpcError.message,
                completed_at: new Date().toISOString(),
              })
              .eq("id", job.id)
            jobDone = true
            continue
          }

          const jobResult = result as {
            success: boolean
            processed?: number
            total?: number
            signals_created?: number
            deleted_count?: number
            has_more?: boolean
            phase?: string
            skipped?: boolean
            error?: string
          }

          // El driver está lockeado por otro proceso: dejar este job y seguir.
          if (jobResult.skipped) {
            console.log(`[Cron Dictionary] Job ${job.id} lockeado por otro proceso, salteando`)
            jobDone = true
            continue
          }

          if (!jobResult.success) {
            console.error(`[Cron Dictionary] Job ${job.id} failed:`, jobResult.error)
            await supabase
              .from("dictionary_jobs")
              .update({
                status: "failed",
                error_message: jobResult.error || "Unknown error",
                completed_at: new Date().toISOString(),
              })
              .eq("id", job.id)
            jobDone = true
            continue
          }

          totalSignalsAffected += jobResult.signals_created || jobResult.deleted_count || 0

          if (!jobResult.has_more) {
            totalJobsProcessed++
            jobDone = true
            console.log(`[Cron Dictionary] Job ${job.id} (${job.keyword}) COMPLETED. ${jobResult.processed}/${jobResult.total} records, ${totalSignalsAffected} signals`)
          }
        } catch (err: any) {
          console.error(`[Cron Dictionary] Exception processing job ${job.id}:`, err.message)
          await supabase
            .from("dictionary_jobs")
            .update({
              status: "failed",
              error_message: err.message,
              completed_at: new Date().toISOString(),
            })
            .eq("id", job.id)
          jobDone = true
        }
      }
    }

    console.log(
      `[Cron Dictionary] Finished. Jobs processed: ${totalJobsProcessed}, Signals affected: ${totalSignalsAffected}`,
    )

    // Register cron execution completion
    if (executionId) {
      await supabase
        .from("cron_executions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          records_processed: totalJobsProcessed,
          signals_created: totalSignalsAffected,
        })
        .eq("id", executionId)
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${totalJobsProcessed} jobs affecting ${totalSignalsAffected} signals`,
      totalJobsProcessed,
      totalSignalsAffected,
    })
  } catch (err: any) {
    console.error("[Cron Dictionary] Unexpected error:", err)

    // Register cron execution failure
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
