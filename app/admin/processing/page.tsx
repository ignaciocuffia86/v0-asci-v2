"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Play, Loader2, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react"
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
  created_at: string
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
    const interval = setInterval(() => {
      fetchStats()
      fetchDictionaryJobs()
    }, 5000)
    return () => clearInterval(interval)
  }, [])

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
            <CardTitle className="text-sm font-medium text-muted-foreground">Estado del Job</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.isSystemProcessing ? "text-blue-600" : "text-green-600"}`}>
              {stats.isSystemProcessing ? "Ejecutando (Background)" : "Inactivo"}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.isSystemProcessing ? "El sistema está procesando datos..." : "Esperando nuevos datos"}
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
                    <TableHead>Progreso</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dictionaryJobs.map((job) => (
                    <TableRow key={job.id}>
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
                        {job.status === "processing" ? (
                          <div className="space-y-1 min-w-[100px]">
                            <Progress value={job.progress} className="h-2" />
                            <span className="text-xs text-muted-foreground">
                              {job.processed_records}/{job.total_records}
                            </span>
                          </div>
                        ) : job.status === "completed" ? (
                          <span className="text-xs text-green-600">{job.processed_records} procesados</span>
                        ) : job.status === "failed" ? (
                          <span className="text-xs text-red-600 max-w-[150px] truncate block">
                            {job.error_message || "Error"}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {new Date(job.created_at).toLocaleString("es-AR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
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
