"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Newspaper,
  Briefcase,
  ExternalLink,
  Calendar,
  Trash2,
  Tag,
  Search,
  Loader2,
  Sparkles,
  RefreshCw,
  Building2,
  Cpu,
  TrendingUp,
  Clock,
  AlertCircle,
} from "lucide-react"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

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

interface Implementation {
  id: string
  title: string
  provider_name: string | null
  technology: string | null
  area: string | null
  summary: string | null
  results: string | null
  evidence_level: string | null
  source_url: string | null
  source_name: string | null
  published_at: string | null
  digest: string | null
  created_at: string
}

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

const AREA_LABELS: Record<string, string> = {
  finanzas: "Finanzas",
  ventas: "Ventas",
  logistica: "Logística",
  rrhh: "RRHH",
  it: "IT",
  ciberseguridad: "Ciberseguridad",
  ecommerce: "eCommerce",
  operaciones: "Operaciones",
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
        .limit(10)

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
            <Briefcase className="h-4 w-4 text-purple-500" />
            Casos de Éxito
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

          {/* Implementations List */}
          {isLoadingImpl ? (
            <div className="p-8 text-center text-muted-foreground">Cargando...</div>
          ) : implementations.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium">Sin casos de éxito registrados</h3>
                <p className="text-sm text-muted-foreground mt-1 mb-4">
                  Usa la búsqueda con AI para encontrar proyectos de vendors
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {implementations.map((item) => (
                <Card key={item.id} className="group hover:bg-muted/30 transition-colors">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {item.source_url ? (
                            <a
                              href={item.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium hover:text-purple-600 hover:underline flex items-center gap-1"
                            >
                              {item.title}
                              <ExternalLink className="h-3.5 w-3.5 opacity-50" />
                            </a>
                          ) : (
                            <h4 className="font-medium">{item.title}</h4>
                          )}
                          {item.evidence_level && (
                            <Badge
                              variant={item.evidence_level === "strong" ? "default" : "secondary"}
                              className="text-[10px]"
                            >
                              {item.evidence_level === "strong"
                                ? "Verificado"
                                : item.evidence_level === "medium"
                                  ? "Probable"
                                  : "Inferido"}
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground flex-wrap">
                          {item.provider_name && (
                            <span className="flex items-center gap-1">
                              <Building2 className="h-3.5 w-3.5" />
                              {item.provider_name}
                            </span>
                          )}
                          {item.technology && (
                            <Badge variant="secondary" className="text-xs">
                              <Cpu className="h-3 w-3 mr-1" />
                              {item.technology}
                            </Badge>
                          )}
                          {item.area && (
                            <Badge variant="outline" className="text-xs">
                              {AREA_LABELS[item.area] || item.area}
                            </Badge>
                          )}
                          {item.published_at && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {new Date(item.published_at).toLocaleDateString("es-AR", {
                                year: "numeric",
                                month: "short",
                              })}
                            </span>
                          )}
                        </div>

                        {item.summary && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{item.summary}</p>}

                        {item.results && (
                          <div className="mt-2 text-sm">
                            <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
                              <TrendingUp className="h-3.5 w-3.5" />
                              {item.results}
                            </span>
                          </div>
                        )}
                      </div>

                      {isSuperAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteImpl(item.id)}
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
      </Tabs>
    </div>
  )
}
