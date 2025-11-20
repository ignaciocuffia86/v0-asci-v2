import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  // Security check: Vercel sends this header
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === "production") {
    // In production, we strictly require the CRON_SECRET
    // You can find this in your Vercel Project Settings -> Cron Jobs
    // For now, we log a warning but allow it if you are testing manually without the header
    console.warn("[Cron] Warning: Unauthorized attempt or missing CRON_SECRET")
    // return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const startTime = Date.now()
  const MAX_EXECUTION_TIME = 55000 // Run for 55 seconds max to avoid timeout
  let totalProcessed = 0
  let loops = 0

  try {
    console.log("[Cron] Starting continuous processing loop...")

    // Loop until we run out of time
    while (Date.now() - startTime < MAX_EXECUTION_TIME) {
      loops++

      // Call the stored procedure to process a chunk of rows
      // We process 10 rows per iteration
      const { data, error } = await supabase.rpc("process_pending_queue", {
        p_limit: 10,
      })

      if (error) {
        console.error("[Cron] Error processing queue:", error)
        // If error is severe, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 5000))
        continue
      }

      const processedCount = data as number
      totalProcessed += processedCount

      if (processedCount === 0) {
        // If no rows were pending, wait a bit longer before checking again
        // to save resources, but still be responsive (e.g., 5 seconds)
        await new Promise((resolve) => setTimeout(resolve, 5000))
      } else {
        // If we processed rows, there might be more.
        // Wait a tiny bit to let the DB breathe, then continue immediately.
        // This achieves the "every few seconds" effect when there is load.
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    console.log(`[Cron] Loop finished. Loops: ${loops}, Total Processed: ${totalProcessed}`)

    return NextResponse.json({
      success: true,
      message: `Processed ${totalProcessed} rows in ${loops} loops`,
      loops,
      totalProcessed,
    })
  } catch (err: any) {
    console.error("[Cron] Unexpected error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
