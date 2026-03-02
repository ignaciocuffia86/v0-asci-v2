import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// ── Configuration ──
const CHUNK_SIZE = 5           // rows per RPC call
const MAX_ITERATIONS = 1       // iterations inside RPC (1 = commit after each 5 rows)
const TIME_BUDGET_MS = 50_000  // stop calling RPCs after 50s (leave 10s buffer)
const MAX_CONSECUTIVE_FAILURES = 5 // skip batch after N consecutive failures

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Clean up stuck "running" executions older than 2 minutes
  await supabase
    .from("cron_executions")
    .update({ status: "failed", completed_at: new Date().toISOString(), error_message: "Stuck timeout" })
    .eq("cron_name", "process-queue")
    .eq("status", "running")
    .lt("started_at", new Date(Date.now() - 120_000).toISOString())

  // Concurrency guard
  const { data: running } = await supabase
    .from("cron_executions")
    .select("id")
    .eq("cron_name", "process-queue")
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - 120_000).toISOString())
    .limit(1)

  if (running && running.length > 0) {
    return NextResponse.json({ skipped: true, reason: "concurrent execution" })
  }

  // Register execution
  const { data: execution } = await supabase
    .from("cron_executions")
    .insert({ cron_name: "process-queue", status: "running", started_at: new Date().toISOString() })
    .select("id")
    .single()

  const executionId = execution?.id
  const startTime = Date.now()
  let totalProcessed = 0
  let calls = 0
  let lastBatchId = ""
  const debugLogs: string[] = []
  const skippedBatches: string[] = []

  try {
    while (Date.now() - startTime < TIME_BUDGET_MS) {
      // ── PHASE 3: FIFO order (oldest first) + skip failing batches ──
      const { data: batch, error: fetchErr } = await supabase
        .from("import_batches")
        .select("id, batch_type, filename, status, consecutive_failures")
        .in("status", ["pending", "processing"])
        .lt("consecutive_failures", MAX_CONSECUTIVE_FAILURES)
        .order("created_at", { ascending: true })  // FIFO: oldest batch first
        .limit(1)
        .single()

      if (fetchErr || !batch) {
        // Check if there are skipped batches (all exceeded failure limit)
        const { count: stuckCount } = await supabase
          .from("import_batches")
          .select("*", { count: "exact", head: true })
          .in("status", ["pending", "processing"])
          .gte("consecutive_failures", MAX_CONSECUTIVE_FAILURES)

        if (stuckCount && stuckCount > 0) {
          debugLogs.push(`No processable batches. ${stuckCount} batch(es) skipped (>${MAX_CONSECUTIVE_FAILURES} consecutive failures)`)
        } else {
          debugLogs.push(`No pending batches found`)
        }
        break
      }

      lastBatchId = batch.id

      // If batch is "pending", set it to "processing"
      if (batch.status === "pending") {
        await supabase
          .from("import_batches")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .eq("id", batch.id)
      }

      // Count pending rows
      const { count: pendingBefore } = await supabase
        .from("import_rows")
        .select("*", { count: "exact", head: true })
        .eq("batch_id", batch.id)
        .eq("status", "pending")

      if (!pendingBefore || pendingBefore === 0) {
        await supabase
          .from("import_batches")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", batch.id)
        debugLogs.push(`Batch ${batch.id.slice(0, 8)} completed (0 pending)`)
        continue
      }

      debugLogs.push(`Batch ${batch.id.slice(0, 8)} (${batch.filename}): ${pendingBefore} pending, failures=${batch.consecutive_failures || 0}`)

      // ── PHASE 1: Small RPC calls with p_max_iterations=1 ──
      // Each call = 1 iteration x 5 rows = separate transaction = committed independently
      // Loop multiple small calls within our time budget
      let batchCallsThisRound = 0
      let batchProcessedThisRound = 0

      while (Date.now() - startTime < TIME_BUDGET_MS) {
        const callStart = Date.now()

        const { data: rpcResult, error: rpcError } = await supabase.rpc("process_import_batch", {
          p_batch_id: batch.id,
          p_chunk_size: CHUNK_SIZE,
          p_max_iterations: MAX_ITERATIONS,
        })

        calls++
        batchCallsThisRound++
        const callMs = Date.now() - callStart

        if (rpcError) {
          // ── PHASE 3: Track consecutive failures ──
          debugLogs.push(`RPC error (${callMs}ms): ${rpcError.message}`)
          await supabase
            .from("import_batches")
            .update({
              consecutive_failures: (batch.consecutive_failures || 0) + 1,
              last_error: rpcError.message,
              updated_at: new Date().toISOString(),
            })
            .eq("id", batch.id)
          break // Move to next batch
        }

        // Parse RPC result
        const result = typeof rpcResult === "string" ? JSON.parse(rpcResult) : rpcResult
        const processedThisCall = result?.processed_this_call ?? result?.total_processed ?? 0
        const pendingRemaining = result?.pending_remaining ?? -1

        batchProcessedThisRound += processedThisCall
        totalProcessed += processedThisCall

        // ── PHASE 3: Reset failure counter on success ──
        if (processedThisCall > 0 && (batch.consecutive_failures || 0) > 0) {
          await supabase
            .from("import_batches")
            .update({ consecutive_failures: 0, last_error: null })
            .eq("id", batch.id)
        }

        // No progress = something wrong with this batch, increment failures and move on
        if (processedThisCall <= 0) {
          debugLogs.push(`No progress on call ${batchCallsThisRound} (${callMs}ms)`)
          await supabase
            .from("import_batches")
            .update({
              consecutive_failures: (batch.consecutive_failures || 0) + 1,
              last_error: "No progress on RPC call",
              updated_at: new Date().toISOString(),
            })
            .eq("id", batch.id)
          break
        }

        // Batch completed?
        if (result?.status === "completed" || pendingRemaining === 0) {
          await supabase
            .from("import_batches")
            .update({ status: "completed", consecutive_failures: 0, updated_at: new Date().toISOString() })
            .eq("id", batch.id)
          debugLogs.push(`Batch ${batch.id.slice(0, 8)} completed! (${batchProcessedThisRound} rows in ${batchCallsThisRound} calls)`)
          break
        }

        debugLogs.push(`Call ${calls}: +${processedThisCall} rows (${callMs}ms), ~${pendingRemaining} remaining`)
      }

      // Summary for this batch
      if (batchProcessedThisRound > 0) {
        debugLogs.push(`Batch ${batch.id.slice(0, 8)} round: ${batchProcessedThisRound} rows in ${batchCallsThisRound} calls`)
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000)
    const details = { calls, totalProcessed, lastBatchId, duration, skippedBatches, debugLogs }

    await finishExecution(supabase, executionId, "completed", totalProcessed, details)
    return NextResponse.json({ success: true, ...details })
  } catch (err: any) {
    const details = { error: err.message, calls, totalProcessed, debugLogs }
    await finishExecution(supabase, executionId, "failed", totalProcessed, details)
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
