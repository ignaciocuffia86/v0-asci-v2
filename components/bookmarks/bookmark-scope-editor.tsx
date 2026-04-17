"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Cpu, Workflow, SlidersHorizontal, Loader2, AlertTriangle, Check } from "lucide-react"
import { updateBookmarkScope, getAvailableSignalsForCompany } from "@/app/actions/bookmarks"
import { cn } from "@/lib/utils"

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface SignalTag {
  id: string
  name: string
  type: "technology" | "process"
  count: number
}

interface BookmarkScopeEditorProps {
  bookmarkId: string
  userId: string
  companyId: string
  companyName: string
  /** Current scope saved in the bookmark */
  currentScope: {
    filterSignalIds?: string[]
    filterType?: string | null
    filtersUsed?: { technology?: string[]; process?: string[] }
    scope_modified_by_user?: boolean
  } | null
  /** Called after a successful scope update so parent can refresh */
  onScopeUpdated?: (newScope: any) => void
  /** Optional trigger element — defaults to a ghost icon button */
  trigger?: React.ReactNode
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

function scopeLabel(scope: BookmarkScopeEditorProps["currentScope"], tags: SignalTag[]): string {
  if (!scope || !scope.filterSignalIds || scope.filterSignalIds.length === 0) return "Sin filtro"
  if (tags.length === 0) {
    const techs = scope.filtersUsed?.technology || []
    const procs = scope.filtersUsed?.process || []
    const all = [...techs, ...procs]
    if (all.length === 0) return "Sin filtro"
    const shown = all.slice(0, 2).join(", ")
    return all.length > 2 ? `${shown} +${all.length - 2} más` : shown
  }
  const names = tags
    .filter((t) => scope.filterSignalIds!.includes(t.id))
    .map((t) => t.name)
  if (names.length === 0) return "Sin filtro"
  const shown = names.slice(0, 2).join(", ")
  return names.length > 2 ? `${shown} +${names.length - 2} más` : shown
}

// -------------------------------------------------------
// Component
// -------------------------------------------------------

export function BookmarkScopeEditor({
  bookmarkId,
  userId,
  companyId,
  companyName,
  currentScope,
  onScopeUpdated,
  trigger,
}: BookmarkScopeEditorProps) {
  const [open, setOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>(currentScope?.filterSignalIds || [])
  const [isSaving, setIsSaving] = useState(false)
  const [isFetchingTags, setIsFetchingTags] = useState(false)
  const [availableTags, setAvailableTags] = useState<SignalTag[]>([])
  const [collisionError, setCollisionError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [fetchError, setFetchError] = useState(false)

  // Reset and fetch tags from the company every time the dialog opens
  const handleOpenChange = async (next: boolean) => {
    if (next) {
      setSelectedIds(currentScope?.filterSignalIds || [])
      setCollisionError(false)
      setSaved(false)
      setFetchError(false)

      setIsFetchingTags(true)
      try {
        const result = await getAvailableSignalsForCompany(companyId)
        if (result.success) {
          setAvailableTags(result.signals)
        } else {
          setFetchError(true)
        }
      } finally {
        setIsFetchingTags(false)
      }
    }
    setOpen(next)
  }

  const toggleTag = (id: string) => {
    setCollisionError(false)
    setSaved(false)
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  // Derive filterType and filtersUsed from selectedIds
  const buildScope = () => {
    const selectedTags = availableTags.filter((t) => selectedIds.includes(t.id))
    const techs = selectedTags.filter((t) => t.type === "technology").map((t) => t.name)
    const procs = selectedTags.filter((t) => t.type === "process").map((t) => t.name)

    let filterType: string | null = null
    if (techs.length > 0 && procs.length > 0) filterType = "mixed"
    else if (techs.length > 0) filterType = "technology"
    else if (procs.length > 0) filterType = "process"

    return {
      filterSignalIds: selectedIds,
      filterType,
      filtersUsed: {
        ...(techs.length > 0 && { technology: techs }),
        ...(procs.length > 0 && { process: procs }),
      },
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setCollisionError(false)

    const newScope = buildScope()
    const result = await updateBookmarkScope(bookmarkId, userId, newScope)

    setIsSaving(false)

    if (result.collision) {
      setCollisionError(true)
      return
    }

    if (result.success) {
      setSaved(true)
      // Pass the full updated bookmark to the callback so data can be refreshed
      onScopeUpdated?.(result.bookmark || newScope)
      setTimeout(() => setOpen(false), 800)
    }
  }

  const hasChanges =
    JSON.stringify([...(currentScope?.filterSignalIds || [])].sort()) !==
    JSON.stringify([...selectedIds].sort())

  const techTags = availableTags.filter((t) => t.type === "technology")
  const processTags = availableTags.filter((t) => t.type === "process")

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span className="sr-only">Editar scope del bookmark</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Editar scope</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            Scope del bookmark
          </DialogTitle>
          <DialogDescription>
            Selecciona las señales para{" "}
            <span className="font-medium text-foreground">{companyName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 py-2 -mx-6 px-6">
          <div className="space-y-4">
            {/* Loading state */}
            {isFetchingTags && (
              <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando señales...
              </div>
            )}

            {/* Error fetching */}
            {!isFetchingTags && fetchError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>No se pudieron cargar las señales. Intenta de nuevo.</p>
              </div>
            )}

            {/* No signals found */}
            {!isFetchingTags && !fetchError && availableTags.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center text-sm text-muted-foreground">
                <SlidersHorizontal className="h-6 w-6 opacity-30" />
                <p className="font-medium">Sin señales disponibles</p>
                <p className="text-xs max-w-xs">
                  No se encontraron señales con empleados activos.
                </p>
              </div>
            )}

            {!isFetchingTags && !fetchError && availableTags.length > 0 && (
              <>
                {/* Current selection summary */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground pb-2 border-b">
                  <span>Actual:</span>
                  <Badge
                    variant={currentScope?.scope_modified_by_user ? "secondary" : "outline"}
                    className="text-xs"
                  >
                    {currentScope?.scope_modified_by_user && <Check className="h-3 w-3 mr-1" />}
                    {scopeLabel(currentScope, availableTags)}
                  </Badge>
                </div>

                {/* Technology tags */}
                {techTags.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <Cpu className="h-3 w-3" />
                      Tecnologias ({techTags.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {techTags.map((tag) => {
                        const isActive = selectedIds.includes(tag.id)
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTag(tag.id)}
                            className={cn(
                              "inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-all select-none",
                              isActive
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-transparent border-border text-foreground hover:border-muted-foreground/60 hover:bg-muted/40"
                            )}
                          >
                            {isActive && <Check className="h-2.5 w-2.5 shrink-0" />}
                            <span className="truncate max-w-[150px]">{tag.name}</span>
                            <span
                              className={cn(
                                "font-normal tabular-nums text-[10px]",
                                isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                              )}
                            >
                              {tag.count}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Process tags */}
                {processTags.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <Workflow className="h-3 w-3" />
                      Procesos ({processTags.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {processTags.map((tag) => {
                        const isActive = selectedIds.includes(tag.id)
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTag(tag.id)}
                            className={cn(
                              "inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium transition-all select-none",
                              isActive
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-transparent border-border text-foreground hover:border-muted-foreground/60 hover:bg-muted/40"
                            )}
                          >
                            {isActive && <Check className="h-2.5 w-2.5 shrink-0" />}
                            <span className="truncate max-w-[150px]">{tag.name}</span>
                            <span
                              className={cn(
                                "font-normal tabular-nums text-[10px]",
                                isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                              )}
                            >
                              {tag.count}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Collision error */}
                {collisionError && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Scope duplicado</p>
                      <p className="text-xs opacity-80 mt-0.5">
                        Ya existe otro bookmark con estas señales.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-0 pt-4 border-t">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !hasChanges || saved || availableTags.length === 0 || selectedIds.length === 0}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Guardando...
              </>
            ) : saved ? (
              <>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Guardado
              </>
            ) : (
              "Guardar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
