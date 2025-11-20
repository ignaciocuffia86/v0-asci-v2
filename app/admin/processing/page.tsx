"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Play, Loader2, RefreshCw } from "lucide-react"
import { processSignals, getProcessingStats } from "@/app/actions/processing"
import { Progress } from "@/components/ui/progress"

export default function ProcessingPage() {
  const [stats, setStats] = useState({ pending: 0, signals: 0, isSystemProcessing: false })
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])

  const fetchStats = async () => {
    const newStats = await getProcessingStats()
    setStats(newStats)
  }

  useEffect(() => {
    fetchStats()
    // Poll stats every 5 seconds to update "Job Status" automatically
    const interval = setInterval(fetchStats, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleProcess = async () => {
    setIsProcessing(true)
    setLogs((prev) => ["Iniciando procesamiento manual...", ...prev])
    setProgress(0)

    const BATCH_SIZE = 10 // Match the safe batch size
    let totalProcessed = 0
    const initialPending = stats.pending

    try {
      // Loop until no more pending contacts or stopped
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

        // Calculate progress based on initial pending count
        const currentProgress =
          initialPending > 0 ? Math.min(Math.round((totalProcessed / initialPending) * 100), 100) : 0

        setProgress(currentProgress)
        setLogs((prev) => [`Procesadas ${result.processed} filas...`, ...prev])

        // Update stats UI
        await fetchStats()

        // Small delay
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Procesamiento de Señales</h1>
          <p className="text-muted-foreground">Estado del motor de detección de señales y ejecución manual.</p>
        </div>
        <Button variant="outline" size="icon" onClick={fetchStats} disabled={isProcessing}>
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
