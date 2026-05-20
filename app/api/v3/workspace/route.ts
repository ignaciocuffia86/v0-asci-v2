import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import { getWorkspaceForUser, workspaceHasDocuments } from "@/lib/v3/workspace"

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  
  if (authError || !user) {
    return NextResponse.json(
      { error: "No autorizado" },
      { status: 401 }
    )
  }
  
  const workspace = await getWorkspaceForUser(user.id)
  
  if (!workspace) {
    return NextResponse.json(
      { workspace: null, hasDocuments: false },
      { status: 200 }
    )
  }
  
  const hasDocuments = await workspaceHasDocuments(workspace.id)
  
  return NextResponse.json({
    workspace: {
      id: workspace.id,
      name: workspace.name,
      domain: workspace.domain,
      role: workspace.member.role,
    },
    hasDocuments,
  })
}
