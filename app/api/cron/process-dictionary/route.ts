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
      fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(25_000) }),
    },
  })

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
  const MAX_EXECUTION_TIME = 55000 // 55 seconds max
  let totalJobsProcessed = 0
  let totalSignalsAffected = 0
  let consecutiveEmptyPolls = 0

  try {
    console.log("[Cron Dictionary] Starting dictionary jobs processing (focused mode)...")

    // Process ONE job at a time, pumping it until completed before moving to next.
    // This is much faster than round-robin across many jobs.
    while (Date.now() - startTime < MAX_EXECUTION_TIME) {
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
      while (!jobDone && Date.now() - startTime < MAX_EXECUTION_TIME) {
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
            error?: string
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
