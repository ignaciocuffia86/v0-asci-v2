"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, RefreshCw, Sparkles, Zap, Undo2, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { DuplicateGroupCard } from "@/components/admin/duplicate-group-card"
import {
  getDupCandidates,
  getDupSummary,
  refreshDupCandidates,
  applyDupCandidate,
  applyDupCandidates,
  previewDupCandidate,
  dismissDupCandidate,
  excludeFromDupCandidate,
  autoMergeSafe,
  classifyAmbiguous,
  getRecentMerges,
  revertMerge,
  type DupCandidateRow,
  type DupSummary,
} from "@/app/actions/dedupe"

type Merge = Awaited<ReturnType<typeof getRecentMerges>>[number]

export default function CompanyDuplicatesPage() {
  const [resumen, setResumen] = useState<DupSummary | null>(null)
  const [seguros, setSeguros] = useState<DupCandidateRow[]>([])
  const [ambiguos, setAmbiguos] = useState<DupCandidateRow[]>([])
  const [conVeredicto, setConVeredicto] = useState<DupCandidateRow[]>([])
  const [historial, setHistorial] = useState<Merge[]>([])
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [cargando, setCargando] = useState(true)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [s, seg, amb, ia, hist] = await Promise.all([
        getDupSummary(),
        getDupCandidates({ classification: "seguro", status: "pending", limit: 200 }),
        getDupCandidates({ classification: "ambiguo", status: "pending", limit: 200 }),
        getDupCandidates({ status: "ai_same", limit: 200 }),
        getRecentMerges(50),
      ])
      setResumen(s)
      setSeguros(seg)
      setAmbiguos(amb)
      setConVeredicto(ia)
      setHistorial(hist)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando duplicados")
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const correr = async (clave: string, fn: () => Promise<string>) => {
    setOcupado(clave)
    try {
      const mensaje = await fn()
      toast.success(mensaje)
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fallo la operacion")
    } finally {
      setOcupado(null)
    }
  }

  const toggleSeleccion = (id: string) =>
    setSeleccion((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const aplicarSeleccion = () =>
    correr("bloque", async () => {
      const ids = [...seleccion]
      const r = await applyDupCandidates(ids)
      setSeleccion(new Set())
      return `${r.aplicados} grupos unificados, ${r.movidas} registros movidos${
        r.errores.length ? `, ${r.errores.length} con error` : ""
      }`
    })

  if (cargando) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-8 text-center text-destructive">{error}</CardContent>
        </Card>
      </div>
    )
  }

  const listas: Record<string, DupCandidateRow[]> = {
    seguros,
    ambiguos,
    ia: conVeredicto,
  }

  return (
    <main className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">Unificacion de empresas</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            La deteccion agrupa por nombre nucleo, asi entran casos como ARCOR y Grupo Arcor. Los grupos seguros se
            unifican solos; los ambiguos los resuelve la IA o vos. La cola se llena por lotes: usá
            &quot;Traer mas grupos&quot; para seguir avanzando.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              correr("refresh", async () => {
                const r = await refreshDupCandidates({ limit: 100 })
                if (r.nuevos_grupos === 0) {
                  return r.grupos_restantes === 0
                    ? "No quedan grupos nuevos por revisar. Resincronizá el índice si cargaste datos nuevos."
                    : "No se agregaron grupos nuevos en este lote."
                }
                return `${r.nuevos_grupos} grupos agregados a la cola. Quedan ${r.grupos_restantes.toLocaleString(
                  "es-AR",
                )} de ${r.grupos_totales.toLocaleString("es-AR")}.`
              })
            }
            disabled={ocupado !== null}
          >
            {ocupado === "refresh" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            Traer mas grupos
          </Button>

          <Button
            variant="outline"
            onClick={() =>
              correr("ia", async () => {
                const r = await classifyAmbiguous(20)
                return `${r.processed} grupos analizados. Misma: ${r.same}, distintas: ${r.different}, dudosos: ${
                  r.unsure
                }. Costo: US$${r.costUsd.toFixed(4)}`
              })
            }
            disabled={ocupado !== null || (resumen?.ambiguos_pendientes ?? 0) === 0}
          >
            {ocupado === "ia" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-4 w-4" />
            )}
            Analizar ambiguos con IA
          </Button>
          <Button
            onClick={() =>
              correr("auto", async () => {
                const r = await autoMergeSafe()
                const base = `${r.groups} grupos unificados, ${r.rows_moved} registros movidos`
                const fallidos = r.errors.length > 0 ? `. ${r.errors.length} fallaron` : ""
                // Corta por presupuesto de tiempo para no chocar con el limite de
                // la conexion. Lo hecho ya quedo guardado, asi que alcanza con
                // volver a tocar el boton.
                return r.corto_por_tiempo
                  ? `${base}${fallidos}. Quedan ${r.restantes.toLocaleString("es-AR")}: tocá de nuevo para seguir.`
                  : `${base}${fallidos}`
              })
            }
            disabled={ocupado !== null || (resumen?.seguros_pendientes ?? 0) === 0}
          >
            {ocupado === "auto" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Zap className="mr-1 h-4 w-4" />}
            Unificar seguros
          </Button>
        </div>
      </header>

      {resumen && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metrica etiqueta="Seguros pendientes" valor={resumen.seguros_pendientes} />
          <Metrica etiqueta="Ambiguos pendientes" valor={resumen.ambiguos_pendientes} />
          <Metrica etiqueta="Unificados" valor={resumen.mergeados} />
          <Metrica etiqueta="Costo IA" valor={`US$${Number(resumen.costo_ia_usd).toFixed(4)}`} />
        </div>
      )}

      {seleccion.size > 0 && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
            <span className="text-sm">
              {seleccion.size} {seleccion.size === 1 ? "grupo seleccionado" : "grupos seleccionados"}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSeleccion(new Set())}>
                Limpiar
              </Button>
              <Button size="sm" onClick={aplicarSeleccion} disabled={ocupado !== null}>
                {ocupado === "bloque" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Unificar seleccionados
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="ia">
        <TabsList>
          <TabsTrigger value="ia">Con veredicto de IA ({conVeredicto.length})</TabsTrigger>
          <TabsTrigger value="ambiguos">Ambiguos ({ambiguos.length})</TabsTrigger>
          <TabsTrigger value="seguros">Seguros ({seguros.length})</TabsTrigger>
          <TabsTrigger value="historial">Historial ({historial.length})</TabsTrigger>
        </TabsList>

        {(["ia", "ambiguos", "seguros"] as const).map((clave) => (
          <TabsContent key={clave} value={clave} className="flex flex-col gap-3">
            {listas[clave].length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  No hay grupos en esta lista.
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSeleccion(new Set(listas[clave].map((g) => g.id)))}
                  >
                    Seleccionar todos
                  </Button>
                </div>
                {listas[clave].map((g) => (
                  <DuplicateGroupCard
                    key={g.id}
                    grupo={g}
                    seleccionado={seleccion.has(g.id)}
                    onToggleSeleccion={toggleSeleccion}
                    onPrevisualizar={previewDupCandidate}
                    onAplicar={async (id) => {
                      const r = await applyDupCandidate(id)
                      toast.success(`Unificado: ${r.rows_moved} registros movidos`)
                      await cargar()
                    }}
                    onDescartar={async (id) => {
                      await dismissDupCandidate(id)
                      toast.success("Descartado: quedo marcado como empresas distintas")
                      await cargar()
                    }}
                    onExcluir={async (candidatoId, empresaId) => {
                      const r = await excludeFromDupCandidate(candidatoId, empresaId)
                      toast.success(
                        r.dismissed
                          ? "Quedo una sola empresa: el grupo se descarto"
                          : `Sacada del grupo. Quedan ${r.remaining} empresas.`,
                      )
                      await cargar()
                    }}
                  />
                ))}
              </>
            )}
          </TabsContent>
        ))}

        <TabsContent value="historial" className="flex flex-col gap-3">
          {historial.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                Todavia no se unifico ninguna empresa.
              </CardContent>
            </Card>
          ) : (
            historial.map((m) => (
              <Card key={m.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-sm">
                      <strong>{m.duplicate_name}</strong> se unifico dentro de <strong>{m.master_name}</strong>
                    </span>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{m.method}</Badge>
                      <span>{m.rows_moved} registros movidos</span>
                      <span>{new Date(m.created_at).toLocaleString("es-AR")}</span>
                    </div>
                    {m.reasoning && <span className="text-xs text-muted-foreground">{m.reasoning}</span>}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      correr(`revert-${m.id}`, async () => {
                        const r = await revertMerge(m.id)
                        return `Se restauro ${r.restored_name} con ${r.rows_restored} registros`
                      })
                    }
                    disabled={ocupado !== null}
                  >
                    {ocupado === `revert-${m.id}` ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Undo2 className="mr-1 h-3 w-3" />
                    )}
                    Deshacer
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {resumen && resumen.fallidos > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-center gap-2 p-4 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span>
              {resumen.fallidos} grupos quedaron con error y no se unificaron. Volve a detectar para reintentarlos.
            </span>
          </CardContent>
        </Card>
      )}
    </main>
  )
}

function Metrica({ etiqueta, valor }: { etiqueta: string; valor: number | string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs text-muted-foreground">{etiqueta}</span>
        <span className="text-2xl font-bold">{typeof valor === "number" ? valor.toLocaleString("es-AR") : valor}</span>
      </CardContent>
    </Card>
  )
}
