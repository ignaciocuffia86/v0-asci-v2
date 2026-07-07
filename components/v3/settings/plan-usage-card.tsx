import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Gauge } from "lucide-react"
import type { WorkspaceUsage } from "@/lib/v3/plans"

function UsageBar({
  label,
  used,
  cap,
  note,
}: {
  label: string
  used: number
  cap: number | null
  note?: string
}) {
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0
  const nearLimit = cap !== null && cap > 0 && used / cap >= 0.8

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={nearLimit ? "font-medium text-amber-600 dark:text-amber-400" : "font-medium"}>
          {used}
          {cap !== null ? ` / ${cap}` : ""}
        </span>
      </div>
      {cap !== null && <Progress value={pct} className="h-1.5" />}
      {nearLimit && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Estás cerca del límite del plan.
        </p>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

/** Card de plan y consumo del workspace (visible para todos los miembros). */
export function PlanUsageCard({ usage }: { usage: WorkspaceUsage }) {
  const { config } = usage
  const isTrial = usage.plan === "trial"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-5" />
          Plan y consumo
          <Badge variant={isTrial ? "outline" : "secondary"} className="ml-1">
            {config.label}
          </Badge>
        </CardTitle>
        <CardDescription>
          {isTrial
            ? "El plan Trial permite investigar 2 cuentas en total, sin re-investigación ni refresh automático."
            : `Hasta ${config.followedCap} cuentas seguidas con refresh automático mensual y ${config.monthlyResearchCap} investigaciones nuevas por mes.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <UsageBar
          label="Cuentas seguidas"
          used={usage.followedCount}
          cap={config.followedCap}
        />
        <UsageBar
          label={isTrial ? "Investigaciones (total del Trial)" : "Investigaciones nuevas este mes"}
          used={isTrial ? usage.lifetimeResearchCount : usage.monthlyResearchCount}
          cap={isTrial ? config.lifetimeResearchCap : config.monthlyResearchCap}
          note={isTrial ? undefined : "El cupo se renueva el 1° de cada mes. Los refresh automáticos del cron no consumen cupo."}
        />
        <UsageBar
          label="Usuarios (incluye invitaciones pendientes)"
          used={usage.memberCount + usage.pendingInvitations}
          cap={config.maxUsers}
          note={config.maxUsers === null ? "Sin límite de usuarios en este plan." : undefined}
        />
        <div className="flex flex-col gap-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            Refresh automático mensual: {config.allowsCron ? "incluido para cuentas seguidas" : "no disponible en Trial"}
          </span>
          <span>API keys / MCP: {config.allowsApiKeys ? "incluido" : "solo en plan Platinum"}</span>
          <span>Digest por email: incluido</span>
        </div>
        {isTrial && (
          <p className="text-xs text-muted-foreground">
            Para ampliar los límites, contactá al administrador de la plataforma para hacer upgrade de plan.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
