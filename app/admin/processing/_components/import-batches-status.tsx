"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Activity } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

type ImportBatch = {
  id: string
  batch_type: string
  status: string
  total_rows: number
  created_at: string
  updated_at: string
  pending_rows?: number
  processed_rows?: number
  failed_rows?: number
}

export function ImportBatchesStatus() {
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchBatches = async () => {
    const { data, error } = await supabase
      .from("import_batches")
      .select("id, batch_type, status, total_rows, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(10)

    if (!error && data) {
      // Enriquecer con conteo de rows
      const enrichedBatches = await Promise.all(
        data.map(async (batch) => {
          const { data: rows } = await supabase.from("import_rows").select("status").eq("batch_id", batch.id)

          const statusCounts = rows?.reduce(
            (acc, row) => ({
              ...acc,
              [row.status]: (acc[row.status as keyof typeof acc] || 0) + 1,
            }),
            { pending: 0, processed: 0, failed: 0 },
          ) || { pending: 0, processed: 0, failed: 0 }

          return {
            ...batch,
            pending_rows: statusCounts.pending || 0,
            processed_rows: statusCounts.processed || 0,
            failed_rows: statusCounts.failed || 0,
          }
        }),
      )

      setBatches(enrichedBatches)
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchBatches()
    const interval = setInterval(fetchBatches, 5000)
    return () => clearInterval(interval)
  }, [])

  const currentBatch = batches.find((b) => b.status === "processing" || b.status === "pending")
  if (!currentBatch) {
    return null
  }

  const progress =
    currentBatch.processed_rows && currentBatch.total_rows
      ? Math.round((currentBatch.processed_rows / currentBatch.total_rows) * 100)
      : 0

  const processingRate =
    currentBatch.processed_rows && currentBatch.updated_at
      ? Math.round(
          currentBatch.processed_rows / ((new Date().getTime() - new Date(currentBatch.updated_at).getTime()) / 60000),
        )
      : 0

  const remainingMinutes =
    processingRate > 0 && currentBatch.pending_rows ? Math.ceil(currentBatch.pending_rows / processingRate) : 0

  return (
    <Card className="border-blue-500 bg-blue-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity
              className={`h-5 w-5 ${currentBatch.status === "processing" ? "text-blue-600 animate-pulse" : "text-gray-400"}`}
            />
            <CardTitle className="text-lg">
              Estado de Ingesta de {currentBatch.batch_type === "contacts" ? "Contactos" : "Job Postings"}
            </CardTitle>
            <Badge variant={currentBatch.status === "processing" ? "default" : "secondary"} className="ml-2">
              {currentBatch.status === "processing" ? (
                <>
                  <span className="animate-pulse">●</span>
                  <span className="ml-1">Procesando</span>
                </>
              ) : (
                "Pendiente"
              )}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Progress Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Progreso General</span>
            <span className="text-lg font-bold text-blue-600">{progress}%</span>
          </div>
          <Progress value={progress} className="h-3" />

          <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
            <div className="text-center p-2 bg-muted/50 rounded">
              <div className="font-semibold text-foreground">{currentBatch.processed_rows?.toLocaleString() || 0}</div>
              <div>Procesados</div>
            </div>
            <div className="text-center p-2 bg-muted/50 rounded">
              <div className="font-semibold text-foreground">{currentBatch.pending_rows?.toLocaleString() || 0}</div>
              <div>Pendientes</div>
            </div>
            <div className="text-center p-2 bg-muted/50 rounded">
              <div className="font-semibold text-foreground">{currentBatch.failed_rows?.toLocaleString() || 0}</div>
              <div>Errores</div>
            </div>
          </div>
        </div>

        {/* Processing Stats */}
        {currentBatch.status === "processing" && (
          <div className="grid grid-cols-2 gap-4 p-3 bg-white/50 dark:bg-slate-900/50 rounded-lg">
            <div>
              <div className="text-xs text-muted-foreground font-medium">Velocidad</div>
              <div className="text-lg font-bold text-green-600">{processingRate} rows/min</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground font-medium">ETA</div>
              <div className="text-lg font-bold text-blue-600">{remainingMinutes}m</div>
            </div>
          </div>
        )}

        {/* Batch Details */}
        <div className="text-xs space-y-1 text-muted-foreground">
          <div>
            ID: <code className="bg-muted px-1 py-0.5 rounded text-xs">{currentBatch.id}</code>
          </div>
          <div>Total: {currentBatch.total_rows?.toLocaleString() || 0} rows</div>
          <div>Creado: {new Date(currentBatch.created_at).toLocaleString("es-AR")}</div>
        </div>
      </CardContent>
    </Card>
  )
}
