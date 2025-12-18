"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Play, Loader2, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, ShieldAlert } from "lucide-react"
import { processSignals, getProcessingStats } from "@/app/actions/processing"
import { Progress } from "@/components/ui/progress"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ImportBatchesStatus } from "./_components/import-batches-status"
import { ProcessingLogs } from "./_components/processing-logs"
import { CronHealth } from "./_components/cron-health"
import { SignalsStatus } from "./_components/signals-status"

type DictionaryJob = {
  id: string
  job_type: string
  signal_type: string
  keyword: string | null
  status: string
  progress: number
  total_records: number
  processed_records: number
  contacts_processed: number
  contacts_total: number
  job_postings_processed: number
  job_postings_total: number
  phase: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

type SystemAlert = {
  id: string
  level: "critical" | "warning" | "info"
  title: string
  message: string
  context?: Record<string, unknown>
}

export default function ProcessingPage() {
  const [stats, setStats] = useState({ pending: 0, signals: 0, isSystemProcessing: false })
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [dictionaryJobs, setDictionaryJobs] = useState<DictionaryJob[]>([])
  const [dictPending, setDictPending] = useState(0)
  const [dictProcessing, setDictProcessing] = useState(0)
  const [dictFailed, setDictFailed] = useState(0)
  const [alerts, setAlerts] = useState<SystemAlert[]>([])
  const [totalPendingJobs, setTotalPendingJobs] = useState(0)
  const [activeTab, setActiveTab] = useState("ingesta") // New state for tab management

  const supabase = createClient()

  const fetchStats = async () => {
    const newStats = await getProcessingStats()
    setStats(newStats)
  }

  const fetchDictionaryJobs = async () => {
    const { data, error } = await supabase
      .from("dictionary_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100)

    if (!error && data) {
      setDictionaryJobs(data.slice(0, 20)) // Show only 20 in table

      const pending = data.filter((j) => j.status === "pending").length
      const processing = data.filter((j) => j.status === "processing")
      const failed = data.filter((j) => j.status === "failed")

      setDictPending(pending)
      setDictProcessing(processing.length)
      setDictFailed(failed.length)

      const { count } = await supabase
        .from("dictionary_jobs")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending")

      setTotalPendingJobs(count || 0)

      const newAlerts: SystemAlert[] = []

      // Check for stuck jobs (processing > 30 min)
      const now = new Date()
      const stuckJobs = processing.filter((j) => {
        if (!j.started_at) return false
        const started = new Date(j.started_at)
        const diffMinutes = (now.getTime() - started.getTime()) / 60000
        return diffMinutes > 30
      })

      if (stuckJobs.length > 0) {
        newAlerts.push({
          id: "stuck-jobs",
          level: "critical",
          title: `${stuckJobs.length} job(s) estancados`,
          message: `Jobs en "processing" por más de 30 minutos: ${stuckJobs.map((j) => j.keyword).join(", ")}`,
        })
      }

      // Check for failed jobs
      if (failed.length > 0) {
        newAlerts.push({
          id: "failed-jobs",
          level: failed.length >= 10 ? "critical" : "warning",
          title: `${failed.length} job(s) fallidos`,
          message: `Errores: ${[...new Set(failed.map((j) => j.error_message))].slice(0, 3).join("; ")}`,
          context: { keywords: failed.slice(0, 5).map((j) => j.keyword) },
        })
      }

      // Check pending queue
      if ((count || 0) >= 500) {
        newAlerts.push({
          id: "queue-critical",
          level: "critical",
          title: `Cola crítica: ${count} jobs pendientes`,
          message: "El sistema puede estar detenido o procesando muy lento",
        })
      } else if ((count || 0) >= 100) {
        newAlerts.push({
          id: "queue-warning",
          level: "warning",
          title: `Cola alta: ${count} jobs pendientes`,
          message: "Considerar revisar el estado del procesamiento",
        })
      }

      // Check if no processing and pending exist
      if (processing.length === 0 && (count || 0) > 0) {
        // Check last completed job
        const { data: lastCompleted } = await supabase
          .from("dictionary_jobs")
          .select("completed_at")
          .eq("status", "completed")
          .order("completed_at", { ascending: false })
          .limit(1)
          .single()

        if (lastCompleted?.completed_at) {
          const lastCompletedTime = new Date(lastCompleted.completed_at)
          const hoursSince = (now.getTime() - lastCompletedTime.getTime()) / 3600000

          if (hoursSince > 2) {
            newAlerts.push({
              id: "no-progress",
              level: "critical",
              title: "Sistema posiblemente detenido",
              message: `No se ha completado ningún job en ${Math.round(hoursSince)} horas y hay ${count} pendientes`,
            })
          }
        }
      }

      setAlerts(newAlerts)
    }
  }

  const handleRetryFailed = async () => {
    const { error } = await supabase
      .from("dictionary_jobs")
      .update({ status: "pending", error_message: null, started_at: null })
      .eq("status", "failed")

    if (!error) {
      setLogs((prev) => ["Jobs fallidos reseteados a pendiente", ...prev])
      fetchDictionaryJobs()
    } else {
      setLogs((prev) => [`Error al resetear jobs: ${error.message}`, ...prev])
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
      fetchDictionaryJobs()
    } else {
      setLogs((prev) => [`Error al resetear jobs: ${error.message}`, ...prev])
    }
  }

  useEffect(() => {
    fetchStats()
    fetchDictionaryJobs()
    const interval = setInterval(
      () => {
        fetchStats()
        fetchDictionaryJobs()
      },
      dictProcessing > 0 ? 3000 : 5000,
    )
    return () => clearInterval(interval)
  }, [dictProcessing])

  const handleProcess = async () => {
    setIsProcessing(true)
    setLogs((prev) => ["Iniciando procesamiento manual...", ...prev])
    setProgress(0)

    const BATCH_SIZE = 10
    let totalProcessed = 0
    const initialPending = stats.pending

    try {
      while (true) {
        const result = await processSignals(BATCH_SIZE)

        if (!result.success) {
          setLogs((prev) => [`Error: ${result.error}`, ...prev])
          break
        }

        if (result.processed === 0) {
          setLogs((prev) => ["No hay más filas pendientes en la cola.", ...prev])
          break
        }

        totalProcessed += result.processed

        const currentProgress =
          initialPending > 0 ? Math.min(Math.round((totalProcessed / initialPending) * 100), 100) : 0

        setProgress(currentProgress)
        setLogs((prev) => [`Procesadas ${result.processed} filas...`, ...prev])

        await fetchStats()

        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    } catch (error) {
      setLogs((prev) => [`Error inesperado: ${error}`, ...prev])
    } finally {
      setIsProcessing(false)
      setLogs((prev) => ["Ejecución manual finalizada.", ...prev])
      fetchStats()
    }
  }

  const formatJobType = (type: string) => {
    switch (type) {
      case "add_keyword":
        return "Agregar Keyword"
      case "remove_keyword":
        return "Eliminar Keyword"
      case "add_product":
        return "Nuevo Producto"
      case "add_process":
        return "Nuevo Proceso"
      default:
        return type
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
          <Badge variant="default" className="gap-1 bg-green-600">
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

  const getElapsedTime = (startedAt: string | null) => {
    if (!startedAt) return null
    const started = new Date(startedAt)
    const now = new Date()
    const diffMs = now.getTime() - started.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours > 0) {
      return `${diffHours}h ${diffMins % 60}m`
    }
    return `${diffMins}m`
  }

  const getActiveJobsStats = () => {
    const activeJobs = dictionaryJobs.filter((j) => j.status === "processing")
    if (activeJobs.length === 0) return null

    const totalContacts = activeJobs.reduce((sum, j) => sum + (j.contacts_total || 0), 0)
    const processedContacts = activeJobs.reduce((sum, j) => sum + (j.contacts_processed || 0), 0)
    const totalJobPostings = activeJobs.reduce((sum, j) => sum + (j.job_postings_total || 0), 0)
    const processedJobPostings = activeJobs.reduce((sum, j) => sum + (j.job_postings_processed || 0), 0)

    return {
      activeCount: activeJobs.length,
      contacts: { processed: processedContacts, total: totalContacts },
      jobPostings: { processed: processedJobPostings, total: totalJobPostings },
    }
  }

  const activeStats = getActiveJobsStats()
  const hasCriticalAlerts = alerts.some((a) => a.level === "critical")
  const hasWarningAlerts = alerts.some((a) => a.level === "warning")

  return (
    <div className="space-y-6 pb-10">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Procesamiento de Señales</h1>
          <p className="text-muted-foreground">ETL en tiempo real: Ingesta → Señales → Diccionario</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            fetchStats()
            fetchDictionaryJobs()
          }}
          disabled={isProcessing}
        >
          <RefreshCw className={`h-4 w-4 ${isProcessing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {hasCriticalAlerts && (
        <div className="space-y-2">
          {alerts
            .filter((a) => a.level === "critical")
            .map((alert) => (
              <Alert key={alert.id} variant="destructive" className="border-red-500 bg-red-50 dark:bg-red-950/20">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>{alert.title}</AlertTitle>
                <AlertDescription>{alert.message}</AlertDescription>
              </Alert>
            ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Batches Activos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.isSystemProcessing ? "✓ Activo" : "Idle"}</div>
            <p className="text-xs text-muted-foreground mt-1">Ingesta de contactos/jobs</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Señales Pendientes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.signals.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">En cola de procesamiento</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Jobs Diccionario</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 text-sm font-medium">
              <span className="text-blue-600">{dictProcessing} activos</span>
              <span className="text-amber-600">{dictPending} pendientes</span>
              {dictFailed > 0 && <span className="text-red-600">{dictFailed} fallidos</span>}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Estado diccionario</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="ingesta">Ingesta</TabsTrigger>
          <TabsTrigger value="señales">Señales</TabsTrigger>
          <TabsTrigger value="diccionario">Diccionario</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="ingesta" className="space-y-4">
          <ImportBatchesStatus />
          <CronHealth />
        </TabsContent>

        <TabsContent value="señales" className="space-y-4">
          <SignalsStatus />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Ejecución Manual</span>
                {isProcessing && <Loader2 className="h-5 w-5 animate-spin" />}
              </CardTitle>
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

        <TabsContent value="diccionario" className="space-y-4">
          {hasWarningAlerts && (
            <div className="space-y-2">
              {alerts
                .filter((a) => a.level === "warning")
                .map((alert) => (
                  <Alert key={alert.id} className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>{alert.title}</AlertTitle>
                    <AlertDescription>{alert.message}</AlertDescription>
                  </Alert>
                ))}
            </div>
          )}

          <div className="flex gap-2 mb-4">
            {alerts.some((a) => a.id === "failed-jobs") && (
              <Button variant="outline" size="sm" onClick={handleRetryFailed}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Reintentar Fallidos
              </Button>
            )}
            {alerts.some((a) => a.id === "stuck-jobs") && (
              <Button variant="outline" size="sm" onClick={handleUnstickJobs}>
                <Play className="h-3 w-3 mr-1" />
                Desbloquear Estancados
              </Button>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Jobs Recientes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">Estado</TableHead>
                      <TableHead>Keyword</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Progreso</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dictionaryJobs.slice(0, 10).map((job) => (
                      <TableRow key={job.id}>
                        <TableCell>{getStatusBadge(job.status)}</TableCell>
                        <TableCell className="font-mono text-sm truncate max-w-xs">{job.keyword || "N/A"}</TableCell>
                        <TableCell>{formatJobType(job.job_type)}</TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm">
                            {job.total_records > 0
                              ? `${Math.round((job.processed_records / job.total_records) * 100)}%`
                              : "0%"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <ProcessingLogs />
        </TabsContent>
      </Tabs>
    </div>
  )
}
