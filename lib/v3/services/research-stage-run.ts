import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

export async function runMeasuredStage<T>(input: {
  researchJobId: string
  stage: string
  provider?: string
  model?: string
  execute: () => Promise<T>
}): Promise<T> {
  const admin = createAdminClient()
  const startedAt = Date.now()
  const { data: run } = await admin
    .schema("v3")
    .from("research_stage_runs")
    .insert({
      research_job_id: input.researchJobId,
      stage: input.stage,
      status: "running",
      provider: input.provider ?? null,
      model: input.model ?? null,
      started_at: new Date(startedAt).toISOString(),
    })
    .select("id")
    .single()

  try {
    const result = await input.execute()
    if (run?.id) {
      await admin
        .schema("v3")
        .from("research_stage_runs")
        .update({
          status: "completed",
          duration_ms: Date.now() - startedAt,
          finished_at: new Date().toISOString(),
        })
        .eq("id", run.id)
    }
    return result
  } catch (error) {
    if (run?.id) {
      await admin
        .schema("v3")
        .from("research_stage_runs")
        .update({
          status: "failed",
          duration_ms: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
          finished_at: new Date().toISOString(),
        })
        .eq("id", run.id)
    }
    throw error
  }
}
