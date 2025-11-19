"use client";

import { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import { Upload, FileUp, CheckCircle, AlertCircle, Loader2, Activity, Database } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createImportBatch, uploadBatchRows, triggerBatchProcessing, getBatchStatus } from "@/app/actions/ingest";

// Define the expected CSV structure based on the provided file
const REQUIRED_HEADERS = [
  "person_linkedin_url",
  "full_name",
  "company_name",
  "current_position",
];

export default function IngestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "processing" | "completed" | "error">("idle");
  const [stats, setStats] = useState({ total: 0, processed: 0, errors: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
      setStatus("idle");
      setErrorMessage(null);
      setProgress(0);
      setBatchId(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
    },
    maxFiles: 1,
  });

  // Poll for batch status when in processing state
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (status === "processing" && batchId) {
      interval = setInterval(async () => {
        const batchStatus = await getBatchStatus(batchId);
        
        if (batchStatus) {
          setStats(prev => ({
            ...prev,
            processed: batchStatus.processed_rows || 0,
            // We can add error tracking to the batch table if needed
          }));

          if (batchStatus.status === 'completed') {
            setStatus("completed");
            setIsUploading(false);
            setProgress(100);
            clearInterval(interval);
          } else if (batchStatus.status === 'failed') {
            setStatus("error");
            setErrorMessage(batchStatus.error_message || "Error desconocido durante el procesamiento");
            setIsUploading(false);
            clearInterval(interval);
          }
        }
      }, 2000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status, batchId]);

  const processFile = async () => {
    if (!file) return;

    setIsUploading(true);
    setStatus("parsing");
    setStats({ total: 0, processed: 0, errors: 0 });

    // 1. Parse CSV
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data as any[];
        const totalRows = rows.length;
        setStats((prev) => ({ ...prev, total: totalRows }));

        // Validate Headers
        const headers = results.meta.fields || [];
        const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));

        if (missingHeaders.length > 0) {
          setErrorMessage(`Faltan columnas requeridas: ${missingHeaders.join(", ")}`);
          setStatus("error");
          setIsUploading(false);
          return;
        }

        // 2. Create Import Batch
        const newBatchId = await createImportBatch(file.name, totalRows);
        if (!newBatchId) {
          setErrorMessage("Error al crear el lote de importación.");
          setIsUploading(false);
          setStatus("error");
          return;
        }
        setBatchId(newBatchId);
        setStatus("uploading");

        // 3. Upload to Raw Tables in Batches
        const BATCH_SIZE = 100; // Larger batch size for raw insert
        
        for (let i = 0; i < totalRows; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          
          const result = await uploadBatchRows(newBatchId, batch);
          if (!result.success) {
            setErrorMessage(`Error al subir filas: ${result.error}`);
            setStatus("error");
            setIsUploading(false);
            return;
          }

          const currentProgress = Math.round(((i + batch.length) / totalRows) * 50); // First 50% is upload
          setProgress(currentProgress);
        }

        // 4. Trigger Database Processing
        setStatus("processing");
        const triggerResult = await triggerBatchProcessing(newBatchId);
        
        if (!triggerResult.success) {
          setErrorMessage(`Error al iniciar procesamiento: ${triggerResult.error}`);
          setStatus("error");
          setIsUploading(false);
          return;
        }
        
        // The useEffect hook will handle polling for completion
      },
      error: (error) => {
        setErrorMessage(`Error al leer el CSV: ${error.message}`);
        setStatus("error");
        setIsUploading(false);
      },
    });
  };

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
              Arrastra un archivo CSV o haz clic para seleccionar. Máximo 10k filas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
                isDragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              }`}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-10 w-10 text-muted-foreground" />
                {file ? (
                  <div className="text-sm font-medium">
                    <p className="text-primary">{file.name}</p>
                    <p className="text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
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
            <CardDescription>
              Progreso y estadísticas de la ingesta actual.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {status === "idle" && (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <Activity className="h-8 w-8 mb-2 opacity-20" />
                <p>Esperando archivo...</p>
              </div>
            )}

            {(status !== "idle") && (
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
                  <Progress value={status === "processing" ? undefined : progress} className={status === "processing" ? "animate-pulse" : ""} />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <div className="text-2xl font-bold">{stats.total}</div>
                    <div className="text-xs text-muted-foreground uppercase">Total Filas</div>
                  </div>
                  <div className="text-center p-3 bg-green-500/10 rounded-lg">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {stats.processed}
                    </div>
                    <div className="text-xs text-muted-foreground uppercase">Procesados</div>
                  </div>
                </div>

                {status === "processing" && (
                  <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-300">
                    <Database className="h-4 w-4" />
                    <AlertTitle>Procesando en Backend</AlertTitle>
                    <AlertDescription>
                      Los datos se están procesando en el servidor de base de datos. Esto es mucho más rápido y seguro.
                    </AlertDescription>
                  </Alert>
                )}

                {status === "completed" && (
                  <Alert className="bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-300">
                    <CheckCircle className="h-4 w-4" />
                    <AlertTitle>¡Completado!</AlertTitle>
                    <AlertDescription>
                      La ingesta ha finalizado correctamente.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
