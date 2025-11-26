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
} from "lucide-react"
import { processSignals, getProcessingStats } from "@/app/actions/processing"
import { Progress } from "@/components/ui/progress"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

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

export default function ProcessingPage() {
  const [stats, setStats] = useState({ pending: 0, signals: 0, isSystemProcessing: false })
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [dictionaryJobs, setDictionaryJobs] = useState<DictionaryJob[]>([])
  const [dictPending, setDictPending] = useState(0)
  const [dictProcessing, setDictProcessing] = useState(0)

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
      .limit(20)

    if (!error && data) {
      setDictionaryJobs(data)
      setDictPending(data.filter((j) => j.status === "pending").length)
      setDictProcessing(data.filter((j) => j.status === "processing").length)
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

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pendientes de Procesar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pending}</div>
            <p className="text-xs text-muted-foreground">Filas en cola (import_rows)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Señales Detectadas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.signals}</div>
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
                dictProcessing > 0 || stats.isSystemProcessing
                  ? "text-blue-600"
                  : dictPending > 0
                    ? "text-amber-600"
                    : "text-green-600"
              }`}
            >
              {dictProcessing > 0
                ? `Procesando (${dictProcessing} jobs)`
                : stats.isSystemProcessing
                  ? "Ejecutando (Background)"
                  : dictPending > 0
                    ? `${dictPending} jobs pendientes`
                    : "Inactivo"}
            </div>
            <p className="text-xs text-muted-foreground">
              {dictProcessing > 0
                ? "Jobs de diccionario en ejecución..."
                : stats.isSystemProcessing
                  ? "El sistema está procesando datos..."
                  : dictPending > 0
                    ? "Jobs en cola esperando turno"
                    : "Esperando nuevos datos"}
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
                    <TableRow key={job.id} className={job.status === "processing" ? "bg-blue-500/5" : ""}>
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
                          <span className="text-xs text-red-600 max-w-[150px] truncate block">
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
