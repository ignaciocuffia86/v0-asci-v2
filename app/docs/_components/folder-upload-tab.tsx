"use client"

import { useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { createDocument } from "@/app/actions/documents"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  FolderOpen,
  FileText,
  FileX,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"

const SUPPORTED_EXTENSIONS = ["pdf", "pptx", "docx"]
const MAX_FILES = 50
const MAX_TOTAL_SIZE_MB = 500
const CONCURRENCY_LIMIT = 3
const DELAY_BETWEEN_BATCHES_MS = 2000

type FileStatus = "pending" | "uploading" | "processing" | "done" | "error" | "duplicate" | "skipped"

interface FileEntry {
  file: File
  name: string
  ext: string
  size: number
  status: FileStatus
  error?: string
}

interface FolderUploadTabProps {
  onDocumentCreated: () => void
  onOpenChange: (open: boolean) => void
}

function getFileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() || ""
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function sanitizeFilename(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
}

const FILE_TYPE_MAP: Record<string, "pdf" | "pptx" | "docx"> = {
  pdf: "pdf",
  pptx: "pptx",
  docx: "docx",
}

export function FolderUploadTab({ onDocumentCreated, onOpenChange }: FolderUploadTabProps) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [processedCount, setProcessedCount] = useState(0)
  const [phase, setPhase] = useState<"select" | "preview" | "uploading" | "done">("select")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return

    const allFiles = Array.from(fileList)

    // Filter and classify files
    const entries: FileEntry[] = []
    let totalSize = 0

    for (const file of allFiles) {
      const ext = getFileExtension(file.name)
      if (!SUPPORTED_EXTENSIONS.includes(ext)) continue

      totalSize += file.size
      entries.push({
        file,
        name: file.name,
        ext,
        size: file.size,
        status: "pending",
      })
    }

    // Enforce limits
    if (entries.length > MAX_FILES) {
      toast.error(`Maximo ${MAX_FILES} archivos por carpeta. Se encontraron ${entries.length}.`)
      return
    }
    if (totalSize > MAX_TOTAL_SIZE_MB * 1024 * 1024) {
      toast.error(`El total supera ${MAX_TOTAL_SIZE_MB}MB. Selecciona menos archivos.`)
      return
    }
    if (entries.length === 0) {
      toast.error("No se encontraron archivos soportados (PDF, PPTX, DOCX) en la carpeta.")
      return
    }

    // Check duplicates before showing preview
    const checked = await checkDuplicatesInEntries(entries)
    setFiles(checked)
    setPhase("preview")
  }

  const checkDuplicatesInEntries = async (entries: FileEntry[]): Promise<FileEntry[]> => {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return entries

    // Fetch existing doc titles for the user
    const { data: existing } = await supabase
      .from("user_documents")
      .select("title, type")
      .eq("user_id", user.id)

    if (!existing) return entries

    const existingSet = new Set(existing.map((d) => `${d.title}::${d.type}`))

    return entries.map((entry) => {
      const title = entry.name.replace(`.${entry.ext}`, "")
      const docType = FILE_TYPE_MAP[entry.ext]
      if (existingSet.has(`${title}::${docType}`)) {
        return { ...entry, status: "duplicate" as FileStatus }
      }
      return entry
    })
  }

  const uploadableFiles = files.filter((f) => f.status === "pending")
  const duplicateFiles = files.filter((f) => f.status === "duplicate")
  const totalUploadable = uploadableFiles.length

  const processFile = async (entry: FileEntry, userId: string): Promise<FileEntry> => {
    const supabase = createClient()
    const docType = FILE_TYPE_MAP[entry.ext]
    const fileExt = entry.ext
    const docId = crypto.randomUUID()
    const sanitizedName = sanitizeFilename(entry.name)
    const storagePath = `${userId}/${docId}/${sanitizedName}`
    const title = entry.name.replace(`.${fileExt}`, "")

    try {
      // Upload to storage
      const { error: storageError } = await supabase.storage
        .from("user-documents")
        .upload(storagePath, entry.file, { cacheControl: "3600", upsert: false })

      if (storageError) {
        return { ...entry, status: "error", error: storageError.message }
      }

      // Create DB record
      const result = await createDocument({
        title,
        type: docType,
        storage_path: storagePath,
        file_size: entry.size,
      })

      if (result.error) {
        return { ...entry, status: "error", error: result.error }
      }

      // Trigger processing
      if (result.data?.id) {
        fetch("/api/documents/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: result.data.id }),
        }).catch(() => {})
      }

      return { ...entry, status: "done" }
    } catch (err: any) {
      return { ...entry, status: "error", error: err.message || "Error desconocido" }
    }
  }

  const handleStartUpload = async () => {
    setIsProcessing(true)
    setPhase("uploading")
    setProcessedCount(0)

    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      toast.error("No autenticado. Recarga la pagina.")
      setIsProcessing(false)
      return
    }

    const toUpload = files.filter((f) => f.status === "pending")
    let processed = 0

    // Process in batches with concurrency limit
    for (let i = 0; i < toUpload.length; i += CONCURRENCY_LIMIT) {
      const batch = toUpload.slice(i, i + CONCURRENCY_LIMIT)

      // Mark batch as uploading
      setFiles((prev) =>
        prev.map((f) => {
          const inBatch = batch.find((b) => b.name === f.name && b.size === f.size)
          return inBatch ? { ...f, status: "uploading" as FileStatus } : f
        })
      )

      // Process batch concurrently
      const results = await Promise.all(batch.map((entry) => processFile(entry, user.id)))

      // Update file statuses
      setFiles((prev) =>
        prev.map((f) => {
          const result = results.find((r) => r.name === f.name && r.size === f.size)
          return result || f
        })
      )

      processed += batch.length
      setProcessedCount(processed)

      // Delay between batches to avoid RPM limits
      if (i + CONCURRENCY_LIMIT < toUpload.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS))
      }
    }

    setIsProcessing(false)
    setPhase("done")
    onDocumentCreated()

    const successCount = files.filter((f) => f.status === "done").length ||
      toUpload.length - files.filter((f) => f.status === "error").length
    toast.success(`${successCount} de ${toUpload.length} documentos subidos. Procesando...`)
  }

  const handleReset = () => {
    setFiles([])
    setPhase("select")
    setProcessedCount(0)
    if (inputRef.current) inputRef.current.value = ""
  }

  const progressPercent = totalUploadable > 0 ? (processedCount / totalUploadable) * 100 : 0

  // Phase: Select folder
  if (phase === "select") {
    return (
      <div className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={handleFolderSelect}
        />
        <div
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors duration-200 border-muted-foreground/25 hover:border-primary/50"
        >
          <div className="flex flex-col items-center gap-3">
            <FolderOpen className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Selecciona una carpeta</p>
              <p className="text-xs text-muted-foreground mt-1">
                Se importaran archivos PDF, PPTX y DOCX (max {MAX_FILES} archivos, {MAX_TOTAL_SIZE_MB}MB total)
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Phase: Preview / Uploading / Done
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-3 text-sm">
        <Badge variant="secondary">{uploadableFiles.length} nuevos</Badge>
        {duplicateFiles.length > 0 && (
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            {duplicateFiles.length} duplicados (omitidos)
          </Badge>
        )}
        <span className="text-muted-foreground text-xs">
          {formatSize(uploadableFiles.reduce((sum, f) => sum + f.size, 0))} total
        </span>
      </div>

      {/* Progress bar during upload */}
      {(phase === "uploading" || phase === "done") && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {phase === "done"
                ? "Completado"
                : `Procesando ${processedCount}/${totalUploadable}...`}
            </span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>
      )}

      {/* File list */}
      <ScrollArea className="h-[240px] rounded-md border">
        <div className="p-2 space-y-1">
          {files.map((entry, i) => (
            <div
              key={`${entry.name}-${i}`}
              className="flex items-center gap-2 py-1.5 px-2 rounded text-sm"
            >
              <StatusIcon status={entry.status} />
              <span className="truncate flex-1 text-xs">{entry.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{formatSize(entry.size)}</span>
              {entry.status === "duplicate" && (
                <span className="text-xs text-amber-600 shrink-0">duplicado</span>
              )}
              {entry.status === "error" && (
                <span className="text-xs text-destructive shrink-0 truncate max-w-[120px]" title={entry.error}>
                  {entry.error}
                </span>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {phase === "preview" && (
          <>
            <Button
              onClick={handleStartUpload}
              disabled={uploadableFiles.length === 0}
              className="flex-1"
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              Ingestar {uploadableFiles.length} documentos
            </Button>
            <Button variant="outline" onClick={handleReset}>
              Cancelar
            </Button>
          </>
        )}
        {phase === "uploading" && (
          <Button disabled className="flex-1">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Procesando {processedCount}/{totalUploadable}...
          </Button>
        )}
        {phase === "done" && (
          <>
            <Button onClick={() => onOpenChange(false)} className="flex-1">
              Cerrar
            </Button>
            <Button variant="outline" onClick={handleReset}>
              Subir mas
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: FileStatus }) {
  switch (status) {
    case "pending":
      return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
    case "uploading":
      return <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
    case "done":
      return <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
    case "error":
      return <XCircle className="h-4 w-4 text-destructive shrink-0" />
    case "duplicate":
      return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
    case "skipped":
      return <FileX className="h-4 w-4 text-muted-foreground/50 shrink-0" />
    default:
      return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
  }
}
