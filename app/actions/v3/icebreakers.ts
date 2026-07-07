"use server"

import { createClient } from "@/lib/supabase/server"
import { requireWorkspace } from "@/lib/v3/workspace"
import { setIcebreakerFeedback as setFeedbackService } from "@/lib/v3/services/icebreakers"

export async function setIcebreakerFeedback(
  icebreakerId: string,
  feedback: 1 | -1,
  note?: string
): Promise<{ success: boolean }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false }

  let workspace
  try {
    workspace = await requireWorkspace(user.id)
  } catch {
    return { success: false }
  }

  return setFeedbackService({ icebreakerId, workspaceId: workspace.id, feedback, note })
}
