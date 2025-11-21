"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function BookmarkOverview({ company }: { company: any }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Información General</CardTitle>
          <CardDescription>Datos públicos de la empresa</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Nombre Legal</div>
            <div>{company.normalized_name || company.name}</div>
          </div>
          {/* More details can be added here from the standard company view */}
          <div className="p-4 bg-muted/30 rounded-lg text-sm text-muted-foreground text-center">
            Esta es la vista general compartida. Utiliza las pestañas de Investigación y Prospectos para agregar tu
            información privada.
          </div>
        </CardContent>
      </Card>
      {/* We can add public signals summary here later */}
    </div>
  )
}
