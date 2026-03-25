"use client"

import React, { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { 
  GripVertical, 
  Building2, 
  Globe, 
  Linkedin,
  Eye,
  Download,
  X,
  Loader2,
  SlidersHorizontal,
} from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { 
  BOOKMARK_STATUS_CONFIG, 
  type BookmarkStatus,
} from "@/lib/bookmark-types"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { BookmarkScopeEditor, type SignalTag } from "@/components/bookmarks/bookmark-scope-editor"

interface BookmarkItem {
  id: string
  notes: string | null
  priority: string | null
  status: BookmarkStatus
  search_context: any
  created_at: string
  updated_at: string | null
  company: {
    id: string
    name: string
    industry: string | null
    country_normalized: string | null
    website: string | null
    linkedin_url: string | null
    logo_url: string | null
  } | null
}

interface KanbanBoardProps {
  bookmarks: BookmarkItem[]
  userId: string
  onStatusChange?: (bookmarkId: string, newStatus: BookmarkStatus) => void
  onScopeUpdated?: (bookmarkId: string, newScope: any) => void
}

const PRIORITY_COLORS: Record<string, string> = {
  alta: "bg-red-500",
  transaccional: "bg-yellow-500",
  baja: "bg-gray-400",
}

function KanbanCard({ 
  bookmark, 
  isDragging,
  onDragStart,
  onDragEnd,
  isSelected,
  onSelectToggle,
  userId,
  onScopeUpdated,
}: { 
  bookmark: BookmarkItem
  isDragging?: boolean
  onDragStart: (e: React.DragEvent, bookmarkId: string) => void
  onDragEnd: () => void
  isSelected: boolean
  onSelectToggle: (bookmarkId: string) => void
  userId: string
  onScopeUpdated?: (bookmarkId: string, newScope: any) => void
}) {
  const supabase = createClient()
  const company = bookmark.company

  const fetchTagsForCompany = async (): Promise<SignalTag[]> => {
    if (!company?.id) return []
    const { data, error } = await supabase
      .from("signals")
      .select("signal_id, keyword_matched, signal_type")
      .eq("company_id", company.id)
      .not("signal_id", "is", null)
    if (error || !data) return []
    const tagMap = new Map<string, SignalTag>()
    data.forEach((s: any) => {
      if (!s.signal_id || !s.keyword_matched) return
      if (tagMap.has(s.signal_id)) {
        tagMap.get(s.signal_id)!.count++
      } else {
        tagMap.set(s.signal_id, {
          id: s.signal_id,
          name: s.keyword_matched,
          type: s.signal_type === "process" ? "process" : "technology",
          count: 1,
        })
      }
    })
    return Array.from(tagMap.values()).sort((a, b) => b.count - a.count)
  }

  const daysInStatus = bookmark.updated_at 
    ? Math.floor((Date.now() - new Date(bookmark.updated_at).getTime()) / (1000 * 60 * 60 * 24))
    : Math.floor((Date.now() - new Date(bookmark.created_at).getTime()) / (1000 * 60 * 60 * 24))

  return (
    <Card 
      data-bookmark-id={bookmark.id}
      draggable
      onDragStart={(e) => onDragStart(e, bookmark.id)}
      onDragEnd={onDragEnd}
      className={cn(
        "group cursor-grab active:cursor-grabbing transition-all hover:shadow-md",
        isDragging && "opacity-50 rotate-2 scale-105"
      )}
    >
      <CardContent className="p-3 space-y-2">
        {/* Header with checkbox, drag handle and company name */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onSelectToggle(bookmark.id)}
              onClick={(e) => e.stopPropagation()}
              className="flex-shrink-0"
            />
            <GripVertical className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
            {company?.logo_url ? (
              <img 
                src={company.logo_url || "/placeholder.svg"} 
                alt={company.name}
                className="w-8 h-8 rounded object-contain bg-white border"
              />
            ) : (
              <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                <Building2 className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <Link 
                href={`/bookmarks/${bookmark.id}`}
                className="font-medium text-sm hover:underline truncate block text-primary"
                onClick={(e) => e.stopPropagation()}
                title="Ver detalle del bookmark"
              >
                {company?.name || "Empresa desconocida"}
              </Link>
              {company?.industry && (
                <p className="text-xs text-muted-foreground truncate">
                  {company.industry}
                </p>
              )}
            </div>
          </div>
          {bookmark.priority && (
            <div 
              className={cn(
                "w-2 h-2 rounded-full flex-shrink-0 mt-1",
                PRIORITY_COLORS[bookmark.priority] || "bg-gray-300"
              )}
              title={`Prioridad: ${bookmark.priority}`}
            />
          )}
        </div>

        {/* Context info */}
        {bookmark.search_context?.filtersUsed && (
          <div className="flex flex-wrap gap-1">
            {bookmark.search_context.filtersUsed.technology?.slice(0, 2).map((t: string) => (
              <Badge key={t} variant="secondary" className="text-xs px-1.5 py-0">
                {t}
              </Badge>
            ))}
            {bookmark.search_context.filtersUsed.process?.slice(0, 2).map((p: string) => (
              <Badge key={p} variant="outline" className="text-xs px-1.5 py-0">
                {p}
              </Badge>
            ))}
          </div>
        )}

        {/* Footer with days and actions */}
        <div className="flex items-center justify-between pt-1 border-t">
          <span className="text-xs text-muted-foreground">
            {daysInStatus === 0 ? "Hoy" : `${daysInStatus}d`}
          </span>
          
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <BookmarkScopeEditor
              bookmarkId={bookmark.id}
              userId={userId}
              companyName={company?.name || ""}
              currentScope={bookmark.search_context}
              fetchAvailableTags={fetchTagsForCompany}
              onScopeUpdated={(newScope) => onScopeUpdated?.(bookmark.id, newScope)}
            />
            {company?.website && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6"
                asChild
              >
                <a 
                  href={company.website} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Globe className="h-3 w-3" />
                </a>
              </Button>
            )}
            {company?.linkedin_url && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6"
                asChild
              >
                <a 
                  href={company.linkedin_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Linkedin className="h-3 w-3" />
                </a>
              </Button>
            )}
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6"
              asChild
            >
              <Link 
                href={`/bookmarks/${bookmark.id}`}
                onClick={(e) => e.stopPropagation()}
                title="Ver detalle"
              >
                <Eye className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function KanbanColumn({ 
  status, 
  bookmarks,
  userId,
  onStatusChange,
  draggingId,
  onDragStart,
  onDragEnd,
  onDrop,
  selectedIds,
  onSelectToggle,
  onScopeUpdated,
}: { 
  status: BookmarkStatus
  bookmarks: BookmarkItem[]
  userId: string
  onStatusChange?: (bookmarkId: string, newStatus: BookmarkStatus) => void
  draggingId: string | null
  onDragStart: (e: React.DragEvent, bookmarkId: string) => void
  onDragEnd: () => void
  onDrop: (status: BookmarkStatus) => void
  selectedIds: Set<string>
  onSelectToggle: (bookmarkId: string) => void
  onScopeUpdated?: (bookmarkId: string, newScope: any) => void
}) {
  const config = BOOKMARK_STATUS_CONFIG[status]
  const [isDragOver, setIsDragOver] = useState(false)
  const [visibleCount, setVisibleCount] = useState(10)
  const visibleBookmarks = bookmarks.slice(0, visibleCount)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    onDrop(status)
  }

  return (
    <div 
      className={cn(
        "flex flex-col min-w-[280px] max-w-[280px] bg-muted/30 rounded-lg transition-colors",
        isDragOver && "bg-primary/10 ring-2 ring-primary/50"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Badge className={cn("font-medium", config.color)}>
            {config.label}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {bookmarks.length}
          </span>
        </div>
      </div>

      {/* Cards container */}
      <div className={cn(
        "flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-300px)] min-h-[100px]",
        isDragOver && "bg-primary/5"
      )}>
        {bookmarks.length === 0 ? (
          <div className={cn(
            "text-center py-8 text-muted-foreground text-sm border-2 border-dashed rounded-lg",
            isDragOver ? "border-primary bg-primary/10" : "border-transparent"
          )}>
            {isDragOver ? "Soltar aquí" : "Sin cuentas"}
          </div>
        ) : (
          <>
            {visibleBookmarks.map((bookmark) => (
              <KanbanCard 
                key={bookmark.id} 
                bookmark={bookmark}
                isDragging={draggingId === bookmark.id}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                isSelected={selectedIds.has(bookmark.id)}
                onSelectToggle={onSelectToggle}
                userId={userId}
                onScopeUpdated={onScopeUpdated}
              />
            ))}
            {bookmarks.length > visibleCount && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full text-xs text-muted-foreground"
                onClick={() => setVisibleCount(prev => prev + 10)}
              >
                Ver {bookmarks.length - visibleCount} más
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function KanbanBoard({ bookmarks, userId, onStatusChange, onScopeUpdated }: KanbanBoardProps) {
  const statusKeys = Object.keys(BOOKMARK_STATUS_CONFIG) as BookmarkStatus[]
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState(false)

  const handleSelectToggle = (bookmarkId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(bookmarkId)) {
        next.delete(bookmarkId)
      } else {
        next.add(bookmarkId)
      }
      return next
    })
  }

  const handleClearSelection = () => {
    setSelectedIds(new Set())
  }

  const handleBulkExport = async () => {
    if (selectedIds.size === 0) return
    setIsExporting(true)
    try {
      const response = await fetch("/api/bookmarks/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmark_ids: Array.from(selectedIds) }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Error al exportar")
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = response.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "export.xlsx"
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      a.remove()
      toast.success(`${selectedIds.size} bookmarks exportados`)
      setSelectedIds(new Set())
    } catch (err: any) {
      toast.error(err.message || "Error al exportar")
    } finally {
      setIsExporting(false)
    }
  }

  // Group bookmarks by status - treat null/undefined as 'nuevo'
  const bookmarksByStatus = statusKeys.reduce((acc, status) => {
    acc[status] = bookmarks.filter(b => {
      const bookmarkStatus = b.status || 'nuevo'
      return bookmarkStatus === status
    })
    return acc
  }, {} as Record<BookmarkStatus, BookmarkItem[]>)

  const handleDragStart = (e: React.DragEvent, bookmarkId: string) => {
    setDraggingId(bookmarkId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', bookmarkId)
  }

  const handleDragEnd = () => {
    setDraggingId(null)
  }

  const handleDrop = async (newStatus: BookmarkStatus) => {
    if (!draggingId) return
    
    const bookmark = bookmarks.find(b => b.id === draggingId)
    if (!bookmark) return
    
    const currentStatus = bookmark.status || 'nuevo'
    if (currentStatus === newStatus) {
      setDraggingId(null)
      return
    }
    
    // Optimistic update
    onStatusChange?.(draggingId, newStatus)
    
    // Client-side update (no server action overhead)
    const supabase = createClient()
    const { error } = await supabase
      .from("bookmarks")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", draggingId)
      .eq("user_id", userId)
    
    if (error) {
      // Revert on error
      onStatusChange?.(draggingId, currentStatus)
    }
    
    setDraggingId(null)
  }

  return (
    <div className="relative">
      <div className="flex gap-4 overflow-x-auto pb-4">
        {statusKeys.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            bookmarks={bookmarksByStatus[status]}
            userId={userId}
            onStatusChange={onStatusChange}
            draggingId={draggingId}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
            selectedIds={selectedIds}
            onSelectToggle={handleSelectToggle}
            onScopeUpdated={onScopeUpdated}
          />
        ))}
      </div>

      {/* Floating action bar for bulk actions */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-card border shadow-lg rounded-lg px-4 py-3 flex items-center gap-4">
          <span className="text-sm font-medium">
            {selectedIds.size} seleccionado{selectedIds.size > 1 ? "s" : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearSelection}
            className="gap-1"
          >
            <X className="h-3 w-3" />
            Limpiar
          </Button>
          <Button
            size="sm"
            onClick={handleBulkExport}
            disabled={isExporting}
            className="gap-1"
          >
            {isExporting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            Exportar Excel
          </Button>
        </div>
      )}
    </div>
  )
}
