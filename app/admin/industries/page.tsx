import { IndustryManagementDashboard } from "@/components/admin/industry-management-dashboard"

export default function IndustriesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Industrias</h1>
        <p className="text-muted-foreground">
          Gestiona el mapeo de industrias para normalizar datos de companies y documentos.
        </p>
      </div>

      <IndustryManagementDashboard />
    </div>
  )
}
