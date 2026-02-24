import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { redirect } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
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
} from "lucide-react"
import {
  UserActivityChart,
  OnboardingPieChart,
  FeatureUsageChart,
  WeeklyActivityChart,
  COLORS,
  ONBOARDING_COLORS,
  type UserActivityData,
  type OnboardingStatusData,
  type FeatureUsageData,
  type WeeklyActivityData,
} from "@/components/admin/usage-charts"

// Helper to get ISO week label
function getWeekLabel(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `S${weekNum}`
}

function getWeekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().split("T")[0]
}

export default async function AdminUsagePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (profile?.role !== "superadmin") redirect("/")

  const adminClient = createAdminClient()

  // Parallel data fetching
  const [
    { data: { users: authUsers } },
    { data: bookmarks },
    { data: contacts },
    { data: news },
    { data: implementations },
    { data: strategies },
    { data: icebreakers },
    { data: briefs },
    { data: documents },
    { data: onboarding },
  ] = await Promise.all([
    adminClient.auth.admin.listUsers(),
    adminClient.from("bookmarks").select("id, user_id, priority, status, created_at"),
    adminClient.from("user_company_contacts").select("id, user_id, created_at"),
    adminClient.from("company_news").select("id, user_id, created_at"),
    adminClient.from("company_implementations").select("id, user_id, created_at"),
    adminClient.from("user_company_strategies").select("id, user_id, created_at"),
    adminClient.from("user_icebreakers").select("id, user_id, created_at"),
    adminClient.from("bookmark_summaries").select("id, bookmark_id, created_at, user_email"),
    adminClient.from("user_documents").select("id, user_id, created_at, status"),
    adminClient.from("user_onboarding").select("user_id, status, progress_percentage, current_track, completed_tracks"),
  ])

  const users = authUsers || []
  const emailMap = new Map(users.map((u) => [u.id, u.email || "Sin email"]))

  // -- Build per-user stats --
  const userActivityData: UserActivityData[] = users.map((u) => ({
    email: u.email || "Sin email",
    bookmarks: (bookmarks || []).filter((b) => b.user_id === u.id).length,
    contacts: (contacts || []).filter((c) => c.user_id === u.id).length,
    news: (news || []).filter((n) => n.user_id === u.id).length,
    implementations: (implementations || []).filter((i) => i.user_id === u.id).length,
    strategies: (strategies || []).filter((s) => s.user_id === u.id).length,
    icebreakers: (icebreakers || []).filter((i) => i.user_id === u.id).length,
    briefs: (briefs || []).filter((b) => {
      // Match briefs by user_email or by bookmark ownership
      if (b.user_email === u.email) return true
      const bk = (bookmarks || []).find((bm) => bm.id === b.bookmark_id)
      return bk?.user_id === u.id
    }).length,
    documents: (documents || []).filter((d) => d.user_id === u.id).length,
  }))

  // -- KPIs --
  const totalUsers = users.length
  const activeUsers = userActivityData.filter(
    (u) => u.bookmarks + u.contacts + u.icebreakers + u.strategies + u.briefs > 0
  ).length
  const totalBookmarks = (bookmarks || []).length
  const totalAIActions =
    (strategies || []).length +
    (icebreakers || []).length +
    (briefs || []).length +
    (news || []).length +
    (implementations || []).length

  // Onboarding stats
  const onboardingList = onboarding || []
  const onboardingCompleted = onboardingList.filter((o) => o.status === "completed").length
  const onboardingRate = totalUsers > 0 ? Math.round((onboardingCompleted / totalUsers) * 100) : 0

  // -- Onboarding pie chart --
  const onboardingStatusData: OnboardingStatusData[] = [
    { name: "Completado", value: onboardingList.filter((o) => o.status === "completed").length, color: ONBOARDING_COLORS.completed },
    { name: "En progreso", value: onboardingList.filter((o) => o.status === "in_progress").length, color: ONBOARDING_COLORS.in_progress },
    { name: "Saltado", value: onboardingList.filter((o) => o.status === "skipped").length, color: ONBOARDING_COLORS.skipped },
    { name: "Pendiente", value: onboardingList.filter((o) => o.status === "pending").length, color: ONBOARDING_COLORS.pending },
  ].filter((d) => d.value > 0)

  // -- Feature usage chart --
  const featureUsageData: FeatureUsageData[] = [
    { name: "Bookmarks", count: (bookmarks || []).length, color: COLORS.primary },
    { name: "Prospectos", count: (contacts || []).length, color: COLORS.secondary },
    { name: "Noticias", count: (news || []).length, color: COLORS.orange },
    { name: "Implementaciones", count: (implementations || []).length, color: COLORS.pink },
    { name: "Estrategias", count: (strategies || []).length, color: COLORS.sky },
    { name: "Icebreakers", count: (icebreakers || []).length, color: COLORS.accent },
    { name: "Briefs", count: (briefs || []).length, color: COLORS.success },
    { name: "Documentos", count: (documents || []).length, color: COLORS.indigo },
  ].sort((a, b) => b.count - a.count)

  // -- Weekly activity (last 8 weeks) --
  const now = new Date()
  const eightWeeksAgo = new Date(now)
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56)

  const weekBuckets = new Map<string, { bookmarks: number; contacts: number; icebreakers: number; briefs: number; documents: number }>()
  for (let i = 0; i < 8; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i * 7)
    const key = getWeekStart(d)
    weekBuckets.set(key, { bookmarks: 0, contacts: 0, icebreakers: 0, briefs: 0, documents: 0 })
  }

  const bucketItem = (items: Array<{ created_at: string }> | null, field: "bookmarks" | "contacts" | "icebreakers" | "briefs" | "documents") => {
    for (const item of items || []) {
      const created = new Date(item.created_at)
      if (created < eightWeeksAgo) continue
      const key = getWeekStart(created)
      const bucket = weekBuckets.get(key)
      if (bucket) bucket[field]++
    }
  }

  bucketItem(bookmarks, "bookmarks")
  bucketItem(contacts, "contacts")
  bucketItem(icebreakers, "icebreakers")
  bucketItem(briefs, "briefs")
  bucketItem(documents, "documents")

  const weeklyActivityData: WeeklyActivityData[] = Array.from(weekBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, counts]) => ({
      week: getWeekLabel(new Date(weekStart)),
      ...counts,
    }))

  // -- Per-user detail table --
  type UserDetail = UserActivityData & {
    userId: string
    createdAt: string
    lastActivity: string
    onboardingStatus: string
    onboardingProgress: number
    totalActions: number
  }

  const userDetails: UserDetail[] = users.map((u) => {
    const activity = userActivityData.find((a) => a.email === (u.email || "Sin email"))!
    const totalActions = activity.bookmarks + activity.contacts + activity.news +
      activity.implementations + activity.strategies + activity.icebreakers + activity.briefs + activity.documents

    // Find last activity across all tables
    const allDates: Date[] = []
    for (const b of bookmarks || []) if (b.user_id === u.id && b.created_at) allDates.push(new Date(b.created_at))
    for (const c of contacts || []) if (c.user_id === u.id && c.created_at) allDates.push(new Date(c.created_at))
    for (const i of icebreakers || []) if (i.user_id === u.id && i.created_at) allDates.push(new Date(i.created_at))
    for (const s of strategies || []) if (s.user_id === u.id && s.created_at) allDates.push(new Date(s.created_at))

    const lastActivity = allDates.length > 0
      ? new Date(Math.max(...allDates.map((d) => d.getTime()))).toLocaleDateString("es-AR")
      : "-"

    const ob = onboardingList.find((o) => o.user_id === u.id)

    return {
      userId: u.id,
      createdAt: u.created_at ? new Date(u.created_at).toLocaleDateString("es-AR") : "-",
      lastActivity,
      onboardingStatus: ob?.status || "sin registro",
      onboardingProgress: ob?.progress_percentage || 0,
      totalActions,
      ...activity,
    }
  }).sort((a, b) => b.totalActions - a.totalActions)

  // -- Engagement scoring --
  const getEngagementLevel = (u: UserDetail) => {
    if (u.totalActions === 0) return { label: "Inactivo", variant: "outline" as const, icon: Minus }
    if (u.totalActions <= 5) return { label: "Bajo", variant: "secondary" as const, icon: ArrowDownRight }
    if (u.totalActions <= 20) return { label: "Medio", variant: "default" as const, icon: ArrowUpRight }
    return { label: "Alto", variant: "default" as const, icon: ArrowUpRight }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Analytics de Uso</h1>
        <p className="text-muted-foreground mt-1">
          Adopcion, engagement y actividad de {totalUsers} usuarios registrados
        </p>
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
            <p className="text-xs text-muted-foreground">{activeUsers > 0 ? (totalBookmarks / activeUsers).toFixed(1) : 0} promedio por usuario activo</p>
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

      {/* Charts Row 1: Activity + Onboarding */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <UserActivityChart data={userActivityData} />
        </div>
        <OnboardingPieChart data={onboardingStatusData} />
      </div>

      {/* Charts Row 2: Features + Weekly */}
      <div className="grid gap-6 lg:grid-cols-2">
        <FeatureUsageChart data={featureUsageData} />
        <WeeklyActivityChart data={weeklyActivityData} />
      </div>

      {/* User Detail Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detalle por Usuario</CardTitle>
          <CardDescription>
            Metricas detalladas de cada usuario ordenadas por actividad total
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">Usuario</TableHead>
                  <TableHead className="text-center">Engagement</TableHead>
                  <TableHead className="text-center">Onboarding</TableHead>
                  <TableHead className="text-center"><span title="Bookmarks - Cuentas guardadas"><Bookmark className="h-3.5 w-3.5 mx-auto" /></span></TableHead>
                  <TableHead className="text-center"><span title="Prospectos - Contactos via Apollo"><Target className="h-3.5 w-3.5 mx-auto" /></span></TableHead>
                  <TableHead className="text-center"><span title="Noticias - Noticias buscadas"><Newspaper className="h-3.5 w-3.5 mx-auto" /></span></TableHead>
                  <TableHead className="text-center"><span title="Implementaciones - Casos de uso"><Briefcase className="h-3.5 w-3.5 mx-auto" /></span></TableHead>
                  <TableHead className="text-center"><span title="Estrategias - Generadas con IA"><BrainCircuit className="h-3.5 w-3.5 mx-auto" /></span></TableHead>
                  <TableHead className="text-center"><span title="Icebreakers - Mensajes generados"><Sparkles className="h-3.5 w-3.5 mx-auto" /></span></TableHead>
                  <TableHead className="text-center"><span title="Briefs - Briefs ejecutivos"><FileText className="h-3.5 w-3.5 mx-auto" /></span></TableHead>
                  <TableHead className="text-center"><span title="Documentos - Docs subidos"><FileText className="h-3.5 w-3.5 mx-auto text-indigo-500" /></span></TableHead>
                  <TableHead className="text-right">Ultima act.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {userDetails.map((u) => {
                  const engagement = getEngagementLevel(u)
                  const EngIcon = engagement.icon
                  return (
                    <TableRow key={u.userId}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm truncate max-w-[200px]">{u.email}</p>
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
                      <TableCell className="text-right text-xs text-muted-foreground">{u.lastActivity}</TableCell>
                    </TableRow>
                  )
                })}
                {userDetails.length === 0 && (
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
          <div className="grid gap-3 sm:grid-cols-2 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <Bookmark className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Bookmarks</strong> - Cuentas guardadas por el usuario</span>
            </div>
            <div className="flex items-start gap-2">
              <Target className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Prospectos</strong> - Contactos buscados via Apollo</span>
            </div>
            <div className="flex items-start gap-2">
              <Newspaper className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Noticias</strong> - Noticias buscadas por cuenta</span>
            </div>
            <div className="flex items-start gap-2">
              <Briefcase className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Implementaciones</strong> - Casos de uso buscados</span>
            </div>
            <div className="flex items-start gap-2">
              <BrainCircuit className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Estrategias</strong> - Estrategias generadas con IA</span>
            </div>
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Icebreakers</strong> - Mensajes generados con IA</span>
            </div>
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 mt-0.5 shrink-0" />
              <span><strong className="text-foreground">Briefs</strong> - Briefs ejecutivos generados</span>
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
