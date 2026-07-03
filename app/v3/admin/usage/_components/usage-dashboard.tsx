"use client"

import { useState, useTransition } from "react"
import {
  getUsageReport,
  type UsageReport,
} from "@/app/actions/v3/admin-usage"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { DollarSign, MessageSquare, Search, PenLine, Users, Zap, Loader2 } from "lucide-react"

const FEATURE_LABELS: Record<string, string> = {
  chat: "Chat",
  "radar-tech": "Radar tecnológico",
  "radar-news": "Radar de noticias",
  "jobs-interpretation": "Interpretación de vacantes",
  scoring: "Scoring",
  icebreaker: "Icebreakers",
  "doc-analysis": "Análisis de documentos",
  other: "Otro",
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 })
}

function fmtInt(n: number): string {
  return n.toLocaleString("es-AR")
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function UsageDashboard({ initialReport }: { initialReport: UsageReport }) {
  const [report, setReport] = useState<UsageReport>(initialReport)
  const [periodDays, setPeriodDays] = useState(30)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const refresh = (nextPeriod: number, nextWs: string | null) => {
    startTransition(async () => {
      const next = await getUsageReport({ periodDays: nextPeriod, workspaceId: nextWs })
      setReport(next)
    })
  }

  const { kpis, daily, byFeature, byUser } = report

  const kpiCards = [
    { label: "Costo IA (est.)", value: fmtUsd(kpis.totalCostUsd), icon: DollarSign },
    { label: "Llamadas IA", value: fmtInt(kpis.totalCalls), icon: Zap },
    {
      label: "Tokens",
      value: `${fmtTokens(kpis.totalInputTokens)} in / ${fmtTokens(kpis.totalOutputTokens)} out`,
      icon: Zap,
    },
    { label: "Usuarios activos", value: fmtInt(kpis.activeUsers), icon: Users },
    { label: "Chats iniciados", value: fmtInt(kpis.chatsStarted), icon: MessageSquare },
    { label: "Researches", value: fmtInt(kpis.researchJobs), icon: Search },
    { label: "Icebreakers", value: fmtInt(kpis.icebreakers), icon: PenLine },
    { label: "Cuentas seguidas", value: fmtInt(kpis.accountsFollowed), icon: Users },
  ]

  return (
    <div className="flex flex-col gap-6">
      {report.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {report.error}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={String(periodDays)}
          onValueChange={(v) => {
            const n = Number(v)
            setPeriodDays(n)
            refresh(n, workspaceId)
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 días</SelectItem>
            <SelectItem value="30">Últimos 30 días</SelectItem>
            <SelectItem value="90">Últimos 90 días</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={workspaceId ?? "all"}
          onValueChange={(v) => {
            const next = v === "all" ? null : v
            setWorkspaceId(next)
            refresh(periodDays, next)
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Workspace" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los workspaces</SelectItem>
            {report.workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isPending && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Actualizando…
          </span>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpiCards.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-start justify-between gap-2 p-4">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 truncate text-lg font-semibold">{value}</p>
              </div>
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tendencias */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Costo diario (USD)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{ costUsd: { label: "Costo USD", color: "var(--chart-1)" } }}
              className="h-56 w-full"
            >
              <AreaChart data={daily} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(d: string) => d.slice(5)}
                  minTickGap={24}
                />
                <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => `$${v}`} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area
                  dataKey="costUsd"
                  type="monotone"
                  fill="var(--color-costUsd)"
                  fillOpacity={0.2}
                  stroke="var(--color-costUsd)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Llamadas de IA por día</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{ calls: { label: "Llamadas", color: "var(--chart-2)" } }}
              className="h-56 w-full"
            >
              <BarChart data={daily} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(d: string) => d.slice(5)}
                  minTickGap={24}
                />
                <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="calls" fill="var(--color-calls)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown por feature */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Costo por funcionalidad</CardTitle>
        </CardHeader>
        <CardContent>
          {byFeature.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Sin datos de uso de IA en el período seleccionado.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Funcionalidad</TableHead>
                  <TableHead className="text-right">Llamadas</TableHead>
                  <TableHead className="text-right">Tokens in</TableHead>
                  <TableHead className="text-right">Tokens out</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byFeature.map((f) => (
                  <TableRow key={f.feature}>
                    <TableCell>
                      <Badge variant="secondary">{FEATURE_LABELS[f.feature] ?? f.feature}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtInt(f.calls)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtTokens(f.inputTokens)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtTokens(f.outputTokens)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmtUsd(f.costUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detalle por usuario */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Detalle por usuario</CardTitle>
        </CardHeader>
        <CardContent>
          {byUser.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Sin actividad de usuarios en el período seleccionado.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead className="text-right">Chats</TableHead>
                  <TableHead className="text-right">Researches</TableHead>
                  <TableHead className="text-right">Icebreakers</TableHead>
                  <TableHead className="text-right">Llamadas IA</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Última actividad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byUser.map((u) => (
                  <TableRow key={u.userId}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell className="text-muted-foreground">{u.workspaceName}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtInt(u.chats)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtInt(u.researchJobs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtInt(u.icebreakers)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtInt(u.aiCalls)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{fmtUsd(u.costUsd)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {u.lastActivity
                        ? new Date(u.lastActivity).toLocaleDateString("es-AR", {
                            day: "2-digit",
                            month: "short",
                          })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
