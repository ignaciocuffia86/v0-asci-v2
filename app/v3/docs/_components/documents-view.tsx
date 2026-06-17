"use client"

import { useState, useEffect, useMemo } from "react"
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
  TrendingUp,
  Search,
  X,
  Filter,
  Users,
  Target,
  Briefcase
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { toast } from "sonner"
import { WorkspaceDocument, WorkspaceDocumentTag, deleteWorkspaceDocument, getWorkspaceDocuments } from "@/app/actions/v3/documents"
import { UploadDocumentDialog } from "./upload-document-dialog"
import { cn } from "@/lib/utils"

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
  
  // Filter state
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  // Extract all unique tags from documents for filter options
  const availableTags = useMemo(() => {
    const tagMap = new Map<string, { type: string; value: string; count: number }>()
    documents.forEach(doc => {
      doc.tags?.forEach(tag => {
        const key = `${tag.tag_type}:${tag.tag_value}`
        const existing = tagMap.get(key)
        if (existing) {
          existing.count++
        } else {
          tagMap.set(key, { type: tag.tag_type, value: tag.tag_value, count: 1 })
        }
      })
    })
    return Array.from(tagMap.entries()).map(([key, data]) => ({ key, ...data }))
      .sort((a, b) => b.count - a.count)
  }, [documents])

  // Filter documents
  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const aiData = parseAiSummary(doc)
        const matchesTitle = doc.title.toLowerCase().includes(query)
        const matchesSummary = aiData?.summary?.toLowerCase().includes(query)
        const matchesTags = doc.tags?.some(t => t.tag_value.toLowerCase().includes(query))
        if (!matchesTitle && !matchesSummary && !matchesTags) return false
      }
      
      // Status filter
      if (statusFilter && doc.status !== statusFilter) return false
      
      // Type filter
      if (typeFilter && doc.type !== typeFilter) return false
      
      // Tag filter
      if (selectedTags.length > 0) {
        const docTagKeys = doc.tags?.map(t => `${t.tag_type}:${t.tag_value}`) || []
        if (!selectedTags.some(tag => docTagKeys.includes(tag))) return false
      }
      
      return true
    })
  }, [documents, searchQuery, statusFilter, typeFilter, selectedTags])

  const hasActiveFilters = searchQuery || statusFilter || typeFilter || selectedTags.length > 0

  const clearAllFilters = () => {
    setSearchQuery("")
    setStatusFilter(null)
    setTypeFilter(null)
    setSelectedTags([])
  }

  const toggleTag = (tagKey: string) => {
    setSelectedTags(prev => 
      prev.includes(tagKey) 
        ? prev.filter(t => t !== tagKey)
        : [...prev, tagKey]
    )
  }

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

        {/* Stats - clickeable para filtrar */}
        <div className="grid grid-cols-4 gap-4">
          <Card 
            className={cn(
              "cursor-pointer transition-all hover:border-foreground/20",
              statusFilter === null && "ring-2 ring-foreground/10"
            )}
            onClick={() => setStatusFilter(null)}
          >
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </CardContent>
          </Card>
          <Card 
            className={cn(
              "cursor-pointer transition-all hover:border-green-500/50",
              statusFilter === "ready" && "ring-2 ring-green-500"
            )}
            onClick={() => setStatusFilter(statusFilter === "ready" ? null : "ready")}
          >
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-green-600">{stats.ready}</div>
              <div className="text-xs text-muted-foreground">Procesados</div>
            </CardContent>
          </Card>
          <Card 
            className={cn(
              "cursor-pointer transition-all hover:border-yellow-500/50",
              statusFilter === "processing" && "ring-2 ring-yellow-500"
            )}
            onClick={() => setStatusFilter(statusFilter === "processing" ? null : "processing")}
          >
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-yellow-600">{stats.processing}</div>
              <div className="text-xs text-muted-foreground">Procesando</div>
            </CardContent>
          </Card>
          <Card 
            className={cn(
              "cursor-pointer transition-all hover:border-red-500/50",
              statusFilter === "error" && "ring-2 ring-red-500"
            )}
            onClick={() => setStatusFilter(statusFilter === "error" ? null : "error")}
          >
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-600">{stats.error}</div>
              <div className="text-xs text-muted-foreground">Con error</div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Buscar documentos..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {/* Type filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <FileText className="size-4" />
                {typeFilter ? typeFilter.toUpperCase() : "Tipo"}
                {typeFilter && <X className="size-3 ml-1" onClick={(e) => { e.stopPropagation(); setTypeFilter(null) }} />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuCheckboxItem 
                checked={typeFilter === "pdf"}
                onCheckedChange={() => setTypeFilter(typeFilter === "pdf" ? null : "pdf")}
              >
                PDF
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem 
                checked={typeFilter === "docx"}
                onCheckedChange={() => setTypeFilter(typeFilter === "docx" ? null : "docx")}
              >
                DOCX
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem 
                checked={typeFilter === "pptx"}
                onCheckedChange={() => setTypeFilter(typeFilter === "pptx" ? null : "pptx")}
              >
                PPTX
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem 
                checked={typeFilter === "url"}
                onCheckedChange={() => setTypeFilter(typeFilter === "url" ? null : "url")}
              >
                URL
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Tags filter */}
          {availableTags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Tag className="size-4" />
                  Tags
                  {selectedTags.length > 0 && (
                    <Badge variant="secondary" className="ml-1 size-5 p-0 flex items-center justify-center text-xs">
                      {selectedTags.length}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-auto">
                {/* Industries */}
                {availableTags.filter(t => t.type === "industry").length > 0 && (
                  <>
                    <DropdownMenuLabel className="flex items-center gap-2 text-blue-700">
                      <Building2 className="size-3" />
                      Industrias
                    </DropdownMenuLabel>
                    {availableTags.filter(t => t.type === "industry").map(tag => (
                      <DropdownMenuCheckboxItem
                        key={tag.key}
                        checked={selectedTags.includes(tag.key)}
                        onCheckedChange={() => toggleTag(tag.key)}
                      >
                        <span className="flex-1">{tag.value}</span>
                        <span className="text-xs text-muted-foreground ml-2">{tag.count}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Technologies */}
                {availableTags.filter(t => t.type === "technology").length > 0 && (
                  <>
                    <DropdownMenuLabel className="flex items-center gap-2 text-purple-700">
                      <Cpu className="size-3" />
                      Tecnologias
                    </DropdownMenuLabel>
                    {availableTags.filter(t => t.type === "technology").map(tag => (
                      <DropdownMenuCheckboxItem
                        key={tag.key}
                        checked={selectedTags.includes(tag.key)}
                        onCheckedChange={() => toggleTag(tag.key)}
                      >
                        <span className="flex-1">{tag.value}</span>
                        <span className="text-xs text-muted-foreground ml-2">{tag.count}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                {/* Processes */}
                {availableTags.filter(t => t.type === "process").length > 0 && (
                  <>
                    <DropdownMenuLabel className="flex items-center gap-2 text-green-700">
                      <Settings2 className="size-3" />
                      Procesos
                    </DropdownMenuLabel>
                    {availableTags.filter(t => t.type === "process").map(tag => (
                      <DropdownMenuCheckboxItem
                        key={tag.key}
                        checked={selectedTags.includes(tag.key)}
                        onCheckedChange={() => toggleTag(tag.key)}
                      >
                        <span className="flex-1">{tag.value}</span>
                        <span className="text-xs text-muted-foreground ml-2">{tag.count}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Clear filters */}
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-muted-foreground">
              <X className="size-4 mr-1" />
              Limpiar
            </Button>
          )}

          <div className="flex-1" />

          {/* Upload button */}
          <Button onClick={() => setUploadOpen(true)} className="gap-2">
            <Upload className="size-4" />
            Subir documento
          </Button>
        </div>

        {/* Active filters display */}
        {hasActiveFilters && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">Filtros activos:</span>
            {statusFilter && (
              <Badge variant="secondary" className="gap-1">
                Estado: {statusFilter === "ready" ? "Procesados" : statusFilter === "processing" ? "Procesando" : "Error"}
                <X className="size-3 cursor-pointer" onClick={() => setStatusFilter(null)} />
              </Badge>
            )}
            {typeFilter && (
              <Badge variant="secondary" className="gap-1">
                Tipo: {typeFilter.toUpperCase()}
                <X className="size-3 cursor-pointer" onClick={() => setTypeFilter(null)} />
              </Badge>
            )}
            {selectedTags.map(tagKey => {
              const tag = availableTags.find(t => t.key === tagKey)
              if (!tag) return null
              const config = tagTypeConfig[tag.type as keyof typeof tagTypeConfig]
              return (
                <Badge key={tagKey} variant="outline" className={cn("gap-1", config?.color)}>
                  {tag.value}
                  <X className="size-3 cursor-pointer" onClick={() => toggleTag(tagKey)} />
                </Badge>
              )
            })}
            <span className="text-sm text-muted-foreground ml-2">
              ({filteredDocuments.length} de {documents.length})
            </span>
          </div>
        )}

        {/* Continue button */}
        {canContinue && (
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => router.push("/v3/campaigns")}>
              Continuar a campañas
              <ArrowRight className="size-4 ml-2" />
            </Button>
          </div>
        )}

        {/* Document List */}
        {filteredDocuments.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="size-12 text-muted-foreground/50 mb-4" />
              {hasActiveFilters ? (
                <>
                  <h3 className="font-medium mb-1">Sin resultados</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    No hay documentos que coincidan con los filtros
                  </p>
                  <Button variant="outline" onClick={clearAllFilters}>
                    Limpiar filtros
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="font-medium mb-1">Sin documentos</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Sube al menos un documento para comenzar a usar ASCI
                  </p>
                  <Button onClick={() => setUploadOpen(true)}>
                    <Upload className="size-4 mr-2" />
                    Subir primer documento
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredDocuments.map((doc) => {
              const aiData = parseAiSummary(doc)
              const groupedTags = doc.tags ? groupTags(doc.tags) : { industries: [], technologies: [], processes: [] }
              const totalTags = (doc.tags?.length || 0)
              const isExpanded = expandedDoc === doc.id
              const persona = doc.inferred_persona
              const jobTitles = doc.recommended_job_titles || []
              const hasPersonaInfo = !!persona || jobTitles.length > 0
              const hasDetails = doc.status === "ready" && (totalTags > 0 || (aiData?.keyResults?.length || 0) > 0 || hasPersonaInfo)

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
                          {/* Persona / Cargos sugeridos */}
                          {hasPersonaInfo && (
                            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-500/5 p-3">
                              <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                                <Users className="size-4" />
                                Perfil objetivo sugerido
                              </div>

                              {persona && (
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium text-foreground">
                                      {persona.name}
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className="bg-amber-500/10 text-amber-700 border-amber-200"
                                    >
                                      {persona.type === "buyer" ? "Decisor / Comprador" : "Usuario"}
                                    </Badge>
                                  </div>
                                  {persona.description && (
                                    <p className="text-sm text-muted-foreground leading-relaxed">
                                      {persona.description}
                                    </p>
                                  )}

                                  <div className="grid gap-3 sm:grid-cols-2">
                                    {persona.pains.length > 0 && (
                                      <div className="space-y-1.5">
                                        <div className="flex items-center gap-1.5 text-xs font-medium text-red-700">
                                          <AlertCircle className="size-3" />
                                          Dolores
                                        </div>
                                        <ul className="space-y-1">
                                          {persona.pains.map((pain, idx) => (
                                            <li
                                              key={idx}
                                              className="text-xs text-muted-foreground flex items-start gap-1.5"
                                            >
                                              <span className="mt-1 size-1 rounded-full bg-red-400 shrink-0" />
                                              {pain}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {persona.goals.length > 0 && (
                                      <div className="space-y-1.5">
                                        <div className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                                          <Target className="size-3" />
                                          Objetivos
                                        </div>
                                        <ul className="space-y-1">
                                          {persona.goals.map((goal, idx) => (
                                            <li
                                              key={idx}
                                              className="text-xs text-muted-foreground flex items-start gap-1.5"
                                            >
                                              <span className="mt-1 size-1 rounded-full bg-green-400 shrink-0" />
                                              {goal}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {jobTitles.length > 0 && (
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                    <Briefcase className="size-3" />
                                    Cargos a buscar
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {jobTitles.map((title, idx) => (
                                      <Badge
                                        key={idx}
                                        variant="outline"
                                        className="bg-background"
                                      >
                                        {title}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

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
