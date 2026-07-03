import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/v3/workspace"
import { getWorkspaceDocumentsWithTags, getDocumentStats } from "@/app/actions/v3/documents"
import { DocumentsView } from "./_components/documents-view"

export default async function DocumentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect("/auth/login")
  }

  const workspace = await getCurrentWorkspace()
  if (!workspace) {
    redirect("/v3/onboarding")
  }

  const [docsResult, stats] = await Promise.all([
    getWorkspaceDocumentsWithTags(),
    getDocumentStats(),
  ])

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <main className="flex-1">
        <DocumentsView 
          initialDocuments={docsResult.data || []}
          stats={stats}
          workspaceName={workspace.name}
        />
      </main>
    </div>
  )
}
