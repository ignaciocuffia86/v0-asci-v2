"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
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
import { Briefcase, Users, Newspaper, Crown, Loader2, X, Check, AlertTriangle } from "lucide-react"
import type { DupCandidateRow } from "@/app/actions/dedupe"

interface Props {
  grupo: DupCandidateRow
  seleccionado: boolean
  onToggleSeleccion: (id: string) => void
  onAplicar: (id: string) => Promise<void>
  onDescartar: (id: string) => Promise<void>
  onPrevisualizar: (id: string) => Promise<{ rows_moved: number; rows_deleted: number }>
}

const ETIQUETA_ESTADO: Record<string, { texto: string; variante: "default" | "secondary" | "outline" | "destructive" }> =
  {
    pending: { texto: "Sin revisar", variante: "outline" },
    ai_same: { texto: "IA: misma empresa", variante: "default" },
    ai_different: { texto: "IA: empresas distintas", variante: "destructive" },
    ai_unsure: { texto: "IA: dudoso", variante: "secondary" },
    failed: { texto: "Error", variante: "destructive" },
  }

const ETIQUETA_METODO: Record<string, string> = {
  core: "nombre nucleo",
  trgm: "similitud",
  exact: "nombre exacto",
  ai: "IA",
}

export function DuplicateGroupCard({
  grupo,
  seleccionado,
  onToggleSeleccion,
  onAplicar,
  onDescartar,
  onPrevisualizar,
}: Props) {
  const [ocupado, setOcupado] = useState(false)
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [previa, setPrevia] = useState<{ rows_moved: number; rows_deleted: number } | null>(null)

  const estado = ETIQUETA_ESTADO[grupo.status] ?? { texto: grupo.status, variante: "outline" as const }
  const master = grupo.companies.find((c) => c.id === grupo.master_id)
  const aMergear = grupo.companies.filter((c) => grupo.company_ids.includes(c.id) && c.id !== grupo.master_id)
  const excluidas = grupo.companies.filter((c) => !grupo.company_ids.includes(c.id))

  const abrirConfirmacion = async () => {
    setDialogoAbierto(true)
    setPrevia(null)
    try {
      setPrevia(await onPrevisualizar(grupo.id))
    } catch {
      setPrevia(null)
    }
  }

  const confirmar = async () => {
    setOcupado(true)
    try {
      await onAplicar(grupo.id)
    } finally {
      setOcupado(false)
      setDialogoAbierto(false)
    }
  }

  const descartar = async () => {
    setOcupado(true)
    try {
      await onDescartar(grupo.id)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={seleccionado}
            onCheckedChange={() => onToggleSeleccion(grupo.id)}
            aria-label={`Seleccionar grupo ${grupo.group_key}`}
          />
          <span className="font-mono text-sm font-medium">{grupo.group_key}</span>
          <Badge variant={estado.variante}>{estado.texto}</Badge>
          <Badge variant="outline">{ETIQUETA_METODO[grupo.method] ?? grupo.method}</Badge>
          {grupo.classification === "seguro" ? (
            <Badge variant="secondary">seguro</Badge>
          ) : (
            <Badge variant="secondary">ambiguo</Badge>
          )}
          {grupo.ai_confidence !== null && (
            <Badge variant="outline">confianza {Math.round(grupo.ai_confidence * 100)}%</Badge>
          )}
        </div>

        {grupo.ai_reasoning && <p className="text-sm text-muted-foreground leading-relaxed">{grupo.ai_reasoning}</p>}

        <div className="flex flex-col gap-2">
          {master && <FilaEmpresa empresa={master} esMaster />}
          {aMergear.map((c) => (
            <FilaEmpresa key={c.id} empresa={c} />
          ))}
          {excluidas.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-dashed p-2">
              <span className="text-xs font-medium text-muted-foreground">
                Quedan separadas ({excluidas.length})
              </span>
              {excluidas.map((c) => (
                <FilaEmpresa key={c.id} empresa={c} atenuada />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={abrirConfirmacion} disabled={ocupado || aMergear.length === 0}>
            {ocupado ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
            Unificar {aMergear.length > 0 ? `(${aMergear.length})` : ""}
          </Button>
          <Button size="sm" variant="outline" onClick={descartar} disabled={ocupado}>
            <X className="mr-1 h-3 w-3" />
            No son la misma
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={dialogoAbierto} onOpenChange={setDialogoAbierto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar unificacion</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-sm">
                <span>
                  Se van a unificar {aMergear.length} {aMergear.length === 1 ? "empresa" : "empresas"} dentro de{" "}
                  <strong>{master?.name}</strong>.
                </span>
                {previa === null ? (
                  <span className="text-muted-foreground">Calculando impacto...</span>
                ) : (
                  <>
                    <span>
                      Se moveran <strong>{previa.rows_moved}</strong> registros asociados.
                    </span>
                    {previa.rows_deleted > 0 && (
                      <span className="flex items-start gap-1 text-destructive">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          <strong>{previa.rows_deleted}</strong> registros duplicados se eliminaran por conflicto de
                          unicidad (por ejemplo la misma cuenta seguida dos veces).
                        </span>
                      </span>
                    )}
                  </>
                )}
                <span className="text-muted-foreground">Se puede deshacer desde la pestana Historial.</span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmar}>Unificar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function FilaEmpresa({
  empresa,
  esMaster,
  atenuada,
}: {
  empresa: DupCandidateRow["companies"][number]
  esMaster?: boolean
  atenuada?: boolean
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-md p-2 ${
        esMaster ? "bg-primary/10" : "bg-muted/50"
      } ${atenuada ? "opacity-60" : ""}`}
    >
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-1">
          {esMaster && <Crown className="h-3 w-3 text-primary" aria-label="Registro principal" />}
          <span className="truncate text-sm font-medium">{empresa.name}</span>
        </div>
        <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          {empresa.country && <span>{empresa.country}</span>}
          {empresa.industry && <span>{empresa.industry}</span>}
          {empresa.website && <span>{empresa.website}</span>}
          {empresa.linkedin && <span>in/{empresa.linkedin}</span>}
        </div>
      </div>
      <div className="flex shrink-0 gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Briefcase className="h-3 w-3" />
          {empresa.jobs}
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {empresa.contacts}
        </span>
        <span className="flex items-center gap-1">
          <Newspaper className="h-3 w-3" />
          {empresa.news}
        </span>
      </div>
    </div>
  )
}
