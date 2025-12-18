"use server"

import { createClient } from "@supabase/supabase-js"

export async function processDictionaryJobs() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const startTime = Date.now()
  const MAX_EXECUTION_TIME = 25000 // 25 seconds para server actions
  let totalJobsProcessed = 0
  let totalSignalsAffected = 0

  try {
    // Procesar jobs pendientes
    while (Date.now() - startTime < MAX_EXECUTION_TIME) {
      const { data: jobs, error: jobsError } = await supabase
        .from("dictionary_jobs")
        .select("*")
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: true })
        .limit(10)

      if (jobsError) {
        return { success: false, error: jobsError.message }
      }

      if (!jobs || jobs.length === 0) {
        break
      }

      for (const job of jobs) {
        if (Date.now() - startTime >= MAX_EXECUTION_TIME) break

        const { data: result, error: rpcError } = await supabase.rpc("process_dictionary_job", {
          p_job_id: job.id,
          p_batch_size: 500,
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
          continue
        }

        const jobResult = result as {
          success: boolean
          signals_created?: number
          deleted_count?: number
        }

        if (jobResult.success) {
          totalJobsProcessed++
          totalSignalsAffected += jobResult.signals_created || jobResult.deleted_count || 0
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
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data, error } = await supabase
    .from("dictionary_jobs")
    .select("id, job_type, keyword, status, created_at")
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: true })
    .limit(50)

  if (error) {
    return { jobs: [], count: 0 }
  }

  return { jobs: data || [], count: data?.length || 0 }
}
