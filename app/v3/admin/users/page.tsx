import { listAllUsers } from "@/app/actions/v3/admin-users"
import { AdminUsersView } from "./_components/admin-users-view"

export default async function AdminUsersPage() {
  // El guard de superadmin vive en el layout de /v3/admin
  const { users, error } = await listAllUsers()

  return <AdminUsersView initialUsers={users} loadError={error} />
}
