"use server"

import { createClient } from "@/lib/supabase/server"

export async function processSignals(batchSize = 10) {
  const supabase = await createClient()

  // Call the background processing function manually
  // This function (process_pending_queue) picks the oldest pending batch and processes a chunk
  const { data, error } = await supabase.rpc("process_pending_queue", {
    p_limit: batchSize,
  })

  if (error) {
    console.error("Error processing queue:", error)
    return { success: false, error: error.message }
  }

  // data is the number of processed rows returned by the function
  const processedCount = (data as number) || 0

  return {
    success: true,
    processed: processedCount,
    errors: 0, // Errors are handled internally by the SQL function (marked as failed rows)
    remaining: 0, // The UI will fetch stats to see remaining
  }
}

export async function getProcessingStats() {
  const supabase = await createClient()

  // Get pending rows from import_rows (the source of truth for the ETL)
  const { count: pendingCount } = await supabase
    .from("import_rows")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending")

  // Get total signals
  const { count: totalSignals } = await supabase.from("signals").select("*", { count: "exact", head: true })

  // Check if there are any active batches (processing)
  const { count: processingBatches } = await supabase
    .from("import_batches")
    .select("*", { count: "exact", head: true })
    .eq("status", "processing")

  return {
    pending: pendingCount || 0,
    signals: totalSignals || 0,
    // System is processing if there are pending rows or batches marked as processing
    isSystemProcessing: (pendingCount || 0) > 0 || (processingBatches || 0) > 0,
  }
}
