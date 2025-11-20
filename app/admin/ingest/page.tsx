"use client"

import { useState, useCallback, useEffect } from "react"
import { useDropzone } from "react-dropzone"
import Papa from "papaparse"
import { Upload, FileUp, CheckCircle, AlertCircle, Loader2, Activity, Database, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { createImportBatch, uploadBatchRows, triggerBatchProcessing, getBatchStatus } from "@/app/actions/ingest"

// Define the expected CSV structure based on the provided file
const REQUIRED_HEADERS = ["person_linkedin_url", "full_name", "company_name", "current_position"]

export default function IngestPage() {
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "processing" | "completed" | "error">("idle")
  const [stats, setStats] = useState({ total: 0, processed: 0, failed: 0, errors: 0 }) // Added failed to stats
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [batchId, setBatchId] = useState<string | null>(null)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0])
      setStatus("idle")
      setErrorMessage(null)
      setProgress(0)
      setBatchId(null)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
    },
    maxFiles: 1,
  })

  // Poll for batch status when in processing state
  useEffect(() => {
    let interval: NodeJS.Timeout

    if (status === "processing" && batchId) {
      interval = setInterval(async () => {
        const batchStatus = await getBatchStatus(batchId)

        if (batchStatus) {
          setStats((prev) => ({
            ...prev,
            processed: batchStatus.processed_rows || 0,
            failed: batchStatus.failed_rows || 0, // Update failed count
          }))

          if (batchStatus.status === "completed") {
            setStatus("completed")
            setIsUploading(false)
            setProgress(100)
            clearInterval(interval)
          } else if (batchStatus.status === "failed") {
            setStatus("error")
            setErrorMessage(batchStatus.error_message || "Error desconocido durante el procesamiento")
            setIsUploading(false)
            clearInterval(interval)
          }
        }
      }, 2000)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [status, batchId])

  const processFile = async () => {
    if (!file) return

    console.log("[v0] Starting file processing")
    setIsUploading(true)
    setStatus("parsing")
    setStats({ total: 0, processed: 0, failed: 0, errors: 0 }) // Reset failed count

    // 1. Parse CSV
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data as any[]
        const totalRows = rows.length
        console.log("[v0] Parsed CSV, total rows:", totalRows)
        setStats((prev) => ({ ...prev, total: totalRows }))

        // Validate Headers
        const headers = results.meta.fields || []
        const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h))

        if (missingHeaders.length > 0) {
          console.error("[v0] Missing headers:", missingHeaders)
          setErrorMessage(`Faltan columnas requeridas: ${missingHeaders.join(", ")}`)
          setStatus("error")
          setIsUploading(false)
          return
        }

        // 2. Create Import Batch
        console.log("[v0] Creating import batch...")
        const newBatchId = await createImportBatch(file.name, totalRows)
        if (!newBatchId) {
          console.error("[v0] Failed to create import batch")
          setErrorMessage("Error al crear el lote de importación.")
          setIsUploading(false)
          setStatus("error")
          return
        }
        console.log("[v0] Created batch with ID:", newBatchId)
        setBatchId(newBatchId)
        setStatus("uploading")

        // 3. Upload to Raw Tables in Batches
        const BATCH_SIZE = 500 // Increased batch size from 100 to 500 to speed up large uploads
        console.log("[v0] Starting upload of", totalRows, "rows in batches of", BATCH_SIZE)

        for (let i = 0; i < totalRows; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE)

          console.log("[v0] Uploading batch", Math.floor(i / BATCH_SIZE) + 1, "with", batch.length, "rows")
          const result = await uploadBatchRows(newBatchId, batch)
          if (!result.success) {
            console.error("[v0] Upload failed:", result.error)
            setErrorMessage(`Error al subir filas: ${result.error}`)
            setStatus("error")
            setIsUploading(false)
            return
          }

          const currentProgress = Math.round(((i + batch.length) / totalRows) * 50)
          setProgress(currentProgress)
        }
        console.log("[v0] Upload completed successfully")

        // 4. Trigger Initial Processing and Switch to Background Mode
        console.log("[v0] Starting background processing")
        setStatus("processing")

        // Trigger one immediate chunk to verify everything works and give immediate feedback
        const triggerResult = await triggerBatchProcessing(newBatchId)

        if (!triggerResult.success) {
          // If immediate trigger fails, warn but don't stop (cron might pick it up)
          console.warn("[v0] Immediate trigger warning:", triggerResult.error)
        } else {
          setStats((prev) => ({
            ...prev,
            processed: (prev.processed || 0) + (triggerResult.processedCount || 0),
          }))
        }

        // The UI now relies on the polling useEffect to update stats,
        // and the backend pg_cron job to do the actual work.
      },
      error: (error) => {
        console.error("[v0] CSV parsing error:", error)
        setErrorMessage(`Error al leer el CSV: ${error.message}`)
        setStatus("error")
        setIsUploading(false)
      },
    })
  }

  const handleManualTrigger = async () => {
    if (!batchId) return

    try {
      const result = await triggerBatchProcessing(batchId)
      if (result.success) {
        setStats((prev) => ({
          ...prev,
          processed: (prev.processed || 0) + (result.processedCount || 0),
        }))
      }
    } catch (error) {
      console.error("Manual trigger failed:", error)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ingesta de Datos</h1>
        <p className="text-muted-foreground">
          Sube archivos CSV para actualizar la base de datos. El procesamiento se realiza en segundo plano.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Subir Archivo</CardTitle>
            <CardDescription>
              Arrastra un archivo CSV o haz clic para seleccionar. Recomendado hasta 50k filas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
              }`}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-10 w-10 text-muted-foreground" />
                {file ? (
                  <div className="text-sm font-medium">
                    <p className="text-primary">{file.name}</p>
                    <p className="text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    <p>Arrastra y suelta aquí</p>
                    <p>o haz clic para seleccionar</p>
                  </div>
                )}
              </div>
            </div>

            {errorMessage && (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            <div className="mt-6">
              <Button
                className="w-full"
                onClick={processFile}
                disabled={!file || isUploading || status === "completed"}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {status === "parsing" && "Leyendo CSV..."}
                    {status === "uploading" && "Subiendo datos..."}
                    {status === "processing" && "Procesando en base de datos..."}
                  </>
                ) : (
                  <>
                    <FileUp className="mr-2 h-4 w-4" />
                    Iniciar Ingesta
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estado del Proceso</CardTitle>
            <CardDescription>Progreso y estadísticas de la ingesta actual.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {status === "idle" && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <Activity className="h-8 w-8 mb-2 opacity-20" />
                <p>Esperando archivo...</p>
              </div>
            )}

            {status !== "idle" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>
                      {status === "parsing" && "Analizando estructura..."}
                      {status === "uploading" && "Cargando datos crudos..."}
                      {status === "processing" && "Motor de ingesta ejecutándose..."}
                      {status === "completed" && "Finalizado"}
                      {status === "error" && "Error"}
                    </span>
                    <span>{status === "processing" ? "En progreso..." : `${progress}%`}</span>
                  </div>
                  <Progress
                    value={status === "processing" ? undefined : progress}
                    className={status === "processing" ? "animate-pulse" : ""}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <div className="text-2xl font-bold">{stats.total}</div>
                    <div className="text-xs text-muted-foreground uppercase">Total Filas</div>
                  </div>
                  <div className="text-center p-3 bg-green-500/10 rounded-lg">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.processed}</div>
                    <div className="text-xs text-muted-foreground uppercase">Procesados</div>
                  </div>
                  {stats.failed > 0 && (
                    <div className="col-span-2 text-center p-3 bg-red-500/10 rounded-lg">
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.failed}</div>
                      <div className="text-xs text-muted-foreground uppercase">Fallidos</div>
                    </div>
                  )}
                </div>

                {status === "processing" && (
                  <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-300">
                    <Database className="h-4 w-4" />
                    <AlertTitle>Procesando en Segundo Plano</AlertTitle>
                    <AlertDescription>
                      Los datos se han subido correctamente. El sistema procesará las filas automáticamente en segundo
                      plano (aprox. 50 filas/minuto).
                      <br />
                      <br />
                      <strong>Ya puedes cerrar esta pestaña.</strong> Si te quedas, verás el progreso en tiempo real.
                      <div className="mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleManualTrigger}
                          className="bg-background/50 hover:bg-background/80"
                        >
                          <Play className="mr-2 h-3 w-3" />
                          Procesar lote manualmente ahora
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {status === "completed" && (
                  <Alert className="bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-300">
                    <CheckCircle className="h-4 w-4" />
                    <AlertTitle>¡Completado!</AlertTitle>
                    <AlertDescription>La ingesta ha finalizado correctamente.</AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
