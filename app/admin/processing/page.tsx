"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Play,
  Loader2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ShieldAlert,
  Database,
  Users,
  Building2,
  Cpu,
  Activity,
  TrendingUp,
  Layers,
  BookOpen,
  Package,
  Store,
} from "lucide-react"
import { processSignals, getDashboardStats, getCronHealth } from "@/app/actions/processing"
import { Progress } from "@/components/ui/progress"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProcessingLogs } from "./_components/processing-logs"

type DashboardStats = {
  signals: {
    total: number
    byType: { process: number; technology: number }
  }
  dictionaryJobs: {
    pending: number
    processing: number
    completed: number
    failed: number
    total: number
    lastCompleted: string | null
    lastCreated: string | null
  }
  importBatches: {
    pending: number
    processing: number
    completed: number
    failed: number
    total: number
    lastActivity: string | null
  }
  entities: {
    contacts: number
    companies: number
  }
  dictionary: {
    processes: number
    products: number
    vendors: number
    processKeywords: number
    productKeywords: number
  }
}

type CronExecution = {
  status: string
  lastRun: string | null
  completedAt?: string | null
  minutesAgo: number | null
  recordsProcessed?: number
  signalsCreated?: number
  errorMessage?: string | null
  executionStatus?: string | null
}

type CronHealth = {
  processDictionary: CronExecution
  processQueue: CronExecution
  monitor: CronExecution
  syncUsers: CronExecution
}

type DictionaryJob = {
  id: string
  job_type: string
  signal_type: string
  keyword: string | null
  status: string
  progress: number
  total_records: number
  processed_records: number
  phase: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

export default function ProcessingPage() {
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null)
  const [cronHealth, setCronHealth] = useState<CronHealth | null>(null)
  const [dictionaryJobs, setDictionaryJobs] = useState<DictionaryJob[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const supabase = createClient()

  const fetchAllData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [stats, crons, jobsResult] = await Promise.all([
        getDashboardStats(),
        getCronHealth(),
        supabase.from("dictionary_jobs").select("*").order("created_at", { ascending: false }).limit(50),
      ])

      if (stats) setDashboardStats(stats)
      if (crons) setCronHealth(crons)
      if (jobsResult.data) setDictionaryJobs(jobsResult.data)
      setLastRefresh(new Date())
    } catch (error) {
      console.error("Error fetching dashboard data:", error)
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchAllData()
    const interval = setInterval(fetchAllData, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [fetchAllData])

  const handleRetryFailed = async () => {
    const { error } = await supabase
      .from("dictionary_jobs")
      .update({ status: "pending", error_message: null, started_at: null })
      .eq("status", "failed")

    if (!error) {
      setLogs((prev) => ["Jobs fallidos reseteados a pendiente", ...prev])
      fetchAllData()
    }
  }

  const handleUnstickJobs = async () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { error } = await supabase
      .from("dictionary_jobs")
      .update({ status: "pending", started_at: null })
      .eq("status", "processing")
      .lt("started_at", thirtyMinutesAgo)

    if (!error) {
      setLogs((prev) => ["Jobs estancados reseteados a pendiente", ...prev])
      fetchAllData()
    }
  }

  const handleProcess = async () => {
    setIsProcessing(true)
    setProgress(0)
    setLogs((prev) => ["Iniciando procesamiento manual...", ...prev])

    try {
      const BATCH_SIZE = 10
      let totalProcessed = 0

      while (true) {
        const result = await processSignals(BATCH_SIZE)
        if (!result.success || result.processed === 0) break
        totalProcessed += result.processed
        setProgress(Math.min(totalProcessed, 100))
        setLogs((prev) => [`Procesadas ${result.processed} filas...`, ...prev])
        await new Promise((resolve) => setTimeout(resolve, 500))
      }

      setLogs((prev) => ["Procesamiento manual finalizado.", ...prev])
    } catch (error) {
      setLogs((prev) => [`Error: ${error}`, ...prev])
    } finally {
      setIsProcessing(false)
      fetchAllData()
    }
  }

  const formatTimeAgo = (dateStr: string | null) => {
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

  const getHealthBadge = (status: string) => {
    switch (status) {
      case "healthy":
        return (
          <Badge className="bg-green-600 gap-1">
            <CheckCircle className="h-3 w-3" />
            Saludable
          </Badge>
        )
      case "warning":
        return (
          <Badge className="bg-amber-600 gap-1">
            <AlertTriangle className="h-3 w-3" />
            Atención
          </Badge>
        )
      case "critical":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Crítico
          </Badge>
        )
      default:
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Desconocido
          </Badge>
        )
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Pendiente
          </Badge>
        )
      case "processing":
        return (
          <Badge className="gap-1 bg-blue-600">
            <Loader2 className="h-3 w-3 animate-spin" />
            Procesando
          </Badge>
        )
      case "completed":
        return (
          <Badge className="gap-1 bg-green-600">
            <CheckCircle className="h-3 w-3" />
            Completado
          </Badge>
        )
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Error
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const getOverallHealth = () => {
    if (!dashboardStats || !cronHealth) return "loading"

    const hasCriticalCron = Object.values(cronHealth).some((c) => c.status === "critical")
    const hasFailedJobs = dashboardStats.dictionaryJobs.failed > 0
    const hasHighQueue = dashboardStats.dictionaryJobs.pending > 500

    if (hasCriticalCron || hasHighQueue) return "critical"
    if (hasFailedJobs || dashboardStats.dictionaryJobs.pending > 100) return "warning"
    return "healthy"
  }

  const overallHealth = getOverallHealth()

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard de Plataforma</h1>
          <p className="text-muted-foreground">
            Estado de salud y métricas del sistema • Actualizado {formatTimeAgo(lastRefresh.toISOString())}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {overallHealth === "healthy" && (
            <Badge className="bg-green-600 gap-1 text-sm py-1 px-3">
              <Activity className="h-4 w-4" />
              Sistema Saludable
            </Badge>
          )}
          {overallHealth === "warning" && (
            <Badge className="bg-amber-600 gap-1 text-sm py-1 px-3">
              <AlertTriangle className="h-4 w-4" />
              Requiere Atención
            </Badge>
          )}
          {overallHealth === "critical" && (
            <Badge variant="destructive" className="gap-1 text-sm py-1 px-3">
              <ShieldAlert className="h-4 w-4" />
              Estado Crítico
            </Badge>
          )}
          <Button variant="outline" size="icon" onClick={fetchAllData} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {dashboardStats && dashboardStats.dictionaryJobs.failed > 0 && (
        <Alert variant="destructive" className="border-red-500">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>{dashboardStats.dictionaryJobs.failed} jobs fallidos</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>Hay jobs de diccionario que requieren atención.</span>
            <Button variant="outline" size="sm" onClick={handleRetryFailed}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Main Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Total Señales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboardStats?.signals.total.toLocaleString() || "-"}</div>
            <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
              <span>Procesos: {dashboardStats?.signals.byType.process.toLocaleString() || 0}</span>
              <span>•</span>
              <span>Tech: {dashboardStats?.signals.byType.technology.toLocaleString() || 0}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              Contactos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboardStats?.entities.contacts.toLocaleString() || "-"}</div>
            <p className="text-xs text-muted-foreground mt-1">En la base de datos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Compañías
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboardStats?.entities.companies.toLocaleString() || "-"}</div>
            <p className="text-xs text-muted-foreground mt-1">Registradas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              Jobs Diccionario
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboardStats?.dictionaryJobs.pending || 0}</div>
            <div className="flex gap-2 mt-1 text-xs">
              <span className="text-blue-600">{dashboardStats?.dictionaryJobs.processing || 0} activos</span>
              {(dashboardStats?.dictionaryJobs.failed || 0) > 0 && (
                <span className="text-red-600">{dashboardStats?.dictionaryJobs.failed} fallidos</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Resumen</TabsTrigger>
          <TabsTrigger value="crons">CRONs</TabsTrigger>
          <TabsTrigger value="dictionary">Diccionario</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Diccionario Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Diccionario
                </CardTitle>
                <CardDescription>Estado de los diccionarios de señales</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-muted rounded-lg">
                    <div className="text-2xl font-bold">{dashboardStats?.dictionary.processes || 0}</div>
                    <div className="text-xs text-muted-foreground">Procesos</div>
                    <div className="text-xs text-blue-600">
                      {dashboardStats?.dictionary.processKeywords || 0} keywords
                    </div>
                  </div>
                  <div className="text-center p-3 bg-muted rounded-lg">
                    <div className="text-2xl font-bold">{dashboardStats?.dictionary.products || 0}</div>
                    <div className="text-xs text-muted-foreground">Productos</div>
                    <div className="text-xs text-blue-600">
                      {dashboardStats?.dictionary.productKeywords || 0} keywords
                    </div>
                  </div>
                  <div className="text-center p-3 bg-muted rounded-lg">
                    <div className="text-2xl font-bold">{dashboardStats?.dictionary.vendors || 0}</div>
                    <div className="text-xs text-muted-foreground">Vendors</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Import Batches Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Import Batches
                </CardTitle>
                <CardDescription>Estado de la ingesta de datos</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-4 gap-2">
                  <div className="text-center p-2 bg-muted rounded-lg">
                    <div className="text-xl font-bold">{dashboardStats?.importBatches.pending || 0}</div>
                    <div className="text-xs text-muted-foreground">Pendientes</div>
                  </div>
                  <div className="text-center p-2 bg-muted rounded-lg">
                    <div className="text-xl font-bold text-blue-600">
                      {dashboardStats?.importBatches.processing || 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Procesando</div>
                  </div>
                  <div className="text-center p-2 bg-muted rounded-lg">
                    <div className="text-xl font-bold text-green-600">
                      {dashboardStats?.importBatches.completed || 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Completados</div>
                  </div>
                  <div className="text-center p-2 bg-muted rounded-lg">
                    <div className="text-xl font-bold text-red-600">{dashboardStats?.importBatches.failed || 0}</div>
                    <div className="text-xs text-muted-foreground">Fallidos</div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Última actividad: {formatTimeAgo(dashboardStats?.importBatches.lastActivity || null)}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Manual Processing */}
          <Card>
            <CardHeader>
              <CardTitle>Procesamiento Manual</CardTitle>
              <CardDescription>Ejecutar procesamiento de señales manualmente</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {progress > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Progreso</span>
                    <span className="font-medium">{progress}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
              )}
              <Button onClick={handleProcess} disabled={isProcessing} className="w-full">
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Procesar Señales Manualmente
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CRONs Tab */}
        <TabsContent value="crons" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Estado de CRONs</CardTitle>
              <CardDescription>Monitoreo de tareas programadas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Process Dictionary CRON */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-muted rounded-lg">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium">process-dictionary</div>
                      <div className="text-sm text-muted-foreground">Procesa jobs del diccionario (cada 5 min)</div>
                      {cronHealth?.processDictionary.recordsProcessed !== undefined && cronHealth.processDictionary.recordsProcessed > 0 && (
                        <div className="text-xs text-green-600 mt-1">
                          Última ejecución: {cronHealth.processDictionary.recordsProcessed} jobs, {cronHealth.processDictionary.signalsCreated || 0} señales
                        </div>
                      )}
                      {cronHealth?.processDictionary.errorMessage && (
                        <div className="text-xs text-red-600 mt-1">
                          Error: {cronHealth.processDictionary.errorMessage}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {cronHealth && getHealthBadge(cronHealth.processDictionary.status)}
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatTimeAgo(cronHealth?.processDictionary.lastRun || null)}
                    </div>
                  </div>
                </div>

                {/* Process Queue CRON */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-muted rounded-lg">
                      <Database className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium">process-queue</div>
                      <div className="text-sm text-muted-foreground">Procesa cola de ingesta (cada 5 min)</div>
                      {cronHealth?.processQueue.recordsProcessed !== undefined && cronHealth.processQueue.recordsProcessed > 0 && (
                        <div className="text-xs text-green-600 mt-1">
                          Última ejecución: {cronHealth.processQueue.recordsProcessed} rows procesadas
                        </div>
                      )}
                      {cronHealth?.processQueue.errorMessage && (
                        <div className="text-xs text-red-600 mt-1">
                          Error: {cronHealth.processQueue.errorMessage}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {cronHealth && getHealthBadge(cronHealth.processQueue.status)}
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatTimeAgo(cronHealth?.processQueue.lastRun || null)}
                    </div>
                  </div>
                </div>

                {/* Monitor CRON */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-muted rounded-lg">
                      <Activity className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium">monitor</div>
                      <div className="text-sm text-muted-foreground">Monitoreo de salud del sistema (cada 15 min)</div>
                      {cronHealth?.monitor.errorMessage && (
                        <div className="text-xs text-red-600 mt-1">
                          Error: {cronHealth.monitor.errorMessage}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {cronHealth && getHealthBadge(cronHealth.monitor.status)}
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatTimeAgo(cronHealth?.monitor.lastRun || null)}
                    </div>
                  </div>
                </div>

                {/* Sync Users CRON */}
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-muted rounded-lg">
                      <Users className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="font-medium">sync-users</div>
                      <div className="text-sm text-muted-foreground">Sincroniza usuarios (diario 2am)</div>
                      {cronHealth?.syncUsers.recordsProcessed !== undefined && cronHealth.syncUsers.recordsProcessed > 0 && (
                        <div className="text-xs text-green-600 mt-1">
                          Última ejecución: {cronHealth.syncUsers.recordsProcessed} usuarios
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {cronHealth && getHealthBadge(cronHealth.syncUsers?.status || 'unknown')}
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatTimeAgo(cronHealth?.syncUsers?.lastRun || null)}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Dictionary Tab */}
        <TabsContent value="dictionary" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="h-4 w-4" />
                  Procesos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{dashboardStats?.dictionary.processes || 0}</div>
                <div className="text-sm text-muted-foreground">
                  {dashboardStats?.dictionary.processKeywords || 0} keywords totales
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Productos
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{dashboardStats?.dictionary.products || 0}</div>
                <div className="text-sm text-muted-foreground">
                  {dashboardStats?.dictionary.productKeywords || 0} keywords totales
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Store className="h-4 w-4" />
                  Vendors
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{dashboardStats?.dictionary.vendors || 0}</div>
                <div className="text-sm text-muted-foreground">Proveedores registrados</div>
              </CardContent>
            </Card>
          </div>

          {/* Dictionary Jobs Queue */}
          <Card>
            <CardHeader>
              <CardTitle>Cola de Jobs del Diccionario</CardTitle>
              <CardDescription>
                {dashboardStats?.dictionaryJobs.pending || 0} pendientes •
                {dashboardStats?.dictionaryJobs.processing || 0} procesando •
                {dashboardStats?.dictionaryJobs.completed || 0} completados
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                {(dashboardStats?.dictionaryJobs.failed || 0) > 0 && (
                  <Button variant="outline" size="sm" onClick={handleRetryFailed}>
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Reintentar {dashboardStats?.dictionaryJobs.failed} Fallidos
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={handleUnstickJobs}>
                  <Play className="h-3 w-3 mr-1" />
                  Desbloquear Estancados
                </Button>
              </div>
              <div className="text-xs text-muted-foreground mb-2">
                Última actividad: {formatTimeAgo(dashboardStats?.dictionaryJobs.lastCompleted || null)}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Jobs Tab */}
        <TabsContent value="jobs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Jobs Recientes</CardTitle>
              <CardDescription>Últimos 50 jobs del diccionario</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto max-h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Estado</TableHead>
                      <TableHead>Keyword</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Señal</TableHead>
                      <TableHead className="text-right">Progreso</TableHead>
                      <TableHead className="text-right">Creado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dictionaryJobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell>{getStatusBadge(job.status)}</TableCell>
                        <TableCell className="font-mono text-sm truncate max-w-xs">{job.keyword || "N/A"}</TableCell>
                        <TableCell className="text-sm">
                          {job.job_type === "add_keyword" ? "Agregar" : "Eliminar"}
                        </TableCell>
                        <TableCell className="text-sm capitalize">{job.signal_type}</TableCell>
                        <TableCell className="text-right text-sm">
                          {job.total_records > 0
                            ? `${Math.round((job.processed_records / job.total_records) * 100)}%`
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {formatTimeAgo(job.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs">
          <ProcessingLogs />
          {logs.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Logs de Sesión</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted p-4 rounded-lg max-h-[300px] overflow-y-auto font-mono text-sm">
                  {logs.map((log, i) => (
                    <div key={i} className="text-muted-foreground">
                      {log}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
