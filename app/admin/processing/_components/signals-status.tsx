"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, Clock } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

type SignalsStatus = {
  totalPending: number
  contactSignals: number
  jobSignals: number
  totalProcessed: number
  processingRate: number
  estimatedTimeMinutes: number
}

export function SignalsStatus() {
  const [signalsStatus, setSignalsStatus] = useState<SignalsStatus | null>(null)
  const supabase = createClient()

  const fetchSignalsStatus = async () => {
    // Obtener signals por tipo
    const { count: totalPending } = await supabase
      .from("pending_signals")
      .select("*", { count: "exact", head: true })
      .is("processed_at", null)

    const { count: contactSignals } = await supabase
      .from("pending_signals")
      .select("*", { count: "exact", head: true })
      .eq("signal_type", "contact")
      .is("processed_at", null)

    const { count: jobSignals } = await supabase
      .from("pending_signals")
      .select("*", { count: "exact", head: true })
      .eq("signal_type", "job")
      .is("processed_at", null)

    const { count: totalProcessed } = await supabase
      .from("pending_signals")
      .select("*", { count: "exact", head: true })
      .not("processed_at", "is", null)

    // Calcular velocidad de procesamiento basado en eventos recientes
    const { data: recentEvents } = await supabase
      .from("debug_events")
      .select("created_at, details")
      .eq("event_type", "signals_batch_processed")
      .order("created_at", { ascending: false })
      .limit(5)

    let processingRate = 0
    if (recentEvents && recentEvents.length > 1) {
      const timeDiffSeconds =
        (new Date(recentEvents[0].created_at).getTime() -
          new Date(recentEvents[recentEvents.length - 1].created_at).getTime()) /
        1000

      if (timeDiffSeconds > 0) {
        const totalProcessedInWindow = recentEvents.reduce((acc, event) => {
          const details = event.details as any
          return acc + (details?.total_processed || 0)
        }, 0)
        processingRate = Math.round((totalProcessedInWindow / timeDiffSeconds) * 60) // por minuto
      }
    }

    const estimatedTimeMinutes = processingRate > 0 ? Math.ceil((totalPending || 0) / processingRate) : 0

    setSignalsStatus({
      totalPending: totalPending || 0,
      contactSignals: contactSignals || 0,
      jobSignals: jobSignals || 0,
      totalProcessed: totalProcessed || 0,
      processingRate: processingRate || 0,
      estimatedTimeMinutes,
    })
  }

  useEffect(() => {
    fetchSignalsStatus()
    const interval = setInterval(fetchSignalsStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  if (!signalsStatus) {
    return null
  }

  const progress =
    signalsStatus.totalProcessed + signalsStatus.totalPending > 0
      ? Math.round((signalsStatus.totalProcessed / (signalsStatus.totalProcessed + signalsStatus.totalPending)) * 100)
      : 0

  return (
    <Card className="border-purple-500 bg-purple-50/50 dark:bg-purple-950/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {signalsStatus.totalPending === 0 ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <Clock className="h-5 w-5 text-purple-600" />
            )}
            <CardTitle>Procesamiento de Señales</CardTitle>
          </div>
          <Badge variant={signalsStatus.totalPending === 0 ? "default" : "secondary"}>
            {signalsStatus.totalPending === 0 ? "Completado" : "Procesando"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Progreso de Signals</span>
            <span className="text-lg font-bold text-purple-600">{progress}%</span>
          </div>
          <Progress value={progress} className="h-3" />
        </div>

        {/* Signal Types Breakdown */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-white/50 dark:bg-slate-900/50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground font-medium">Signals Contactos</div>
                <div className="text-xl font-bold text-blue-600">{signalsStatus.contactSignals.toLocaleString()}</div>
              </div>
              <div className="text-2xl opacity-30">👥</div>
            </div>
          </div>

          <div className="p-3 bg-white/50 dark:bg-slate-900/50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground font-medium">Signals Jobs</div>
                <div className="text-xl font-bold text-purple-600">{signalsStatus.jobSignals.toLocaleString()}</div>
              </div>
              <div className="text-2xl opacity-30">💼</div>
            </div>
          </div>
        </div>

        {/* Processing Speed */}
        {signalsStatus.totalPending > 0 && (
          <div className="grid grid-cols-2 gap-3 p-3 bg-white/50 dark:bg-slate-900/50 rounded-lg">
            <div>
              <div className="text-xs text-muted-foreground font-medium">Velocidad</div>
              <div className="text-lg font-bold text-green-600">{signalsStatus.processingRate} signals/min</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground font-medium">ETA</div>
              <div className="text-lg font-bold text-blue-600">~{signalsStatus.estimatedTimeMinutes}m</div>
            </div>
          </div>
        )}

        {/* Total Stats */}
        <div className="text-xs space-y-1 text-muted-foreground border-t pt-3">
          <div className="flex justify-between">
            <span>Total Procesadas:</span>
            <span className="font-semibold text-green-600">{signalsStatus.totalProcessed.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Total Pendientes:</span>
            <span className="font-semibold text-purple-600">{signalsStatus.totalPending.toLocaleString()}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
