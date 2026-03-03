"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Users,
  Bookmark,
  GraduationCap,
  Zap,
  FileText,
  Target,
  Newspaper,
  Briefcase,
  BrainCircuit,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  ShieldAlert,
  Upload,
} from "lucide-react"
import {
  UserActivityChart,
  OnboardingPieChart,
  FeatureUsageChart,
  WeeklyActivityChart,
  COLORS,
  ONBOARDING_COLORS,
  type OnboardingStatusData,
  type FeatureUsageData,
  type WeeklyActivityData,
} from "./usage-charts"

// -- Types --
export interface UserRow {
  email: string
  isAdmin: boolean
  bookmarks: number
  contacts: number
  news: number
  implementations: number
  strategies: number
  icebreakers: number
  briefs: number
  documents: number
  userId: string
  createdAt: string
  lastActivity: string
  onboardingStatus: string
  onboardingProgress: number
}

interface OnboardingRow {
  status: string
  userId: string
  isAdmin: boolean
}

interface DashboardProps {
  userRows: UserRow[]
  onboardingRows: OnboardingRow[]
  weeklyDataAll: WeeklyActivityData[]
  weeklyDataFiltered: WeeklyActivityData[]
}

function getEngagement(total: number) {
  if (total === 0) return { label: "Inactivo", variant: "outline" as const, icon: Minus }
  if (total <= 5) return { label: "Bajo", variant: "secondary" as const, icon: ArrowDownRight }
  if (total <= 20) return { label: "Medio", variant: "default" as const, icon: ArrowUpRight }
  return { label: "Alto", variant: "default" as const, icon: ArrowUpRight }
}

export function UsageDashboardClient({ userRows, onboardingRows, weeklyDataAll, weeklyDataFiltered }: DashboardProps) {
  const [hideAdmins, setHideAdmins] = useState(true)

  const filtered = useMemo(() => hideAdmins ? userRows.filter((u) => !u.isAdmin) : userRows, [userRows, hideAdmins])
  const filteredOnboarding = useMemo(() => hideAdmins ? onboardingRows.filter((o) => !o.isAdmin) : onboardingRows, [onboardingRows, hideAdmins])

  // KPIs
  const totalUsers = filtered.length
  const activeUsers = filtered.filter(
    (u) => u.bookmarks + u.contacts + u.icebreakers + u.strategies + u.briefs + u.news + u.implementations > 0
  ).length
  const totalBookmarks = filtered.reduce((s, u) => s + u.bookmarks, 0)
  const totalAIActions = filtered.reduce(
    (s, u) => s + u.strategies + u.icebreakers + u.briefs + u.news + u.implementations, 0
  )

  // Onboarding
  const onboardingCompleted = filteredOnboarding.filter((o) => o.status === "completed").length
  const onboardingRate = totalUsers > 0 ? Math.round((onboardingCompleted / totalUsers) * 100) : 0

  const onboardingStatusData: OnboardingStatusData[] = [
    { name: "Completado", value: filteredOnboarding.filter((o) => o.status === "completed").length, color: ONBOARDING_COLORS.completed },
    { name: "En progreso", value: filteredOnboarding.filter((o) => o.status === "in_progress").length, color: ONBOARDING_COLORS.in_progress },
    { name: "Saltado", value: filteredOnboarding.filter((o) => o.status === "skipped").length, color: ONBOARDING_COLORS.skipped },
    { name: "Pendiente", value: filteredOnboarding.filter((o) => o.status === "pending").length, color: ONBOARDING_COLORS.pending },
  ].filter((d) => d.value > 0)

  // Feature usage
  const featureUsageData: FeatureUsageData[] = [
    { name: "Bookmarks", count: filtered.reduce((s, u) => s + u.bookmarks, 0), color: COLORS.primary },
    { name: "Prospectos", count: filtered.reduce((s, u) => s + u.contacts, 0), color: COLORS.secondary },
    { name: "Noticias", count: filtered.reduce((s, u) => s + u.news, 0), color: COLORS.orange },
    { name: "Implementaciones", count: filtered.reduce((s, u) => s + u.implementations, 0), color: COLORS.pink },
    { name: "Estrategias", count: filtered.reduce((s, u) => s + u.strategies, 0), color: COLORS.sky },
    { name: "Icebreakers", count: filtered.reduce((s, u) => s + u.icebreakers, 0), color: COLORS.accent },
    { name: "Briefs", count: filtered.reduce((s, u) => s + u.briefs, 0), color: COLORS.success },
    { name: "Documentos", count: filtered.reduce((s, u) => s + u.documents, 0), color: COLORS.indigo },
  ].sort((a, b) => b.count - a.count)

  // User activity chart data
  const activityChartData = filtered.map((u) => ({
    email: u.email,
    bookmarks: u.bookmarks,
    contacts: u.contacts,
    news: u.news,
    implementations: u.implementations,
    strategies: u.strategies,
    icebreakers: u.icebreakers,
    briefs: u.briefs,
    documents: u.documents,
  }))

  // Detail table sorted by total actions
  const sortedDetails = [...filtered]
    .map((u) => ({
      ...u,
      totalActions: u.bookmarks + u.contacts + u.news + u.implementations + u.strategies + u.icebreakers + u.briefs + u.documents,
    }))
    .sort((a, b) => b.totalActions - a.totalActions)

  return (
    <div className="space-y-8">
      {/* Header with admin filter */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics de Uso</h1>
          <p className="text-muted-foreground mt-1">
            Adopcion, engagement y actividad de {totalUsers} usuarios{hideAdmins ? "" : " (incluyendo admins)"}
          </p>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-border bg-card">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          <Label htmlFor="hide-admins" className="text-sm cursor-pointer select-none">Ocultar admins</Label>
          <Switch id="hide-admins" checked={hideAdmins} onCheckedChange={setHideAdmins} />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Usuarios Activos</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeUsers}<span className="text-base font-normal text-muted-foreground">/{totalUsers}</span></div>
            <p className="text-xs text-muted-foreground">{totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0}% con al menos 1 accion</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasa de Onboarding</CardTitle>
            <GraduationCap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{onboardingRate}%</div>
            <p className="text-xs text-muted-foreground">{onboardingCompleted} de {totalUsers} completaron el tour</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Bookmarks</CardTitle>
            <Bookmark className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalBookmarks}</div>
            <p className="text-xs text-muted-foreground">{activeUsers > 0 ? (totalBookmarks / activeUsers).toFixed(1) : "0"} promedio por usuario activo</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Acciones AI</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalAIActions}</div>
            <p className="text-xs text-muted-foreground">Estrategias, icebreakers, briefs, noticias, impl.</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 min-w-0">
          <UserActivityChart data={activityChartData} />
        </div>
        <div className="min-w-0">
          <OnboardingPieChart data={onboardingStatusData} />
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <FeatureUsageChart data={featureUsageData} />
        </div>
        <div className="min-w-0">
          <WeeklyActivityChart data={hideAdmins ? weeklyDataFiltered : weeklyDataAll} />
        </div>
      </div>

      {/* User Detail Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detalle por Usuario</CardTitle>
          <CardDescription>Metricas detalladas de cada usuario ordenadas por actividad total</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Usuario</TableHead>
                  <TableHead className="text-center">Engagement</TableHead>
                  <TableHead className="text-center">Onboarding</TableHead>
                  <TableHead className="text-center">
                    <span title="Bookmarks - Cuentas guardadas" className="inline-flex items-center justify-center cursor-help"><Bookmark className="h-3.5 w-3.5" /></span>
                  </TableHead>
                  <TableHead className="text-center">
                    <span title="Prospectos - Contactos via Apollo" className="inline-flex items-center justify-center cursor-help"><Target className="h-3.5 w-3.5" /></span>
                  </TableHead>
                  <TableHead className="text-center">
                    <span title="Noticias - Noticias buscadas" className="inline-flex items-center justify-center cursor-help"><Newspaper className="h-3.5 w-3.5" /></span>
                  </TableHead>
                  <TableHead className="text-center">
                    <span title="Implementaciones - Casos de uso" className="inline-flex items-center justify-center cursor-help"><Briefcase className="h-3.5 w-3.5" /></span>
                  </TableHead>
                  <TableHead className="text-center">
                    <span title="Estrategias - Generadas con IA" className="inline-flex items-center justify-center cursor-help"><BrainCircuit className="h-3.5 w-3.5" /></span>
                  </TableHead>
                  <TableHead className="text-center">
                    <span title="Icebreakers - Mensajes generados" className="inline-flex items-center justify-center cursor-help"><Sparkles className="h-3.5 w-3.5" /></span>
                  </TableHead>
                  <TableHead className="text-center">
                    <span title="Briefs - Briefs ejecutivos" className="inline-flex items-center justify-center cursor-help"><FileText className="h-3.5 w-3.5" /></span>
                  </TableHead>
                  <TableHead className="text-center">
                    <span title="Documentos - Docs subidos" className="inline-flex items-center justify-center cursor-help"><Upload className="h-3.5 w-3.5" /></span>
                  </TableHead>
                  <TableHead className="text-right">Ultima act.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDetails.map((u) => {
                  const engagement = getEngagement(u.totalActions)
                  const EngIcon = engagement.icon
                  return (
                    <TableRow key={u.userId}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm truncate max-w-[220px]">{u.email}</p>
                          <p className="text-xs text-muted-foreground">Desde {u.createdAt}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={engagement.variant} className="gap-1 text-xs">
                          <EngIcon className="h-3 w-3" />
                          {engagement.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <Badge
                            variant={u.onboardingStatus === "completed" ? "default" : "outline"}
                            className="text-[10px] px-1.5"
                          >
                            {u.onboardingStatus === "completed" ? "Completo" :
                              u.onboardingStatus === "in_progress" ? "En curso" :
                                u.onboardingStatus === "skipped" ? "Saltado" :
                                  u.onboardingStatus === "pending" ? "Pendiente" : "-"}
                          </Badge>
                          {u.onboardingProgress > 0 && u.onboardingStatus !== "completed" && (
                            <span className="text-[10px] text-muted-foreground">{u.onboardingProgress}%</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">{u.bookmarks || <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{u.contacts || <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{u.news || <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{u.implementations || <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{u.strategies || <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{u.icebreakers || <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{u.briefs || <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="text-center font-mono text-sm">{u.documents || <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">{u.lastActivity}</TableCell>
                    </TableRow>
                  )
                })}
                {sortedDetails.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                      No hay usuarios registrados
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card className="bg-muted/30">
        <CardContent className="pt-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <Bookmark className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Bookmarks</strong> - Cuentas guardadas</span>
            </div>
            <div className="flex items-start gap-2">
              <Target className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Prospectos</strong> - Contactos via Apollo</span>
            </div>
            <div className="flex items-start gap-2">
              <Newspaper className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Noticias</strong> - Noticias buscadas</span>
            </div>
            <div className="flex items-start gap-2">
              <Briefcase className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Implementaciones</strong> - Casos de uso</span>
            </div>
            <div className="flex items-start gap-2">
              <BrainCircuit className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Estrategias</strong> - Generadas con IA</span>
            </div>
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Icebreakers</strong> - Mensajes con IA</span>
            </div>
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Briefs</strong> - Briefs ejecutivos</span>
            </div>
            <div className="flex items-start gap-2">
              <Upload className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Documentos</strong> - Docs subidos</span>
            </div>
            <div className="flex items-start gap-2">
              <GraduationCap className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Engagement</strong> - Inactivo (0), Bajo (1-5), Medio (6-20), Alto (20+)</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
