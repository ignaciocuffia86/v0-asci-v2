"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FileText, Globe, FileSpreadsheet, Presentation, Loader2, AlertCircle, CheckCircle2, Trash2 } from "lucide-react"
import type { UserDocument } from "@/app/actions/documents"
import { deleteDocument } from "@/app/actions/documents"
import { toast } from "sonner"
import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

const TYPE_ICONS: Record<string, React.ElementType> = {
  pdf: FileText,
  docx: FileSpreadsheet,
  pptx: Presentation,
  url: Globe,
}

const TYPE_COLORS: Record<string, string> = {
  pdf: "bg-red-50 text-red-700 border-red-200",
  docx: "bg-blue-50 text-blue-700 border-blue-200",
  pptx: "bg-orange-50 text-orange-700 border-orange-200",
  url: "bg-green-50 text-green-700 border-green-200",
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  uploading: { label: "Subiendo", icon: Loader2, color: "text-muted-foreground" },
  processing: { label: "Procesando", icon: Loader2, color: "text-primary" },
  ready: { label: "Listo", icon: CheckCircle2, color: "text-green-600" },
  error: { label: "Error", icon: AlertCircle, color: "text-destructive" },
}

interface DocumentCardProps {
  document: UserDocument
  onClick: () => void
  onDeleted: () => void
}

export function DocumentCard({ document, onClick, onDeleted }: DocumentCardProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const Icon = TYPE_ICONS[document.type] || FileText
  const typeColor = TYPE_COLORS[document.type] || ""
  const status = STATUS_CONFIG[document.status]
  const StatusIcon = status.icon
  const tagCount = document.tags?.length || 0

  const handleDelete = async () => {
    setIsDeleting(true)
    const { success, error } = await deleteDocument(document.id)
    if (success) {
      toast.success("Documento eliminado")
      onDeleted()
    } else {
      toast.error(error || "Error al eliminar")
    }
    setIsDeleting(false)
  }

  const formatSize = (bytes: number | null) => {
    if (!bytes) return null
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <Card
      className="group hover:border-primary/50 transition-all cursor-pointer relative"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2.5 rounded-lg border ${typeColor}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium truncate pr-8">{document.title}</h4>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-[10px] uppercase">
                {document.type}
              </Badge>
              {document.file_size && (
                <span className="text-[10px] text-muted-foreground">
                  {formatSize(document.file_size)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <StatusIcon className={`h-3.5 w-3.5 ${status.color} ${document.status === "processing" || document.status === "uploading" ? "animate-spin" : ""}`} />
              <span className={`text-xs ${status.color}`}>{status.label}</span>
              {document.status === "ready" && tagCount > 0 && (
                <span className="text-xs text-muted-foreground ml-1">
                  &middot; {tagCount} tag{tagCount !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {document.status === "error" && document.processing_error && (
              <p className="text-xs text-destructive mt-1 truncate">{document.processing_error}</p>
            )}
          </div>
        </div>
      </CardContent>

      {/* Delete button */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={(e) => e.stopPropagation()}
          >
            {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar documento</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminara &quot;{document.title}&quot; y todos sus tags asociados. Esta accion no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
