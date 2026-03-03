"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, FileText, Loader2, ArrowLeft, Building2, Cpu, Workflow, X, Filter } from "lucide-react"
import Link from "next/link"
import { getUserDocumentsWithTags, getUserValueProfile } from "@/app/actions/documents"
import type { UserDocument, UserValueProfile, DocumentTag } from "@/app/actions/documents"
import { UploadDialog } from "./_components/upload-dialog"
import { DocumentCard } from "./_components/document-card"
import { ValueProfileCard } from "./_components/value-profile-card"
import { DocumentDetailDialog } from "./_components/document-detail-dialog"
import { toast } from "sonner"

const TAG_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; activeColor: string }> = {
  industry: {
    label: "Industria",
    icon: Building2,
    color: "border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100",
    activeColor: "border-emerald-500 text-emerald-900 bg-emerald-200",
  },
  technology: {
    label: "Tecnologia",
    icon: Cpu,
    color: "border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100",
    activeColor: "border-blue-500 text-blue-900 bg-blue-200",
  },
  process: {
    label: "Proceso",
    icon: Workflow,
    color: "border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100",
    activeColor: "border-purple-500 text-purple-900 bg-purple-200",
  },
}

export default function DocsPage() {
  const [documents, setDocuments] = useState<UserDocument[]>([])
  const [valueProfile, setValueProfile] = useState<UserValueProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)

  const fetchData = useCallback(async () => {
    const [docsResult, profileResult] = await Promise.all([
      getUserDocumentsWithTags(),
      getUserValueProfile(),
    ])
    if (docsResult.data) setDocuments(docsResult.data)
    if (profileResult.data) setValueProfile(profileResult.data)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Poll for processing documents
  useEffect(() => {
    const hasProcessing = documents.some((d) => d.status === "processing" || d.status === "uploading")
    if (!hasProcessing) return

    const interval = setInterval(() => {
      fetchData()
    }, 5000)

    return () => clearInterval(interval)
  }, [documents, fetchData])

  const handleRegenerate = async () => {
    const res = await fetch("/api/documents/generate-profile", { method: "POST" })
    if (!res.ok) throw new Error("Error al generar perfil")
    await fetchData()
  }

  // Extract unique tags from all documents
  const allTags = useMemo(() => {
    const tagMap = new Map<string, { type: string; value: string; count: number }>()
    documents.forEach((doc) => {
      (doc.tags || []).forEach((tag) => {
        const key = `${tag.tag_type}::${tag.tag_value}`
        if (tagMap.has(key)) {
          tagMap.get(key)!.count++
        } else {
          tagMap.set(key, { type: tag.tag_type, value: tag.tag_value, count: 1 })
        }
      })
    })
    // Sort: by type (industry, process, technology), then by count desc
    return Array.from(tagMap.entries())
      .sort((a, b) => {
        if (a[1].type !== b[1].type) return a[1].type.localeCompare(b[1].type)
        return b[1].count - a[1].count
      })
      .map(([key, data]) => ({ key, ...data }))
  }, [documents])

  // Filter documents based on active tags
  const filteredDocuments = useMemo(() => {
    if (activeFilters.size === 0) return documents
    return documents.filter((doc) => {
      const docTagKeys = (doc.tags || []).map((t) => `${t.tag_type}::${t.tag_value}`)
      // Document must match ALL active filters (AND logic)
      return Array.from(activeFilters).every((filter) => docTagKeys.includes(filter))
    })
  }, [documents, activeFilters])

  const toggleFilter = (key: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const clearFilters = () => setActiveFilters(new Set())

  const readyDocs = documents.filter((d) => d.status === "ready")

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/search">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver a Busqueda
        </Link>
      </Button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3" data-onboarding="docs-header">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Docs</h1>
          <p className="text-muted-foreground">
            Tu base de conocimiento. Subi documentos para que ASCI entienda tu propuesta de valor.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)} className="gap-2" data-onboarding="docs-upload">
          <Plus className="h-4 w-4" />
          Agregar
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Value Profile */}
          <ValueProfileCard
            profile={valueProfile}
            documentCount={readyDocs.length}
            onRegenerate={handleRegenerate}
          />

          {/* Documents Section */}
          {documents.length > 0 ? (
            <div className="space-y-3" data-onboarding="docs-list">
              {/* Documents header with filter toggle */}
              <div className="flex items-center justify-between" data-onboarding="docs-folders">
                <h2 className="text-sm font-medium text-muted-foreground">
                  Documentos ({filteredDocuments.length}{activeFilters.size > 0 ? ` de ${documents.length}` : ""})
                </h2>
                {allTags.length > 0 && (
                  <Button
                    variant={showFilters ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setShowFilters(!showFilters)}
                    className="gap-1.5 h-7 text-xs"
                  >
                    <Filter className="h-3.5 w-3.5" />
                    Filtrar
                    {activeFilters.size > 0 && (
                      <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] rounded-full">
                        {activeFilters.size}
                      </Badge>
                    )}
                  </Button>
                )}
              </div>

              {/* Tag filters */}
              {showFilters && allTags.length > 0 && (
                <div className="rounded-lg border bg-card p-3 space-y-2.5" data-onboarding="docs-tags">
                  {(["industry", "technology", "process"] as const).map((type) => {
                    const tagsOfType = allTags.filter((t) => t.type === type)
                    if (tagsOfType.length === 0) return null
                    const config = TAG_TYPE_CONFIG[type]
                    const TagIcon = config.icon

                    return (
                      <div key={type}>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
                          <TagIcon className="h-3 w-3" />
                          {config.label}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {tagsOfType.map((tag) => {
                            const isActive = activeFilters.has(tag.key)
                            return (
                              <button
                                key={tag.key}
                                onClick={() => toggleFilter(tag.key)}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer ${
                                  isActive ? config.activeColor : config.color
                                }`}
                              >
                                {tag.value}
                                <span className="text-[10px] opacity-60">{tag.count}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}

                  {activeFilters.size > 0 && (
                    <div className="pt-1 border-t">
                      <button
                        onClick={clearFilters}
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
                      >
                        <X className="h-3 w-3" />
                        Limpiar filtros
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Documents Grid */}
              {filteredDocuments.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {filteredDocuments.map((doc) => (
                    <DocumentCard
                      key={doc.id}
                      document={doc}
                      onClick={() => {
                        setSelectedDocId(doc.id)
                        setDetailOpen(true)
                      }}
                      onDeleted={fetchData}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    Ningun documento coincide con los filtros seleccionados.
                  </p>
                  <button
                    onClick={clearFilters}
                    className="text-sm text-primary hover:underline mt-1"
                  >
                    Limpiar filtros
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 rounded-full bg-muted mb-4">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">No hay documentos</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Subi un caso de exito, brochure, propuesta o URL de tu web para que ASCI aprenda sobre tu negocio.
              </p>
              <Button className="mt-4 gap-2" onClick={() => setUploadOpen(true)}>
                <Plus className="h-4 w-4" />
                Agregar primer documento
              </Button>
            </div>
          )}
        </>
      )}

      {/* Dialogs */}
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onDocumentCreated={fetchData}
      />
      <DocumentDetailDialog
        documentId={selectedDocId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdated={fetchData}
      />
    </div>
  )
}
