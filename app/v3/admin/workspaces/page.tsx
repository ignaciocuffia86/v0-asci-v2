import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { listAllWorkspaces } from "@/app/actions/v3/admin"
import { AdminWorkspacesView } from "./_components/admin-workspaces-view"

export default async function AdminWorkspacesPage() {
  // Guard de superadmin (defensa adicional a nivel de página)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login?next=/v3/admin/workspaces")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "superadmin") {
    redirect("/v3")
  }

  const { workspaces, error } = await listAllWorkspaces()

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <AdminWorkspacesView initialWorkspaces={workspaces} loadError={error} />
    </div>
  )
}
