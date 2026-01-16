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

export async function getDashboardStats() {
  const supabase = await createClient()

  try {
    // Parallel queries for all stats
    const [
      signalsResult,
      dictionaryJobsResult,
      importBatchesResult,
      contactsResult,
      companiesResult,
      dictionaryProcessesResult,
      dictionaryProductsResult,
      dictionaryVendorsResult,
    ] = await Promise.all([
      // Total signals by type
      supabase
        .from("signals")
        .select("signal_type"),
      // Dictionary jobs by status
      supabase
        .from("dictionary_jobs")
        .select("status, created_at, completed_at, started_at"),
      // Import batches by status
      supabase
        .from("import_batches")
        .select("status, updated_at"),
      // Total contacts
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true }),
      // Total companies
      supabase
        .from("companies")
        .select("id", { count: "exact", head: true }),
      // Dictionary processes with keywords
      supabase
        .from("dictionary_processes")
        .select("id, keywords"),
      // Dictionary products with keywords
      supabase
        .from("dictionary_products")
        .select("id, keywords"),
      // Dictionary vendors
      supabase
        .from("dictionary_vendors")
        .select("id", { count: "exact", head: true }),
    ])

    // Process signals by type
    const signalsByType = { process: 0, technology: 0 }
    if (signalsResult.data) {
      for (const signal of signalsResult.data) {
        if (signal.signal_type === "process") signalsByType.process++
        else if (signal.signal_type === "technology") signalsByType.technology++
      }
    }

    // Process dictionary jobs by status
    const dictionaryJobs = { pending: 0, processing: 0, completed: 0, failed: 0 }
    let lastJobCompleted: string | null = null
    let lastJobCreated: string | null = null
    if (dictionaryJobsResult.data) {
      for (const job of dictionaryJobsResult.data) {
        dictionaryJobs[job.status as keyof typeof dictionaryJobs]++
        if (job.completed_at && (!lastJobCompleted || job.completed_at > lastJobCompleted)) {
          lastJobCompleted = job.completed_at
        }
        if (job.created_at && (!lastJobCreated || job.created_at > lastJobCreated)) {
          lastJobCreated = job.created_at
        }
      }
    }

    // Process import batches by status
    const importBatches = { pending: 0, processing: 0, completed: 0, failed: 0 }
    let lastBatchActivity: string | null = null
    if (importBatchesResult.data) {
      for (const batch of importBatchesResult.data) {
        importBatches[batch.status as keyof typeof importBatches]++
        if (batch.updated_at && (!lastBatchActivity || batch.updated_at > lastBatchActivity)) {
          lastBatchActivity = batch.updated_at
        }
      }
    }

    let processKeywordsCount = 0
    let productKeywordsCount = 0

    if (dictionaryProcessesResult.data) {
      for (const process of dictionaryProcessesResult.data) {
        processKeywordsCount += process.keywords?.length || 0
      }
    }

    if (dictionaryProductsResult.data) {
      for (const product of dictionaryProductsResult.data) {
        productKeywordsCount += product.keywords?.length || 0
      }
    }

    return {
      signals: {
        total: signalsByType.process + signalsByType.technology,
        byType: signalsByType,
      },
      dictionaryJobs: {
        ...dictionaryJobs,
        total: dictionaryJobs.pending + dictionaryJobs.processing + dictionaryJobs.completed + dictionaryJobs.failed,
        lastCompleted: lastJobCompleted,
        lastCreated: lastJobCreated,
      },
      importBatches: {
        ...importBatches,
        total: importBatches.pending + importBatches.processing + importBatches.completed + importBatches.failed,
        lastActivity: lastBatchActivity,
      },
      entities: {
        contacts: contactsResult.count || 0,
        companies: companiesResult.count || 0,
      },
      dictionary: {
        processes: dictionaryProcessesResult.data?.length || 0,
        products: dictionaryProductsResult.data?.length || 0,
        vendors: dictionaryVendorsResult.count || 0,
        processKeywords: processKeywordsCount,
        productKeywords: productKeywordsCount,
      },
    }
  } catch (error) {
    console.error("Error getting dashboard stats:", error)
    return null
  }
}

export async function getCronHealth() {
  const supabase = await createClient()

  // Get last activity for each cron by checking related tables
  const [lastDictionaryJob, lastImportBatch] = await Promise.all([
    // process-dictionary cron - check last dictionary job activity
    supabase
      .from("dictionary_jobs")
      .select("started_at, completed_at, status")
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .single(),
    // process-queue cron - check last import batch activity
    supabase
      .from("import_batches")
      .select("updated_at, status")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single(),
  ])

  const now = new Date()

  const getCronStatus = (lastActivity: string | null, intervalMinutes: number) => {
    if (!lastActivity) return { status: "unknown", lastRun: null, minutesAgo: null }
    const lastRun = new Date(lastActivity)
    const minutesAgo = Math.floor((now.getTime() - lastRun.getTime()) / 60000)
    const status =
      minutesAgo <= intervalMinutes * 2 ? "healthy" : minutesAgo <= intervalMinutes * 4 ? "warning" : "critical"
    return { status, lastRun: lastActivity, minutesAgo }
  }

  return {
    processDictionary: getCronStatus(lastDictionaryJob.data?.started_at || lastDictionaryJob.data?.completed_at, 5),
    processQueue: getCronStatus(lastImportBatch.data?.updated_at, 5),
    monitor: { status: "unknown", lastRun: null, minutesAgo: null }, // No table to track monitor cron
  }
}
