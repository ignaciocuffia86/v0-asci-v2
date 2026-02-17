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
  const MAX_TIME = 50_000
  let totalProcessed = 0
  let calls = 0
  let lastBatchId = ""
  let debugLogs: string[] = []

  try {
    while (Date.now() - startTime < MAX_TIME) {
      // Get the NEWEST pending/processing batch
      const { data: batch, error: fetchErr } = await supabase
        .from("import_batches")
        .select("id, batch_type, filename, status")
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single()

      if (fetchErr || !batch) {
        debugLogs.push(`No batches found: ${fetchErr?.message || "empty"}`)
        break
      }

      lastBatchId = batch.id

      // If batch is "pending", set it to "processing" first
      if (batch.status === "pending") {
        await supabase
          .from("import_batches")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .eq("id", batch.id)
      }

      // Count pending rows BEFORE the RPC call
      const { count: pendingBefore } = await supabase
        .from("import_rows")
        .select("*", { count: "exact", head: true })
        .eq("batch_id", batch.id)
        .eq("status", "pending")

      debugLogs.push(`Batch ${batch.id.slice(0,8)} (${batch.filename}): ${pendingBefore} pending`)

      if (!pendingBefore || pendingBefore === 0) {
        // No pending rows -- mark batch completed and try next
        await supabase
          .from("import_batches")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", batch.id)
        debugLogs.push(`Batch ${batch.id.slice(0,8)} marked completed (0 pending)`)
        continue
      }

      // Call RPC: chunk_size=5 => 50 rows per call (5 per iteration x 10 iterations)
      const { data: rpcResult, error: rpcError } = await supabase.rpc("process_import_batch", {
        p_batch_id: batch.id,
        p_chunk_size: 5,
      })

      calls++

      if (rpcError) {
        debugLogs.push(`RPC error: ${rpcError.message}`)
        break
      }

      // Debug: log the raw RPC result type and value
      debugLogs.push(`RPC raw type=${typeof rpcResult}, val=${JSON.stringify(rpcResult).slice(0, 200)}`)

      // Count pending rows AFTER the RPC call to know how many were actually processed
      const { count: pendingAfter } = await supabase
        .from("import_rows")
        .select("*", { count: "exact", head: true })
        .eq("batch_id", batch.id)
        .eq("status", "pending")

      const processed = (pendingBefore || 0) - (pendingAfter || 0)
      totalProcessed += processed
      debugLogs.push(`Call ${calls}: processed ${processed} rows, ${pendingAfter} remaining`)

      // If no progress was made, something is wrong - break to avoid infinite loop
      if (processed <= 0) {
        debugLogs.push(`No progress, breaking`)
        break
      }

      // If batch done, loop picks next one
      if (pendingAfter === 0) {
        await supabase
          .from("import_batches")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", batch.id)
        debugLogs.push(`Batch completed`)
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000)
    const details = { calls, totalProcessed, lastBatchId, duration, debugLogs }

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
