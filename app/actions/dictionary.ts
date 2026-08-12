"use server"

import { createClient } from "@supabase/supabase-js"
import { requireSuperadmin } from "@/lib/auth/require-superadmin"

export async function processDictionaryJobs() {
  const auth = await requireSuperadmin()
  if ("error" in auth) return { success: false, error: auth.error }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const startTime = Date.now()
  const MAX_EXECUTION_TIME = 25000 // 25 seconds para server actions
  let totalJobsProcessed = 0
  let totalSignalsAffected = 0

  try {
    // Process ONE job at a time until completed, then move to next.
    // This avoids round-robin across many jobs and finishes each faster.
    while (Date.now() - startTime < MAX_EXECUTION_TIME) {
      // Pick the single oldest job, preferring ones already in progress
      const { data: job, error: jobsError } = await supabase
        .from("dictionary_jobs")
        .select("*")
        .in("status", ["processing", "pending"])
        .order("status", { ascending: false }) // 'processing' first (alphabetically after 'pending')
        .order("created_at", { ascending: true })
        .limit(1)
        .single()

      if (jobsError || !job) {
        break
      }

      // Pump this single job repeatedly until it completes or we run out of time
      let jobDone = false
      while (!jobDone && Date.now() - startTime < MAX_EXECUTION_TIME) {
        const { data: result, error: rpcError } = await supabase.rpc("process_dictionary_job", {
          p_job_id: job.id,
          p_batch_size: 1000,
        })

        if (rpcError) {
          await supabase
            .from("dictionary_jobs")
            .update({
              status: "failed",
              error_message: rpcError.message,
              completed_at: new Date().toISOString(),
            })
            .eq("id", job.id)
          jobDone = true
          continue
        }

        const jobResult = result as {
          success: boolean
          has_more?: boolean
          signals_created?: number
          deleted_count?: number
        }

        totalSignalsAffected += jobResult.signals_created || jobResult.deleted_count || 0

        if (!jobResult.has_more) {
          // Job completed, move to next
          totalJobsProcessed++
          jobDone = true
        }
      }
    }

    return {
      success: true,
      processed: totalJobsProcessed,
      signalsAffected: totalSignalsAffected,
    }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function getPendingDictionaryJobs() {
  const auth = await requireSuperadmin()
  if ("error" in auth) return { jobs: [], count: 0 }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Use exact count to get the real total, not capped by limit
  const [countRes, dataRes] = await Promise.all([
    supabase
      .from("dictionary_jobs")
      .select("*", { count: "exact", head: true })
      .in("status", ["pending", "processing"]),
    supabase
      .from("dictionary_jobs")
      .select("id, job_type, keyword, status, created_at")
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: true })
      .limit(50),
  ])

  if (dataRes.error) {
    return { jobs: [], count: 0 }
  }

  return { jobs: dataRes.data || [], count: countRes.count || 0 }
}
