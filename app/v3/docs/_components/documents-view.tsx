"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { 
  FileText, 
  Upload, 
  Link2, 
  MoreHorizontal, 
  Trash2, 
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { WorkspaceDocument, deleteWorkspaceDocument, getWorkspaceDocuments } from "@/app/actions/v3/documents"
import { UploadDocumentDialog } from "./upload-document-dialog"

interface DocumentsViewProps {
  initialDocuments: WorkspaceDocument[]
  stats: {
    total: number
    ready: number
    processing: number
    error: number
  }
  workspaceName: string
}

export function DocumentsView({ initialDocuments, stats, workspaceName }: DocumentsViewProps) {
  const router = useRouter()
  const [documents, setDocuments] = useState(initialDocuments)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Poll for updates when there are processing documents
  useEffect(() => {
    const hasProcessing = documents.some(d => d.status === "processing")
    if (!hasProcessing) return

    const interval = setInterval(async () => {
      try {
        const result = await getWorkspaceDocuments()
        if (result.data) {
          setDocuments(result.data)
          // If no more processing, router.refresh to update stats
          const stillProcessing = result.data.some((d: WorkspaceDocument) => d.status === "processing")
          if (!stillProcessing) {
            router.refresh()
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 3000) // Poll every 3 seconds

    return () => clearInterval(interval)
  }, [documents, router])

  const handleDocumentCreated = () => {
    router.refresh()
    setUploadOpen(false)
  }

  const handleDelete = async (docId: string) => {
    setDeletingId(docId)
    try {
      const result = await deleteWorkspaceDocument(docId)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success("Documento eliminado")
        setDocuments(prev => prev.filter(d => d.id !== docId))
      }
    } catch {
      toast.error("Error al eliminar documento")
    } finally {
      setDeletingId(null)
    }
  }

  const handleReprocess = async (docId: string) => {
    toast.info("Reprocesando documento...")
    try {
      const res = await fetch("/api/v3/documents/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: docId, reprocess: true }),
      })
      if (res.ok) {
        toast.success("Documento en cola de procesamiento")
        router.refresh()
      } else {
        toast.error("Error al reprocesar")
      }
    } catch {
      toast.error("Error al reprocesar")
    }
  }

  const canContinue = stats.ready > 0

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Documentos de {workspaceName}
          </h1>
          <p className="text-muted-foreground">
            Sube documentacion de tu empresa para que ASCI entienda tu propuesta de valor 
            y pueda recomendar cuentas y generar mensajes personalizados.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-600">{stats.ready}</div>
              <div className="text-xs text-muted-foreground">Procesados</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-yellow-600">{stats.processing}</div>
              <div className="text-xs text-muted-foreground">Procesando</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-600">{stats.error}</div>
              <div className="text-xs text-muted-foreground">Con error</div>
            </CardContent>
          </Card>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <Button onClick={() => setUploadOpen(true)}>
            <Upload data-icon="inline-start" />
            Subir documento
          </Button>

          {canContinue && (
            <Button variant="outline" onClick={() => router.push("/v3/campaigns")}>
              Continuar a campanas
              <ArrowRight data-icon="inline-end" />
            </Button>
          )}
        </div>

        {/* Document List */}
        {documents.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="size-12 text-muted-foreground/50 mb-4" />
              <h3 className="font-medium mb-1">Sin documentos</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Sube al menos un documento para comenzar a usar ASCI
              </p>
              <Button onClick={() => setUploadOpen(true)}>
                <Upload data-icon="inline-start" />
                Subir primer documento
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <Card key={doc.id} className="group">
                <CardContent className="flex items-center gap-4 py-4">
                  {/* Icon */}
                  <div className="flex-shrink-0">
                    {doc.type === "url" ? (
                      <Link2 className="size-8 text-muted-foreground" />
                    ) : (
                      <FileText className="size-8 text-muted-foreground" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{doc.title}</span>
                      <Badge variant="secondary" className="uppercase text-xs">
                        {doc.type}
                      </Badge>
                    </div>
                    {doc.ai_summary && (
                      <p className="text-sm text-muted-foreground truncate mt-0.5">
                        {doc.ai_summary}
                      </p>
                    )}
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {doc.tags.slice(0, 5).map((tag) => (
                          <Badge 
                            key={tag.id} 
                            variant="outline" 
                            className="text-xs"
                          >
                            {tag.tag_value}
                          </Badge>
                        ))}
                        {doc.tags.length > 5 && (
                          <Badge variant="outline" className="text-xs">
                            +{doc.tags.length - 5}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Status */}
                  <div className="flex-shrink-0 w-24">
                    {doc.status === "ready" && (
                      <div className="flex items-center gap-1.5 text-green-600">
                        <CheckCircle2 className="size-4" />
                        <span className="text-xs font-medium">Listo</span>
                      </div>
                    )}
                    {doc.status === "processing" && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-yellow-600">
                          <Loader2 className="size-4 animate-spin" />
                          <span className="text-xs font-medium">
                            {doc.processing_progress || 0}%
                          </span>
                        </div>
                        <Progress 
                          value={doc.processing_progress || 0} 
                          className="h-1.5"
                        />
                      </div>
                    )}
                    {doc.status === "error" && (
                      <div className="flex items-center gap-1.5 text-red-600">
                        <AlertCircle className="size-4" />
                        <span className="text-xs font-medium">Error</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleReprocess(doc.id)}>
                        <RefreshCw data-icon="inline-start" />
                        Reprocesar
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleDelete(doc.id)}
                        className="text-destructive"
                        disabled={deletingId === doc.id}
                      >
                        <Trash2 data-icon="inline-start" />
                        {deletingId === doc.id ? "Eliminando..." : "Eliminar"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Blocker notice */}
        {!canContinue && documents.length > 0 && (
          <Card className="border-yellow-500/50 bg-yellow-500/5">
            <CardContent className="flex items-center gap-3 py-4">
              <Loader2 className="size-5 text-yellow-600 animate-spin" />
              <div>
                <p className="font-medium text-sm">Procesando documentos</p>
                <p className="text-xs text-muted-foreground">
                  Espera a que al menos un documento termine de procesarse para continuar
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onDocumentCreated={handleDocumentCreated}
      />
    </div>
  )
}
