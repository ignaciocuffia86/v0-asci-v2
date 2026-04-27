"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Newspaper,
  ExternalLink,
  Calendar,
  Trash2,
  Tag,
  Search,
  Loader2,
  Sparkles,
  RefreshCw,
  Clock,
  AlertCircle,
  Radar,
  History,
  ChevronDown,
} from "lucide-react"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { TechRadarFilters, type EvidenceFilter } from "./tech-radar-filters"
import { TechRadarFindingCard } from "./tech-radar-finding-card"
import { LegacyImplCard } from "./legacy-impl-card"
import { MICRO_AGENTS } from "@/lib/tech-radar"
import type { Implementation as ImplementationType } from "./types"

interface CompanyNews {
  id: string
  title: string
  summary: string | null
  source_url: string | null
  source_name: string | null
  published_at: string | null
  category: string | null
  digest: string | null
  created_at: string
}

// Usamos el tipo compartido que ya incluye los campos del Tech Radar v2
// (micro_agent, evidence_detail, convergent_sources, supporting_source_urls,
// prompt_version) ademas de los campos legacy.
type Implementation = ImplementationType

interface IntelligenceTabProps {
  bookmarkId: string
  companyId: string
  companyName: string
}

const CATEGORY_LABELS: Record<string, string> = {
  inversion: "Inversión",
  transformacion: "Transformación",
  crecimiento: "Crecimiento",
  ejecutivos: "Ejecutivos",
  desafios: "Desafíos",
  alianzas: "Alianzas",
  regulatorio: "Regulatorio",
  ma: "M&A",
  innovacion: "Innovación",
}

interface CooldownInfo {
  canRefresh: boolean
  lastSearchDate: string | null
  daysUntilRefresh: number
}

export function IntelligenceTab({ bookmarkId, companyId, companyName }: IntelligenceTabProps) {
  const [news, setNews] = useState<CompanyNews[]>([])
  const [implementations, setImplementations] = useState<Implementation[]>([])
  const [isLoadingNews, setIsLoadingNews] = useState(true)
  const [isLoadingImpl, setIsLoadingImpl] = useState(true)
  const [isSearchingNews, setIsSearchingNews] = useState(false)
  const [isSearchingImpl, setIsSearchingImpl] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  
  // Cooldown state
  const [newsCooldown, setNewsCooldown] = useState<CooldownInfo>({ canRefresh: true, lastSearchDate: null, daysUntilRefresh: 0 })
  const [implCooldown, setImplCooldown] = useState<CooldownInfo>({ canRefresh: true, lastSearchDate: null, daysUntilRefresh: 0 })

  const supabase = createClient()

  useEffect(() => {
    loadNews()
    loadImplementations()
    checkUserRole()
  }, [companyId])

  const checkUserRole = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
      setIsSuperAdmin(profile?.role === "superadmin")
    }
  }

  // ── Load News ────────────────────────────────────────────────
  const loadNews = async () => {
    setIsLoadingNews(true)
    try {
      const { data, error } = await supabase
        .from("company_news")
        .select("*")
        .eq("company_id", companyId)
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(15)

      if (error) throw error
      setNews(data || [])

      // Calculate cooldown from last item created_at
      if (data && data.length > 0) {
        const lastCreated = new Date(data[0].created_at)
        const daysSince = (Date.now() - lastCreated.getTime()) / (1000 * 60 * 60 * 24)
        setNewsCooldown({
          canRefresh: isSuperAdmin || daysSince >= 30,
          lastSearchDate: data[0].created_at,
          daysUntilRefresh: daysSince >= 30 ? 0 : Math.ceil(30 - daysSince),
        })
      }
    } catch (error: any) {
      console.error("Error loading news:", error)
    } finally {
      setIsLoadingNews(false)
    }
  }

  // ── Load Implementations ─────────────────────────────────────
  const loadImplementations = async () => {
    setIsLoadingImpl(true)
    try {
      const { data, error } = await supabase
        .from("company_implementations")
        .select("*")
        .eq("company_id", companyId)
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(60)

      if (error) throw error
      setImplementations(data || [])

      // Calculate cooldown
      if (data && data.length > 0) {
        const lastCreated = new Date(data[0].created_at)
        const daysSince = (Date.now() - lastCreated.getTime()) / (1000 * 60 * 60 * 24)
        setImplCooldown({
          canRefresh: isSuperAdmin || daysSince >= 30,
          lastSearchDate: data[0].created_at,
          daysUntilRefresh: daysSince >= 30 ? 0 : Math.ceil(30 - daysSince),
        })
      }
    } catch (error: any) {
      console.error("Error loading implementations:", error)
    } finally {
      setIsLoadingImpl(false)
    }
  }

  // ── Search News ──────────────────────────────────────────────
  const handleSearchNews = async (forceRefresh = false) => {
    setIsSearchingNews(true)
    try {
      const response = await fetch("/api/research/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, companyName, forceRefresh }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || "Error al buscar noticias")
      }

      const result = await response.json()
      toast.success(`Se encontraron ${result.news?.length || 0} noticias`)

      // Update cooldown from response
      setNewsCooldown({
        canRefresh: result.canRefresh ?? isSuperAdmin,
        lastSearchDate: result.lastSearchDate,
        daysUntilRefresh: result.daysUntilRefresh ?? 0,
      })

      await loadNews()
    } catch (error: any) {
      console.error("Error searching news:", error)
      toast.error(error.message || "Error al buscar noticias")
    } finally {
      setIsSearchingNews(false)
    }
  }

  // ── Search Implementations ───────────────────────────────────
  const handleSearchImplementations = async (forceRefresh = false) => {
    setIsSearchingImpl(true)
    try {
      const response = await fetch("/api/research/implementations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkId, forceRefresh }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || "Error al buscar implementaciones")
      }

      const result = await response.json()
      toast.success(`Se encontraron ${result.implementations?.length || 0} casos de éxito`)

      // Update cooldown from response
      setImplCooldown({
        canRefresh: result.canRefresh ?? isSuperAdmin,
        lastSearchDate: result.lastSearchDate,
        daysUntilRefresh: result.daysUntilRefresh ?? 0,
      })

      if (result.implementations) {
        setImplementations(result.implementations)
      } else {
        await loadImplementations()
      }
    } catch (error: any) {
      console.error("Error searching implementations:", error)
      toast.error(error.message || "Error al buscar implementaciones")
    } finally {
      setIsSearchingImpl(false)
    }
  }

  // ── Delete handlers ──────────────────────────────────────────
  const handleDeleteNews = async (id: string) => {
    if (!isSuperAdmin) {
      toast.error("Solo administradores pueden eliminar")
      return
    }
    try {
      await supabase.from("company_news").delete().eq("id", id)
      setNews(news.filter((n) => n.id !== id))
      toast.success("Noticia eliminada")
    } catch {
      toast.error("Error al eliminar")
    }
  }

  const handleDeleteImpl = async (id: string) => {
    if (!isSuperAdmin) {
      toast.error("Solo administradores pueden eliminar")
      return
    }
    try {
      await supabase.from("company_implementations").delete().eq("id", id)
      setImplementations(implementations.filter((i) => i.id !== id))
      toast.success("Caso de éxito eliminado")
    } catch {
      toast.error("Error al eliminar")
    }
  }

  const hasNews = news.length > 0
  const hasImpl = implementations.length > 0

  // Get digest from first item (where we store it)
  const newsDigest = news.find(n => n.digest)?.digest
  const implDigest = implementations.find(i => i.digest)?.digest

  // ── Tech Radar partition + filtros ─────────────────────────────────
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>("todos")
  const [agentFilter, setAgentFilter] = useState<string | null>(null)
  const [legacyOpen, setLegacyOpen] = useState(false)

  const v2Findings = implementations.filter((i) => i.prompt_version === "v2")
  const legacyItems = implementations.filter((i) => i.prompt_version !== "v2")

  // Conteos para los badges del filtro
  const agentCounts: Record<string, number> = {}
  for (const a of MICRO_AGENTS) agentCounts[a] = 0
  for (const f of v2Findings) {
    if (f.micro_agent && agentCounts[f.micro_agent] !== undefined) {
      agentCounts[f.micro_agent]++
    }
  }
  const evidenceCounts: Record<EvidenceFilter, number> = {
    todos: v2Findings.length,
    directa: v2Findings.filter((f) => f.evidence_level === "directa").length,
    convergente: v2Findings.filter((f) => f.evidence_level === "convergente").length,
    inferencia: v2Findings.filter((f) => f.evidence_level === "inferencia").length,
  }

  // Aplicar filtros activos
  const filteredFindings = v2Findings.filter((f) => {
    if (evidenceFilter !== "todos" && f.evidence_level !== evidenceFilter) return false
    if (agentFilter && f.micro_agent !== agentFilter) return false
    return true
  })

  // Ordenar findings: directa primero, despues convergente, despues inferencia.
  // Dentro de cada nivel, mas reciente primero.
  const evidenceRank: Record<string, number> = { directa: 0, convergente: 1, inferencia: 2 }
  const sortedFindings = [...filteredFindings].sort((a, b) => {
    const rA = evidenceRank[a.evidence_level ?? ""] ?? 99
    const rB = evidenceRank[b.evidence_level ?? ""] ?? 99
    if (rA !== rB) return rA - rB
    const dA = a.published_at ?? a.created_at ?? ""
    const dB = b.published_at ?? b.created_at ?? ""
    return dB.localeCompare(dA)
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-500" />
          Inteligencia sobre {companyName}
        </h2>
        <p className="text-sm text-muted-foreground">
          Noticias recientes y casos de éxito de vendors en esta empresa
        </p>
      </div>

      <Tabs defaultValue="news" className="space-y-4">
        <TabsList>
          <TabsTrigger value="news" className="gap-2">
            <Newspaper className="h-4 w-4 text-blue-500" />
            Noticias
            {hasNews && <Badge variant="secondary" className="ml-1">{news.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="implementations" className="gap-2">
            <Radar className="h-4 w-4 text-purple-500" />
            Tech Radar
            {hasImpl && <Badge variant="secondary" className="ml-1">{implementations.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        {/* ── News Tab ──────────────────────────────────────── */}
        <TabsContent value="news" className="space-y-4">
          {/* Digest Card */}
          {newsDigest && (
            <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800">
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  Resumen de Inteligencia
                </CardTitle>
              </CardHeader>
              <CardContent className="py-0 pb-3">
                <p className="text-sm text-muted-foreground">{newsDigest}</p>
              </CardContent>
            </Card>
          )}

          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {newsCooldown.lastSearchDate && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Última búsqueda: {formatDistanceToNow(new Date(newsCooldown.lastSearchDate), { addSuffix: true, locale: es })}
                </span>
              )}
              {!newsCooldown.canRefresh && !isSuperAdmin && (
                <Badge variant="outline" className="text-xs">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Próxima en {newsCooldown.daysUntilRefresh} días
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isSuperAdmin && hasNews && (
                <Button
                  onClick={() => handleSearchNews(true)}
                  disabled={isSearchingNews}
                  variant="outline"
                  size="sm"
                >
                  {isSearchingNews ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  <span className="ml-2 hidden sm:inline">Regenerar</span>
                </Button>
              )}
              <Button
                onClick={() => handleSearchNews(false)}
                disabled={isSearchingNews || (hasNews && !newsCooldown.canRefresh && !isSuperAdmin)}
                variant={hasNews ? "outline" : "default"}
                size="sm"
              >
                {isSearchingNews ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Buscando...
                  </>
                ) : hasNews && !newsCooldown.canRefresh ? (
                  <>
                    <Clock className="h-4 w-4 mr-2 opacity-50" />
                    En cooldown
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    {hasNews ? "Actualizar" : "Buscar con AI"}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* News List */}
          {isLoadingNews ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : news.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium">Sin noticias registradas</h3>
                <p className="text-sm text-muted-foreground mt-1 mb-4">
                  Usa la búsqueda con AI para encontrar noticias recientes
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {news.map((item) => (
                <Card key={item.id} className="hover:bg-muted/30 transition-colors">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-3">
                          <div className="h-10 w-10 rounded-lg bg-blue-100 dark:bg-blue-950 flex items-center justify-center shrink-0">
                            <Newspaper className="h-5 w-5 text-blue-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-sm leading-tight">
                              {item.source_url ? (
                                <a
                                  href={item.source_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:text-blue-600 hover:underline"
                                >
                                  {item.title}
                                  <ExternalLink className="h-3 w-3 inline ml-1 opacity-50" />
                                </a>
                              ) : (
                                item.title
                              )}
                            </h3>
                            {item.summary && (
                              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.summary}</p>
                            )}
                            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                              {item.source_name && (
                                <span className="flex items-center gap-1">
                                  <ExternalLink className="h-3 w-3" />
                                  {item.source_name}
                                </span>
                              )}
                              {item.published_at && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {formatDistanceToNow(new Date(item.published_at), { addSuffix: true, locale: es })}
                                </span>
                              )}
                            </div>
                            {item.category && (
                              <div className="flex items-center gap-1 mt-2">
                                <Tag className="h-3 w-3 text-muted-foreground" />
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {CATEGORY_LABELS[item.category] || item.category}
                                </Badge>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {isSuperAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => handleDeleteNews(item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Implementations Tab ───────────────────────────── */}
        <TabsContent value="implementations" className="space-y-4">
          {/* Digest Card */}
          {implDigest && (
            <Card className="border-purple-200 bg-purple-50/50 dark:bg-purple-950/20 dark:border-purple-800">
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                  Resumen de Competencia
                </CardTitle>
              </CardHeader>
              <CardContent className="py-0 pb-3">
                <p className="text-sm text-muted-foreground">{implDigest}</p>
              </CardContent>
            </Card>
          )}

          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {implCooldown.lastSearchDate && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Última búsqueda: {formatDistanceToNow(new Date(implCooldown.lastSearchDate), { addSuffix: true, locale: es })}
                </span>
              )}
              {!implCooldown.canRefresh && !isSuperAdmin && (
                <Badge variant="outline" className="text-xs">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Próxima en {implCooldown.daysUntilRefresh} días
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isSuperAdmin && hasImpl && (
                <Button
                  onClick={() => handleSearchImplementations(true)}
                  disabled={isSearchingImpl}
                  variant="outline"
                  size="sm"
                >
                  {isSearchingImpl ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  <span className="ml-2 hidden sm:inline">Regenerar</span>
                </Button>
              )}
              <Button
                onClick={() => handleSearchImplementations(false)}
                disabled={isSearchingImpl || (hasImpl && !implCooldown.canRefresh && !isSuperAdmin)}
                variant={hasImpl ? "outline" : "default"}
                size="sm"
              >
                {isSearchingImpl ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Buscando...
                  </>
                ) : hasImpl && !implCooldown.canRefresh ? (
                  <>
                    <Clock className="h-4 w-4 mr-2 opacity-50" />
                    En cooldown
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    {hasImpl ? "Actualizar" : "Buscar con AI"}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Tech Radar findings (v2) + Histórico (v1) */}
          {isLoadingImpl ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : implementations.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Radar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium">Sin hallazgos del Tech Radar</h3>
                <p className="text-sm text-muted-foreground mt-1 mb-4">
                  Ejecutá el Tech Radar con AI para descubrir tecnologías que usa esta empresa
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* Sección Tech Radar v2 */}
              {v2Findings.length > 0 && (
                <div className="space-y-4">
                  <TechRadarFilters
                    agentCounts={agentCounts}
                    evidenceCounts={evidenceCounts}
                    selectedAgent={agentFilter}
                    selectedEvidence={evidenceFilter}
                    onAgentChange={setAgentFilter}
                    onEvidenceChange={setEvidenceFilter}
                  />

                  {sortedFindings.length === 0 ? (
                    <Card className="border-dashed">
                      <CardContent className="py-8 text-center text-sm text-muted-foreground">
                        Ningún hallazgo coincide con los filtros activos.
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-3">
                      {sortedFindings.map((finding) => (
                        <TechRadarFindingCard
                          key={finding.id}
                          finding={finding}
                          isSuperAdmin={isSuperAdmin}
                          onDelete={handleDeleteImpl}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Caso especial: solo hay legacy, todavía no se corrió Tech Radar */}
              {v2Findings.length === 0 && legacyItems.length > 0 && (
                <Card className="border-dashed border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
                  <CardContent className="py-6 text-center">
                    <Radar className="h-10 w-10 mx-auto text-amber-600 mb-3" />
                    <h3 className="font-medium">Tech Radar no ejecutado</h3>
                    <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                      Hay registros del motor anterior debajo. Ejecutá el Tech Radar para obtener
                      hallazgos clasificados por área tecnológica con nivel de evidencia.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Sección Histórico (v1) — colapsable */}
              {legacyItems.length > 0 && (
                <Collapsible open={legacyOpen} onOpenChange={setLegacyOpen}>
                  <div className="flex items-center justify-between border-t pt-4">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <History className="h-4 w-4" />
                      <span>Histórico ({legacyItems.length})</span>
                      <span className="text-xs">— generados con el motor anterior</span>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="gap-1">
                        {legacyOpen ? "Ocultar" : "Mostrar"}
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${legacyOpen ? "rotate-180" : ""}`}
                        />
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent className="space-y-3 pt-4">
                    {legacyItems.map((item) => (
                      <LegacyImplCard
                        key={item.id}
                        item={item}
                        isSuperAdmin={isSuperAdmin}
                        onDelete={handleDeleteImpl}
                      />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
