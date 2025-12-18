"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CheckCircle, AlertCircle, Clock } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

type CronStatus = {
  isRunning: boolean
  lastExecution?: Date
  nextExecution?: Date
  status: "healthy" | "idle" | "critical"
  message: string
  pendingContactSignals?: number
  pendingJobSignals?: number
  totalPendingSignals?: number
  processedSignals?: number
  completedBatches?: number
}

export function CronHealth() {
  const [cronStatus, setCronStatus] = useState<CronStatus | null>(null)
  const supabase = createClient()

  const checkCronHealth = async () => {
    const { data: events } = await supabase
      .from("debug_events")
      .select("event_type, created_at")
      .in("event_type", ["cron_start", "batch_completed", "batch_partial", "signals_batch_processed"])
      .order("created_at", { ascending: false })
      .limit(100)

    const { count: pendingContactSignals } = await supabase
      .from("pending_signals")
      .select("*", { count: "exact", head: true })
      .eq("signal_type", "contact")
      .is("processed_at", null)

    const { count: pendingJobSignals } = await supabase
      .from("pending_signals")
      .select("*", { count: "exact", head: true })
      .eq("signal_type", "job")
      .is("processed_at", null)

    const { count: totalPendingSignals } = await supabase
      .from("pending_signals")
      .select("*", { count: "exact", head: true })
      .is("processed_at", null)

    const { count: processedSignals } = await supabase
      .from("pending_signals")
      .select("*", { count: "exact", head: true })
      .not("processed_at", "is", null)

    const { count: completedBatches } = await supabase
      .from("import_batches")
      .select("*", { count: "exact", head: true })
      .eq("status", "completed")

    // Analizar eventos para determinar salud
    const now = new Date()
    const oneMinuteAgo = new Date(now.getTime() - 60000)
    const fiveMinutesAgo = new Date(now.getTime() - 300000)

    const recentBatchRun = events?.some((e) => {
      const eventTime = new Date(e.created_at)
      return (e.event_type === "batch_completed" || e.event_type === "batch_partial") && eventTime > oneMinuteAgo
    })

    const recentSignalRun = events?.some((e) => {
      const eventTime = new Date(e.created_at)
      return e.event_type === "signals_batch_processed" && eventTime > oneMinuteAgo
    })

    const anyActivityIn5Min = events?.some((e) => {
      const eventTime = new Date(e.created_at)
      return eventTime > fiveMinutesAgo
    })

    let status: CronStatus["status"] = "healthy"
    let message = "Crons ejecutándose normalmente"

    if (!anyActivityIn5Min) {
      status = "critical"
      message = "Crons no están ejecutándose"
    } else if (!recentBatchRun && !recentSignalRun && totalPendingSignals === 0) {
      status = "idle"
      message = "Crons idle (sin trabajo pendiente o completaron)"
    } else if (totalPendingSignals === 0 && recentBatchRun) {
      status = "idle"
      message = "Esperando signals para procesar"
    }

    const lastCronEvent = events?.[0]
    const lastExecution = lastCronEvent ? new Date(lastCronEvent.created_at) : undefined

    setCronStatus({
      isRunning: recentBatchRun || recentSignalRun || false,
      lastExecution,
      status,
      message,
      pendingContactSignals: pendingContactSignals || 0,
      pendingJobSignals: pendingJobSignals || 0,
      totalPendingSignals: totalPendingSignals || 0,
      processedSignals: processedSignals || 0,
      completedBatches: completedBatches || 0,
    })
  }

  useEffect(() => {
    checkCronHealth()
    const interval = setInterval(checkCronHealth, 10000)
    return () => clearInterval(interval)
  }, [])

  if (!cronStatus) {
    return null
  }

  return (
    <Card
      className={
        cronStatus.status === "critical"
          ? "border-red-500 bg-red-50/50 dark:bg-red-950/20"
          : cronStatus.status === "idle"
            ? "border-amber-500 bg-amber-50/50 dark:bg-amber-950/20"
            : "border-green-500 bg-green-50/50 dark:bg-green-950/20"
      }
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {cronStatus.status === "healthy" ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-amber-600" />
            )}
            <CardTitle>Estado de Salud del Sistema</CardTitle>
          </div>
          <Badge
            variant={
              cronStatus.status === "critical" ? "destructive" : cronStatus.status === "idle" ? "secondary" : "default"
            }
          >
            {cronStatus.status === "healthy" ? "Saludable" : cronStatus.status === "idle" ? "Idle" : "Crítico"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Alert variant={cronStatus.status === "critical" ? "destructive" : "default"}>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{cronStatus.message}</AlertDescription>
        </Alert>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="p-3 bg-white/50 dark:bg-slate-900/50 rounded-lg">
            <div className="text-xs text-muted-foreground font-medium">Cron Activo</div>
            <div className={`text-lg font-bold ${cronStatus.isRunning ? "text-green-600" : "text-gray-400"}`}>
              {cronStatus.isRunning ? "Ejecutando" : "Inactivo"}
            </div>
          </div>

          <div className="p-3 bg-white/50 dark:bg-slate-900/50 rounded-lg">
            <div className="text-xs text-muted-foreground font-medium">Última Ejecución</div>
            <div className="text-sm font-mono">
              {cronStatus.lastExecution
                ? `hace ${Math.round((new Date().getTime() - cronStatus.lastExecution.getTime()) / 1000)}s`
                : "N/A"}
            </div>
          </div>

          <div className="p-3 bg-white/50 dark:bg-slate-900/50 rounded-lg">
            <div className="text-xs text-muted-foreground font-medium">Signals Contactos</div>
            <div className="text-lg font-bold text-blue-600">
              {cronStatus.pendingContactSignals?.toLocaleString() || 0}
            </div>
          </div>

          <div className="p-3 bg-white/50 dark:bg-slate-900/50 rounded-lg">
            <div className="text-xs text-muted-foreground font-medium">Signals Jobs</div>
            <div className="text-lg font-bold text-purple-600">
              {cronStatus.pendingJobSignals?.toLocaleString() || 0}
            </div>
          </div>

          <div className="p-3 bg-white/50 dark:bg-slate-900/50 rounded-lg">
            <div className="text-xs text-muted-foreground font-medium">Batches Completados</div>
            <div className="text-lg font-bold text-green-600">{cronStatus.completedBatches?.toLocaleString() || 0}</div>
          </div>
        </div>

        {cronStatus.totalPendingSignals > 0 && (
          <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Total de Signals Pendientes: {cronStatus.totalPendingSignals?.toLocaleString() || 0}
            </div>
            <div className="text-xs text-blue-700 dark:text-blue-200 mt-1">
              Procesados: {cronStatus.processedSignals?.toLocaleString() || 0}
            </div>
          </div>
        )}

        {cronStatus.status === "idle" && (
          <Alert>
            <Clock className="h-4 w-4" />
            <AlertDescription>
              El cron está en estado idle porque no hay trabajos pendientes en este momento. Es normal.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
