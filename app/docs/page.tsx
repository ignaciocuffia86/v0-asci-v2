"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Plus, FileText, Loader2, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { getUserDocuments, getUserValueProfile } from "@/app/actions/documents"
import type { UserDocument, UserValueProfile } from "@/app/actions/documents"
import { UploadDialog } from "./_components/upload-dialog"
import { DocumentCard } from "./_components/document-card"
import { ValueProfileCard } from "./_components/value-profile-card"
import { DocumentDetailDialog } from "./_components/document-detail-dialog"
import { toast } from "sonner"

export default function DocsPage() {
  const [documents, setDocuments] = useState<UserDocument[]>([])
  const [valueProfile, setValueProfile] = useState<UserValueProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const fetchData = useCallback(async () => {
    const [docsResult, profileResult] = await Promise.all([
      getUserDocuments(),
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

  const readyDocs = documents.filter((d) => d.status === "ready")

  return (
    <div className="p-8 space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/search">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver a Busqueda
        </Link>
      </Button>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Docs</h1>
          <p className="text-muted-foreground">
            Tu base de conocimiento. Subi documentos para que ASCI entienda tu propuesta de valor.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)} className="gap-2">
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

          {/* Documents Grid */}
          {documents.length > 0 ? (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">
                Documentos ({documents.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {documents.map((doc) => (
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
