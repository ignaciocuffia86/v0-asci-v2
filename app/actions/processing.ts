"use server"

import { createClient } from "@/lib/supabase/server"

export async function processSignals(batchSize = 10) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("process_pending_queue", {
    p_limit: batchSize,
  })

  if (error) {
    console.error("Error processing queue:", error)
    return { success: false, error: error.message }
  }

  const processedCount = (data as number) || 0

  return {
    success: true,
    processed: processedCount,
    errors: 0,
    remaining: 0,
  }
}

export async function getProcessingStats() {
  const supabase = await createClient()

  const { data: stats, error } = await supabase.rpc("get_processing_stats")

  if (error) {
    console.error("Error getting processing stats:", error)
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
      signals: 0,
      isSystemProcessing: (pendingCount || 0) > 0 || (processingBatches || 0) > 0,
    }
  }

  return {
    pending: stats?.pending || 0,
    signals: stats?.signals || 0,
    isSystemProcessing: (stats?.pending || 0) > 0 || (stats?.processing_batches || 0) > 0,
  }
}

interface DashboardCounts {
  signals_total: number
  signals_process: number
  signals_technology: number
  contacts_total: number
  companies_total: number
  dictionary_processes: number
  dictionary_products: number
  dictionary_vendors: number
  jobs_pending: number
  jobs_processing: number
  jobs_completed: number
  jobs_failed: number
  keywords_process: number
  keywords_technology: number
  batches_pending: number
  batches_processing: number
  batches_completed: number
  batches_failed: number
}

interface CronExecution {
  status: string | null
  started_at: string | null
  completed_at: string | null
  records_processed: number | null
  signals_created?: number | null
  error_message: string | null
}

interface CronStatus {
  process_dictionary: CronExecution | null
  process_queue: CronExecution | null
  monitor: CronExecution | null
  sync_users: CronExecution | null
}

export async function getDashboardStats() {
  const supabase = await createClient()

  try {
    // Use the new RPC for accurate counts (no 1000 cap)
    const { data: counts, error: countsError } = await supabase.rpc("get_dashboard_counts")

    if (countsError) {
      console.error("Error getting dashboard counts:", countsError)
      return null
    }

    const c = counts as DashboardCounts

    return {
      signals: {
        total: c.signals_total,
        byType: {
          process: c.signals_process,
          technology: c.signals_technology,
        },
      },
      dictionaryJobs: {
        pending: c.jobs_pending,
        processing: c.jobs_processing,
        completed: c.jobs_completed,
        failed: c.jobs_failed,
        total: c.jobs_pending + c.jobs_processing + c.jobs_completed + c.jobs_failed,
      },
      importBatches: {
        pending: c.batches_pending,
        processing: c.batches_processing,
        completed: c.batches_completed,
        failed: c.batches_failed,
        total: c.batches_pending + c.batches_processing + c.batches_completed + c.batches_failed,
      },
      entities: {
        contacts: c.contacts_total,
        companies: c.companies_total,
      },
      dictionary: {
        processes: c.dictionary_processes,
        products: c.dictionary_products,
        vendors: c.dictionary_vendors,
        processKeywords: c.keywords_process,
        productKeywords: c.keywords_technology,
      },
    }
  } catch (error) {
    console.error("Error getting dashboard stats:", error)
    return null
  }
}

export async function getCronHealth() {
  const supabase = await createClient()

  try {
    // Use the new RPC for cron status
    const { data: cronStatus, error: cronError } = await supabase.rpc("get_cron_status")

    if (cronError) {
      console.error("Error getting cron status:", cronError)
      // Fallback to legacy method
      return getLegacyCronHealth(supabase)
    }

    const status = cronStatus as CronStatus
    const now = new Date()

    const formatCronStatus = (execution: CronExecution | null, intervalMinutes: number) => {
      if (!execution || !execution.started_at) {
        return { status: "unknown", lastRun: null, minutesAgo: null, recordsProcessed: 0, signalsCreated: 0 }
      }

      const lastRun = new Date(execution.started_at)
      const minutesAgo = Math.floor((now.getTime() - lastRun.getTime()) / 60000)
      const healthStatus =
        execution.status === "failed"
          ? "critical"
          : minutesAgo <= intervalMinutes * 2
            ? "healthy"
            : minutesAgo <= intervalMinutes * 4
              ? "warning"
              : "critical"

      return {
        status: healthStatus,
        lastRun: execution.started_at,
        completedAt: execution.completed_at,
        minutesAgo,
        recordsProcessed: execution.records_processed || 0,
        signalsCreated: execution.signals_created || 0,
        errorMessage: execution.error_message,
        executionStatus: execution.status,
      }
    }

    return {
      processDictionary: formatCronStatus(status.process_dictionary, 5),
      processQueue: formatCronStatus(status.process_queue, 5),
      monitor: formatCronStatus(status.monitor, 15),
      syncUsers: formatCronStatus(status.sync_users, 1440), // 24 hours
    }
  } catch (error) {
    console.error("Error getting cron health:", error)
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLegacyCronHealth(supabase: any) {
  // Fallback: Get last activity for each cron by checking related tables
  const [lastDictionaryJob, lastImportBatch] = await Promise.all([
    supabase
      .from("dictionary_jobs")
      .select("started_at, completed_at, status")
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .single(),
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
    monitor: { status: "unknown", lastRun: null, minutesAgo: null },
    syncUsers: { status: "unknown", lastRun: null, minutesAgo: null },
  }
}

// Get signal processing activity from debug_events
export async function getSignalProcessingActivity() {
  const supabase = await createClient()

  try {
    // Get summary of recent processing activity
    const [recentBatches, eventSummary, pendingSignals] = await Promise.all([
      // Last 10 batch processed events
      supabase
        .from("debug_events")
        .select("event_type, message, details, created_at")
        .eq("event_type", "signals_batch_processed")
        .order("created_at", { ascending: false })
        .limit(10),
      // Event type summary
      supabase
        .from("debug_events")
        .select("event_type")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      // Pending signals count
      supabase
        .from("pending_signals")
        .select("id", { count: "exact", head: true })
        .is("processed_at", null),
    ])

    // Count events by type in last 24h
    const eventCounts: Record<string, number> = {}
    if (eventSummary.data) {
      for (const event of eventSummary.data) {
        eventCounts[event.event_type] = (eventCounts[event.event_type] || 0) + 1
      }
    }

    // Calculate total signals processed in recent batches
    let totalProcessedRecently = 0
    const batches = recentBatches.data || []
    for (const batch of batches) {
      const details = batch.details as { total_processed?: number; count?: number } | null
      totalProcessedRecently += details?.total_processed || details?.count || 0
    }

    return {
      pendingSignals: pendingSignals.count || 0,
      recentBatches: batches.map((b) => ({
        type: b.event_type,
        message: b.message,
        details: b.details,
        createdAt: b.created_at,
      })),
      last24hEvents: eventCounts,
      totalProcessedRecently,
      lastProcessedAt: batches[0]?.created_at || null,
    }
  } catch (error) {
    console.error("Error getting signal processing activity:", error)
    return null
  }
}

// Helper to register a cron execution start
export async function registerCronStart(cronName: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("cron_executions")
    .insert({
      cron_name: cronName,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (error) {
    console.error(`Error registering cron start for ${cronName}:`, error)
    return null
  }

  return data.id
}

// Helper to register a cron execution completion
export async function registerCronComplete(
  executionId: string,
  status: "completed" | "failed",
  metrics?: {
    recordsProcessed?: number
    recordsFailed?: number
    signalsCreated?: number
    errorMessage?: string
    details?: Record<string, unknown>
  }
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("cron_executions")
    .update({
      status,
      completed_at: new Date().toISOString(),
      records_processed: metrics?.recordsProcessed || 0,
      records_failed: metrics?.recordsFailed || 0,
      signals_created: metrics?.signalsCreated || 0,
      error_message: metrics?.errorMessage || null,
      details: metrics?.details || {},
    })
    .eq("id", executionId)

  if (error) {
    console.error(`Error completing cron execution ${executionId}:`, error)
  }
}
