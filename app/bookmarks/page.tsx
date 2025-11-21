"use client"

import type React from "react"
import { useRouter } from "next/navigation"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trash2, Edit2, Building2 } from "lucide-react"
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
    setIsLoading(false)
  }

  useEffect(() => {
    fetchBookmarks()
  }, [])

  const updateBookmark = async (id: string, notes: string, priority: string) => {
    await supabase.from("bookmarks").update({ notes, priority }).eq("id", id)
    fetchBookmarks()
  }

  const deleteBookmark = async (id: string) => {
    if (confirm("¿Estás seguro de eliminar este bookmark?")) {
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

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Mis Bookmarks</h1>
        <p className="text-muted-foreground">Gestiona tus empresas guardadas y su seguimiento.</p>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Prioridad</TableHead>
              <TableHead>Notas</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookmarks.map((bookmark) => (
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
                        onClick={() => router.push(`/bookmarks/${bookmark.company.id}`)}
                      >
                        {bookmark.company.name}
                      </div>
                      <div className="text-xs text-muted-foreground">{bookmark.company.industry}</div>
                    </div>
                  </div>
                </TableCell>
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
            {!isLoading && bookmarks.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center h-32 text-muted-foreground">
                  No tienes bookmarks guardados.
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
