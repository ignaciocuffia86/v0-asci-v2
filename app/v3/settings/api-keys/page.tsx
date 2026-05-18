import { Suspense } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/v3/workspace"
import { ApiKeysView } from "./_components/api-keys-view"
import { Skeleton } from "@/components/ui/skeleton"

export default async function ApiKeysPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect("/auth/login")
  }
  
  const workspace = await getCurrentWorkspace(user.id)
  if (!workspace) {
    redirect("/v3/onboarding")
  }
  
  // Get user's role
  const { data: membership } = await supabase
    .from("v3_workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .single()
  
  return (
    <div className="container max-w-4xl py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ApiKeysView 
          workspaceName={workspace.name} 
          isAdmin={membership?.role === "admin"} 
        />
      </Suspense>
    </div>
  )
}
