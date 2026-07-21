import { Suspense } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getApiKeySettingsContext } from "@/app/actions/v3/api-keys"
import { ApiKeysView } from "./_components/api-keys-view"
import { Skeleton } from "@/components/ui/skeleton"

export default async function ApiKeysPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect("/auth/login")
  }
  
  const context = await getApiKeySettingsContext()
  if (!context.success || !context.workspaces?.length || !context.defaultWorkspaceId) {
    redirect("/v3/onboarding")
  }

  return (
    <div className="container max-w-4xl py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ApiKeysView
          workspaces={context.workspaces}
          defaultWorkspaceId={context.defaultWorkspaceId}
          isSuperAdmin={context.isSuperAdmin ?? false}
        />
      </Suspense>
    </div>
  )
}
