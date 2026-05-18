import { redirect } from "next/navigation"
import { getOnboardingStatus } from "@/app/actions/v3/workspace"

export default async function V3IndexPage() {
  // Verificar estado de onboarding y redirigir
  const status = await getOnboardingStatus()
  
  if (status.status === "no_workspace" || status.status === "workspace_exists") {
    // Necesita completar onboarding
    redirect("/v3/onboarding")
  }
  
  if (status.status === "active_member") {
    if (!status.hasDocuments) {
      // Tiene workspace pero le faltan docs (blocker)
      redirect("/v3/docs")
    }
    // Todo OK - ir a campanas
    redirect("/v3/campaigns")
  }
  
  // Fallback
  redirect("/v3/onboarding")
}
