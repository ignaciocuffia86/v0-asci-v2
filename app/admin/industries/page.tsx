"use client"

import dynamic from "next/dynamic"

const IndustryManagementDashboard = dynamic(
  () => import("@/components/admin/industry-management-dashboard").then(mod => mod.IndustryManagementDashboard),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }
)

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
