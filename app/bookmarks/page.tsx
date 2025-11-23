"use client"

import type React from "react"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, Edit2, Building2, Search, ArrowLeft } from "lucide-react"
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

type Bookmark = {
  id: string
  company_id: string
  notes: string
  priority: "alta" | "transaccional" | "baja" | null
  created_at: string
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
    country: string | null
    logo_url: string | null
  }
}

export default function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [filteredBookmarks, setFilteredBookmarks] = useState<Bookmark[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const router = useRouter()

  const supabase = createClient()

  const fetchBookmarks = async () => {
    setIsLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { data } = await supabase
      .from("bookmarks")
      .select(`
        id,
        company_id,
        notes,
        priority,
        created_at,
        search_context,
        company:company_id (
          id,
          name,
          industry,
          country,
          logo_url
        )
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })

    setBookmarks((data as any) || [])
    setFilteredBookmarks((data as any) || [])
    setIsLoading(false)
  }

  useEffect(() => {
    fetchBookmarks()
  }, [])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredBookmarks(bookmarks)
      return
    }

    const query = searchQuery.toLowerCase()
    const filtered = bookmarks.filter(
      (b) =>
        b.company.name.toLowerCase().includes(query) ||
        (b.notes && b.notes.toLowerCase().includes(query)) ||
        (b.company.industry && b.company.industry.toLowerCase().includes(query)),
    )
    setFilteredBookmarks(filtered)
  }, [searchQuery, bookmarks])

  const updateBookmark = async (id: string, notes: string, priority: string) => {
    await supabase.from("bookmarks").update({ notes, priority }).eq("id", id)
    fetchBookmarks()
  }

  const deleteBookmark = async (id: string) => {
    if (confirm("¿Estás seguro de eliminar este bookmark? Se borrarán también las estrategias y señales privadas.")) {
      await supabase.from("bookmarks").delete().eq("id", id)
      fetchBookmarks()
    }
  }

  const getPriorityColor = (priority: string | null) => {
    switch (priority) {
      case "alta":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
      case "transaccional":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
      case "baja":
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300"
      default:
        return "bg-gray-100 text-gray-800"
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
    <div className="p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mis Bookmarks</h1>
          <p className="text-muted-foreground">Gestiona tus empresas guardadas y sus diferentes estrategias.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => router.push("/")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver al Home
          </Button>
          <Button onClick={() => router.push("/search")}>
            <Search className="mr-2 h-4 w-4" />
            Nueva Búsqueda
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center space-x-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, notas o industria..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Contexto de Búsqueda</TableHead>
              <TableHead>Prioridad</TableHead>
              <TableHead>Notas</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredBookmarks.map((bookmark) => (
              <TableRow key={bookmark.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-muted rounded-md flex items-center justify-center flex-shrink-0">
                      {bookmark.company.logo_url ? (
                        <img
                          src={bookmark.company.logo_url || "/placeholder.svg"}
                          alt={bookmark.company.name}
                          className="w-full h-full object-cover rounded-md"
                        />
                      ) : (
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <div
                        className="font-medium hover:underline cursor-pointer text-primary"
                        onClick={() => router.push(`/bookmarks/${bookmark.id}`)}
                      >
                        {bookmark.company.name}
                      </div>
                      <div className="text-xs text-muted-foreground">{bookmark.company.industry}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{renderContext(bookmark.search_context)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={getPriorityColor(bookmark.priority)}>
                    {bookmark.priority
                      ? bookmark.priority.charAt(0).toUpperCase() + bookmark.priority.slice(1)
                      : "Sin prioridad"}
                  </Badge>
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
            {!isLoading && filteredBookmarks.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-32 text-muted-foreground">
                  {bookmarks.length === 0
                    ? "No tienes bookmarks guardados."
                    : "No se encontraron resultados para tu búsqueda."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function EditBookmarkDialog({
  bookmark,
  onUpdate,
}: {
  bookmark: Bookmark
  onUpdate: (id: string, notes: string, priority: string) => void
}) {
  const [notes, setNotes] = useState(bookmark.notes || "")
  const [priority, setPriority] = useState(bookmark.priority || "baja")
  const [open, setOpen] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onUpdate(bookmark.id, notes, priority)
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
          <DialogTitle>Editar Bookmark</DialogTitle>
          <DialogDescription>Actualiza las notas y prioridad para {bookmark.company.name}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="priority">Prioridad</Label>
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
