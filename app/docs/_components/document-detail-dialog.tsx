"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  FileText, Globe, FileSpreadsheet, Presentation,
  Loader2, X, Building2, Cpu, Workflow, RefreshCw,
  ExternalLink, Eye, Info,
} from "lucide-react"
import { getDocumentWithTags, removeDocumentTag, getDocumentPreviewUrl } from "@/app/actions/documents"
import type { UserDocument, DocumentTag } from "@/app/actions/documents"
import { toast } from "sonner"

const TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  pptx: "PowerPoint",
  url: "URL",
}

const TAG_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  industry: { label: "Industria", icon: Building2, color: "border-emerald-200 text-emerald-700 bg-emerald-50" },
  technology: { label: "Tecnologia", icon: Cpu, color: "border-blue-200 text-blue-700 bg-blue-50" },
  process: { label: "Proceso", icon: Workflow, color: "border-purple-200 text-purple-700 bg-purple-50" },
}

interface DocumentDetailDialogProps {
  documentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => void
}

export function DocumentDetailDialog({ documentId, open, onOpenChange, onUpdated }: DocumentDetailDialogProps) {
  const [doc, setDoc] = useState<UserDocument | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isReprocessing, setIsReprocessing] = useState(false)
  const [removingTagId, setRemovingTagId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [activeTab, setActiveTab] = useState("details")

  useEffect(() => {
    if (documentId && open) {
      setIsLoading(true)
      setPreviewUrl(null)
      setActiveTab("details")
      getDocumentWithTags(documentId).then(({ data }) => {
        setDoc(data)
        setIsLoading(false)
      })
    }
  }, [documentId, open])

  const loadPreview = async () => {
    if (!doc || previewUrl) return
    setPreviewLoading(true)
    const { url, error } = await getDocumentPreviewUrl(doc.id)
    if (url) {
      setPreviewUrl(url)
    } else {
      toast.error(error || "No se pudo cargar el preview")
    }
    setPreviewLoading(false)
  }

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    if (tab === "preview") {
      loadPreview()
    }
  }

  const handleRemoveTag = async (tagId: string) => {
    setRemovingTagId(tagId)
    const { success } = await removeDocumentTag(tagId)
    if (success) {
      setDoc((prev) => prev ? { ...prev, tags: prev.tags?.filter((t) => t.id !== tagId) } : prev)
      onUpdated()
    } else {
      toast.error("Error al eliminar tag")
    }
    setRemovingTagId(null)
  }

  const handleReprocess = async () => {
    if (!doc) return
    setIsReprocessing(true)
    try {
      await fetch("/api/documents/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: doc.id,
          reprocess: true,
        }),
      })
      toast.success("Reprocesando documento...")
      onOpenChange(false)
      onUpdated()
    } catch {
      toast.error("Error al reprocesar")
    } finally {
      setIsReprocessing(false)
    }
  }

  // Group tags by type and deduplicate industry tags by master_industry_id
  const groupedTags = (doc?.tags || []).reduce((acc, tag) => {
    if (!acc[tag.tag_type]) acc[tag.tag_type] = []
    
    // For industry tags, deduplicate by master_industry_id
    if (tag.tag_type === "industry" && tag.master_industry_id) {
      const existing = acc[tag.tag_type].find(
        (t) => t.master_industry_id === tag.master_industry_id
      )
      if (existing) {
        // Keep the one with highest confidence
        if (tag.confidence > existing.confidence) {
          acc[tag.tag_type] = acc[tag.tag_type].filter(
            (t) => t.master_industry_id !== tag.master_industry_id
          )
          acc[tag.tag_type].push(tag)
        }
        return acc
      }
    }
    
    acc[tag.tag_type].push(tag)
    return acc
  }, {} as Record<string, DocumentTag[]>)

  const canPreview = doc && (doc.type === "pdf" || doc.type === "url")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            {doc?.title || "Cargando..."}
            {doc?.type && (
              <Badge variant="outline" className="text-[10px] uppercase font-normal">
                {TYPE_LABELS[doc.type]}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : doc ? (
          <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col min-h-0">
            <TabsList className={`grid w-full ${canPreview ? "grid-cols-2" : "grid-cols-1"}`}>
              <TabsTrigger value="details" className="gap-1.5">
                <Info className="h-3.5 w-3.5" />
                Detalle
              </TabsTrigger>
              {canPreview && (
                <TabsTrigger value="preview" className="gap-1.5">
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </TabsTrigger>
              )}
            </TabsList>

            {/* Details Tab */}
            <TabsContent value="details" className="flex-1 overflow-y-auto mt-4">
              <div className="space-y-5 pb-4">
                {/* Summary */}
                {doc.ai_summary && (
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      Resumen
                    </h4>
                    <p className="text-sm leading-relaxed text-foreground">{doc.ai_summary}</p>
                  </div>
                )}

                {/* Tags */}
                {Object.keys(groupedTags).length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                      Tags extraidos
                    </h4>
                    <div className="space-y-3">
                      {(["industry", "technology", "process"] as const).map((type) => {
                        const tags = groupedTags[type]
                        if (!tags?.length) return null
                        const config = TAG_TYPE_CONFIG[type]
                        const TagIcon = config.icon

                        return (
                          <div key={type}>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                              <TagIcon className="h-3.5 w-3.5" />
                              {config.label}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {tags.map((tag) => {
                                // For industry tags, show master industry name if available
                                const displayValue = tag.tag_type === "industry" && tag.master_industry?.name_es
                                  ? tag.master_industry.name_es
                                  : tag.tag_value
                                
                                return (
                                  <Badge
                                    key={tag.id}
                                    variant="outline"
                                    className={`text-xs gap-1 pr-1 ${config.color}`}
                                    title={tag.tag_type === "industry" && tag.master_industry?.name_es ? `Original: ${tag.tag_value}` : undefined}
                                  >
                                    {displayValue}
                                    <span className="text-[9px] opacity-60">
                                      {Math.round(tag.confidence * 100)}%
                                    </span>
                                    <button
                                      onClick={() => handleRemoveTag(tag.id)}
                                      className="ml-0.5 hover:bg-background/50 rounded p-0.5"
                                      disabled={removingTagId === tag.id}
                                    >
                                      {removingTagId === tag.id ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <X className="h-3 w-3" />
                                      )}
                                    </button>
                                  </Badge>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Source */}
                {doc.source_url && (
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      Fuente
                    </h4>
                    <a
                      href={doc.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                    >
                      {doc.source_url}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                {/* Error */}
                {doc.status === "error" && doc.processing_error && (
                  <div className="rounded-lg bg-destructive/10 p-3">
                    <p className="text-sm text-destructive">{doc.processing_error}</p>
                  </div>
                )}

                <Separator />

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReprocess}
                    disabled={isReprocessing}
                    className="gap-1.5"
                  >
                    {isReprocessing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Reprocesar
                  </Button>
                  {doc.type !== "pdf" && doc.type !== "url" && doc.storage_path && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={async () => {
                        const { url } = await getDocumentPreviewUrl(doc.id)
                        if (url) window.open(url, "_blank")
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Descargar
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(doc.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </div>
              </div>
            </TabsContent>

            {/* Preview Tab */}
            {canPreview && (
              <TabsContent value="preview" className="flex-1 min-h-0 mt-4">
                {previewLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : previewUrl ? (
                  <div className="h-[55vh] rounded-lg border overflow-hidden bg-muted">
                    {doc.type === "url" ? (
                      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
                        <Globe className="h-10 w-10 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          El preview de URLs externas no se puede embeber. Abri el link directamente:
                        </p>
                        <Button asChild variant="outline" className="gap-1.5">
                          <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                            Abrir URL
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      </div>
                    ) : (
                      <iframe
                        src={previewUrl}
                        className="w-full h-full"
                        title={`Preview de ${doc.title}`}
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                    No se pudo cargar el preview.
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
