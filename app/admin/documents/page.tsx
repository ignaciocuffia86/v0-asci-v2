"use client"

import { useEffect, useState, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { RefreshCw, AlertCircle, CheckCircle, Loader2 } from "lucide-react"

type DocStatus = "ready" | "processing" | "error" | "pending"

interface AdminDocument {
  id: string
  title: string
  type: string
  status: DocStatus
  ai_summary: string | null
  created_at: string
  user_id: string
  processing_error: string | null
  tag_count: number
}

type ReprocessState = "idle" | "processing" | "done" | "error"

export default function AdminDocumentsPage() {
  const [docs, setDocs] = useState<AdminDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reprocessStates, setReprocessStates] = useState<Record<string, ReprocessState>>({})
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 })

  const fetchDocs = useCallback(async () => {
    setLoading(true)
    const res = await fetch("/api/admin/documents/reprocess")
    const data = await res.json()
    setDocs(data.documents || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchDocs()
  }, [fetchDocs])

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === docs.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(docs.map((d) => d.id)))
    }
  }

  const runReprocess = async (ids: string[]) => {
    if (ids.length === 0 || isRunning) return
    setIsRunning(true)
    setProgress({ done: 0, total: ids.length, errors: 0 })

    // Initialize all as processing
    setReprocessStates((prev) => {
      const next = { ...prev }
      ids.forEach((id) => (next[id] = "processing"))
      return next
    })

    let errors = 0
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      try {
        const res = await fetch("/api/admin/documents/reprocess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: id }),
        })
        const data = await res.json()
        setReprocessStates((prev) => ({ ...prev, [id]: res.ok ? "done" : "error" }))
        if (!res.ok) errors++
      } catch {
        setReprocessStates((prev) => ({ ...prev, [id]: "error" }))
        errors++
      }
      setProgress({ done: i + 1, total: ids.length, errors })
    }

    setIsRunning(false)
    // Refresh doc list to get updated tag counts
    await fetchDocs()
  }

  const statusBadge = (status: DocStatus) => {
    const map: Record<DocStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      ready: { label: "Listo", variant: "default" },
      processing: { label: "Procesando", variant: "secondary" },
      error: { label: "Error", variant: "destructive" },
      pending: { label: "Pendiente", variant: "outline" },
    }
    const { label, variant } = map[status] || { label: status, variant: "outline" }
    return <Badge variant={variant}>{label}</Badge>
  }

  const reprocessIcon = (state: ReprocessState | undefined) => {
    if (!state || state === "idle") return null
    if (state === "processing") return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    if (state === "done") return <CheckCircle className="h-4 w-4 text-green-500" />
    if (state === "error") return <AlertCircle className="h-4 w-4 text-destructive" />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reprocesar Documentos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {docs.length} documentos en total. Selecciona los que quieras reprocesar con el nuevo prompt de tagging.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isRunning && (
            <span className="text-sm text-muted-foreground">
              {progress.done}/{progress.total} procesados
              {progress.errors > 0 && ` · ${progress.errors} errores`}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => runReprocess(Array.from(selected))}
            disabled={selected.size === 0 || isRunning}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reprocesar seleccionados ({selected.size})
          </Button>
          <Button
            size="sm"
            onClick={() => runReprocess(docs.map((d) => d.id))}
            disabled={isRunning}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reprocesar todos ({docs.length})
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={selected.size === docs.length && docs.length > 0}
                onCheckedChange={selectAll}
              />
            </TableHead>
            <TableHead>Documento</TableHead>
            <TableHead>Usuario</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Tags</TableHead>
            <TableHead className="w-8"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((doc) => (
            <TableRow
              key={doc.id}
              className={selected.has(doc.id) ? "bg-muted/40" : ""}
            >
              <TableCell>
                <Checkbox
                  checked={selected.has(doc.id)}
                  onCheckedChange={() => toggleSelect(doc.id)}
                  disabled={isRunning}
                />
              </TableCell>
              <TableCell>
                <div className="space-y-0.5">
                  <div className="font-medium text-sm">{doc.title}</div>
                  {doc.processing_error && (
                    <div className="text-xs text-destructive truncate max-w-xs">
                      {doc.processing_error}
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground font-mono">
                {doc.user_id.slice(0, 8)}…
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs uppercase">
                  {doc.type}
                </Badge>
              </TableCell>
              <TableCell>{statusBadge(doc.status)}</TableCell>
              <TableCell className="text-right text-sm tabular-nums">
                {doc.tag_count}
              </TableCell>
              <TableCell>{reprocessIcon(reprocessStates[doc.id])}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
