"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import { createCsvImport } from "@/app/actions/v3/csv-import";

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onSuccess: () => void;
}

interface ParsedRow {
  company_name: string;
  domain?: string;
}

type ImportState = "idle" | "parsing" | "uploading" | "success" | "error";

export function CsvImportDialog({
  open,
  onOpenChange,
  campaignId,
  onSuccess,
}: CsvImportDialogProps) {
  const [state, setState] = useState<ImportState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const resetState = () => {
    setState("idle");
    setFile(null);
    setParsedRows([]);
    setProgress(0);
    setError(null);
    setResultMessage(null);
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const parseCSV = useCallback((content: string): ParsedRow[] => {
    const lines = content.split("\n").filter((line) => line.trim());
    if (lines.length < 2) return [];

    // Detectar headers
    const header = lines[0].toLowerCase();
    const headers = header.split(",").map((h) => h.trim().replace(/"/g, ""));

    // Buscar columnas de nombre y dominio
    const nameIndex = headers.findIndex(
      (h) =>
        h.includes("company") ||
        h.includes("name") ||
        h.includes("empresa") ||
        h.includes("nombre")
    );
    const domainIndex = headers.findIndex(
      (h) => h.includes("domain") || h.includes("dominio") || h.includes("website") || h.includes("url")
    );

    if (nameIndex === -1) {
      throw new Error(
        "No se encontro una columna de nombre de empresa. Asegurate de tener una columna llamada 'company', 'name', 'empresa' o 'nombre'."
      );
    }

    const rows: ParsedRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Simple CSV parsing (no maneja commas dentro de quotes perfectamente)
      const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));

      const companyName = values[nameIndex];
      if (!companyName) continue;

      rows.push({
        company_name: companyName,
        domain: domainIndex !== -1 ? values[domainIndex] || undefined : undefined,
      });
    }

    return rows;
  }, []);

  const handleFileSelect = useCallback(
    async (selectedFile: File) => {
      setFile(selectedFile);
      setState("parsing");
      setError(null);

      try {
        const content = await selectedFile.text();
        const rows = parseCSV(content);

        if (rows.length === 0) {
          throw new Error("El archivo no contiene filas validas");
        }

        setParsedRows(rows);
        setState("idle");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al parsear el archivo");
        setState("error");
      }
    },
    [parseCSV]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile && droppedFile.type === "text/csv") {
        handleFileSelect(droppedFile);
      } else {
        setError("Solo se permiten archivos CSV");
      }
    },
    [handleFileSelect]
  );

  const handleUpload = async () => {
    if (!file || parsedRows.length === 0) return;

    setState("uploading");
    setProgress(0);

    // Simular progreso mientras se procesa
    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 10, 90));
    }, 200);

    try {
      const result = await createCsvImport(campaignId, file.name, parsedRows);

      clearInterval(progressInterval);
      setProgress(100);

      if (result.success) {
        setState("success");
        setResultMessage(
          `Se procesaron ${parsedRows.length} filas. Las coincidencias automaticas se agregaron a la campana.`
        );
        setTimeout(() => {
          onSuccess();
          handleClose();
        }, 2000);
      } else {
        setState("error");
        setError(result.error || "Error al procesar el CSV");
      }
    } catch (err) {
      clearInterval(progressInterval);
      setState("error");
      setError(err instanceof Error ? err.message : "Error inesperado");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar CSV</DialogTitle>
          <DialogDescription>
            Sube un archivo CSV con nombres de empresas para agregarlas a la campana
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {state === "success" ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="rounded-full bg-green-500/10 p-3 mb-4">
                <CheckCircle className="size-8 text-green-500" />
              </div>
              <h3 className="font-semibold mb-1">Import completado</h3>
              <p className="text-sm text-muted-foreground">{resultMessage}</p>
            </div>
          ) : state === "uploading" ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="size-8 animate-spin text-primary mb-4" />
              <p className="text-sm font-medium mb-2">Procesando...</p>
              <div className="w-full max-w-xs">
                <Progress value={progress} className="h-2" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Analizando coincidencias con empresas existentes
              </p>
            </div>
          ) : (
            <>
              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  file ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                }`}
              >
                {file ? (
                  <div className="flex flex-col items-center">
                    <FileSpreadsheet className="size-10 text-primary mb-3" />
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {parsedRows.length} filas detectadas
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        setFile(null);
                        setParsedRows([]);
                      }}
                    >
                      Cambiar archivo
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <Upload className="size-10 text-muted-foreground mb-3" />
                    <p className="font-medium">Arrastra un archivo CSV aqui</p>
                    <p className="text-sm text-muted-foreground mb-3">o</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = ".csv";
                        input.onchange = (e) => {
                          const target = e.target as HTMLInputElement;
                          if (target.files?.[0]) {
                            handleFileSelect(target.files[0]);
                          }
                        };
                        input.click();
                      }}
                    >
                      Seleccionar archivo
                    </Button>
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-destructive/10 text-destructive">
                  <AlertCircle className="size-5 shrink-0 mt-0.5" />
                  <p className="text-sm">{error}</p>
                </div>
              )}

              {/* Formato esperado */}
              <div className="text-xs text-muted-foreground bg-muted p-3 rounded-lg">
                <p className="font-medium mb-1">Formato esperado:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>
                    Columna requerida: <code>company</code>, <code>name</code>, <code>empresa</code>{" "}
                    o <code>nombre</code>
                  </li>
                  <li>
                    Columna opcional: <code>domain</code>, <code>dominio</code> o <code>website</code>
                  </li>
                </ul>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {state === "success" ? "Cerrar" : "Cancelar"}
          </Button>
          {state !== "success" && state !== "uploading" && (
            <Button onClick={handleUpload} disabled={!file || parsedRows.length === 0}>
              Importar {parsedRows.length > 0 && `(${parsedRows.length} filas)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
