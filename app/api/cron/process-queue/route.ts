import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { assertCron } from "@/lib/cron-auth"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// ── Configuration ──
const CHUNK_SIZE = 3           // rows per RPC call (kept small so each call finishes well within timeout)
const MAX_ITERATIONS = 3       // iterations inside RPC (3 x 3 rows = up to 9 rows per call)
const TIME_BUDGET_MS = 45_000  // stop calling RPCs after 45s (leave 15s buffer for slow calls)
const MAX_CONSECUTIVE_FAILURES = 5 // skip batch after N consecutive failures

export async function GET(request: Request) {
  const denied = assertCron(request)
  if (denied) return denied

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

  // ── Concurrency guard: distributed lease lock ──
  // The previous guard (SELECT running executions, then INSERT) had its own race:
  // two simultaneous invocations both read "none running" and both proceeded. We
  // observed two different deployments processing the same queue at once, which
  // is why reported counts disagreed with the RPC results.
  // acquire_cron_lock does a single atomic conditional UPDATE, so exactly one
  // caller can win regardless of how many deployments hit this endpoint.
  const holder = crypto.randomUUID()
  const { data: lockAcquired, error: lockError } = await supabase.rpc("acquire_cron_lock", {
    p_lock_name: "process-queue",
    p_holder: holder,
    p_ttl_secs: 120,
  })

  if (lockError) {
    return NextResponse.json({ error: `Lock error: ${lockError.message}` }, { status: 500 })
  }

  if (!lockAcquired) {
    return NextResponse.json({ skipped: true, reason: "concurrent execution (lock held)" })
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
        .select("id, batch_type, filename, status, consecutive_failures, total_rows")
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
        // ── THE BUG THIS GUARD FIXES ──
        // "0 pending rows" used to be treated as "batch finished". That is wrong
        // while rows are still being inserted: the batch got marked "completed"
        // with 0 processed rows and was never looked at again (silent failure).
        // Uploads now stay in "uploading" (invisible here), but we still verify
        // that every expected row is accounted for before declaring completion.
        const { count: accountedRows } = await supabase
          .from("import_rows")
          .select("*", { count: "exact", head: true })
          .eq("batch_id", batch.id)
          .in("status", ["processed", "failed", "skipped"])

        const accounted = accountedRows || 0
        const expected = batch.total_rows || 0

        if (expected > 0 && accounted < expected) {
          // Rows are missing entirely - do NOT mark completed. Count it as a
          // failure so it eventually trips the skip threshold instead of
          // looping forever, and surface it loudly.
          debugLogs.push(
            `Batch ${batch.id.slice(0, 8)} INCONSISTENT: 0 pending but only ${accounted}/${expected} rows accounted for. Not completing.`,
          )
          await supabase.rpc("increment_batch_failures", {
            p_batch_id: batch.id,
            p_error: `Inconsistent batch: 0 pending rows but ${accounted}/${expected} accounted for (rows missing)`,
          })
          continue
        }

        await supabase
          .from("import_batches")
          // Counters are maintained by process_import_batch (it recounts rows by
          // status), so we only flip the status here.
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", batch.id)
        debugLogs.push(
          `Batch ${batch.id.slice(0, 8)} completed (0 pending, ${accounted}/${expected} accounted)`,
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
  } finally {
    // Always hand the lease back so the next minute's run can start immediately.
    // If this fails, the TTL (120s) releases it anyway.
    try {
      await supabase.rpc("release_cron_lock", { p_lock_name: "process-queue", p_holder: holder })
    } catch {
      // best effort - the lease expires on its own
    }
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
