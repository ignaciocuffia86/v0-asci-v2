import { createClient } from "@/lib/supabase/server"
import { getInvitationByToken } from "@/lib/v3/invitations"
import { getWorkspaceById } from "@/lib/v3/workspace"
import { InviteView } from "./_components/invite-view"

interface InvitePageProps {
  params: Promise<{ token: string }>
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params

  const invitation = await getInvitationByToken(token)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Estado de la invitación
  let invitationState: "valid" | "not_found" | "used" | "revoked" | "expired" = "valid"
  let workspaceName: string | null = null

  if (!invitation) {
    invitationState = "not_found"
  } else if (invitation.status === "accepted") {
    invitationState = "used"
  } else if (invitation.status === "revoked") {
    invitationState = "revoked"
  } else if (new Date(invitation.expires_at) < new Date()) {
    invitationState = "expired"
  } else {
    const workspace = await getWorkspaceById(invitation.workspace_id)
    workspaceName = workspace?.name ?? null
  }

  const emailMatches =
    !!user?.email &&
    !!invitation &&
    user.email.toLowerCase() === invitation.email.toLowerCase()

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <InviteView
          token={token}
          invitationState={invitationState}
          invitedEmail={invitation?.email ?? null}
          role={invitation?.role ?? null}
          workspaceName={workspaceName}
          currentEmail={user?.email ?? null}
          isAuthenticated={!!user}
          emailMatches={emailMatches}
        />
      </div>
    </div>
  )
}
