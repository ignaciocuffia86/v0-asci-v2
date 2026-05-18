import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace, getWorkspaceMembers } from "@/lib/v3/workspace"
import { WorkspaceSettingsView } from "./_components/workspace-settings-view"
import { redirect } from "next/navigation"

export default async function WorkspaceSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) redirect("/auth/login?next=/v3/settings/workspace")
  
  const workspace = await getCurrentWorkspace(user.id)
  
  if (!workspace) {
    redirect("/v3/onboarding")
  }
  
  const members = await getWorkspaceMembers(workspace.id)
  
  // Verificar si el usuario actual es admin
  const currentMember = members.find(m => m.user_id === user.id)
  const isAdmin = currentMember?.role === "admin"
  
  return (
    <WorkspaceSettingsView 
      workspace={workspace}
      members={members}
      currentUserId={user.id}
      isAdmin={isAdmin}
    />
  )
}
