"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { X, Plus, AlertTriangle, Loader2 } from "lucide-react"

type EditKeywordsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemId: string
  itemName: string
  itemType: "product" | "process"
  currentKeywords: string[]
  onSave: () => void
}

type PendingChange = {
  type: "add" | "remove"
  keyword: string
}

export function EditKeywordsDialog({
  open,
  onOpenChange,
  itemId,
  itemName,
  itemType,
  currentKeywords,
  onSave,
}: EditKeywordsDialogProps) {
  const [keywords, setKeywords] = useState<string[]>([])
  const [newKeyword, setNewKeyword] = useState("")
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([])
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [editingName, setEditingName] = useState(itemName)
  const supabase = createClient()

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setKeywords([...currentKeywords])
      setPendingChanges([])
      setNewKeyword("")
      setEditingName(itemName)
    }
  }, [open, currentKeywords, itemName])

  // Calculate pending changes by comparing current vs original
  const calculateChanges = (newKeywords: string[]): PendingChange[] => {
    const changes: PendingChange[] = []

    // Find removed keywords
    currentKeywords.forEach((kw) => {
      if (!newKeywords.includes(kw)) {
        changes.push({ type: "remove", keyword: kw })
      }
    })

    // Find added keywords
    newKeywords.forEach((kw) => {
      if (!currentKeywords.includes(kw)) {
        changes.push({ type: "add", keyword: kw })
      }
    })

    return changes
  }

  const handleAddKeyword = () => {
    if (!newKeyword.trim()) return

    // Support semicolon-separated bulk add
    const newKeywords = newKeyword
      .split(";")
      .map((k) => k.trim())
      .filter((k) => k && !keywords.includes(k))

    if (newKeywords.length > 0) {
      const updatedKeywords = [...keywords, ...newKeywords]
      setKeywords(updatedKeywords)
      setPendingChanges(calculateChanges(updatedKeywords))
    }
    setNewKeyword("")
  }

  const handleRemoveKeyword = (keyword: string) => {
    const updatedKeywords = keywords.filter((k) => k !== keyword)
    setKeywords(updatedKeywords)
    setPendingChanges(calculateChanges(updatedKeywords))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleAddKeyword()
    }
  }

  const hasChanges = pendingChanges.length > 0 || editingName !== itemName
  const addedKeywords = pendingChanges.filter((c) => c.type === "add")
  const removedKeywords = pendingChanges.filter((c) => c.type === "remove")

  const handleApplyChanges = async () => {
    setIsProcessing(true)

    try {
      const tableName = itemType === "product" ? "dictionary_products" : "dictionary_processes"
      const signalType = itemType === "product" ? "technology" : "process"

      // 1. Update the dictionary entry (name and keywords)
      await supabase
        .from(tableName)
        .update({
          name: editingName,
          keywords: keywords,
        })
        .eq("id", itemId)

      // 2. Create jobs for keyword changes
      for (const change of pendingChanges) {
        await supabase.from("dictionary_jobs").insert({
          job_type: change.type === "add" ? "add_keyword" : "remove_keyword",
          signal_id: itemId,
          signal_type: signalType,
          keyword: change.keyword,
          status: "pending",
        })
      }

      onSave()
      onOpenChange(false)
    } catch (error) {
      console.error("Error applying changes:", error)
    } finally {
      setIsProcessing(false)
      setShowConfirmDialog(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar {itemType === "product" ? "Producto" : "Proceso"}</DialogTitle>
            <DialogDescription>
              Modifica el nombre y las keywords. Los cambios se procesarán en background.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Name editing */}
            <div className="space-y-2">
              <Label htmlFor="item-name">Nombre</Label>
              <Input id="item-name" value={editingName} onChange={(e) => setEditingName(e.target.value)} />
            </div>

            {/* Current keywords */}
            <div className="space-y-2">
              <Label>Keywords actuales</Label>
              <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[60px] bg-muted/30">
                {keywords.length === 0 ? (
                  <span className="text-sm text-muted-foreground">Sin keywords</span>
                ) : (
                  keywords.map((kw) => {
                    const isNew = !currentKeywords.includes(kw)
                    return (
                      <Badge
                        key={kw}
                        variant={isNew ? "default" : "secondary"}
                        className={`gap-1 pr-1 ${isNew ? "bg-green-600 hover:bg-green-700" : ""}`}
                      >
                        {kw}
                        <button
                          onClick={() => handleRemoveKeyword(kw)}
                          className="ml-1 hover:bg-black/20 rounded-full p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    )
                  })
                )}
              </div>
            </div>

            {/* Add new keyword */}
            <div className="space-y-2">
              <Label htmlFor="new-keyword">Agregar keywords</Label>
              <div className="flex gap-2">
                <Input
                  id="new-keyword"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Separar múltiples con punto y coma (;)"
                />
                <Button type="button" onClick={handleAddKeyword} size="icon">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Usa punto y coma (;) para agregar múltiples keywords a la vez.
              </p>
            </div>

            {/* Pending changes summary */}
            {hasChanges && (
              <div className="space-y-2 p-3 border rounded-md bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">Cambios pendientes</span>
                </div>

                {editingName !== itemName && (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Nombre: "{itemName}" → "{editingName}"
                  </p>
                )}

                {addedKeywords.length > 0 && (
                  <div className="text-sm">
                    <span className="text-green-700 dark:text-green-400">+ Agregar:</span>{" "}
                    <span className="text-green-600 dark:text-green-300">
                      {addedKeywords.map((c) => c.keyword).join(", ")}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">
                      Se procesará la base de datos para detectar nuevas señales.
                    </p>
                  </div>
                )}

                {removedKeywords.length > 0 && (
                  <div className="text-sm">
                    <span className="text-red-700 dark:text-red-400">- Eliminar:</span>{" "}
                    <span className="text-red-600 dark:text-red-300">
                      {removedKeywords.map((c) => c.keyword).join(", ")}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">
                      Se eliminarán las señales existentes con estas keywords.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={() => setShowConfirmDialog(true)} disabled={!hasChanges || keywords.length === 0}>
              Aplicar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar cambios?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>Estás a punto de aplicar los siguientes cambios:</p>

              {editingName !== itemName && (
                <p className="text-sm">
                  • Cambiar nombre de "{itemName}" a "{editingName}"
                </p>
              )}

              {addedKeywords.length > 0 && (
                <p className="text-sm text-green-600">
                  • Agregar {addedKeywords.length} keyword(s): {addedKeywords.map((c) => c.keyword).join(", ")}
                </p>
              )}

              {removedKeywords.length > 0 && (
                <p className="text-sm text-red-600">
                  • Eliminar {removedKeywords.length} keyword(s): {removedKeywords.map((c) => c.keyword).join(", ")}
                </p>
              )}

              <p className="text-sm mt-4 font-medium">
                Los cambios se procesarán en background. Puedes ver el progreso en Admin → Procesamiento.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleApplyChanges} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                "Confirmar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
