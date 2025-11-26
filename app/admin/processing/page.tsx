"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Play,
  Loader2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Activity,
  Users,
  Briefcase,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react"
import { processSignals, getProcessingStats } from "@/app/actions/processing"
import { Progress } from "@/components/ui/progress"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Procesamiento de Señales</h1>
          <p className="text-muted-foreground">Estado del motor de detección de señales y ejecución manual.</p>
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

      {alerts.length > 0 && (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <Alert
              key={alert.id}
              variant={alert.level === "critical" ? "destructive" : "default"}
              className={
                alert.level === "critical"
                  ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                  : alert.level === "warning"
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20"
                    : ""
              }
            >
              {alert.level === "critical" ? <ShieldAlert className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <AlertTitle className="flex items-center gap-2">
                {alert.title}
                <Badge variant={alert.level === "critical" ? "destructive" : "secondary"} className="text-xs">
                  {alert.level === "critical" ? "Crítico" : "Advertencia"}
                </Badge>
              </AlertTitle>
              <AlertDescription className="mt-1">
                {alert.message}
                {alert.context && (
                  <span className="block text-xs mt-1 opacity-70">
                    Keywords: {(alert.context.keywords as string[])?.join(", ")}
                  </span>
                )}
              </AlertDescription>
            </Alert>
          ))}

          {/* Quick action buttons for alerts */}
          <div className="flex gap-2">
            {alerts.some((a) => a.id === "failed-jobs") && (
              <Button variant="outline" size="sm" onClick={handleRetryFailed}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Reintentar Jobs Fallidos
              </Button>
            )}
            {alerts.some((a) => a.id === "stuck-jobs") && (
              <Button variant="outline" size="sm" onClick={handleUnstickJobs}>
                <Play className="h-3 w-3 mr-1" />
                Desbloquear Jobs Estancados
              </Button>
            )}
          </div>
        </div>
      )}

      {activeStats && (
        <Card className="border-blue-500 bg-blue-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="p-2 rounded-full bg-blue-500/10">
                <Activity className="h-5 w-5 text-blue-600 animate-pulse" />
              </div>
              <div>
                <h3 className="font-semibold text-blue-600">
                  {activeStats.activeCount} {activeStats.activeCount === 1 ? "Job" : "Jobs"} de Diccionario Activos
                </h3>
                <p className="text-sm text-muted-foreground">Procesando cambios de keywords en segundo plano</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Contactos
                  </span>
                  <span className="font-medium">
                    {activeStats.contacts.processed.toLocaleString()} / {activeStats.contacts.total.toLocaleString()}
                  </span>
                </div>
                <Progress
                  value={
                    activeStats.contacts.total > 0
                      ? (activeStats.contacts.processed / activeStats.contacts.total) * 100
                      : 0
                  }
                  className="h-2"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4" />
                    Job Postings
                  </span>
                  <span className="font-medium">
                    {activeStats.jobPostings.processed.toLocaleString()} /{" "}
                    {activeStats.jobPostings.total.toLocaleString()}
                  </span>
                </div>
                <Progress
                  value={
                    activeStats.jobPostings.total > 0
                      ? (activeStats.jobPostings.processed / activeStats.jobPostings.total) * 100
                      : 0
                  }
                  className="h-2"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-4">
        <Card
          className={totalPendingJobs >= 500 ? "border-red-500" : totalPendingJobs >= 100 ? "border-amber-500" : ""}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Jobs Pendientes (Total)</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${totalPendingJobs >= 500 ? "text-red-600" : totalPendingJobs >= 100 ? "text-amber-600" : ""}`}
            >
              {totalPendingJobs.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">En cola de dictionary_jobs</p>
          </CardContent>
        </Card>

        <Card className={dictFailed > 0 ? "border-red-500" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Jobs Fallidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${dictFailed > 0 ? "text-red-600" : "text-green-600"}`}>
              {dictFailed}
            </div>
            <p className="text-xs text-muted-foreground">{dictFailed > 0 ? "Requieren atención" : "Sin errores"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Señales Detectadas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.signals.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Total histórico</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Estado del Sistema</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                hasCriticalAlerts
                  ? "text-red-600"
                  : hasWarningAlerts
                    ? "text-amber-600"
                    : dictProcessing > 0
                      ? "text-blue-600"
                      : "text-green-600"
              }`}
            >
              {hasCriticalAlerts
                ? "Crítico"
                : hasWarningAlerts
                  ? "Advertencia"
                  : dictProcessing > 0
                    ? "Procesando"
                    : "Saludable"}
            </div>
            <p className="text-xs text-muted-foreground">
              {alerts.length > 0 ? `${alerts.length} alerta(s) activa(s)` : "Sin alertas"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              Jobs de Diccionario
              {(dictPending > 0 || dictProcessing > 0) && (
                <Badge variant="secondary" className="ml-2">
                  {dictPending + dictProcessing} activos
                </Badge>
              )}
              {dictFailed > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {dictFailed} fallidos
                </Badge>
              )}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {dictionaryJobs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No hay jobs de diccionario recientes.</p>
              <p className="text-xs mt-1">Los jobs se crean al modificar keywords en Admin → Diccionarios.</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Keyword</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Fase</TableHead>
                    <TableHead>Progreso</TableHead>
                    <TableHead>Tiempo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dictionaryJobs.map((job) => (
                    <TableRow
                      key={job.id}
                      className={
                        job.status === "processing" ? "bg-blue-500/5" : job.status === "failed" ? "bg-red-500/5" : ""
                      }
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">{formatJobType(job.job_type)}</span>
                          <span className="text-xs text-muted-foreground">
                            {job.signal_type === "technology" ? "Tecnología" : "Proceso"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">{job.keyword || "-"}</code>
                      </TableCell>
                      <TableCell>{getStatusBadge(job.status)}</TableCell>
                      <TableCell>
                        {job.status === "processing" && job.phase ? (
                          <Badge variant="outline" className="gap-1">
                            {job.phase === "contacts" ? (
                              <>
                                <Users className="h-3 w-3" /> Contactos
                              </>
                            ) : (
                              <>
                                <Briefcase className="h-3 w-3" /> Job Postings
                              </>
                            )}
                          </Badge>
                        ) : job.status === "completed" ? (
                          <span className="text-xs text-green-600">Finalizado</span>
                        ) : job.status === "failed" ? (
                          <span className="text-xs text-red-600">Error</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {job.status === "processing" ? (
                          <div className="space-y-1 min-w-[140px]">
                            <Progress value={job.progress} className="h-2" />
                            <div className="flex flex-col text-xs text-muted-foreground">
                              {job.phase === "contacts" ? (
                                <span>
                                  {job.contacts_processed?.toLocaleString() || 0}/
                                  {job.contacts_total?.toLocaleString() || 0} contactos
                                </span>
                              ) : (
                                <span>
                                  {job.job_postings_processed?.toLocaleString() || 0}/
                                  {job.job_postings_total?.toLocaleString() || 0} postings
                                </span>
                              )}
                            </div>
                          </div>
                        ) : job.status === "completed" ? (
                          <div className="text-xs text-green-600">
                            <div>{job.contacts_total?.toLocaleString() || 0} contactos</div>
                            <div>{job.job_postings_total?.toLocaleString() || 0} postings</div>
                          </div>
                        ) : job.status === "failed" ? (
                          <span
                            className="text-xs text-red-600 max-w-[150px] truncate block"
                            title={job.error_message || "Error"}
                          >
                            {job.error_message || "Error"}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">En cola</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {job.status === "processing" && job.started_at ? (
                          <span className="text-xs font-medium text-blue-600">{getElapsedTime(job.started_at)}</span>
                        ) : job.status === "completed" && job.completed_at ? (
                          <span className="text-xs text-muted-foreground">
                            {new Date(job.completed_at).toLocaleString("es-AR", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {new Date(job.created_at).toLocaleString("es-AR", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ejecución Manual</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            El sistema procesa automáticamente en segundo plano. Usa este botón solo si necesitas forzar el
            procesamiento inmediato de la cola pendiente.
          </p>

          {isProcessing && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progreso de la sesión manual</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          <Button onClick={handleProcess} disabled={stats.pending === 0 || isProcessing} className="w-full sm:w-auto">
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Forzar Procesamiento Ahora
              </>
            )}
          </Button>

          <div className="mt-4 bg-muted/50 rounded-md p-4 h-40 overflow-y-auto font-mono text-xs">
            {logs.length === 0 ? (
              <span className="text-muted-foreground">Esperando logs...</span>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="mb-1">
                  {log}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
