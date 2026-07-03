import { getUsageReport } from "@/app/actions/v3/admin-usage"
import { UsageDashboard } from "./_components/usage-dashboard"

export default async function AdminUsagePage() {
  // El guard de superadmin vive en el layout de /v3/admin
  const initialReport = await getUsageReport({ periodDays: 30, workspaceId: null })

  return <UsageDashboard initialReport={initialReport} />
}
