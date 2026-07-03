import { getOnboardingStatus } from "@/app/actions/v3/workspace"
import { redirect } from "next/navigation"
import { NoAccessCard } from "./_components/no-access-card"

export default async function OnboardingPage() {
  const status = await getOnboardingStatus()

  // Si ya tiene workspace activo, redirigir
  if (status.status === "active_member") {
    if (!status.hasDocuments) {
      redirect("/v3/docs")
    }
    redirect("/v3/chat")
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <NoAccessCard />
      </div>
    </div>
  )
}
