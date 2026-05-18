import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Clock } from "lucide-react"

interface PendingApprovalProps {
  workspaceName: string
}

export function PendingApproval({ workspaceName }: PendingApprovalProps) {
  return (
    <Card className="border-border/50">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-amber-500/10">
          <Clock className="size-6 text-amber-500" />
        </div>
        <CardTitle className="text-2xl">Solicitud Pendiente</CardTitle>
        <CardDescription className="text-base">
          Tu solicitud para unirte a <strong>{workspaceName}</strong> esta en revision
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm text-muted-foreground">
            El administrador del workspace revisara tu solicitud. 
            Recibiras un email cuando sea aprobada.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
