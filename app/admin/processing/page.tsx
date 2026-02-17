"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ShieldAlert,
  Database,
  Users,
  Building2,
  Activity,
  TrendingUp,
  Layers,
  Package,
  Store,
  Loader2,
  ChevronDown,
  ChevronRight,
  Briefcase,
  Play,
  FileText,
} from "lucide-react"
import {
  getDashboardCounts,
  getCronHealth,
  getImportBatches,
  getRecentActivity,
  getDictionaryJobs,
  getPendingImportRowsCount,
  getBatchErrors,
} from "@/app/actions/processing"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { createClient } from "@/lib/supabase/client"

// ─── Types ───────────────────────────────────────────────────────────────

type DashboardCounts = Awaited<ReturnType<typeof getDashboardCounts>>
type CronEntry = Awaited<ReturnType<typeof getCronHealth>>[number]
type ImportBatch = Awaited<ReturnType<typeof getImportBatches>>[number]
type DictionaryJob = Awaited<ReturnType<typeof getDictionaryJobs>>[number]
type ActivityEvent = Awaited<ReturnType<typeof getRecentActivity>>[number]

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatTimeAgo(dateStr: string | null) {
  if (!dateStr) return "Nunca"
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return "Ahora"
  if (diffMins < 60) return `Hace ${diffMins}m`
  if (diffHours < 24) return `Hace ${diffHours}h ${diffMins % 60}m`
  return `Hace ${diffDays}d ${diffHours % 24}h`
}

function formatNumber(n: number | undefined | null) {
  if (n == null) return "-"
  return n.toLocaleString("es-AR")
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "healthy":
      return <Badge className="bg-green-600 text-white gap-1"><CheckCircle className="h-3 w-3" />OK</Badge>
    case "warning":
      return <Badge className="bg-amber-600 text-white gap-1"><AlertTriangle className="h-3 w-3" />Alerta</Badge>
    case "critical":
      return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Critico</Badge>
    case "pending":
      return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Pendiente</Badge>
    case "processing":
      return <Badge className="gap-1 bg-blue-600 text-white"><Loader2 className="h-3 w-3 animate-spin" />Procesando</Badge>
    case "completed":
      return <Badge className="gap-1 bg-green-600 text-white"><CheckCircle className="h-3 w-3" />Completado</Badge>
    case "failed":
      return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Error</Badge>
    default:
      return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />{status || "Desconocido"}</Badge>
  }
}

// ─── Main Component ──────────────────────────────────────────────────────

export default function ProcessingPage() {
  const [counts, setCounts] = useState<DashboardCounts>(null)
  const [crons, setCrons] = useState<CronEntry[]>([])
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [dictJobs, setDictJobs] = useState<DictionaryJob[]>([])
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [pendingRows, setPendingRows] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const fetchAll = useCallback(async () => {
    setIsLoading(true)
    try {
      const [c, cr, b, dj, act, pr] = await Promise.all([
        getDashboardCounts(),
        getCronHealth(),
        getImportBatches(30),
        getDictionaryJobs(20),
        getRecentActivity(50),
        getPendingImportRowsCount(),
      ])
      if (c) setCounts(c)
      setCrons(cr)
      setBatches(b)
      setDictJobs(dj)
      setActivity(act)
      setPendingRows(pr)
      setLastRefresh(new Date())
    } catch (e) {
      console.error("Error fetching:", e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 30000)
    return () => clearInterval(interval)
  }, [fetchAll])

  // ─── Overall health ───
  const overallHealth = (() => {
    if (!counts) return "loading"
    const hasCriticalCron = crons.some((c) => c.status === "critical")
    if (hasCriticalCron || pendingRows > 50000) return "critical"
    if (pendingRows > 10000 || crons.some((c) => c.status === "warning")) return "warning"
    return "healthy"
  })()

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-sans text-foreground text-balance">Dashboard de Procesamiento</h1>
          <p className="text-muted-foreground text-sm">
            Estado del sistema y cola de procesamiento — Actualizado {formatTimeAgo(lastRefresh.toISOString())}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {overallHealth === "healthy" && (
            <Badge className="bg-green-600 text-white gap-1 text-sm py-1 px-3"><Activity className="h-4 w-4" />Sistema OK</Badge>
          )}
          {overallHealth === "warning" && (
            <Badge className="bg-amber-600 text-white gap-1 text-sm py-1 px-3"><AlertTriangle className="h-4 w-4" />Atencion</Badge>
          )}
          {overallHealth === "critical" && (
            <Badge variant="destructive" className="gap-1 text-sm py-1 px-3"><ShieldAlert className="h-4 w-4" />Critico</Badge>
          )}
          <Button variant="outline" size="icon" onClick={fetchAll} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Senales" value={formatNumber(counts?.signals_total)} sub={`Procesos: ${formatNumber(counts?.signals_process)} | Tech: ${formatNumber(counts?.signals_technology)}`} />
        <StatCard icon={<Users className="h-4 w-4" />} label="Contactos" value={formatNumber(counts?.contacts_total)} />
        <StatCard icon={<Building2 className="h-4 w-4" />} label="Companias" value={formatNumber(counts?.companies_total)} />
        <StatCard icon={<Briefcase className="h-4 w-4" />} label="Jobs Completados" value={formatNumber(counts?.jobs_completed)} />
        <StatCard
          icon={<Database className="h-4 w-4" />}
          label="Cola Pendiente"
          value={formatNumber(pendingRows)}
          sub={`${counts?.batches_processing || 0} batches activos`}
          highlight={pendingRows > 10000 ? "amber" : pendingRows > 0 ? "blue" : undefined}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="pipeline" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="crons">CRONs</TabsTrigger>
          <TabsTrigger value="dictionary">Diccionario</TabsTrigger>
          <TabsTrigger value="activity">Actividad</TabsTrigger>
        </TabsList>

        {/* ────────── Pipeline Tab ────────── */}
        <TabsContent value="pipeline" className="space-y-4">
          {/* Batch summary cards */}
          <div className="grid grid-cols-4 gap-4">
            <MiniStat label="Pendientes" value={counts?.batches_pending || 0} color="text-muted-foreground" />
            <MiniStat label="Procesando" value={counts?.batches_processing || 0} color="text-blue-600" />
            <MiniStat label="Completados" value={counts?.batches_completed || 0} color="text-green-600" />
            <MiniStat label="Fallidos" value={counts?.batches_failed || 0} color="text-red-600" />
          </div>

          {/* Batches table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Import Batches</CardTitle>
              <CardDescription>Ultimos 30 batches de ingesta — auto-refresh cada 30s</CardDescription>
            </CardHeader>
            <CardContent>
              <BatchTable batches={batches} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ────────── CRONs Tab ────────── */}
        <TabsContent value="crons" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Estado de Tareas Programadas</CardTitle>
              <CardDescription>Vercel Cron Jobs — los pg_cron fueron eliminados para evitar deadlocks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {crons.map((cron) => (
                <CronRow key={cron.name} cron={cron} />
              ))}
              {crons.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-4">No se encontraron ejecuciones de cron.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ────────── Dictionary Tab ────────── */}
        <TabsContent value="dictionary" className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Layers className="h-4 w-4" />Procesos</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{counts?.dictionary_processes || 0}</div>
                <p className="text-sm text-muted-foreground">{formatNumber(counts?.keywords_process)} keywords</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Package className="h-4 w-4" />Productos</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{counts?.dictionary_products || 0}</div>
                <p className="text-sm text-muted-foreground">{formatNumber(counts?.keywords_technology)} keywords</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2"><Store className="h-4 w-4" />Vendors</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{counts?.dictionary_vendors || 0}</div>
                <p className="text-sm text-muted-foreground">Proveedores registrados</p>
              </CardContent>
            </Card>
          </div>

          {/* Dictionary jobs */}
          <DictionaryJobsSection jobs={dictJobs} onRefresh={fetchAll} />
        </TabsContent>

        {/* ────────── Activity Tab ────────── */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Actividad Reciente</CardTitle>
              <CardDescription>Ultimos 50 eventos del sistema</CardDescription>
            </CardHeader>
            <CardContent>
              <ActivityLog events={activity} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, highlight }: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  highlight?: "amber" | "blue"
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          {icon}{label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${highlight === "amber" ? "text-amber-600" : highlight === "blue" ? "text-blue-600" : ""}`}>
          {value}
        </div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 text-center">
        <div className={`text-2xl font-bold ${color}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

function CronRow({ cron }: { cron: CronEntry }) {
  const iconMap: Record<string, React.ReactNode> = {
    "process-queue": <Database className="h-5 w-5" />,
    "process-dictionary": <Layers className="h-5 w-5" />,
    "monitor": <Activity className="h-5 w-5" />,
    "sync-users": <Users className="h-5 w-5" />,
    "cleanup": <RefreshCw className="h-5 w-5" />,
  }

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg">
      <div className="flex items-center gap-4">
        <div className="p-2 bg-muted rounded-lg">
          {iconMap[cron.name] || <Activity className="h-5 w-5" />}
        </div>
        <div>
          <div className="font-medium">{cron.label}</div>
          <div className="text-sm text-muted-foreground">{cron.schedule}</div>
          {cron.recordsProcessed > 0 && (
            <div className="text-xs text-green-600 mt-0.5">{cron.recordsProcessed} registros en ultima ejecucion</div>
          )}
          {cron.error && (
            <div className="text-xs text-red-600 mt-0.5 max-w-md truncate">Error: {cron.error}</div>
          )}
        </div>
      </div>
      <div className="text-right flex flex-col items-end gap-1">
        <StatusBadge status={cron.status} />
        <span className="text-xs text-muted-foreground">{formatTimeAgo(cron.lastRun)}</span>
      </div>
    </div>
  )
}

function BatchTable({ batches }: { batches: ImportBatch[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [errors, setErrors] = useState<{ message: string; count: number }[]>([])

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    const errs = await getBatchErrors(id)
    setErrors(errs)
  }

  return (
    <div className="overflow-auto max-h-[500px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Archivo</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Procesadas</TableHead>
            <TableHead className="text-right">Fallidas</TableHead>
            <TableHead>Progreso</TableHead>
            <TableHead className="text-right">Fecha</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((b) => {
            const pct = b.total_rows > 0 ? Math.round(((b.processed_rows || 0) + (b.failed_rows || 0)) / b.total_rows * 100) : 0
            const hasFailed = (b.failed_rows || 0) > 0
            const isExpanded = expandedId === b.id

            return (
              <TableRow key={b.id} className="group">
                <TableCell>
                  {hasFailed && (
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleExpand(b.id)}>
                      {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </Button>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs max-w-[200px] truncate" title={b.filename}>{b.filename}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-xs capitalize">{b.batch_type}</Badge>
                </TableCell>
                <TableCell><StatusBadge status={b.status} /></TableCell>
                <TableCell className="text-right text-sm">{formatNumber(b.total_rows)}</TableCell>
                <TableCell className="text-right text-sm text-green-600">{formatNumber(b.processed_rows)}</TableCell>
                <TableCell className="text-right text-sm text-red-600">{(b.failed_rows || 0) > 0 ? formatNumber(b.failed_rows) : "-"}</TableCell>
                <TableCell className="w-32">
                  <div className="flex items-center gap-2">
                    <Progress value={pct} className="h-2 flex-1" />
                    <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                  </div>
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">{formatTimeAgo(b.created_at)}</TableCell>
              </TableRow>
            )
          })}
          {batches.length === 0 && (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground py-8">No hay batches de importacion.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Expanded error detail */}
      {expandedId && errors.length > 0 && (
        <div className="mt-2 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg">
          <h4 className="text-sm font-medium text-red-800 dark:text-red-300 mb-2">Errores del batch</h4>
          <div className="space-y-1">
            {errors.map((e, i) => (
              <div key={i} className="flex justify-between text-xs">
                <span className="text-red-700 dark:text-red-400 truncate max-w-md font-mono">{e.message}</span>
                <Badge variant="destructive" className="text-xs ml-2">{e.count}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DictionaryJobsSection({ jobs, onRefresh }: { jobs: DictionaryJob[]; onRefresh: () => void }) {
  const supabase = createClient()

  const handleRetryFailed = async () => {
    await supabase
      .from("dictionary_jobs")
      .update({ status: "pending", error_message: null, started_at: null } as Record<string, unknown>)
      .eq("status", "failed")
    onRefresh()
  }

  const handleUnstickJobs = async () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    await supabase
      .from("dictionary_jobs")
      .update({ status: "pending", started_at: null } as Record<string, unknown>)
      .eq("status", "processing")
      .lt("started_at", thirtyMinutesAgo)
    onRefresh()
  }

  const failedCount = jobs.filter((j) => j.status === "failed").length
  const processingCount = jobs.filter((j) => j.status === "processing").length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jobs del Diccionario</CardTitle>
        <CardDescription>
          Ultimos 20 jobs — se generan al agregar/eliminar keywords
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(failedCount > 0 || processingCount > 0) && (
          <div className="flex gap-2">
            {failedCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleRetryFailed}>
                <RefreshCw className="h-3 w-3 mr-1" />Reintentar {failedCount} fallidos
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleUnstickJobs}>
              <Play className="h-3 w-3 mr-1" />Desbloquear estancados
            </Button>
          </div>
        )}

        <div className="overflow-auto max-h-[400px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Estado</TableHead>
                <TableHead>Keyword</TableHead>
                <TableHead>Accion</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Progreso</TableHead>
                <TableHead className="text-right">Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell><StatusBadge status={job.status} /></TableCell>
                  <TableCell className="font-mono text-sm truncate max-w-xs">{job.keyword || "N/A"}</TableCell>
                  <TableCell className="text-sm">{job.job_type === "add_keyword" ? "Agregar" : "Eliminar"}</TableCell>
                  <TableCell className="text-sm capitalize">{job.signal_type}</TableCell>
                  <TableCell className="text-right text-sm">
                    {job.total_records > 0
                      ? `${Math.round((job.processed_records / job.total_records) * 100)}%`
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">{formatTimeAgo(job.created_at)}</TableCell>
                </TableRow>
              ))}
              {jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No hay jobs recientes.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

function ActivityLog({ events }: { events: ActivityEvent[] }) {
  const typeColors: Record<string, string> = {
    batch_completed: "text-green-600",
    batch_process_start: "text-blue-600",
    batch_partial: "text-blue-500",
    chunk_processed: "text-muted-foreground",
    batch_failed: "text-red-600",
    signal_error: "text-red-600",
    row_error: "text-red-500",
  }

  return (
    <div className="max-h-[500px] overflow-y-auto space-y-1">
      {events.map((ev, i) => (
        <div key={i} className="flex items-start gap-3 text-xs py-1.5 border-b border-border/50 last:border-0">
          <span className="text-muted-foreground whitespace-nowrap w-20 shrink-0">
            {new Date(ev.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <Badge variant="outline" className={`text-[10px] shrink-0 ${typeColors[ev.event_type] || ""}`}>
            {ev.event_type}
          </Badge>
          <span className="text-foreground truncate">{ev.message}</span>
        </div>
      ))}
      {events.length === 0 && (
        <p className="text-muted-foreground text-sm text-center py-8">No hay actividad reciente.</p>
      )}
    </div>
  )
}
