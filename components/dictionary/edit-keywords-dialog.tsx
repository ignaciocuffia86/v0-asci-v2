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
  const [confirmData, setConfirmData] = useState<{
    keywords: string[]
    editingName: string
    pendingChanges: PendingChange[]
  } | null>(null)
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

  const confirmAddedKeywords = confirmData?.pendingChanges.filter((c) => c.type === "add") || []
  const confirmRemovedKeywords = confirmData?.pendingChanges.filter((c) => c.type === "remove") || []

  const handleShowConfirm = () => {
    // Store the current data for the confirmation dialog
    setConfirmData({
      keywords: [...keywords],
      editingName,
      pendingChanges: [...pendingChanges],
    })
    // Close the main dialog first
    onOpenChange(false)
    // Then open the confirmation dialog after a brief delay to avoid aria-hidden conflict
    setTimeout(() => {
      setShowConfirmDialog(true)
    }, 100)
  }

  const handleCancelConfirm = () => {
    setShowConfirmDialog(false)
    // Restore state and reopen main dialog
    if (confirmData) {
      setKeywords(confirmData.keywords)
      setEditingName(confirmData.editingName)
      setPendingChanges(confirmData.pendingChanges)
    }
    setTimeout(() => {
      onOpenChange(true)
    }, 100)
  }

  const handleApplyChanges = async () => {
    if (!confirmData) return
    setIsProcessing(true)

    try {
      const tableName = itemType === "product" ? "dictionary_products" : "dictionary_processes"
      const signalType = itemType === "product" ? "technology" : "process"

      // 1. Update the dictionary entry (name and keywords)
      await supabase
        .from(tableName)
        .update({
          name: confirmData.editingName,
          keywords: confirmData.keywords,
        })
        .eq("id", itemId)

      // 2. Create jobs for keyword changes
      for (const change of confirmData.pendingChanges) {
        await supabase.from("dictionary_jobs").insert({
          job_type: change.type === "add" ? "add_keyword" : "remove_keyword",
          signal_id: itemId,
          signal_type: signalType,
          keyword: change.keyword,
          status: "pending",
        })
      }

      onSave()
      setShowConfirmDialog(false)
      setConfirmData(null)
    } catch (error) {
      console.error("Error applying changes:", error)
    } finally {
      setIsProcessing(false)
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
              <Label>Keywords actuales ({keywords.length})</Label>
              <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[60px] max-h-[200px] overflow-y-auto bg-muted/30">
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
              <div className="space-y-2 p-3 border rounded-md bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 max-h-[200px] overflow-y-auto">
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
                    <span className="text-green-700 dark:text-green-400">+ Agregar ({addedKeywords.length}):</span>{" "}
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
                    <span className="text-red-700 dark:text-red-400">- Eliminar ({removedKeywords.length}):</span>{" "}
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
            <Button onClick={handleShowConfirm} disabled={!hasChanges || keywords.length === 0}>
              Aplicar Cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog */}
      <AlertDialog
        open={showConfirmDialog}
        onOpenChange={(open) => {
          if (!open && !isProcessing) {
            handleCancelConfirm()
          }
        }}
      >
        <AlertDialogContent className="max-h-[90vh] flex flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar cambios?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-muted-foreground text-sm space-y-2 max-h-[50vh] overflow-y-auto">
                <span className="block">Estás a punto de aplicar los siguientes cambios:</span>

                {confirmData && confirmData.editingName !== itemName && (
                  <span className="block text-sm">
                    • Cambiar nombre de "{itemName}" a "{confirmData.editingName}"
                  </span>
                )}

                {confirmAddedKeywords.length > 0 && (
                  <span className="block text-sm text-green-600">
                    • Agregar {confirmAddedKeywords.length} keyword(s):{" "}
                    {confirmAddedKeywords.map((c) => c.keyword).join(", ")}
                  </span>
                )}

                {confirmRemovedKeywords.length > 0 && (
                  <span className="block text-sm text-red-600">
                    • Eliminar {confirmRemovedKeywords.length} keyword(s):{" "}
                    {confirmRemovedKeywords.map((c) => c.keyword).join(", ")}
                  </span>
                )}

                <span className="block text-sm mt-4 font-medium">
                  Los cambios se procesarán en background. Puedes ver el progreso en Admin → Procesamiento.
                </span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProcessing} onClick={handleCancelConfirm}>
              Cancelar
            </AlertDialogCancel>
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
