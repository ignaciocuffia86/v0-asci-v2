import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { requireWorkspace } from "@/lib/v3/workspace"
import { getBatchStatus } from "@/lib/v3/services"

export async function GET(_req: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response("Unauthorized", { status: 401 })

  let workspace
  try {
    workspace = await requireWorkspace(user.id)
  } catch {
    return new Response("Workspace required", { status: 403 })
  }

  const jobs = await getBatchStatus(batchId, workspace.id)
  return NextResponse.json({
    batchId,
    jobs: jobs.map((j) => ({
      id: j.id,
      companyInput: j.company_input,
      companyId: j.company_id,
      status: j.status,
      currentStep: j.current_step,
      phase: j.phase,
      progress: j.progress,
      preliminaryReadyAt: j.preliminary_ready_at,
      errorCode: j.error_code,
      error: j.error,
    })),
    done: jobs.length > 0 && jobs.every((j) => ["completed", "completed_with_warnings", "failed_terminal", "cancelled"].includes(j.status)),
  })
}
