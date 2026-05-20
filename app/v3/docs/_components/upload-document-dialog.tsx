"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { upload } from "@vercel/blob/client"
import { createWorkspaceDocument } from "@/app/actions/v3/documents"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Upload, Link2, FileText, Loader2, AlertCircle } from "lucide-react"
import { toast } from "sonner"

const ACCEPTED_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
}

const FILE_TYPE_MAP: Record<string, "pdf" | "pptx" | "docx"> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}

interface UploadDocumentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDocumentCreated: () => void
}

export function UploadDocumentDialog({ 
  open, 
  onOpenChange, 
  onDocumentCreated 
}: UploadDocumentDialogProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [url, setUrl] = useState("")
  const [urlTitle, setUrlTitle] = useState("")

  const handleFileUpload = async (file: File) => {
    setIsUploading(true)
    setUploadError(null)
    
    try {
      // Detect file type
      let docType = FILE_TYPE_MAP[file.type]
      if (!docType) {
        const ext = file.name.split(".").pop()?.toLowerCase()
        if (ext === "pdf") docType = "pdf"
        else if (ext === "pptx") docType = "pptx"
        else if (ext === "docx") docType = "docx"
        else throw new Error(`Tipo de archivo no soportado: ${file.type || file.name}`)
      }

      // Get file info for title
      const fileExt = file.name.split(".").pop()
      const title = file.name.replace(`.${fileExt}`, "")
      
      // Upload to Vercel Blob (client-side, bypasses 4.5MB limit)
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/v3/documents/blob-upload",
      })

      // Create document record via server action
      const result = await createWorkspaceDocument({
        title,
        type: docType,
        storage_path: blob.url,
        file_size: file.size,
      })

      if (result.error) throw new Error(result.error)

      toast.success(`"${title}" subido correctamente. Procesando...`)
      onDocumentCreated()

      // Trigger async processing
      if (result.data?.id) {
        fetch("/api/v3/documents/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: result.data.id }),
        }).catch(() => {})
      }
    } catch (err: any) {
      const msg = err.message || "Error al subir el archivo"
      setUploadError(msg)
      toast.error(msg)
    } finally {
      setIsUploading(false)
    }
  }

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    if (rejectedFiles.length > 0) {
      const errorCode = rejectedFiles[0].errors?.[0]?.code
      if (errorCode === "file-too-large") {
        setUploadError("El archivo supera los 50MB permitidos")
        toast.error("El archivo supera los 50MB permitidos")
      } else if (errorCode === "file-invalid-type") {
        setUploadError("Formato no soportado. Usa PDF, PPTX o DOCX")
        toast.error("Formato no soportado. Usa PDF, PPTX o DOCX")
      }
      return
    }
    if (acceptedFiles.length === 0) return
    handleFileUpload(acceptedFiles[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    maxSize: 52428800, // 50MB
    disabled: isUploading,
    onDropAccepted: () => setUploadError(null),
  })

  const handleUrlSubmit = async () => {
    if (!url.trim()) return

    setIsUploading(true)
    try {
      const title = urlTitle.trim() || new URL(url).hostname
      const result = await createWorkspaceDocument({
        title,
        type: "url",
        source_url: url.trim(),
      })

      if (result.error) throw new Error(result.error)

      toast.success(`"${title}" creado. Procesando URL...`)
      onDocumentCreated()
      setUrl("")
      setUrlTitle("")

      // Trigger processing
      if (result.data?.id) {
        fetch("/api/v3/documents/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: result.data.id }),
        }).catch(() => {})
      }
    } catch (err: any) {
      toast.error(err.message || "Error al procesar la URL")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar documento</DialogTitle>
          <DialogDescription>
            Subi un archivo o ingresa una URL para que ASCI analice tu propuesta de valor.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="file" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="file" className="gap-2">
              <Upload className="size-4" />
              Archivo
            </TabsTrigger>
            <TabsTrigger value="url" className="gap-2">
              <Link2 className="size-4" />
              URL
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="mt-4">
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                transition-colors duration-200
                ${isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}
                ${isUploading ? "opacity-50 pointer-events-none" : ""}
              `}
            >
              <input {...getInputProps()} />
              {isUploading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="size-10 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Subiendo archivo...</p>
                </div>
              ) : uploadError ? (
                <div className="flex flex-col items-center gap-3">
                  <AlertCircle className="size-10 text-destructive" />
                  <div>
                    <p className="text-sm font-medium text-destructive">{uploadError}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Hace click o arrastra para reintentar
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <FileText className="size-10 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {isDragActive ? "Solta el archivo aca" : "Arrastra un archivo o hace click"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      PDF, PPTX o DOCX (max 50MB)
                    </p>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="url" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="url">URL</Label>
              <Input
                id="url"
                placeholder="https://tuempresa.com/servicios"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isUploading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="url-title">Titulo (opcional)</Label>
              <Input
                id="url-title"
                placeholder="Landing de servicios"
                value={urlTitle}
                onChange={(e) => setUrlTitle(e.target.value)}
                disabled={isUploading}
              />
            </div>
            <Button
              onClick={handleUrlSubmit}
              disabled={!url.trim() || isUploading}
              className="w-full"
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <Link2 className="mr-2 size-4" />
                  Analizar URL
                </>
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
