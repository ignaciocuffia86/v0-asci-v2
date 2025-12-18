import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  // Security check: Vercel sends this header
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === "production") {
    console.warn("[Cron] Warning: Unauthorized attempt or missing CRON_SECRET")
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const startTime = Date.now()
  const MAX_EXECUTION_TIME = 55000 // Run for 55 seconds max to avoid timeout
  let totalProcessed = 0
  let batchesProcessed = 0
  let loops = 0

  try {
    console.log("[Cron] Starting import batch processing...")

    while (Date.now() - startTime < MAX_EXECUTION_TIME) {
      loops++

      // Fetch pending/processing batches
      const { data: batches, error: batchError } = await supabase
        .from("import_batches")
        .select("id, batch_type")
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: true })
        .limit(3) // Process max 3 batches per loop

      if (batchError) {
        console.error("[Cron] Error fetching batches:", batchError)
        await new Promise((resolve) => setTimeout(resolve, 5000))
        continue
      }

      if (!batches || batches.length === 0) {
        console.log("[Cron] No pending batches found, waiting...")
        await new Promise((resolve) => setTimeout(resolve, 5000))
        continue
      }

      // Process each batch with the new process_import_batch function
      for (const batch of batches) {
        try {
          console.log(`[Cron] Processing batch ${batch.id} (${batch.batch_type})...`)

          const { data: result, error: processError } = await supabase.rpc("process_import_batch", {
            p_batch_id: batch.id,
            p_chunk_size: 100,
          })

          if (processError) {
            console.error(`[Cron] Error processing batch ${batch.id}:`, processError)
            continue
          }

          console.log(`[Cron] Batch result:`, result)

          if (result?.status === "completed") {
            totalProcessed += result.total_processed || 0
            batchesProcessed += 1
            console.log(
              `[Cron] Batch ${batch.id} completed. Processed: ${result.total_processed} rows in ${result.iterations} iterations`,
            )
          } else if (result?.status === "partial") {
            totalProcessed += result.processed_this_call || 0
            console.log(
              `[Cron] Batch ${batch.id} partial. Processed: ${result.processed_this_call} rows. ${result.pending_remaining} remaining. Will retry on next cron.`,
            )
          }

          // Small delay between batches
          await new Promise((resolve) => setTimeout(resolve, 1000))
        } catch (batchErr: any) {
          console.error(`[Cron] Unexpected error processing batch ${batch.id}:`, batchErr)
        }
      }
    }

    console.log(
      `[Cron] Loop finished. Loops: ${loops}, Batches Processed: ${batchesProcessed}, Total Rows: ${totalProcessed}`,
    )

    return NextResponse.json({
      success: true,
      message: `Processed ${totalProcessed} rows in ${batchesProcessed} batches`,
      loops,
      batchesProcessed,
      totalProcessed,
    })
  } catch (err: any) {
    console.error("[Cron] Unexpected error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
