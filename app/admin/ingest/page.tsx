"use client"

import { useState, useCallback, useEffect } from "react"
import { useDropzone } from "react-dropzone"
import { upload } from "@vercel/blob/client"
import { Upload, FileUp, CheckCircle, AlertCircle, Loader2, Activity, Database } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { getBatchStatus } from "@/app/actions/ingest"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"

const BATCH_TYPES = {
  contacts: {
    label: "Contactos (Personas)",
    requiredHeaders: ["person_linkedin_url", "full_name", "company_name", "current_position"],
    description: "CSV de contactos con perfiles de LinkedIn",
  },
  job_postings: {
    label: "Ofertas de Empleo (Job Postings)",
    requiredHeaders: ["title", "companyUrl"],
    description: "CSV de ofertas laborales con datos de empresas",
  },
} as const

type BatchType = keyof typeof BATCH_TYPES

export default function IngestPage() {
  const [file, setFile] = useState<File | null>(null)
  const [batchType, setBatchType] = useState<BatchType>("contacts")
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "processing" | "completed" | "error">("idle")
  const [stats, setStats] = useState({ total: 0, processed: 0, failed: 0, errors: 0 })
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
            failed: batchStatus.failed_rows || 0,
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

    setIsUploading(true)
    setStatus("uploading")
    setStats({ total: 0, processed: 0, failed: 0, errors: 0 })
    setErrorMessage(null)

    try {
      // Step 1: Upload CSV directly to Vercel Blob from browser (bypasses serverless 4.5MB limit)
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/ingest/blob-upload",
      })
      const blobUrl = blob.url
      setProgress(30)

      // Step 2: Tell the API route to process the blob (lightweight JSON request)
      setStatus("parsing")
      const processResponse = await fetch("/api/ingest/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl,
          filename: file.name,
          batchType,
        }),
      })

      let result
      try {
        result = await processResponse.json()
      } catch {
        const text = await processResponse.text()
        throw new Error(`Respuesta inesperada del servidor: ${text.substring(0, 100)}`)
      }

      if (!processResponse.ok || !result.success) {
        setErrorMessage(result.error || "Error al procesar el archivo")
        setStatus("error")
        setIsUploading(false)
        return
      }

      // Server created the batch and inserted all rows
      setBatchId(result.batchId)
      setStats((prev) => ({ ...prev, total: result.totalRows }))
      setProgress(50)
      setStatus("processing")
      // The Vercel cron picks up the batch automatically
    } catch (err: any) {
      setErrorMessage(err.message || "Error de conexion")
      setStatus("error")
      setIsUploading(false)
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
            <div className="mb-6 space-y-2">
              <Label htmlFor="batch-type">Tipo de Datos</Label>
              <Select value={batchType} onValueChange={(value) => setBatchType(value as BatchType)}>
                <SelectTrigger id="batch-type">
                  <SelectValue placeholder="Selecciona el tipo de archivo" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(BATCH_TYPES).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">{BATCH_TYPES[batchType].description}</p>
            </div>

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
                      <strong>Ya puedes cerrar esta pestaña.</strong> Si te quedas, veras el progreso en tiempo real.
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
