"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
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
  Search,
  X,
  TrendingUp,
  TrendingDown,
  Clock,
  Filter,
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
  createdAtTimestamp: number
  lastActivity: string
  lastSignIn: string | null
  daysSinceLastActivity: number
  weekOverWeekGrowth: number | null
  thisWeekActions: number
  lastWeekActions: number
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

// Helper to format relative time
function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "Nunca"
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffMins < 60) return `Hace ${diffMins} min`
  if (diffHours < 24) return `Hace ${diffHours}h`
  if (diffDays === 1) return "Ayer"
  if (diffDays < 7) return `Hace ${diffDays} dias`
  if (diffDays < 30) return `Hace ${Math.floor(diffDays / 7)} sem`
  return `Hace ${Math.floor(diffDays / 30)} mes${Math.floor(diffDays / 30) > 1 ? "es" : ""}`
}

// Inactivity badge helper
function getInactivityBadge(days: number) {
  if (days === -1) return { label: "Sin actividad", variant: "outline" as const, className: "text-muted-foreground" }
  if (days > 30) return { label: `${days}d`, variant: "destructive" as const, className: "" }
  if (days > 14) return { label: `${days}d`, variant: "secondary" as const, className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" }
  if (days > 7) return { label: `${days}d`, variant: "secondary" as const, className: "" }
  return { label: `${days}d`, variant: "outline" as const, className: "text-green-600 dark:text-green-400" }
}

export function UsageDashboardClient({ userRows, onboardingRows, weeklyDataAll, weeklyDataFiltered }: DashboardProps) {
  const [hideAdmins, setHideAdmins] = useState(true)
  
  // Filter states
  const [searchEmail, setSearchEmail] = useState("")
  const [engagementFilter, setEngagementFilter] = useState<string>("all")
  const [onboardingFilter, setOnboardingFilter] = useState<string>("all")
  const [registrationFilter, setRegistrationFilter] = useState<string>("all")
  const [inactivityFilter, setInactivityFilter] = useState<string>("all")

  // Apply all filters
  const filtered = useMemo(() => {
    let result = hideAdmins ? userRows.filter((u) => !u.isAdmin) : userRows
    
    // Search by email
    if (searchEmail.trim()) {
      const search = searchEmail.toLowerCase().trim()
      result = result.filter((u) => u.email.toLowerCase().includes(search))
    }
    
    // Engagement filter
    if (engagementFilter !== "all") {
      result = result.filter((u) => {
        const total = u.bookmarks + u.contacts + u.news + u.implementations + u.strategies + u.icebreakers + u.briefs + u.documents
        if (engagementFilter === "inactive") return total === 0
        if (engagementFilter === "low") return total > 0 && total <= 5
        if (engagementFilter === "medium") return total > 5 && total <= 20
        if (engagementFilter === "high") return total > 20
        return true
      })
    }
    
    // Onboarding filter
    if (onboardingFilter !== "all") {
      result = result.filter((u) => {
        if (onboardingFilter === "completed") return u.onboardingStatus === "completed"
        if (onboardingFilter === "in_progress") return u.onboardingStatus === "in_progress"
        if (onboardingFilter === "skipped") return u.onboardingStatus === "skipped"
        if (onboardingFilter === "pending") return u.onboardingStatus === "pending" || u.onboardingStatus === "sin registro"
        return true
      })
    }
    
    // Registration date filter
    if (registrationFilter !== "all") {
      const now = new Date()
      result = result.filter((u) => {
        if (!u.createdAtTimestamp) return false
        const daysSinceRegistration = Math.floor((now.getTime() - u.createdAtTimestamp) / (1000 * 60 * 60 * 24))
        if (registrationFilter === "last7days") return daysSinceRegistration <= 7
        if (registrationFilter === "last30days") return daysSinceRegistration <= 30
        if (registrationFilter === "last90days") return daysSinceRegistration <= 90
        if (registrationFilter === "thisYear") return new Date(u.createdAtTimestamp).getFullYear() === now.getFullYear()
        return true
      })
    }
    
    // Inactivity filter
    if (inactivityFilter !== "all") {
      result = result.filter((u) => {
        if (inactivityFilter === "7days") return u.daysSinceLastActivity > 7 || u.daysSinceLastActivity === -1
        if (inactivityFilter === "14days") return u.daysSinceLastActivity > 14 || u.daysSinceLastActivity === -1
        if (inactivityFilter === "30days") return u.daysSinceLastActivity > 30 || u.daysSinceLastActivity === -1
        if (inactivityFilter === "never") return u.daysSinceLastActivity === -1
        return true
      })
    }
    
    return result
  }, [userRows, hideAdmins, searchEmail, engagementFilter, onboardingFilter, registrationFilter, inactivityFilter])
  
  const filteredOnboarding = useMemo(() => hideAdmins ? onboardingRows.filter((o) => !o.isAdmin) : onboardingRows, [onboardingRows, hideAdmins])
  
  // Check if any filter is active
  const hasActiveFilters = searchEmail || engagementFilter !== "all" || onboardingFilter !== "all" || registrationFilter !== "all" || inactivityFilter !== "all"
  
  const clearFilters = () => {
    setSearchEmail("")
    setEngagementFilter("all")
    setOnboardingFilter("all")
    setRegistrationFilter("all")
    setInactivityFilter("all")
  }

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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Detalle por Usuario</CardTitle>
              <CardDescription>
                {hasActiveFilters 
                  ? `Mostrando ${filtered.length} de ${userRows.filter(u => hideAdmins ? !u.isAdmin : true).length} usuarios`
                  : `Metricas detalladas de ${filtered.length} usuarios ordenadas por actividad`
                }
              </CardDescription>
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5">
                <X className="h-4 w-4" />
                Limpiar filtros
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-3 p-4 rounded-lg border border-border bg-muted/30">
            <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
            
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-[300px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por email..."
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            
            {/* Engagement */}
            <Select value={engagementFilter} onValueChange={setEngagementFilter}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Engagement" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo engagement</SelectItem>
                <SelectItem value="high">Alto (20+)</SelectItem>
                <SelectItem value="medium">Medio (6-20)</SelectItem>
                <SelectItem value="low">Bajo (1-5)</SelectItem>
                <SelectItem value="inactive">Inactivo (0)</SelectItem>
              </SelectContent>
            </Select>
            
            {/* Onboarding */}
            <Select value={onboardingFilter} onValueChange={setOnboardingFilter}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Onboarding" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo onboarding</SelectItem>
                <SelectItem value="completed">Completado</SelectItem>
                <SelectItem value="in_progress">En progreso</SelectItem>
                <SelectItem value="skipped">Saltado</SelectItem>
                <SelectItem value="pending">Pendiente</SelectItem>
              </SelectContent>
            </Select>
            
            {/* Registration */}
            <Select value={registrationFilter} onValueChange={setRegistrationFilter}>
              <SelectTrigger className="w-[150px] h-9">
                <SelectValue placeholder="Registro" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo registro</SelectItem>
                <SelectItem value="last7days">Ultimos 7 dias</SelectItem>
                <SelectItem value="last30days">Ultimos 30 dias</SelectItem>
                <SelectItem value="last90days">Ultimos 90 dias</SelectItem>
                <SelectItem value="thisYear">Este anio</SelectItem>
              </SelectContent>
            </Select>
            
            {/* Inactivity */}
            <Select value={inactivityFilter} onValueChange={setInactivityFilter}>
              <SelectTrigger className="w-[150px] h-9">
                <SelectValue placeholder="Inactividad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toda actividad</SelectItem>
                <SelectItem value="7days">Inactivo 7+ dias</SelectItem>
                <SelectItem value="14days">Inactivo 14+ dias</SelectItem>
                <SelectItem value="30days">Inactivo 30+ dias</SelectItem>
                <SelectItem value="never">Nunca activo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Usuario</TableHead>
                  <TableHead className="text-center">Engagement</TableHead>
                  <TableHead className="text-center">
                    <span title="Cambio semana a semana" className="inline-flex items-center justify-center cursor-help gap-1">
                      <TrendingUp className="h-3.5 w-3.5" />
                      WoW
                    </span>
                  </TableHead>
                  <TableHead className="text-center">
                    <span title="Ultimo login" className="inline-flex items-center justify-center cursor-help gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      Login
                    </span>
                  </TableHead>
                  <TableHead className="text-center">Inactividad</TableHead>
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
                  const inactivityBadge = getInactivityBadge(u.daysSinceLastActivity)
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
                      {/* WoW Column */}
                      <TableCell className="text-center">
                        {u.weekOverWeekGrowth !== null ? (
                          <div className="flex items-center justify-center gap-1">
                            {u.weekOverWeekGrowth > 0 ? (
                              <TrendingUp className="h-3.5 w-3.5 text-green-600" />
                            ) : u.weekOverWeekGrowth < 0 ? (
                              <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                            ) : (
                              <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            <span className={`text-xs font-medium ${
                              u.weekOverWeekGrowth > 0 ? "text-green-600" : 
                              u.weekOverWeekGrowth < 0 ? "text-red-500" : "text-muted-foreground"
                            }`}>
                              {u.weekOverWeekGrowth > 0 ? "+" : ""}{u.weekOverWeekGrowth}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                        <p className="text-[10px] text-muted-foreground">{u.thisWeekActions} vs {u.lastWeekActions}</p>
                      </TableCell>
                      {/* Last Login Column */}
                      <TableCell className="text-center">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatRelativeTime(u.lastSignIn)}
                        </span>
                      </TableCell>
                      {/* Inactivity Column */}
                      <TableCell className="text-center">
                        <Badge variant={inactivityBadge.variant} className={`text-[10px] px-1.5 ${inactivityBadge.className}`}>
                          {inactivityBadge.label}
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
                    <TableCell colSpan={15} className="text-center text-muted-foreground py-8">
                      {hasActiveFilters ? "No hay usuarios que coincidan con los filtros" : "No hay usuarios registrados"}
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
              <TrendingUp className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">WoW</strong> - Cambio % de acciones vs semana anterior</span>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Login</strong> - Ultimo inicio de sesion</span>
            </div>
            <div className="flex items-start gap-2">
              <GraduationCap className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Inactividad</strong> - Rojo 30+d, Amarillo 14+d, Verde 7d</span>
            </div>
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
              <Users className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Engagement</strong> - Inactivo (0), Bajo (1-5), Medio (6-20), Alto (20+)</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
