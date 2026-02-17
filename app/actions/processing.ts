"use server"

import { createClient } from "@/lib/supabase/server"

// ─── Dashboard totals (contacts, companies, signals, job_postings) ───
export async function getDashboardCounts() {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_dashboard_counts")
  if (error) {
    console.error("Error getting dashboard counts:", error)
    return null
  }
  return data as {
    signals_total: number
    signals_process: number
    signals_technology: number
    contacts_total: number
    companies_total: number
    dictionary_processes: number
    dictionary_products: number
    dictionary_vendors: number
    keywords_process: number
    keywords_technology: number
    batches_pending: number
    batches_processing: number
    batches_completed: number
    batches_failed: number
    jobs_pending: number
    jobs_processing: number
    jobs_completed: number
    jobs_failed: number
  }
}

// ─── Import batches with row-level progress ───
export async function getImportBatches(limit = 20) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("import_batches")
    .select("id, filename, batch_type, status, total_rows, processed_rows, failed_rows, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("Error getting import batches:", error)
    return []
  }

  return data || []
}

// ─── Import row status breakdown for a given batch ───
export async function getBatchRowBreakdown(batchId: string) {
  const supabase = await createClient()

  const [processed, pending, failed] = await Promise.all([
    supabase.from("import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batchId).eq("status", "processed"),
    supabase.from("import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batchId).eq("status", "pending"),
    supabase.from("import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batchId).eq("status", "failed"),
  ])

  return {
    processed: processed.count || 0,
    pending: pending.count || 0,
    failed: failed.count || 0,
  }
}

// ─── Failed row error breakdown for a batch ───
export async function getBatchErrors(batchId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("import_rows")
    .select("error_message")
    .eq("batch_id", batchId)
    .eq("status", "failed")
    .limit(500)

  if (error || !data) return []

  // Group by error message
  const grouped: Record<string, number> = {}
  for (const row of data) {
    const msg = row.error_message || "Unknown error"
    grouped[msg] = (grouped[msg] || 0) + 1
  }

  return Object.entries(grouped)
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count)
}

// ─── Cron health from cron_executions table ───
export async function getCronHealth() {
  const supabase = await createClient()

  const cronNames = ["process-queue", "process-dictionary", "monitor", "sync-users", "cleanup"]

  const results = await Promise.all(
    cronNames.map(async (name) => {
      const { data } = await supabase
        .from("cron_executions")
        .select("cron_name, status, started_at, completed_at, records_processed, error_message")
        .eq("cron_name", name)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      return { name, execution: data }
    })
  )

  const intervals: Record<string, number> = {
    "process-queue": 1,
    "process-dictionary": 1,
    "monitor": 15,
    "sync-users": 1440,
    "cleanup": 10080, // weekly
  }

  const labels: Record<string, string> = {
    "process-queue": "Procesamiento de Cola",
    "process-dictionary": "Procesamiento de Diccionario",
    "monitor": "Monitor de Salud",
    "sync-users": "Sincronizacion de Usuarios",
    "cleanup": "Limpieza de Datos",
  }

  const now = new Date()

  return results.map(({ name, execution }) => {
    if (!execution?.started_at) {
      return { name, label: labels[name] || name, status: "unknown" as const, lastRun: null, minutesAgo: null, recordsProcessed: 0, error: null }
    }

    const lastRun = new Date(execution.started_at)
    const minutesAgo = Math.floor((now.getTime() - lastRun.getTime()) / 60000)
    const interval = intervals[name] || 5

    let status: "healthy" | "warning" | "critical" | "unknown"
    if (execution.status === "failed") {
      status = "critical"
    } else if (minutesAgo <= interval * 2.5) {
      status = "healthy"
    } else if (minutesAgo <= interval * 5) {
      status = "warning"
    } else {
      status = "critical"
    }

    return {
      name,
      label: labels[name] || name,
      status,
      lastRun: execution.started_at,
      completedAt: execution.completed_at,
      minutesAgo,
      recordsProcessed: execution.records_processed || 0,
      error: execution.error_message,
      executionStatus: execution.status,
    }
  })
}

// ─── Recent processing activity from debug_events ───
export async function getRecentActivity(limit = 30) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("debug_events")
    .select("event_type, message, details, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("Error getting recent activity:", error)
    return []
  }

  return data || []
}

// ─── Pending signals count ───
export async function getPendingSignalsCount() {
  const supabase = await createClient()

  const { count } = await supabase
    .from("pending_signals")
    .select("id", { count: "exact", head: true })
    .is("processed_at", null)

  return count || 0
}

// ─── Dictionary jobs status ───
export async function getDictionaryJobs(limit = 10) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("dictionary_jobs")
    .select("id, job_type, signal_type, keyword, status, progress, total_records, processed_records, created_at, completed_at, error_message, phase, contacts_processed, contacts_total, job_postings_processed, job_postings_total")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("Error getting dictionary jobs:", error)
    return []
  }

  return data || []
}
