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

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

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
    console.log("[Cron Dictionary] Starting dictionary jobs processing...")

    while (Date.now() - startTime < MAX_EXECUTION_TIME) {
      const { data: jobs, error: jobsError } = await supabase
        .from("dictionary_jobs")
        .select("*")
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: true })
        .limit(20)

      if (jobsError) {
        console.error("[Cron Dictionary] Error fetching jobs:", jobsError)
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }

      if (!jobs || jobs.length === 0) {
        consecutiveEmptyPolls++
        if (consecutiveEmptyPolls >= 3) {
          console.log("[Cron Dictionary] No pending jobs after 3 polls, exiting early")
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 2000))
        continue
      }

      // Reset counter when we find jobs
      consecutiveEmptyPolls = 0

      // Process each job
      for (const job of jobs) {
        if (Date.now() - startTime >= MAX_EXECUTION_TIME) break

        console.log(`[Cron Dictionary] Processing job ${job.id} (${job.job_type})...`)

        try {
          const { data: result, error: rpcError } = await supabase.rpc("process_dictionary_job", {
            p_job_id: job.id,
            p_batch_size: 1000,
          })

          if (rpcError) {
            console.error(`[Cron Dictionary] Error processing job ${job.id}:`, rpcError)
            await supabase
              .from("dictionary_jobs")
              .update({
                status: "failed",
                error_message: rpcError.message,
                completed_at: new Date().toISOString(),
              })
              .eq("id", job.id)
            continue
          }

          const jobResult = result as {
            success: boolean
            processed?: number
            signals_created?: number
            deleted_count?: number
            has_more?: boolean
            error?: string
          }

          if (jobResult.success) {
            totalJobsProcessed++
            totalSignalsAffected += jobResult.signals_created || jobResult.deleted_count || 0

            console.log(
              `[Cron Dictionary] Job ${job.id} progress: ${jobResult.processed || 0} processed, ${
                jobResult.signals_created || jobResult.deleted_count || 0
              } signals affected`,
            )
          } else {
            console.error(`[Cron Dictionary] Job ${job.id} failed:`, jobResult.error)
            await supabase
              .from("dictionary_jobs")
              .update({
                status: "failed",
                error_message: jobResult.error || "Unknown error",
                completed_at: new Date().toISOString(),
              })
              .eq("id", job.id)
          }
        } catch (err: any) {
          console.error(`[Cron Dictionary] Exception processing job ${job.id}:`, err)
          await supabase
            .from("dictionary_jobs")
            .update({
              status: "failed",
              error_message: err.message,
              completed_at: new Date().toISOString(),
            })
            .eq("id", job.id)
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 100))
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
