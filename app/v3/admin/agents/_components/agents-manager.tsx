"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
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
import { Bot, Newspaper, Cpu, Pencil, Plus, Trash2 } from "lucide-react"
import {
  saveAgent,
  toggleAgent,
  removeAgent,
  type AgentsData,
  type DictionaryOption,
} from "@/app/actions/v3/admin-agents"
import type { MicroAgent } from "@/lib/v3/services/radar-agents"
import type { RadarType } from "@/lib/v3/services/types"

interface AgentsManagerProps {
  initialAgents: MicroAgent[]
  products: DictionaryOption[]
  processes: DictionaryOption[]
  loadError?: string
}

interface DraftAgent {
  id: string | null
  key: string
  label: string
  description: string
  radarType: RadarType
  focusPrompt: string
  keywords: string
  priority: number
  enabled: boolean
  dictionaryProductIds: string[]
  dictionaryProcessIds: string[]
}

function emptyDraft(): DraftAgent {
  return {
    id: null,
    key: "",
    label: "",
    description: "",
    radarType: "tech",
    focusPrompt: "",
    keywords: "",
    priority: 100,
    enabled: true,
    dictionaryProductIds: [],
    dictionaryProcessIds: [],
  }
}

function toDraft(a: MicroAgent): DraftAgent {
  return {
    id: a.id,
    key: a.key,
    label: a.label,
    description: a.description ?? "",
    radarType: a.radarType,
    focusPrompt: a.focusPrompt,
    keywords: a.keywords.join(", "),
    priority: a.priority,
    enabled: a.enabled,
    dictionaryProductIds: [...a.dictionaryProductIds],
    dictionaryProcessIds: [...a.dictionaryProcessIds],
  }
}

export function AgentsManager({ initialAgents, products, processes, loadError }: AgentsManagerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [draft, setDraft] = useState<DraftAgent | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<MicroAgent | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const productName = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products])
  const processName = useMemo(() => new Map(processes.map((p) => [p.id, p.name])), [processes])

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {loadError}
      </div>
    )
  }

  const openNew = () => {
    setFormError(null)
    setDraft(emptyDraft())
  }
  const openEdit = (a: MicroAgent) => {
    setFormError(null)
    setDraft(toDraft(a))
  }

  const handleToggle = (a: MicroAgent, enabled: boolean) => {
    startTransition(async () => {
      const res = await toggleAgent(a.id, enabled)
      if (res.success) router.refresh()
    })
  }

  const handleSave = () => {
    if (!draft) return
    setFormError(null)
    startTransition(async () => {
      const res = await saveAgent(draft.id, {
        key: draft.key,
        label: draft.label,
        description: draft.description || null,
        radarType: draft.radarType,
        focusPrompt: draft.focusPrompt,
        keywords: draft.keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        priority: draft.priority,
        enabled: draft.enabled,
        dictionaryProductIds: draft.dictionaryProductIds,
        dictionaryProcessIds: draft.dictionaryProcessIds,
      })
      if (res.success) {
        setDraft(null)
        router.refresh()
      } else {
        setFormError(res.error ?? "Error al guardar")
      }
    })
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    startTransition(async () => {
      const res = await removeAgent(deleteTarget.id)
      setDeleteTarget(null)
      if (res.success) router.refresh()
    })
  }

  const toggleId = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Bot className="size-5 text-muted-foreground" />
            Micro-agentes de investigación
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Cada micro-agente investiga un área concreta de una cuenta con búsqueda web real. Se
            seleccionan automáticamente según la propuesta de valor y los tags de los documentos de
            cada workspace, priorizando los de mayor afinidad.
          </p>
        </div>
        <Button size="sm" onClick={openNew} disabled={isPending}>
          <Plus data-icon="inline-start" />
          Nuevo micro-agente
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {initialAgents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No hay micro-agentes. Creá el primero para empezar a investigar cuentas.
          </p>
        ) : (
          initialAgents.map((a) => {
            const mapped = [
              ...a.dictionaryProductIds.map((id) => productName.get(id)).filter(Boolean),
              ...a.dictionaryProcessIds.map((id) => processName.get(id)).filter(Boolean),
            ] as string[]
            return (
              <Card key={a.id} className={a.enabled ? undefined : "opacity-60"}>
                <CardContent className="flex flex-wrap items-start gap-3 p-4">
                  <div className="mt-0.5 shrink-0 text-muted-foreground">
                    {a.radarType === "news" ? (
                      <Newspaper className="size-4" aria-hidden />
                    ) : (
                      <Cpu className="size-4" aria-hidden />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.label}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {a.radarType === "news" ? "Noticias" : "Tecnología"}
                      </Badge>
                      <code className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{a.key}</code>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        prioridad {a.priority}
                      </Badge>
                    </div>
                    {a.description && <p className="text-sm text-muted-foreground">{a.description}</p>}
                    {(a.keywords.length > 0 || mapped.length > 0) && (
                      <div className="flex flex-wrap gap-1">
                        {mapped.map((name) => (
                          <Badge key={`d-${name}`} variant="outline" className="border-primary/40 text-[10px] text-primary">
                            {name}
                          </Badge>
                        ))}
                        {a.keywords.slice(0, 6).map((k) => (
                          <Badge key={`k-${k}`} variant="secondary" className="text-[10px]">
                            {k}
                          </Badge>
                        ))}
                        {a.keywords.length > 6 && (
                          <span className="text-[10px] text-muted-foreground">+{a.keywords.length - 6}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch
                      checked={a.enabled}
                      disabled={isPending}
                      onCheckedChange={(v) => handleToggle(a, v)}
                      aria-label={`Activar ${a.label}`}
                    />
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => openEdit(a)} aria-label={`Editar ${a.label}`}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(a)}
                      aria-label={`Eliminar ${a.label}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* Formulario (crear/editar) */}
      <Sheet open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-xl">
          <SheetHeader className="border-b border-border">
            <SheetTitle>{draft?.id ? "Editar micro-agente" : "Nuevo micro-agente"}</SheetTitle>
            <SheetDescription>
              Definí el foco de investigación y a qué intereses del workspace aplica.
            </SheetDescription>
          </SheetHeader>

          {draft && (
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-4 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="agent-label">Nombre</Label>
                    <Input
                      id="agent-label"
                      value={draft.label}
                      onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                      placeholder="ERP y gestión"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="agent-key">Clave</Label>
                    <Input
                      id="agent-key"
                      value={draft.key}
                      disabled={!!draft.id}
                      onChange={(e) => setDraft({ ...draft, key: e.target.value.toLowerCase() })}
                      placeholder="erp"
                      className="font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="agent-desc">Descripción</Label>
                  <Input
                    id="agent-desc"
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="Sistemas de planificación de recursos empresariales"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Tipo de radar</Label>
                    <Select
                      value={draft.radarType}
                      onValueChange={(v) => setDraft({ ...draft, radarType: v as RadarType })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tech">Tecnología</SelectItem>
                        <SelectItem value="news">Noticias / negocio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="agent-priority">Prioridad</Label>
                    <Input
                      id="agent-priority"
                      type="number"
                      value={draft.priority}
                      onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="agent-focus">Foco de investigación</Label>
                  <Textarea
                    id="agent-focus"
                    value={draft.focusPrompt}
                    onChange={(e) => setDraft({ ...draft, focusPrompt: e.target.value })}
                    rows={6}
                    className="text-sm leading-relaxed"
                    placeholder="Buscá evidencia pública y verificable de..."
                  />
                  <p className="text-xs text-muted-foreground">
                    Instrucción que recibe el investigador. Sé específico sobre qué buscar y qué fuentes priorizar.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="agent-keywords">Keywords de afinidad</Label>
                  <Input
                    id="agent-keywords"
                    value={draft.keywords}
                    onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
                    placeholder="erp, sap, oracle, dynamics"
                  />
                  <p className="text-xs text-muted-foreground">
                    Separadas por coma. Se cruzan con la propuesta de valor y los tags del workspace para decidir cuándo correr este agente.
                  </p>
                </div>

                {products.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <Label>Productos del diccionario</Label>
                    <ScrollArea className="h-32 rounded-md border border-border p-2">
                      <div className="flex flex-col gap-1.5">
                        {products.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={draft.dictionaryProductIds.includes(p.id)}
                              onCheckedChange={() =>
                                setDraft({ ...draft, dictionaryProductIds: toggleId(draft.dictionaryProductIds, p.id) })
                              }
                            />
                            {p.name}
                          </label>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                {processes.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <Label>Procesos del diccionario</Label>
                    <ScrollArea className="h-32 rounded-md border border-border p-2">
                      <div className="flex flex-col gap-1.5">
                        {processes.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={draft.dictionaryProcessIds.includes(p.id)}
                              onCheckedChange={() =>
                                setDraft({ ...draft, dictionaryProcessIds: toggleId(draft.dictionaryProcessIds, p.id) })
                              }
                            />
                            {p.name}
                          </label>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={draft.enabled}
                    onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
                  />
                  Activo
                </label>

                {formError && <p className="text-sm text-destructive">{formError}</p>}
              </div>
            </ScrollArea>
          )}

          <SheetFooter className="border-t border-border">
            <Button variant="outline" className="bg-transparent" disabled={isPending} onClick={() => setDraft(null)}>
              Cancelar
            </Button>
            <Button disabled={isPending} onClick={handleSave}>
              {draft?.id ? "Guardar cambios" : "Crear micro-agente"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Confirmación de borrado */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar micro-agente</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará &quot;{deleteTarget?.label}&quot;. Los hallazgos ya generados se conservan. Esta
              acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={handleDelete}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
