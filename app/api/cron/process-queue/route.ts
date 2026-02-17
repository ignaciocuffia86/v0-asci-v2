import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === "production") {
    console.warn("[Cron] Unauthorized attempt or missing CRON_SECRET")
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Register cron execution start
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
  const MAX_EXECUTION_TIME = 50000 // 50 seconds to leave margin
  let totalProcessed = 0
  let batchesProcessed = 0
  let loops = 0
  const errors: string[] = []

  try {
    console.log("[Cron] Starting import batch processing...")

    while (Date.now() - startTime < MAX_EXECUTION_TIME) {
      loops++

      // Fetch pending/processing batches - NEWEST first so recent uploads get priority
      const { data: batches, error: batchError } = await supabase
        .from("import_batches")
        .select("id, batch_type")
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(3)

      if (batchError) {
        console.error("[Cron] Error fetching batches:", batchError.message)
        errors.push(`Fetch error: ${batchError.message}`)
        break
      }

      if (!batches || batches.length === 0) {
        console.log("[Cron] No pending batches found. Done.")
        break
      }

      console.log(`[Cron] Loop ${loops}: Found ${batches.length} batches`)

      for (const batch of batches) {
        if (Date.now() - startTime >= MAX_EXECUTION_TIME) break

        try {
          console.log(`[Cron] Processing batch ${batch.id} (${batch.batch_type})`)

          const { data: result, error: processError } = await supabase.rpc("process_import_batch", {
            p_batch_id: batch.id,
            p_chunk_size: 100,
          })

          if (processError) {
            console.error(`[Cron] RPC error for ${batch.id}:`, processError.message)
            errors.push(`Batch ${batch.id}: ${processError.message}`)
            continue
          }

          // Supabase-js returns jsonb as a parsed object directly
          const res = typeof result === "string" ? JSON.parse(result) : result
          console.log(`[Cron] Batch ${batch.id} result:`, JSON.stringify(res))

          if (res?.status === "completed") {
            totalProcessed += res.total_processed || 0
            batchesProcessed++
          } else if (res?.status === "partial") {
            totalProcessed += res.processed_this_call || 0
          } else if (res?.status === "error") {
            errors.push(`Batch ${batch.id}: ${res.message}`)
          }

          // Small delay between batches to avoid overloading
          await new Promise((resolve) => setTimeout(resolve, 500))
        } catch (batchErr: any) {
          console.error(`[Cron] Unexpected error for ${batch.id}:`, batchErr.message)
          errors.push(`Batch ${batch.id}: ${batchErr.message}`)
        }
      }

      // Small delay between loops
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    const duration = Math.round((Date.now() - startTime) / 1000)
    console.log(`[Cron] Done. ${duration}s, ${loops} loops, ${batchesProcessed} completed, ${totalProcessed} rows`)

    if (executionId) {
      await supabase
        .from("cron_executions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          records_processed: totalProcessed,
          details: { loops, batchesProcessed, duration, errors: errors.length > 0 ? errors : undefined },
        })
        .eq("id", executionId)
    }

    return NextResponse.json({
      success: true,
      loops,
      batchesProcessed,
      totalProcessed,
      duration,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err: any) {
    console.error("[Cron] Fatal error:", err.message)

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
