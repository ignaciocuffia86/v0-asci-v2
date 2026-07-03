import { listAllWorkspaces } from "@/app/actions/v3/admin"
import { AdminWorkspacesView } from "./_components/admin-workspaces-view"

export default async function AdminWorkspacesPage() {
  // El guard de superadmin vive en el layout de /v3/admin
  const { workspaces, error } = await listAllWorkspaces()

  return (
    <div className="mx-auto max-w-4xl">
      <AdminWorkspacesView initialWorkspaces={workspaces} loadError={error} />
    </div>
  )
}
