"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { FileTerminal, History, RotateCcw, Save } from "lucide-react"
import {
  savePrompt,
  resetPromptToDefault,
  listPromptVersions,
  restorePromptVersion,
  type PromptWithState,
  type PromptVersion,
} from "@/app/actions/v3/admin-prompts"

interface PromptsManagerProps {
  initialPrompts: PromptWithState[]
  loadError?: string
}

export function PromptsManager({ initialPrompts, loadError }: PromptsManagerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Borradores por key (solo se llena cuando el usuario edita)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Record<string, { type: "success" | "error"; message: string }>>({})
  const [resetTarget, setResetTarget] = useState<PromptWithState | null>(null)

  // Historial (sheet lateral)
  const [historyKey, setHistoryKey] = useState<string | null>(null)
  const [historyVersions, setHistoryVersions] = useState<PromptVersion[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {loadError}
      </div>
    )
  }

  const getDraft = (p: PromptWithState) => drafts[p.key] ?? p.content
  const isDirty = (p: PromptWithState) => getDraft(p).trim() !== p.content.trim()

  const handleSave = (p: PromptWithState) => {
    const content = getDraft(p)
    startTransition(async () => {
      const result = await savePrompt(p.key, content)
      setFeedback((f) => ({
        ...f,
        [p.key]: result.success
          ? { type: "success", message: "Guardado. Se aplica en la próxima llamada de IA (cache de 60s)." }
          : { type: "error", message: result.error ?? "Error al guardar" },
      }))
      if (result.success) {
        setDrafts((d) => {
          const next = { ...d }
          delete next[p.key]
          return next
        })
        router.refresh()
      }
    })
  }

  const handleReset = () => {
    if (!resetTarget) return
    const key = resetTarget.key
    startTransition(async () => {
      const result = await resetPromptToDefault(key)
      setFeedback((f) => ({
        ...f,
        [key]: result.success
          ? { type: "success", message: "Restaurado al default del código." }
          : { type: "error", message: result.error ?? "Error al restaurar" },
      }))
      setResetTarget(null)
      if (result.success) {
        setDrafts((d) => {
          const next = { ...d }
          delete next[key]
          return next
        })
        router.refresh()
      }
    })
  }

  const openHistory = (key: string) => {
    setHistoryKey(key)
    setHistoryLoading(true)
    setHistoryVersions([])
    void listPromptVersions(key).then(({ versions }) => {
      setHistoryVersions(versions)
      setHistoryLoading(false)
    })
  }

  const handleRestore = (versionId: string) => {
    if (!historyKey) return
    const key = historyKey
    startTransition(async () => {
      const result = await restorePromptVersion(key, versionId)
      setFeedback((f) => ({
        ...f,
        [key]: result.success
          ? { type: "success", message: "Versión restaurada." }
          : { type: "error", message: result.error ?? "Error al restaurar la versión" },
      }))
      setHistoryKey(null)
      if (result.success) {
        setDrafts((d) => {
          const next = { ...d }
          delete next[key]
          return next
        })
        router.refresh()
      }
    })
  }

  const historyPrompt = initialPrompts.find((p) => p.key === historyKey)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileTerminal className="size-5 text-muted-foreground" />
          Prompts de IA
        </h1>
        <p className="text-sm text-muted-foreground">
          Editá los prompts que corren en cada flujo de la aplicación sin tocar código. Los
          placeholders <code className="rounded bg-muted px-1 text-xs">{"{{variable}}"}</code> se
          reemplazan en runtime con datos reales; los obligatorios no se pueden quitar.
        </p>
      </div>

      <Accordion type="multiple" className="flex flex-col gap-3">
        {initialPrompts.map((p) => {
          const fb = feedback[p.key]
          return (
            <AccordionItem key={p.key} value={p.key} className="rounded-lg border border-border px-0">
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <span className="flex flex-1 flex-wrap items-center gap-2 text-left">
                  <span className="font-medium">{p.name}</span>
                  {p.isCustomized ? (
                    <Badge variant="outline" className="border-primary/40 text-xs text-primary">
                      Personalizado
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      Default
                    </Badge>
                  )}
                  {isDirty(p) && (
                    <Badge variant="outline" className="border-amber-500/50 text-xs text-amber-600 dark:text-amber-400">
                      Sin guardar
                    </Badge>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">{p.description}</p>

                  {p.placeholders.length > 0 && (
                    <Card className="border-dashed">
                      <CardContent className="flex flex-col gap-1.5 p-3">
                        <span className="text-xs font-medium text-muted-foreground">
                          Placeholders disponibles
                        </span>
                        <ul className="flex flex-col gap-1 text-xs">
                          {p.placeholders.map((ph) => (
                            <li key={ph.name} className="flex flex-wrap items-baseline gap-1.5">
                              <code className="rounded bg-muted px-1 py-0.5">{`{{${ph.name}}}`}</code>
                              <span className="text-muted-foreground">{ph.description}</span>
                              {p.requiredPlaceholders.includes(ph.name) && (
                                <Badge variant="outline" className="h-4 border-destructive/40 px-1 text-[10px] text-destructive">
                                  obligatorio
                                </Badge>
                              )}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  <Textarea
                    value={getDraft(p)}
                    onChange={(e) => {
                      const value = e.target.value
                      setDrafts((d) => ({ ...d, [p.key]: value }))
                      setFeedback((f) => {
                        const next = { ...f }
                        delete next[p.key]
                        return next
                      })
                    }}
                    rows={Math.min(24, Math.max(8, getDraft(p).split("\n").length + 1))}
                    className="font-mono text-xs leading-relaxed"
                    aria-label={`Contenido del prompt ${p.name}`}
                  />

                  {fb && (
                    <p
                      className={
                        fb.type === "success"
                          ? "text-sm text-green-600 dark:text-green-400"
                          : "text-sm text-destructive"
                      }
                    >
                      {fb.message}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" disabled={isPending || !isDirty(p)} onClick={() => handleSave(p)}>
                      <Save data-icon="inline-start" />
                      Guardar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-transparent"
                      disabled={isPending || p.versionsCount === 0}
                      onClick={() => openHistory(p.key)}
                    >
                      <History data-icon="inline-start" />
                      Historial ({p.versionsCount})
                    </Button>
                    {p.isCustomized && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-transparent text-muted-foreground"
                        disabled={isPending}
                        onClick={() => setResetTarget(p)}
                      >
                        <RotateCcw data-icon="inline-start" />
                        Volver al default
                      </Button>
                    )}
                    {p.updatedAt && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        Última edición:{" "}
                        {new Date(p.updatedAt).toLocaleDateString("es", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>

      {/* Confirmación de reset */}
      <AlertDialog open={!!resetTarget} onOpenChange={(open) => !open && setResetTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Volver al default</AlertDialogTitle>
            <AlertDialogDescription>
              El prompt &quot;{resetTarget?.name}&quot; volverá al texto original del código. La
              versión personalizada actual queda guardada en el historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={handleReset}>
              Restaurar default
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Historial de versiones */}
      <Sheet open={!!historyKey} onOpenChange={(open) => !open && setHistoryKey(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-xl">
          <SheetHeader className="border-b border-border">
            <SheetTitle>Historial: {historyPrompt?.name}</SheetTitle>
            <SheetDescription>
              Últimas 20 versiones. Restaurar una versión crea una entrada nueva en el historial.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
            {historyLoading ? (
              <p className="text-sm text-muted-foreground">Cargando versiones...</p>
            ) : historyVersions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin versiones previas.</p>
            ) : (
              historyVersions.map((v) => (
                <Card key={v.id}>
                  <CardContent className="flex flex-col gap-2 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {new Date(v.createdAt).toLocaleDateString("es", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {v.createdByEmail && <span>· {v.createdByEmail}</span>}
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto h-6 bg-transparent px-2 text-xs"
                        disabled={isPending}
                        onClick={() => handleRestore(v.id)}
                      >
                        Restaurar
                      </Button>
                    </div>
                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-xs leading-relaxed">
                      {v.content}
                    </pre>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
