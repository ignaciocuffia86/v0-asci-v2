"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { createClient } from "@/lib/supabase/client"
import { createDocument } from "@/app/actions/documents"
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
import { Upload, Link2, FileText, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
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

interface UploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDocumentCreated: () => void
}

export function UploadDialog({ open, onOpenChange, onDocumentCreated }: UploadDialogProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [url, setUrl] = useState("")
  const [urlTitle, setUrlTitle] = useState("")
  const supabase = createClient()

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return
    const file = acceptedFiles[0]

    setIsUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("No autenticado")

      const docType = FILE_TYPE_MAP[file.type]
      if (!docType) throw new Error("Tipo de archivo no soportado")

      // Generate unique path
      const fileExt = file.name.split(".").pop()
      const docId = crypto.randomUUID()
      const storagePath = `${user.id}/${docId}/${file.name}`

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("user-documents")
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
        })

      if (uploadError) throw uploadError

      // Create DB record
      const title = file.name.replace(`.${fileExt}`, "")
      const result = await createDocument({
        title,
        type: docType,
        storage_path: storagePath,
        file_size: file.size,
      })

      if (result.error) throw new Error(result.error)

      toast.success(`"${title}" subido correctamente. Procesando...`)
      onDocumentCreated()
      onOpenChange(false)

      // Trigger processing using documentId (most reliable)
      if (result.data?.id) {
        fetch("/api/documents/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: result.data.id }),
        }).catch((err) => console.error("[v0] Process trigger failed:", err))
      }
    } catch (err: any) {
      toast.error(err.message || "Error al subir el archivo")
    } finally {
      setIsUploading(false)
    }
  }, [supabase, onDocumentCreated, onOpenChange])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    maxSize: 52428800, // 50MB
    disabled: isUploading,
  })

  const handleUrlSubmit = async () => {
    if (!url.trim()) return

    setIsUploading(true)
    try {
      const title = urlTitle.trim() || new URL(url).hostname
      const result = await createDocument({
        title,
        type: "url",
        source_url: url.trim(),
      })

      if (result.error) throw new Error(result.error)

      toast.success(`"${title}" creado. Procesando URL...`)
      onDocumentCreated()
      onOpenChange(false)
      setUrl("")
      setUrlTitle("")

      // Trigger processing using documentId (most reliable)
      if (result.data?.id) {
        fetch("/api/documents/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: result.data.id }),
        }).catch((err) => console.error("[v0] URL process trigger failed:", err))
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
              <Upload className="h-4 w-4" />
              Archivo
            </TabsTrigger>
            <TabsTrigger value="url" className="gap-2">
              <Link2 className="h-4 w-4" />
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
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Subiendo archivo...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <FileText className="h-10 w-10 text-muted-foreground" />
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <Link2 className="mr-2 h-4 w-4" />
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
