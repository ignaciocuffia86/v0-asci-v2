import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { runResearchJob } from "./research-pipeline"

const MAX_RETRIES_PER_RUN = 3

export async function recoverResearchJobs() {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: expired } = await admin
    .schema("v3")
    .from("research_jobs")
    .select("id, attempt_count, max_attempts")
    .eq("status", "running")
    .lt("lease_expires_at", now)
    .limit(25)

  let leasesRecovered = 0
  for (const job of expired ?? []) {
    const canRetry = (job.attempt_count ?? 0) < (job.max_attempts ?? 3)
    await admin
      .schema("v3")
      .from("research_jobs")
      .update({
        status: canRetry ? "failed_retriable" : "failed_terminal",
        error_code: "LEASE_EXPIRED",
        error: "El worker dejó de enviar heartbeat antes de finalizar.",
        last_error_at: now,
        next_retry_at: canRetry ? now : null,
        worker_id: null,
      })
      .eq("id", job.id)
      .eq("status", "running")
    leasesRecovered += 1
  }

  const { data: retryable } = await admin
    .schema("v3")
    .from("research_jobs")
    .select("id")
    .eq("status", "failed_retriable")
    .lte("next_retry_at", now)
    .order("next_retry_at", { ascending: true })
    .limit(MAX_RETRIES_PER_RUN)

  const retried: string[] = []
  for (const job of retryable ?? []) {
    const { data: claimed } = await admin
      .schema("v3")
      .from("research_jobs")
      .update({ status: "pending", current_step: "retry_queued", progress: 0 })
      .eq("id", job.id)
      .eq("status", "failed_retriable")
      .select("id")
      .maybeSingle()

    if (!claimed) continue
    retried.push(job.id)
    await runResearchJob(job.id)
  }

  return { leasesRecovered, retried }
}
