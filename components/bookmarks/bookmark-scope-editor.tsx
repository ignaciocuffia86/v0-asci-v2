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
import { Cpu, Workflow, Globe, SlidersHorizontal, Loader2, AlertTriangle, X, Check } from "lucide-react"
import { updateBookmarkScope } from "@/app/actions/bookmarks"
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
  companyName: string
  /** Current scope saved in the bookmark */
  currentScope: {
    filterSignalIds?: string[]
    filterType?: string | null
    filtersUsed?: { technology?: string[]; process?: string[] }
    scope_modified_by_user?: boolean
  } | null
  /** All signal tags available for this company (from getTagCloud + getJobPostingTags).
   *  If empty and fetchAvailableTags is provided, tags are fetched lazily on dialog open. */
  availableTags?: SignalTag[]
  /** Optional async function to load tags on demand (used when rendering outside the drawer) */
  fetchAvailableTags?: () => Promise<SignalTag[]>
  /** Called after a successful scope update so parent can refresh */
  onScopeUpdated?: (newScope: any) => void
  /** Optional trigger element — defaults to a ghost icon button */
  trigger?: React.ReactNode
}

// -------------------------------------------------------
// Helpers
// -------------------------------------------------------

function scopeLabel(scope: BookmarkScopeEditorProps["currentScope"]): string {
  if (!scope || !scope.filterSignalIds || scope.filterSignalIds.length === 0) return "General"
  const techs = scope.filtersUsed?.technology || []
  const procs = scope.filtersUsed?.process || []
  const all = [...techs, ...procs]
  if (all.length === 0) return "General"
  const shown = all.slice(0, 2).join(", ")
  const rest = all.length - 2
  return rest > 0 ? `${shown} +${rest} más` : shown
}

// -------------------------------------------------------
// Component
// -------------------------------------------------------

export function BookmarkScopeEditor({
  bookmarkId,
  userId,
  companyName,
  currentScope,
  availableTags: propTags,
  fetchAvailableTags,
  onScopeUpdated,
  trigger,
}: BookmarkScopeEditorProps) {
  const [open, setOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>(currentScope?.filterSignalIds || [])
  const [isSaving, setIsSaving] = useState(false)
  const [isFetchingTags, setIsFetchingTags] = useState(false)
  const [loadedTags, setLoadedTags] = useState<SignalTag[]>(propTags || [])
  const [collisionError, setCollisionError] = useState(false)
  const [saved, setSaved] = useState(false)

  // Keep loadedTags in sync when prop changes (drawer scenario)
  useEffect(() => {
    if (propTags && propTags.length > 0) setLoadedTags(propTags)
  }, [propTags])

  const availableTags = loadedTags

  // Reset state when dialog opens; fetch tags lazily if needed
  const handleOpenChange = async (next: boolean) => {
    if (next) {
      setSelectedIds(currentScope?.filterSignalIds || [])
      setCollisionError(false)
      setSaved(false)

      if ((!propTags || propTags.length === 0) && fetchAvailableTags && loadedTags.length === 0) {
        setIsFetchingTags(true)
        try {
          const fetched = await fetchAvailableTags()
          setLoadedTags(fetched)
        } finally {
          setIsFetchingTags(false)
        }
      }
    }
    setOpen(next)
  }

  const toggleTag = (id: string) => {
    setCollisionError(false)
    setSaved(false)
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((x) => x !== id))
    } else {
      setSelectedIds([...selectedIds, id])
    }
  }

  const clearAll = () => {
    setSelectedIds([])
    setCollisionError(false)
    setSaved(false)
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
      onScopeUpdated?.(newScope)
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

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            Scope del bookmark
          </DialogTitle>
          <DialogDescription>
            Definí qué señales representan este bookmark de <span className="font-medium text-foreground">{companyName}</span>.
            El scope afecta cómo se filtran los contactos en el drawer y en el export.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Loading state for lazy-fetched tags */}
          {isFetchingTags && (
            <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando señales de la empresa...
            </div>
          )}

          {!isFetchingTags && (
          <>
          {/* Current scope summary */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Scope actual:</span>
            <Badge variant={currentScope?.scope_modified_by_user ? "secondary" : "outline"} className="text-xs">
              {currentScope?.scope_modified_by_user && <Check className="h-3 w-3 mr-1" />}
              {scopeLabel(currentScope)}
            </Badge>
          </div>

          {/* General option */}
          <button
            onClick={clearAll}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-sm transition-all text-left",
              selectedIds.length === 0
                ? "border-primary bg-primary/5 text-primary font-medium"
                : "border-border hover:border-muted-foreground/30 hover:bg-muted/30",
            )}
          >
            <Globe className={cn("h-4 w-4 shrink-0", selectedIds.length === 0 ? "text-primary" : "text-muted-foreground")} />
            <div>
              <div className="font-medium">General</div>
              <div className="text-xs text-muted-foreground font-normal">Sin filtro de señales — representa la empresa como un todo</div>
            </div>
            {selectedIds.length === 0 && <Check className="h-4 w-4 ml-auto text-primary" />}
          </button>

          {/* Technology tags */}
          {techTags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <Cpu className="h-3.5 w-3.5" />
                Tecnologías
              </div>
              <div className="flex flex-wrap gap-2">
                {techTags.map((tag) => {
                  const isActive = selectedIds.includes(tag.id)
                  return (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        "cursor-pointer select-none px-2.5 py-1 text-xs transition-all",
                        isActive
                          ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                          : "hover:border-muted-foreground/50 hover:bg-muted/30",
                      )}
                    >
                      {isActive && <Check className="h-3 w-3 mr-1" />}
                      {tag.name}
                      <span className={cn("ml-1.5 font-normal", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                        {tag.count}
                      </span>
                    </Badge>
                  )
                })}
              </div>
            </div>
          )}

          {/* Process tags */}
          {processTags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <Workflow className="h-3.5 w-3.5" />
                Procesos
              </div>
              <div className="flex flex-wrap gap-2">
                {processTags.map((tag) => {
                  const isActive = selectedIds.includes(tag.id)
                  return (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      onClick={() => toggleTag(tag.id)}
                      className={cn(
                        "cursor-pointer select-none px-2.5 py-1 text-xs transition-all",
                        isActive
                          ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                          : "hover:border-muted-foreground/50 hover:bg-muted/30",
                      )}
                    >
                      {isActive && <Check className="h-3 w-3 mr-1" />}
                      {tag.name}
                      <span className={cn("ml-1.5 font-normal", isActive ? "text-primary-foreground/70" : "text-muted-foreground")}>
                        {tag.count}
                      </span>
                    </Badge>
                  )
                })}
              </div>
            </div>
          )}

          {availableTags.length === 0 && (
            <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg">
              No se encontraron señales para esta empresa. El scope quedará como General.
            </div>
          )}

          {/* Collision warning */}
          {collisionError && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Ya existe otro bookmark de <span className="font-medium">{companyName}</span> con este mismo scope. Elegí una combinación de señales diferente.</span>
            </div>
          )}

          {/* Strategy warning when scope changes */}
          {hasChanges && selectedIds.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
              <span>Si tenés una estrategia generada para este bookmark, cambiar el scope no la actualiza automáticamente. Podés regenerarla desde el drawer.</span>
            </div>
          )}
          </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !hasChanges || saved} className="min-w-[140px]">
            {isSaving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Guardando...</>
            ) : saved ? (
              <><Check className="h-4 w-4 mr-2" /> Guardado</>
            ) : (
              "Actualizar scope"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
