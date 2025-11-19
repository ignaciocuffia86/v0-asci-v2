"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import Papa from "papaparse";
import { Upload, FileUp, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
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
import { ingestBatch, createIngestionLog, completeIngestionLog } from "@/app/actions/ingest";

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
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "completed" | "error">("idle");
  const [stats, setStats] = useState({ total: 0, processed: 0, errors: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
      setStatus("idle");
      setErrorMessage(null);
      setProgress(0);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
    },
    maxFiles: 1,
  });

  const processFile = async () => {
    if (!file) return;

    setIsUploading(true);
    setStatus("parsing");
    setStats({ total: 0, processed: 0, errors: 0 });

    // 1. Create Log Entry
    const logId = await createIngestionLog(file.name);
    if (!logId) {
      setErrorMessage("Error al crear el log de ingesta.");
      setIsUploading(false);
      setStatus("error");
      return;
    }

    // 2. Parse CSV
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

        setStatus("uploading");

        // 3. Process in Batches
        const BATCH_SIZE = 50;
        let processedCount = 0;
        let errorCount = 0;
        const errors: any[] = [];

        for (let i = 0; i < totalRows; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          
          try {
            const result = await ingestBatch(batch, logId);
            if (result.success) {
              processedCount += result.processed;
            } else {
              errorCount += batch.length;
              errors.push({ batch: i, error: result.error });
            }
          } catch (e) {
            errorCount += batch.length;
            errors.push({ batch: i, error: String(e) });
          }

          const currentProgress = Math.round(((i + batch.length) / totalRows) * 100);
          setProgress(Math.min(currentProgress, 100));
          setStats((prev) => ({
            ...prev,
            processed: processedCount,
            errors: errorCount,
          }));
        }

        // 4. Complete Log
        await completeIngestionLog(logId, {
          total_rows: totalRows,
          processed_rows: processedCount,
          errors: errors,
          status: errorCount === totalRows ? "failed" : "completed",
        });

        setStatus("completed");
        setIsUploading(false);
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
          Sube archivos CSV para actualizar la base de datos de contactos y compañías.
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
                    Procesando...
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

            {(status === "parsing" || status === "uploading" || status === "completed") && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Progreso</span>
                    <span>{progress}%</span>
                  </div>
                  <Progress value={progress} />
                </div>

                <div className="grid grid-cols-3 gap-4 pt-4">
                  <div className="text-center p-3 bg-muted/30 rounded-lg">
                    <div className="text-2xl font-bold">{stats.total}</div>
                    <div className="text-xs text-muted-foreground uppercase">Total</div>
                  </div>
                  <div className="text-center p-3 bg-green-500/10 rounded-lg">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {stats.processed}
                    </div>
                    <div className="text-xs text-muted-foreground uppercase">Procesados</div>
                  </div>
                  <div className="text-center p-3 bg-red-500/10 rounded-lg">
                    <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {stats.errors}
                    </div>
                    <div className="text-xs text-muted-foreground uppercase">Errores</div>
                  </div>
                </div>

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
