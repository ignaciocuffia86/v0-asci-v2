"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Loader2, Play, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { processDictionaryJobs, getPendingDictionaryJobs } from "@/app/actions/dictionary"
import { Badge } from "@/components/ui/badge"

export function ProcessDictionaryButton() {
  const [isProcessing, setIsProcessing] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)

  const loadPendingCount = async () => {
    const result = await getPendingDictionaryJobs()
    setPendingCount(result.count)
  }

  useEffect(() => {
    loadPendingCount()
  }, [])

  const handleProcess = async () => {
    setIsProcessing(true)
    try {
      const result = await processDictionaryJobs()

      if (result.success) {
        toast.success(`Procesamiento completado: ${result.processed} jobs, ${result.signalsAffected} señales afectadas`)
        loadPendingCount()
      } else {
        toast.error(result.error || "Error al procesar el diccionario")
      }
    } catch (error) {
      toast.error("Error de conexión al procesar el diccionario")
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {pendingCount > 0 && (
        <Badge variant="secondary" className="text-xs">
          {pendingCount} pendientes
        </Badge>
      )}
      <Button onClick={loadPendingCount} variant="ghost" size="icon" disabled={isProcessing}>
        <RefreshCw className="h-4 w-4" />
      </Button>
      <Button onClick={handleProcess} disabled={isProcessing} variant="outline">
        {isProcessing ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Procesando...
          </>
        ) : (
          <>
            <Play className="mr-2 h-4 w-4" />
            Procesar Diccionario
          </>
        )}
      </Button>
    </div>
  )
}
