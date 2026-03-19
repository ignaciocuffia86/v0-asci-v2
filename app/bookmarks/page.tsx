"use client"

import { useMemo, useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, Edit2, Building2, Search, LayoutGrid, List, Filter, X, Eye, Download, Loader2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { KanbanBoard } from "@/components/bookmarks/kanban-board"
import { 
  BOOKMARK_STATUS_CONFIG, 
  PRIORITY_CONFIG,
  type BookmarkStatus,
} from "@/lib/bookmark-types"

type Bookmark = {
  id: string
  company_id: string
  notes: string
  priority: "alta" | "transaccional" | "baja" | null
  status: BookmarkStatus
  created_at: string
  updated_at: string | null
  search_context: {
    filtersUsed?: {
      process?: string[]
      technology?: string[]
      role?: string[]
    }
  } | null
  company: {
    id: string
    name: string
    industry: string | null
    country_normalized: string | null
    website: string | null
    linkedin_url: string | null
    logo_url: string | null
  }
}

type ViewMode = "list" | "kanban"

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [filteredBookmarks, setFilteredBookmarks] = useState<Bookmark[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>("kanban")
  const [userId, setUserId] = useState<string | null>(null)
  
  // Filters
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([])
  const [selectedStatuses, setSelectedStatuses] = useState<BookmarkStatus[]>([])
  
  // Bulk selection for list view
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState(false)
  
  // Stats - calculated from bookmarks with useMemo for auto-refresh
  const stats = useMemo(() => {
    if (bookmarks.length === 0) return null
    
    const calculatedStats = {
      byStatus: {} as Record<BookmarkStatus, number>,
      byPriority: {} as Record<string, number>,
      total: bookmarks.length,
    }
    
    // Initialize status counts
    for (const status of Object.keys(BOOKMARK_STATUS_CONFIG)) {
      calculatedStats.byStatus[status as BookmarkStatus] = 0
    }
    
    // Count by status and priority
    for (const bookmark of bookmarks) {
      const status = (bookmark.status || 'nuevo') as BookmarkStatus
      calculatedStats.byStatus[status] = (calculatedStats.byStatus[status] || 0) + 1
      
      if (bookmark.priority) {
        calculatedStats.byPriority[bookmark.priority] = 
          (calculatedStats.byPriority[bookmark.priority] || 0) + 1
      }
    }
    
    return calculatedStats
  }, [bookmarks])

  const router = useRouter()
  const supabase = createClient()

  const fetchBookmarks = useCallback(async () => {
    setIsLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    setUserId(user.id)

    const { data } = await supabase
      .from("bookmarks")
      .select(`
        id,
        company_id,
        notes,
        priority,
        status,
        created_at,
        updated_at,
        search_context,
        company:company_id (
          id,
          name,
          industry,
          country_normalized,
          website,
          linkedin_url,
          logo_url
        )
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    const bookmarksData = (data as any) || []
    setBookmarks(bookmarksData)
    setFilteredBookmarks(bookmarksData)
    setIsLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchBookmarks()
  }, [fetchBookmarks])

  // Apply filters
  useEffect(() => {
    let filtered = [...bookmarks]

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (b) =>
          b.company?.name?.toLowerCase().includes(query) ||
          (b.notes && b.notes.toLowerCase().includes(query)) ||
          (b.company?.industry && b.company.industry.toLowerCase().includes(query)),
      )
    }

    // Priority filter
    if (selectedPriorities.length > 0) {
      filtered = filtered.filter((b) => {
        if (selectedPriorities.includes("sin_prioridad")) {
          return !b.priority || selectedPriorities.includes(b.priority)
        }
        return b.priority && selectedPriorities.includes(b.priority)
      })
    }

    // Status filter
    if (selectedStatuses.length > 0) {
      filtered = filtered.filter((b) => {
        const bookmarkStatus = b.status || 'nuevo'
        return selectedStatuses.includes(bookmarkStatus)
      })
    }

    setFilteredBookmarks(filtered)
  }, [searchQuery, bookmarks, selectedPriorities, selectedStatuses])

  const handleStatusChange = (bookmarkId: string, newStatus: BookmarkStatus) => {
    // Optimistic update
    setBookmarks((prev) =>
      prev.map((b) => (b.id === bookmarkId ? { ...b, status: newStatus, updated_at: new Date().toISOString() } : b))
    )
    // Stats will be recalculated on next fetch
  }

  const updateBookmark = async (id: string, notes: string, priority: string, status: BookmarkStatus) => {
    await supabase.from("bookmarks").update({ notes, priority, status, updated_at: new Date().toISOString() }).eq("id", id)
    // Don't refetch - we use optimistic updates
  }

  const deleteBookmark = async (id: string) => {
    if (confirm("Eliminar este bookmark?\n\nSe eliminan: estrategia, icebreakers, brief y senales privadas.\nSe conservan: noticias, implementaciones y contactos (reutilizables por otros usuarios).")) {
      await supabase.from("bookmarks").delete().eq("id", id)
      fetchBookmarks()
    }
  }

  const togglePriorityFilter = (priority: string) => {
    setSelectedPriorities((prev) =>
      prev.includes(priority) ? prev.filter((p) => p !== priority) : [...prev, priority]
    )
  }

  const toggleStatusFilter = (status: BookmarkStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    )
  }

  const clearFilters = () => {
    setSelectedPriorities([])
    setSelectedStatuses([])
    setSearchQuery("")
  }

  const hasActiveFilters = selectedPriorities.length > 0 || selectedStatuses.length > 0 || searchQuery.trim()

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

  const handleSelectAll = () => {
    if (selectedIds.size === filteredBookmarks.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredBookmarks.map((b) => b.id)))
    }
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

  const renderContext = (context: any) => {
    if (!context || !context.filtersUsed) return <span className="text-muted-foreground text-xs">-</span>

    const filters = context.filtersUsed
    const items = []

    if (filters.technology && filters.technology.length > 0) {
      items.push(
        <Badge key="tech" variant="outline" className="text-[10px] border-blue-200 text-blue-700 bg-blue-50">
          Tech: {filters.technology[0]} {filters.technology.length > 1 && `+${filters.technology.length - 1}`}
        </Badge>,
      )
    }
    if (filters.process && filters.process.length > 0) {
      items.push(
        <Badge key="process" variant="outline" className="text-[10px] border-purple-200 text-purple-700 bg-purple-50">
          Proc: {filters.process[0]} {filters.process.length > 1 && `+${filters.process.length - 1}`}
        </Badge>,
      )
    }

    if (items.length === 0) return <span className="text-muted-foreground text-xs">General</span>

    return <div className="flex flex-wrap gap-1">{items}</div>
  }

 return (
  <div className="p-4 md:p-8 space-y-4 md:space-y-6">
  {/* Header */}
  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4" data-onboarding="bookmarks-header">
  <div>
  <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Mis Cuentas</h1>
          <p className="text-muted-foreground">
            Gestiona tu pipeline de prospeccion. {stats?.total || 0} cuentas guardadas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList data-onboarding="bookmarks-view-toggle">
              <TabsTrigger value="kanban" className="gap-2">
                <LayoutGrid className="h-4 w-4" />
                Kanban
              </TabsTrigger>
              <TabsTrigger value="list" className="gap-2">
                <List className="h-4 w-4" />
                Lista
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={() => router.push("/search")}>
            <Search className="mr-2 h-4 w-4" />
            Nueva Búsqueda
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {(Object.keys(BOOKMARK_STATUS_CONFIG) as BookmarkStatus[]).map((status) => {
            const config = BOOKMARK_STATUS_CONFIG[status]
            const count = stats.byStatus[status] || 0
            const isSelected = selectedStatuses.includes(status)
            
            return (
              <Card 
                key={status}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-md",
                  isSelected && "ring-2 ring-primary"
                )}
                onClick={() => toggleStatusFilter(status)}
              >
                <CardContent className="p-2 md:p-3 text-center">
                  <div className="text-xl md:text-2xl font-bold">{count}</div>
                  <Badge className={cn("text-[10px] md:text-xs", config.color)}>{config.label}</Badge>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, notas o industria..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

      {/* Priority Filters */}
      <div className="flex items-center gap-2" data-onboarding="bookmarks-tier-filter">
      <span className="text-sm text-muted-foreground">Tier:</span>
          {(Object.keys(PRIORITY_CONFIG) as Array<keyof typeof PRIORITY_CONFIG>).map((priority) => {
            const config = PRIORITY_CONFIG[priority]
            const isSelected = selectedPriorities.includes(priority)
            const count = stats?.byPriority[priority] || 0
            
            return (
              <Button
                key={priority}
                variant={isSelected ? "default" : "outline"}
                size="sm"
                onClick={() => togglePriorityFilter(priority)}
                className={cn(
                  "gap-1",
                  !isSelected && config.color
                )}
              >
                {config.label}
                <span className="text-xs opacity-70">({count})</span>
              </Button>
            )
          })}
          {/* Sin Prioridad filter */}
          <Button
            variant={selectedPriorities.includes("sin_prioridad") ? "default" : "outline"}
            size="sm"
            onClick={() => togglePriorityFilter("sin_prioridad")}
            className="gap-1"
          >
            Sin Prioridad
            <span className="text-xs opacity-70">
              ({(stats?.total || 0) - Object.values(stats?.byPriority || {}).reduce((a, b) => a + b, 0)})
            </span>
          </Button>
        </div>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
            <X className="h-4 w-4" />
            Limpiar filtros
          </Button>
        )}
      </div>

      {/* Active Filters Summary */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="h-4 w-4" />
          Mostrando {filteredBookmarks.length} de {bookmarks.length} cuentas
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : viewMode === "kanban" ? (
        <KanbanBoard 
          bookmarks={filteredBookmarks as any} 
          userId={userId || ""} 
          onStatusChange={handleStatusChange}
        />
      ) : (
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={selectedIds.size === filteredBookmarks.length && filteredBookmarks.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Contexto</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Notas</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBookmarks.map((bookmark) => (
                <TableRow key={bookmark.id} data-bookmark-id={bookmark.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(bookmark.id)}
                      onCheckedChange={() => handleSelectToggle(bookmark.id)}
                    />
                  </TableCell>
                  <TableCell 
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => router.push(`/bookmarks/${bookmark.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-muted rounded-md flex items-center justify-center flex-shrink-0">
                        {bookmark.company?.logo_url ? (
                          <img
                            src={bookmark.company.logo_url || "/placeholder.svg"}
                            alt={bookmark.company?.name}
                            className="w-full h-full object-cover rounded-md"
                          />
                        ) : (
                          <Building2 className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-primary flex items-center gap-2">
                          {bookmark.company?.name || "Empresa"}
                          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="text-xs text-muted-foreground">{bookmark.company?.industry}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={bookmark.status}
                      onValueChange={(val) => {
                        const newStatus = val as BookmarkStatus
                        handleStatusChange(bookmark.id, newStatus)
                        updateBookmark(bookmark.id, bookmark.notes || "", bookmark.priority || "", newStatus)
                      }}
                    >
                      <SelectTrigger className={cn("w-[130px] h-8 text-xs", BOOKMARK_STATUS_CONFIG[bookmark.status]?.color)}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(BOOKMARK_STATUS_CONFIG) as BookmarkStatus[]).map((s) => (
                          <SelectItem key={s} value={s}>
                            <span className={cn("px-2 py-0.5 rounded text-xs", BOOKMARK_STATUS_CONFIG[s].color)}>
                              {BOOKMARK_STATUS_CONFIG[s].label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>{renderContext(bookmark.search_context)}</TableCell>
                  <TableCell>
                    <Select
                      value={bookmark.priority || "sin_prioridad"}
                      onValueChange={(val) => {
                        const newPriority = val === "sin_prioridad" ? "" : val
                        // Optimistic update
                        setBookmarks((prev) =>
                          prev.map((b) => (b.id === bookmark.id ? { ...b, priority: newPriority as any } : b))
                        )
                        updateBookmark(bookmark.id, bookmark.notes || "", newPriority, bookmark.status)
                      }}
                    >
                      <SelectTrigger className={cn(
                        "w-[130px] h-8 text-xs border",
                        bookmark.priority && PRIORITY_CONFIG[bookmark.priority as keyof typeof PRIORITY_CONFIG]?.color
                      )}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alta">
                          <span className={cn("px-2 py-0.5 rounded text-xs", PRIORITY_CONFIG.alta.color)}>Alta</span>
                        </SelectItem>
                        <SelectItem value="transaccional">
                          <span className={cn("px-2 py-0.5 rounded text-xs", PRIORITY_CONFIG.transaccional.color)}>Transaccional</span>
                        </SelectItem>
                        <SelectItem value="baja">
                          <span className={cn("px-2 py-0.5 rounded text-xs", PRIORITY_CONFIG.baja.color)}>Baja</span>
                        </SelectItem>
                        <SelectItem value="sin_prioridad">
                          <span className="px-2 py-0.5 rounded text-xs bg-gray-50 text-gray-500">Sin prioridad</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{bookmark.notes || "-"}</TableCell>
                  <TableCell>{new Date(bookmark.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <EditBookmarkDialog bookmark={bookmark} onUpdate={updateBookmark} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteBookmark(bookmark.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredBookmarks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center h-32 text-muted-foreground">
                    {bookmarks.length === 0
                      ? "No tienes cuentas guardadas."
                      : "No se encontraron resultados para los filtros aplicados."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Floating action bar for bulk actions in list view */}
      {viewMode === "list" && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-card border shadow-lg rounded-lg px-4 py-3 flex items-center gap-4">
          <span className="text-sm font-medium">
            {selectedIds.size} seleccionado{selectedIds.size > 1 ? "s" : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
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

function EditBookmarkDialog({
  bookmark,
  onUpdate,
}: {
  bookmark: Bookmark
  onUpdate: (id: string, notes: string, priority: string, status: BookmarkStatus) => void
}) {
  const [notes, setNotes] = useState(bookmark.notes || "")
  const [priority, setPriority] = useState(bookmark.priority || "baja")
  const [status, setStatus] = useState<BookmarkStatus>(bookmark.status || "nuevo")
  const [open, setOpen] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onUpdate(bookmark.id, notes, priority, status)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Edit2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Cuenta</DialogTitle>
          <DialogDescription>Actualiza el estado, prioridad y notas para {bookmark.company?.name}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="status">Estado de Prospección</Label>
              <Select value={status} onValueChange={(val) => setStatus(val as BookmarkStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(BOOKMARK_STATUS_CONFIG) as BookmarkStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {BOOKMARK_STATUS_CONFIG[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="priority">Tier / Prioridad</Label>
              <Select value={priority} onValueChange={(val: any) => setPriority(val)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="transaccional">Transaccional</SelectItem>
                  <SelectItem value="baja">Baja</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Escribe tus notas aquí..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit">Guardar Cambios</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
