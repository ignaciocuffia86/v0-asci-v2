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
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Tag,
  Building2,
  Cpu,
  Settings2,
  Sparkles,
  TrendingUp
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { toast } from "sonner"
import { WorkspaceDocument, WorkspaceDocumentTag, deleteWorkspaceDocument, getWorkspaceDocuments } from "@/app/actions/v3/documents"
import { UploadDocumentDialog } from "./upload-document-dialog"

// Helper to parse ai_summary JSON
function parseAiSummary(doc: WorkspaceDocument): { summary: string; keyResults: string[]; documentType: string } | null {
  if (!doc.ai_summary) return null
  try {
    const parsed = JSON.parse(doc.ai_summary)
    return {
      summary: parsed.summary || "",
      keyResults: parsed.key_results || [],
      documentType: parsed.document_type || "OTRO"
    }
  } catch {
    // If not JSON, treat as plain text summary
    return { summary: doc.ai_summary, keyResults: [], documentType: "OTRO" }
  }
}

// Group tags by type
function groupTags(tags: WorkspaceDocumentTag[]): {
  industries: WorkspaceDocumentTag[]
  technologies: WorkspaceDocumentTag[]
  processes: WorkspaceDocumentTag[]
} {
  return {
    industries: tags.filter(t => t.tag_type === "industry"),
    technologies: tags.filter(t => t.tag_type === "technology"),
    processes: tags.filter(t => t.tag_type === "process"),
  }
}

const tagTypeConfig = {
  industry: { icon: Building2, label: "Industrias", color: "bg-blue-500/10 text-blue-700 border-blue-200" },
  technology: { icon: Cpu, label: "Tecnologias", color: "bg-purple-500/10 text-purple-700 border-purple-200" },
  process: { icon: Settings2, label: "Procesos", color: "bg-green-500/10 text-green-700 border-green-200" },
}

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
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null)

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
            {documents.map((doc) => {
              const aiData = parseAiSummary(doc)
              const groupedTags = doc.tags ? groupTags(doc.tags) : { industries: [], technologies: [], processes: [] }
              const totalTags = (doc.tags?.length || 0)
              const isExpanded = expandedDoc === doc.id
              const hasDetails = doc.status === "ready" && (totalTags > 0 || (aiData?.keyResults?.length || 0) > 0)

              return (
                <Collapsible 
                  key={doc.id} 
                  open={isExpanded} 
                  onOpenChange={(open) => setExpandedDoc(open ? doc.id : null)}
                >
                  <Card className="group overflow-hidden">
                    <CardContent className="p-0">
                      {/* Main row */}
                      <div className="flex items-center gap-4 p-4">
                        {/* Icon */}
                        <div className="flex-shrink-0">
                          {doc.type === "url" ? (
                            <div className="size-10 rounded-lg bg-muted flex items-center justify-center">
                              <Link2 className="size-5 text-muted-foreground" />
                            </div>
                          ) : (
                            <div className="size-10 rounded-lg bg-muted flex items-center justify-center">
                              <FileText className="size-5 text-muted-foreground" />
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{doc.title}</span>
                            <Badge variant="secondary" className="uppercase text-xs shrink-0">
                              {doc.type}
                            </Badge>
                            {aiData?.documentType && aiData.documentType !== "OTRO" && (
                              <Badge variant="outline" className="text-xs shrink-0">
                                {aiData.documentType === "CASO_DE_EXITO" ? "Caso de Exito" : "Brochure"}
                              </Badge>
                            )}
                          </div>
                          
                          {/* Summary preview */}
                          {aiData?.summary && (
                            <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">
                              {aiData.summary}
                            </p>
                          )}
                          
                          {/* Tags summary */}
                          {totalTags > 0 && (
                            <div className="flex items-center gap-3 mt-2">
                              {groupedTags.industries.length > 0 && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Building2 className="size-3" />
                                  <span>{groupedTags.industries.length}</span>
                                </div>
                              )}
                              {groupedTags.technologies.length > 0 && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Cpu className="size-3" />
                                  <span>{groupedTags.technologies.length}</span>
                                </div>
                              )}
                              {groupedTags.processes.length > 0 && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Settings2 className="size-3" />
                                  <span>{groupedTags.processes.length}</span>
                                </div>
                              )}
                              <span className="text-xs text-muted-foreground">
                                ({totalTags} tags)
                              </span>
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

                        {/* Expand button */}
                        {hasDetails && (
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="icon" className="shrink-0">
                              {isExpanded ? (
                                <ChevronUp className="size-4" />
                              ) : (
                                <ChevronDown className="size-4" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                        )}

                        {/* Actions */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleReprocess(doc.id)}>
                              <RefreshCw className="size-4 mr-2" />
                              Reprocesar
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleDelete(doc.id)}
                              className="text-destructive"
                              disabled={deletingId === doc.id}
                            >
                              <Trash2 className="size-4 mr-2" />
                              {deletingId === doc.id ? "Eliminando..." : "Eliminar"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Expanded content */}
                      <CollapsibleContent>
                        <div className="border-t bg-muted/30 p-4 space-y-4">
                          {/* Key Results */}
                          {aiData?.keyResults && aiData.keyResults.length > 0 && (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                <TrendingUp className="size-4 text-green-600" />
                                Resultados clave
                              </div>
                              <ul className="space-y-1.5 ml-6">
                                {aiData.keyResults.map((result, idx) => (
                                  <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                                    <Sparkles className="size-3 mt-1 text-yellow-500 shrink-0" />
                                    {result}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Tags by category */}
                          {totalTags > 0 && (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                <Tag className="size-4" />
                                Tags extraidos
                              </div>
                              
                              <div className="grid gap-3 sm:grid-cols-3">
                                {/* Industries */}
                                {groupedTags.industries.length > 0 && (
                                  <div className="space-y-1.5">
                                    <div className="flex items-center gap-1.5 text-xs font-medium text-blue-700">
                                      <Building2 className="size-3" />
                                      Industrias
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {groupedTags.industries.map((tag) => (
                                        <Badge 
                                          key={tag.id} 
                                          variant="outline"
                                          className={tagTypeConfig.industry.color}
                                        >
                                          {tag.tag_value}
                                          {tag.confidence >= 0.8 && (
                                            <span className="ml-1 opacity-60">
                                              {Math.round(tag.confidence * 100)}%
                                            </span>
                                          )}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Technologies */}
                                {groupedTags.technologies.length > 0 && (
                                  <div className="space-y-1.5">
                                    <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700">
                                      <Cpu className="size-3" />
                                      Tecnologias
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {groupedTags.technologies.map((tag) => (
                                        <Badge 
                                          key={tag.id} 
                                          variant="outline"
                                          className={tagTypeConfig.technology.color}
                                        >
                                          {tag.tag_value}
                                          {tag.confidence >= 0.8 && (
                                            <span className="ml-1 opacity-60">
                                              {Math.round(tag.confidence * 100)}%
                                            </span>
                                          )}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Processes */}
                                {groupedTags.processes.length > 0 && (
                                  <div className="space-y-1.5">
                                    <div className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                                      <Settings2 className="size-3" />
                                      Procesos
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {groupedTags.processes.map((tag) => (
                                        <Badge 
                                          key={tag.id} 
                                          variant="outline"
                                          className={tagTypeConfig.process.color}
                                        >
                                          {tag.tag_value}
                                          {tag.confidence >= 0.8 && (
                                            <span className="ml-1 opacity-60">
                                              {Math.round(tag.confidence * 100)}%
                                            </span>
                                          )}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </CardContent>
                  </Card>
                </Collapsible>
              )
            })}
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
