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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { X, Plus, AlertTriangle, Loader2, ArrowLeft, Crosshair, RefreshCw } from "lucide-react"
import { planDictionaryJobs, type PendingChange } from "@/lib/dictionary/plan-jobs"

/** keyword (en minúsculas) → términos. Ver dictionary_products.keywords_contexto. */
type TermMap = Record<string, string[]>

type EditKeywordsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemId: string
  itemName: string
  itemType: "product" | "process"
  currentKeywords: string[]
  /** Solo productos. Los procesos no tienen co-ocurrencia. */
  currentContexto?: TermMap
  currentExcluye?: TermMap
  onSave: () => void
}

// "recalculate" es un cambio de co-ocurrencia sobre una keyword que ya existe.
// No alcanza con guardar el mapa: las señales viejas se generaron con las
// reglas anteriores, así que hay que borrarlas y volver a generarlas.
// El tipo y el reparto en carriles viven en lib/dictionary/plan-jobs.

const termKey = (keyword: string) => keyword.toLowerCase()

const sameTerms = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && a.every((t, i) => t === b[i])

type DialogView = "edit" | "confirm"

export function EditKeywordsDialog({
  open,
  onOpenChange,
  itemId,
  itemName,
  itemType,
  currentKeywords,
  currentContexto,
  currentExcluye,
  onSave,
}: EditKeywordsDialogProps) {
  const [keywords, setKeywords] = useState<string[]>([])
  const [newKeyword, setNewKeyword] = useState("")
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [editingName, setEditingName] = useState(itemName)
  const [view, setView] = useState<DialogView>("edit")
  const [contexto, setContexto] = useState<TermMap>({})
  const [excluye, setExcluye] = useState<TermMap>({})
  /** Keyword cuyo panel de co-ocurrencia está abierto. */
  const [afinando, setAfinando] = useState<string | null>(null)
  const [nuevoTermino, setNuevoTermino] = useState({ contexto: "", excluye: "" })
  const supabase = createClient()

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setKeywords([...currentKeywords])
      setPendingChanges([])
      setNewKeyword("")
      setEditingName(itemName)
      setView("edit")
      setContexto({ ...(currentContexto ?? {}) })
      setExcluye({ ...(currentExcluye ?? {}) })
      setAfinando(null)
      setNuevoTermino({ contexto: "", excluye: "" })
    }
  }, [open, currentKeywords, itemName, currentContexto, currentExcluye])

  // Calculate pending changes by comparing current vs original
  const calculateChanges = (newKeywords: string[], ctx: TermMap, exc: TermMap): PendingChange[] => {
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

    // Keywords que siguen estando pero cambiaron sus reglas de co-ocurrencia.
    // Las que se agregan o se sacan no entran acá: su job ya recalcula todo.
    newKeywords.forEach((kw) => {
      if (!currentKeywords.includes(kw)) return
      const k = termKey(kw)
      const cambio =
        !sameTerms(ctx[k], (currentContexto ?? {})[k]) || !sameTerms(exc[k], (currentExcluye ?? {})[k])
      if (cambio) changes.push({ type: "recalculate", keyword: kw })
    })

    return changes
  }

  /** Reescribe uno de los dos mapas para una keyword y recalcula los pendientes. */
  const setTerminos = (campo: "contexto" | "excluye", keyword: string, terms: string[]) => {
    const k = termKey(keyword)
    const next = campo === "contexto" ? { ...contexto } : { ...excluye }
    if (terms.length > 0) next[k] = terms
    else delete next[k]

    const ctx = campo === "contexto" ? next : contexto
    const exc = campo === "excluye" ? next : excluye
    if (campo === "contexto") setContexto(next)
    else setExcluye(next)
    setPendingChanges(calculateChanges(keywords, ctx, exc))
  }

  const agregarTermino = (campo: "contexto" | "excluye", keyword: string) => {
    const crudos = nuevoTermino[campo]
      .split(/[;,]/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (crudos.length === 0) return
    const actuales = (campo === "contexto" ? contexto : excluye)[termKey(keyword)] ?? []
    const nuevos = crudos.filter((t) => !actuales.includes(t))
    if (nuevos.length > 0) setTerminos(campo, keyword, [...actuales, ...nuevos])
    setNuevoTermino((prev) => ({ ...prev, [campo]: "" }))
  }

  const handleAddKeyword = () => {
    if (!newKeyword.trim()) return

    // Support semicolon or comma-separated bulk add
    const newKeywords = newKeyword
      .split(/[;,]/)
      .map((k) => k.trim())
      .filter((k) => k && !keywords.includes(k))

    if (newKeywords.length > 0) {
      const updatedKeywords = [...keywords, ...newKeywords]
      setKeywords(updatedKeywords)
      setPendingChanges(calculateChanges(updatedKeywords, contexto, excluye))
    }
    setNewKeyword("")
  }

  const handleRemoveKeyword = (keyword: string) => {
    const updatedKeywords = keywords.filter((k) => k !== keyword)
    // Si se va la keyword se van sus reglas: un mapa con claves huérfanas no
    // rompe nada, pero queda basura que después nadie sabe de dónde salió.
    const k = termKey(keyword)
    const ctx = { ...contexto }
    const exc = { ...excluye }
    delete ctx[k]
    delete exc[k]
    setKeywords(updatedKeywords)
    setContexto(ctx)
    setExcluye(exc)
    if (afinando === keyword) setAfinando(null)
    setPendingChanges(calculateChanges(updatedKeywords, ctx, exc))
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
  const recalcKeywords = pendingChanges.filter((c) => c.type === "recalculate")
  const tieneReglas = (kw: string) => {
    const k = termKey(kw)
    return (contexto[k]?.length ?? 0) > 0 || (excluye[k]?.length ?? 0) > 0
  }

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
          // Los mapas de co-ocurrencia solo existen en productos.
          ...(itemType === "product"
            ? { keywords_contexto: contexto, keywords_excluye: excluye }
            : {}),
        })
        .eq("id", itemId)

      // 2. Encolar los cambios como jobs en background, en dos carriles.
      //
      //    El borrado ya NO se hace síncrono desde el browser: eso disparaba
      //    "canceling statement due to lock timeout" (DELETE con ILIKE sobre
      //    signals bajo el statement_timeout de 8s del rol authenticated).
      //    Ahora el cron/driver procesa remove_keyword con timeout amplio.
      //
      //    Carril inmediato: agregar y sacar keywords. Lo toma el cron que
      //    corre cada minuto, así el editor ve el efecto de lo que acaba de
      //    tocar.
      const { inmediatos, recalcs } = planDictionaryJobs(pendingChanges, itemId, signalType)
      if (inmediatos.length > 0) {
        await supabase.from("dictionary_jobs").insert(inmediatos)
      }

      //    Carril nocturno: recálculos de co-ocurrencia. Cambiar el contexto de
      //    una keyword obliga a rehacer señales que YA existen y que nadie está
      //    esperando —reprocesar "Exchange" toca ~5.000 contactos—, así que no
      //    tiene por qué competir con el trabajo interactivo. Salen 'deferred'
      //    y los libera el cron nocturno.
      //
      //    Va por RPC y no por insert: el dedupe usa un índice único PARCIAL
      //    (solo sobre deferred) y PostgREST no sabe expresar el predicado que
      //    ON CONFLICT necesita para inferirlo. La RPC además inserta el par
      //    remove → add en una sola transacción con created_at explícito, que
      //    es lo que garantiza que el add no corra antes que su remove.
      if (recalcs.length > 0) {
        const { error: recalcError } = await supabase.rpc("enqueue_dictionary_recalc", {
          p_signal_id: itemId,
          p_signal_type: signalType,
          p_keywords: recalcs,
        })
        if (recalcError) throw recalcError
      }

      onSave()
      onOpenChange(false)
    } catch (error) {
      console.error("Error applying changes:", error)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (isProcessing) return
    if (!newOpen) {
      setView("edit")
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg !flex !flex-col max-h-[85vh]">
        {view === "edit" ? (
          <>
            <DialogHeader>
              <DialogTitle>Editar {itemType === "product" ? "Producto" : "Proceso"}</DialogTitle>
              <DialogDescription>
                Modifica el nombre y las keywords. Los cambios se procesarán en background.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 overflow-y-auto min-h-0">
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
                      const conReglas = tieneReglas(kw)
                      return (
                        <Badge
                          key={kw}
                          variant={isNew ? "default" : "secondary"}
                          className={`gap-1 pr-1 ${isNew ? "bg-green-600 hover:bg-green-700" : ""} ${
                            afinando === kw ? "ring-2 ring-primary" : ""
                          }`}
                        >
                          {kw}
                          {itemType === "product" && (
                            <button
                              onClick={() => {
                                setAfinando(afinando === kw ? null : kw)
                                setNuevoTermino({ contexto: "", excluye: "" })
                              }}
                              title="Co-ocurrencia: exigir contexto o excluir colocaciones"
                              className={`ml-1 rounded-full p-0.5 hover:bg-black/20 ${
                                conReglas ? "text-amber-600 dark:text-amber-400" : "opacity-60"
                              }`}
                            >
                              <Crosshair className="h-3 w-3" />
                            </button>
                          )}
                          <button
                            onClick={() => handleRemoveKeyword(kw)}
                            className="ml-0.5 hover:bg-black/20 rounded-full p-0.5"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Co-ocurrencia de una keyword puntual */}
              {afinando && itemType === "product" && (
                <div className="space-y-3 p-3 border rounded-md bg-muted/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Crosshair className="h-4 w-4 shrink-0 text-primary" />
                      <span className="text-sm font-medium truncate">Co-ocurrencia de "{afinando}"</span>
                    </div>
                    <button onClick={() => setAfinando(null)} className="shrink-0 hover:bg-black/10 rounded p-1">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Para keywords que son palabras comunes. Sirven para dos cosas distintas: el contexto resuelve
                    la ambigüedad de dominio (&quot;Fabric&quot; de tela o de redes) y las exclusiones resuelven la
                    de nombre (&quot;Service Fabric&quot;, &quot;Hyperledger Fabric&quot;). Dejar las dos vacías es
                    matcheo directo, como siempre.
                  </p>

                  {(["contexto", "excluye"] as const).map((campo) => {
                    const terms = (campo === "contexto" ? contexto : excluye)[termKey(afinando)] ?? []
                    return (
                      <div key={campo} className="space-y-1.5">
                        <Label className="text-xs">
                          {campo === "contexto"
                            ? "Exigir que el texto también diga alguno de:"
                            : "No contar la mención cuando es parte de:"}
                        </Label>
                        <div className="flex flex-wrap gap-1.5">
                          {terms.length === 0 ? (
                            <span className="text-xs text-muted-foreground italic">Sin términos</span>
                          ) : (
                            terms.map((t) => (
                              <Badge
                                key={t}
                                variant="outline"
                                className={`gap-1 pr-1 text-xs font-normal ${
                                  campo === "contexto"
                                    ? "border-emerald-500/60 text-emerald-700 dark:text-emerald-400"
                                    : "border-red-500/60 text-red-700 dark:text-red-400"
                                }`}
                              >
                                {t}
                                <button
                                  onClick={() =>
                                    setTerminos(campo, afinando, terms.filter((x) => x !== t))
                                  }
                                  className="ml-0.5 hover:bg-black/20 rounded-full p-0.5"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </Badge>
                            ))
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Input
                            value={nuevoTermino[campo]}
                            onChange={(e) => setNuevoTermino((prev) => ({ ...prev, [campo]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault()
                                agregarTermino(campo, afinando)
                              }
                            }}
                            placeholder={
                              campo === "contexto" ? "Power BI, Synapse, OneLake" : "Service Fabric, Data Fabric"
                            }
                            className="h-8 text-xs"
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => agregarTermino(campo, afinando)}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Add new keyword */}
              <div className="space-y-2">
                <Label htmlFor="new-keyword">Agregar keywords</Label>
                <div className="flex gap-2">
                  <Input
                    id="new-keyword"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Separar múltiples con coma (,) o punto y coma (;)"
                  />
                  <Button type="button" onClick={handleAddKeyword} size="icon">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Usa coma (,) o punto y coma (;) para agregar múltiples keywords a la vez.
                </p>
              </div>

              {/* Pending changes summary */}
              {hasChanges && (
                <div className="space-y-2 p-3 border rounded-md bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 max-h-[200px] overflow-y-auto overflow-x-hidden">
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
                      <span className="text-green-700 dark:text-green-400">+ Agregar ({addedKeywords.length}):</span>
                      <p className="text-green-600 dark:text-green-300 break-words">
                        {addedKeywords.map((c) => c.keyword).join(", ")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Se procesará la base de datos para detectar nuevas señales.
                      </p>
                    </div>
                  )}

                  {removedKeywords.length > 0 && (
                    <div className="text-sm">
                      <span className="text-red-700 dark:text-red-400">- Eliminar ({removedKeywords.length}):</span>
                      <p className="text-red-600 dark:text-red-300 break-words">
                        {removedKeywords.map((c) => c.keyword).join(", ")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Se eliminarán las señales existentes con estas keywords.
                      </p>
                    </div>
                  )}

                  {recalcKeywords.length > 0 && (
                    <div className="text-sm">
                      <span className="text-blue-700 dark:text-blue-400">
                        ~ Recalcular co-ocurrencia ({recalcKeywords.length}):
                      </span>
                      <p className="text-blue-600 dark:text-blue-300 break-words">
                        {recalcKeywords.map((c) => c.keyword).join(", ")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Las señales actuales de estas keywords se borran y se vuelven a generar con las reglas
                        nuevas. Corre de noche: es trabajo pesado sobre señales que ya existen.
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
              <Button onClick={() => setView("confirm")} disabled={!hasChanges || keywords.length === 0}>
                Aplicar Cambios
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                ¿Confirmar cambios?
              </DialogTitle>
              <DialogDescription>Estás a punto de aplicar los siguientes cambios:</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4 max-h-[50vh] overflow-y-auto">
              {editingName !== itemName && (
                <p className="text-sm">
                  • Cambiar nombre de "<span className="font-medium">{itemName}</span>" a "
                  <span className="font-medium">{editingName}</span>"
                </p>
              )}

              {addedKeywords.length > 0 && (
                <div className="text-sm">
                  <span className="text-green-600 dark:text-green-400 font-medium">
                    • Agregar {addedKeywords.length} keyword(s):
                  </span>
                  <p className="text-green-600 dark:text-green-300 ml-3">
                    {addedKeywords.map((c) => c.keyword).join(", ")}
                  </p>
                </div>
              )}

              {removedKeywords.length > 0 && (
                <div className="text-sm">
                  <span className="text-red-600 dark:text-red-400 font-medium">
                    • Eliminar {removedKeywords.length} keyword(s):
                  </span>
                  <p className="text-red-600 dark:text-red-300 ml-3">
                    {removedKeywords.map((c) => c.keyword).join(", ")}
                  </p>
                </div>
              )}

              {recalcKeywords.length > 0 && (
                <div className="text-sm">
                  <span className="text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Recalcular {recalcKeywords.length} keyword(s) por co-ocurrencia:
                  </span>
                  <p className="text-blue-600 dark:text-blue-300 ml-3">
                    {recalcKeywords.map((c) => c.keyword).join(", ")}
                  </p>
                  <p className="text-xs text-muted-foreground ml-3 mt-1">
                    Se borran sus señales actuales y se regeneran con las reglas nuevas. Queda encolado para la
                    madrugada; hasta entonces las señales siguen mostrando las reglas viejas.
                  </p>
                </div>
              )}

              <p className="text-sm text-muted-foreground pt-2 border-t">
                Agregar y sacar keywords se procesa en minutos. Los recálculos de co-ocurrencia se procesan de
                madrugada. Podés ver el progreso en Admin → Procesamiento.
              </p>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setView("edit")}
                disabled={isProcessing}
                className="w-full sm:w-auto"
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Volver
              </Button>
              <Button onClick={handleApplyChanges} disabled={isProcessing} className="w-full sm:w-auto">
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  "Confirmar"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
