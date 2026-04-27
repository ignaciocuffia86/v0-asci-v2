"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Building2,
  Loader2,
  Sparkles,
  Search,
  RefreshCw,
  Radar,
  ChevronDown,
  History,
} from "lucide-react"
import { toast } from "sonner"
import type { Implementation } from "./types"
import { TechRadarFindingCard } from "./tech-radar-finding-card"
import { LegacyImplCard } from "./legacy-impl-card"
import { TechRadarFilters, type EvidenceFilter } from "./tech-radar-filters"

interface Props {
  bookmarkId: string
  companyId: string
  companyName: string
}

export function ImplementationsTab({ bookmarkId, companyId, companyName }: Props) {
  const [items, setItems] = useState<Implementation[]>([])
  const [loading, setLoading] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  // Filtros del tab v2
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceFilter>("todos")

  // Histórico colapsado por default
  const [historyOpen, setHistoryOpen] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    void loadItems()
    void checkUserRole()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function checkUserRole() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
      setIsSuperAdmin(profile?.role === "superadmin")
    }
  }

  async function loadItems() {
    setLoading(true)
    try {
      const { data } = await supabase
        .from("company_implementations")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(60)

      setItems((data ?? []) as Implementation[])
    } catch (error) {
      console.error("Error loading implementations:", error)
    } finally {
      setLoading(false)
    }
  }

  async function handleSearch(forceRefresh: boolean) {
    if (forceRefresh) setIsRegenerating(true)
    else setIsSearching(true)

    try {
      const response = await fetch("/api/research/implementations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkId, companyId, companyName, forceRefresh }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error?.message || "Error al ejecutar el Tech Radar")
      }

      const result = await response.json()
      const count = result?.count ?? result?.implementations?.length ?? 0
      toast.success(`${count} hallazgos encontrados${forceRefresh ? " (regenerado)" : ""}`)

      if (Array.isArray(result?.implementations) && result.implementations.length > 0) {
        // El endpoint devuelve los items mas recientes; refrescamos full desde DB
        // para asegurar que incluyamos todos los micro-agentes y sus orderings.
        await loadItems()
      } else {
        await loadItems()
      }
    } catch (error: any) {
      console.error("Error running Tech Radar:", error)
      toast.error(error?.message || "Error al ejecutar el Tech Radar")
    } finally {
      setIsSearching(false)
      setIsRegenerating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!isSuperAdmin) {
      toast.error("Solo administradores pueden eliminar hallazgos")
      return
    }
    try {
      const { error } = await supabase.from("company_implementations").delete().eq("id", id)
      if (error) throw error
      setItems((prev) => prev.filter((it) => it.id !== id))
      toast.success("Hallazgo eliminado")
    } catch {
      toast.error("Error al eliminar")
    }
  }

  // Particion v2 (Tech Radar) vs v1 (legacy histórico)
  const { v2Items, legacyItems } = useMemo(() => {
    const v2: Implementation[] = []
    const legacy: Implementation[] = []
    for (const it of items) {
      if (it.prompt_version === "v2") v2.push(it)
      else legacy.push(it)
    }
    return { v2Items: v2, legacyItems: legacy }
  }, [items])

  // Conteos para los filtros (siempre sobre el universo v2 completo)
  const { agentCounts, evidenceCounts } = useMemo(() => {
    const ac: Record<string, number> = {}
    const ec: Record<EvidenceFilter, number> = {
      todos: v2Items.length,
      directa: 0,
      convergente: 0,
      inferencia: 0,
    }
    for (const it of v2Items) {
      if (it.micro_agent) ac[it.micro_agent] = (ac[it.micro_agent] ?? 0) + 1
      const ev = (it.evidence_level ?? "").toLowerCase()
      if (ev === "directa" || ev === "convergente" || ev === "inferencia") {
        ec[ev as EvidenceFilter] += 1
      }
    }
    return { agentCounts: ac, evidenceCounts: ec }
  }, [v2Items])

  // Items filtrados según selección
  const filteredV2 = useMemo(() => {
    return v2Items.filter((it) => {
      if (selectedAgent && it.micro_agent !== selectedAgent) return false
      if (selectedEvidence !== "todos") {
        const ev = (it.evidence_level ?? "").toLowerCase()
        if (ev !== selectedEvidence) return false
      }
      return true
    })
  }, [v2Items, selectedAgent, selectedEvidence])

  // Orden por nivel de evidencia (directa > convergente > inferencia) y luego fecha desc
  const orderedFiltered = useMemo(() => {
    const evidenceRank: Record<string, number> = {
      directa: 0,
      convergente: 1,
      inferencia: 2,
    }
    return [...filteredV2].sort((a, b) => {
      const ra = evidenceRank[(a.evidence_level ?? "").toLowerCase()] ?? 99
      const rb = evidenceRank[(b.evidence_level ?? "").toLowerCase()] ?? 99
      if (ra !== rb) return ra - rb
      const da = a.published_at ? new Date(a.published_at).getTime() : 0
      const db = b.published_at ? new Date(b.published_at).getTime() : 0
      return db - da
    })
  }, [filteredV2])

  const hasV2 = v2Items.length > 0
  const hasLegacy = legacyItems.length > 0

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Radar className="h-5 w-5 text-primary" />
            Tech Radar — {companyName}
          </h3>
          <p className="text-sm text-muted-foreground">
            Tecnologías, vendors y casos de implementación detectados por nuestros 17 micro-agentes
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && hasV2 ? (
            <Button
              onClick={() => handleSearch(true)}
              disabled={isSearching || isRegenerating}
              variant="outline"
              size="sm"
            >
              {isRegenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Regenerando…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerar
                </>
              )}
            </Button>
          ) : null}
          <Button
            onClick={() => handleSearch(false)}
            disabled={isSearching || isRegenerating || hasV2}
            variant={hasV2 ? "outline" : "default"}
          >
            {isSearching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Escaneando…
              </>
            ) : hasV2 ? (
              <>
                <Sparkles className="mr-2 h-4 w-4 opacity-50" />
                Escaneo completado
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Ejecutar Tech Radar
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Empty state — sin v2 ni legacy */}
      {!hasV2 && !hasLegacy ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Search className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="font-medium">Sin hallazgos todavía</h3>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">
              Ejecutá el Tech Radar para detectar tecnologías y casos en {companyName}
            </p>
            <Button onClick={() => handleSearch(false)} disabled={isSearching}>
              {isSearching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Escaneando…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Ejecutar Tech Radar
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Sección v2: Tech Radar */}
      {hasV2 ? (
        <section className="space-y-4">
          <TechRadarFilters
            agentCounts={agentCounts}
            evidenceCounts={evidenceCounts}
            selectedAgent={selectedAgent}
            selectedEvidence={selectedEvidence}
            onAgentChange={setSelectedAgent}
            onEvidenceChange={setSelectedEvidence}
          />

          {orderedFiltered.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No hay hallazgos que coincidan con los filtros aplicados.
                </p>
                <Button
                  variant="link"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setSelectedAgent(null)
                    setSelectedEvidence("todos")
                  }}
                >
                  Limpiar filtros
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {orderedFiltered.map((finding) => (
                <TechRadarFindingCard
                  key={finding.id}
                  finding={finding}
                  isSuperAdmin={isSuperAdmin}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* Empty v2 pero hay legacy: aviso para correr el Tech Radar */}
      {!hasV2 && hasLegacy ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="py-8 text-center">
            <Radar className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h4 className="font-medium">El Tech Radar nunca corrió para esta empresa</h4>
            <p className="mb-3 mt-1 text-sm text-muted-foreground">
              Hay {legacyItems.length} hallazgo{legacyItems.length === 1 ? "" : "s"} histórico
              {legacyItems.length === 1 ? "" : "s"} más abajo. Ejecutá el escaneo nuevo para
              clasificarlos por micro-agente y detectar tecnologías más recientes.
            </p>
            <Button onClick={() => handleSearch(false)} disabled={isSearching}>
              {isSearching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Escaneando…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Ejecutar Tech Radar
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Sección legacy v1: histórico colapsable */}
      {hasLegacy ? (
        <section>
          <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between gap-2 text-muted-foreground hover:bg-muted/40"
              >
                <span className="inline-flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Histórico ({legacyItems.length} hallazgo{legacyItems.length === 1 ? "" : "s"} previo
                  {legacyItems.length === 1 ? "" : "s"})
                </span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${historyOpen ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <div className="rounded-lg border border-dashed bg-muted/10 p-3">
                <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Building2 className="h-3 w-3" />
                  Hallazgos generados con el motor anterior, sin clasificación por micro-agente.
                </p>
                <div className="space-y-2">
                  {legacyItems.map((item) => (
                    <LegacyImplCard
                      key={item.id}
                      item={item}
                      isSuperAdmin={isSuperAdmin}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>
      ) : null}
    </div>
  )
}
