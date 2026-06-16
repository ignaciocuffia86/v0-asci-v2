import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace, getWorkspaceMembers } from "@/lib/v3/workspace"
import { getPendingInvitations } from "@/lib/v3/invitations"
import { WorkspaceSettingsView } from "./_components/workspace-settings-view"
import { redirect } from "next/navigation"

export default async function WorkspaceSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/auth/login?next=/v3/settings/workspace")

  const workspace = await getCurrentWorkspace(user.id)

  if (!workspace) {
    redirect("/v3/onboarding")
  }

  const members = await getWorkspaceMembers(workspace.id)

  // Verificar si el usuario actual es admin
  const currentMember = members.find((m) => m.user_id === user.id)
  const isAdmin = currentMember?.role === "admin"

  // Solo los admins ven las invitaciones pendientes
  const pendingInvitations = isAdmin ? await getPendingInvitations(workspace.id) : []

  return (
    <WorkspaceSettingsView
      workspace={workspace}
      members={members}
      pendingInvitations={pendingInvitations}
      currentUserId={user.id}
      isAdmin={isAdmin}
    />
  )
}
