import { getOnboardingStatus } from "@/app/actions/v3/workspace"
import { redirect } from "next/navigation"
import { OnboardingForm } from "./_components/onboarding-form"
import { PendingApproval } from "./_components/pending-approval"

export default async function OnboardingPage() {
  const status = await getOnboardingStatus()
  
  // Si ya tiene workspace activo, redirigir
  if (status.status === "active_member") {
    if (!status.hasDocuments) {
      redirect("/v3/docs")
    }
    redirect("/v3/campaigns")
  }
  
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {status.status === "no_workspace" && (
          <OnboardingForm domain={status.domain} mode="create" />
        )}
        
        {status.status === "workspace_exists" && !status.isPending && (
          <OnboardingForm 
            domain={status.workspace.domain} 
            workspaceId={status.workspace.id}
            workspaceName={status.workspace.name}
            mode="join" 
          />
        )}
        
        {status.status === "workspace_exists" && status.isPending && (
          <PendingApproval workspaceName={status.workspace.name} />
        )}
      </div>
    </div>
  )
}
