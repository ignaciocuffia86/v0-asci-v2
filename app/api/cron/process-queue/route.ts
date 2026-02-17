import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Concurrency guard: skip if another cron is already running
  const { data: running } = await supabase
    .from("cron_executions")
    .select("id")
    .eq("cron_name", "process-queue")
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - 120_000).toISOString()) // within last 2 min
    .limit(1)

  if (running && running.length > 0) {
    console.log("[Cron] Another execution already running, skipping")
    return NextResponse.json({ skipped: true, reason: "concurrent execution" })
  }

  // Register this execution
  const { data: execution } = await supabase
    .from("cron_executions")
    .insert({
      cron_name: "process-queue",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  const executionId = execution?.id
  const startTime = Date.now()

  const MAX_TIME = 50_000 // 50s safety margin within 60s maxDuration
  let totalProcessed = 0
  let calls = 0
  let lastBatchId = ""
  let lastStatus = ""
  let lastPending = 0

  try {
    // Loop: make multiple RPC calls within our time window
    while (Date.now() - startTime < MAX_TIME) {
      // Get the NEWEST pending/processing batch
      const { data: batch, error: fetchErr } = await supabase
        .from("import_batches")
        .select("id, batch_type, filename")
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

      if (fetchErr || !batch) {
        console.log("[Cron] No pending batches found")
        break
      }

      lastBatchId = batch.id

      // chunk_size=5 means 5 rows per iteration x 10 internal iterations = 50 rows per call
      // Each call takes ~5-15s depending on signal matching complexity
      const { data: rpcResult, error: rpcError } = await supabase.rpc("process_import_batch", {
        p_batch_id: batch.id,
        p_chunk_size: 5,
      })

      calls++

      if (rpcError) {
        console.error(`[Cron] RPC error on call ${calls}:`, rpcError.message)
        break
      }

      // Parse result
      let result: any
      try {
        result = typeof rpcResult === "string" ? JSON.parse(rpcResult) : rpcResult
      } catch {
        result = { status: "unknown", raw: String(rpcResult) }
      }

      const processed = result?.processed_this_call || result?.total_processed || 0
      totalProcessed += processed
      lastStatus = result?.status || "unknown"
      lastPending = result?.pending_remaining ?? 0

      console.log(`[Cron] Call ${calls}: ${processed} rows (${lastStatus}), ${lastPending} pending`)

      // If batch completed, loop will pick the next one
      if (lastStatus === "completed" || processed === 0) {
        // No progress or batch done - check if there are more batches
        continue
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000)
    console.log(`[Cron] Done: ${calls} calls, ${totalProcessed} rows in ${duration}s`)

    await finishExecution(supabase, executionId, "completed", totalProcessed, {
      calls,
      totalProcessed,
      lastBatchId,
      lastStatus,
      lastPending,
      duration,
    })

    return NextResponse.json({
      success: true,
      calls,
      totalProcessed,
      lastBatchId,
      lastStatus,
      lastPending,
      duration,
    })
  } catch (err: any) {
    console.error("[Cron] Fatal error:", err.message)
    await finishExecution(supabase, executionId, "failed", totalProcessed, {
      error: err.message,
      calls,
      totalProcessed,
    })
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function finishExecution(
  supabase: any,
  executionId: string | undefined,
  status: string,
  processed: number,
  details: Record<string, any>
) {
  if (!executionId) return
  try {
    await supabase
      .from("cron_executions")
      .update({
        status,
        completed_at: new Date().toISOString(),
        records_processed: processed,
        details,
      })
      .eq("id", executionId)
  } catch (e: any) {
    console.error("[Cron] Failed to update execution:", e.message)
  }
}
