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

  const { data: stats, error } = await supabase.rpc("get_processing_stats")

  if (error) {
    console.error("Error getting processing stats:", error)
    // Fallback to individual queries if RPC fails
    const { count: pendingCount } = await supabase
      .from("import_rows")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")

    const { count: processingBatches } = await supabase
      .from("import_batches")
      .select("*", { count: "exact", head: true })
      .eq("status", "processing")

    return {
      pending: pendingCount || 0,
      signals: 0, // Skip signals count on error
      isSystemProcessing: (pendingCount || 0) > 0 || (processingBatches || 0) > 0,
    }
  }

  return {
    pending: stats?.pending || 0,
    signals: stats?.signals || 0,
    isSystemProcessing: (stats?.pending || 0) > 0 || (stats?.processing_batches || 0) > 0,
  }
}
