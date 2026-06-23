import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// ── Configuration ──
const CHUNK_SIZE = 3           // rows per RPC call (kept small so each call finishes well within timeout)
const MAX_ITERATIONS = 3       // iterations inside RPC (3 x 3 rows = up to 9 rows per call)
const TIME_BUDGET_MS = 45_000  // stop calling RPCs after 45s (leave 15s buffer for slow calls)
const MAX_CONSECUTIVE_FAILURES = 5 // skip batch after N consecutive failures

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      // RPCs now have SET statement_timeout = '120s' (SECURITY DEFINER override).
      // Fetch timeout must exceed that to avoid client-side abort before Postgres finishes.
      global: {
        fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(45_000) }),
      },
    }
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
  const deferredBatches: string[] = []

  try {
    // ── Zombie recovery ──
    // A batch wrongly marked "completed" while rows were still being inserted (the race condition)
    // has processed_rows + failed_rows < total_rows. Reactivate those that still have pending rows
    // so the cron picks them up again. Safe for v2: only reactivates batches with real pending work.
    // Scope: only RECENT zombies (last 72h). Old abandoned imports are left untouched so they don't
    // flood the FIFO queue; those are handled manually.
    const ZOMBIE_RECOVERY_WINDOW_MS = 72 * 60 * 60 * 1000
    const zombieCutoff = new Date(Date.now() - ZOMBIE_RECOVERY_WINDOW_MS).toISOString()
    const { data: zombies } = await supabase
      .from("import_batches")
      .select("id, filename, total_rows, processed_rows, failed_rows")
      .eq("status", "completed")
      .gt("total_rows", 0)
      .gte("created_at", zombieCutoff)
      .limit(50)

    for (const z of zombies ?? []) {
      const accounted = (z.processed_rows ?? 0) + (z.failed_rows ?? 0)
      if (accounted >= (z.total_rows ?? 0)) continue // genuinely complete

      const { count: zPending } = await supabase
        .from("import_rows")
        .select("*", { count: "exact", head: true })
        .eq("batch_id", z.id)
        .eq("status", "pending")

      if (zPending && zPending > 0) {
        await supabase
          .from("import_batches")
          .update({ status: "processing", consecutive_failures: 0, updated_at: new Date().toISOString() })
          .eq("id", z.id)
          .eq("status", "completed") // guard against concurrent change
        debugLogs.push(`Recovered zombie batch ${z.id.slice(0, 8)} (${z.filename}): ${zPending} pending, ${accounted}/${z.total_rows} accounted`)
      }
    }

    while (Date.now() - startTime < TIME_BUDGET_MS) {
      // ── PHASE 3: FIFO order (oldest first) + skip failing batches ──
      let fetchQuery = supabase
        .from("import_batches")
        .select("id, batch_type, filename, status, consecutive_failures, total_rows, processed_rows, failed_rows")
        .in("status", ["pending", "processing"])
        .lt("consecutive_failures", MAX_CONSECUTIVE_FAILURES)
      // Exclude batches deferred this run (rows still being inserted by the uploader)
      if (deferredBatches.length > 0) {
        fetchQuery = fetchQuery.not("id", "in", `(${deferredBatches.join(",")})`)
      }
      const { data: batch, error: fetchErr } = await fetchQuery
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
        // No pending rows. Only mark completed if the batch's rows are fully accounted for.
        // Invariant: a batch is done <=> processed_rows + failed_rows >= total_rows.
        // If total_rows is still greater, the uploader is mid-insert (rows not committed yet),
        // so completing here would orphan those rows (the original race condition). Defer instead.
        const totalRows = batch.total_rows ?? 0
        const accounted = (batch.processed_rows ?? 0) + (batch.failed_rows ?? 0)

        if (totalRows === 0 || accounted >= totalRows) {
          await supabase
            .from("import_batches")
            .update({ status: "completed", updated_at: new Date().toISOString() })
            .eq("id", batch.id)
          debugLogs.push(`Batch ${batch.id.slice(0, 8)} completed (0 pending, ${accounted}/${totalRows} accounted)`)
          continue
        }

        // Rows still being loaded: defer this batch to a later run, do not complete it.
        deferredBatches.push(batch.id)
        debugLogs.push(
          `Batch ${batch.id.slice(0, 8)} deferred: 0 pending but only ${accounted}/${totalRows} rows loaded (uploader in progress)`
        )
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
          // Atomic increment - prevents stale-read race condition
          debugLogs.push(`RPC error (${callMs}ms): ${rpcError.message}`)
          await supabase.rpc("increment_batch_failures", {
            p_batch_id: batch.id,
            p_error: rpcError.message,
          })
          break // Move to next batch
        }

        // Parse RPC result
        const result = typeof rpcResult === "string" ? JSON.parse(rpcResult) : rpcResult
        const processedThisCall = result?.processed_this_call ?? result?.total_processed ?? 0
        const pendingRemaining = result?.pending_remaining ?? -1

        batchProcessedThisRound += processedThisCall
        totalProcessed += processedThisCall

        // Atomic reset - only updates if consecutive_failures > 0
        if (processedThisCall > 0) {
          await supabase.rpc("reset_batch_failures", { p_batch_id: batch.id })
        }

        // No progress = something wrong with this batch, atomic increment and move on
        if (processedThisCall <= 0) {
          debugLogs.push(`No progress on call ${batchCallsThisRound} (${callMs}ms)`)
          await supabase.rpc("increment_batch_failures", {
            p_batch_id: batch.id,
            p_error: "No progress on RPC call",
          })
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
