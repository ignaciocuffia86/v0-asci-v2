"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Newspaper, ExternalLink, Calendar, Trash2, Tag, Search, Loader2, Sparkles } from "lucide-react"
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
  relevance_tags: string[] | null
  created_at: string
}

interface BookmarkNewsProps {
  bookmarkId: string
  companyId: string
  companyName: string
}

const RELEVANCE_TAGS = [
  { value: "expansion", label: "Expansión" },
  { value: "new_product", label: "Nuevo Producto" },
  { value: "partnership", label: "Partnership" },
  { value: "hiring", label: "Contratando" },
  { value: "funding", label: "Financiamiento" },
  { value: "award", label: "Premio/Reconocimiento" },
  { value: "technology", label: "Tecnología" },
  { value: "leadership", label: "Cambio de Liderazgo" },
]

export function BookmarkNews({ bookmarkId, companyId, companyName }: BookmarkNewsProps) {
  const [news, setNews] = useState<CompanyNews[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const hasResults = news.length > 0

  useEffect(() => {
    loadNews()
  }, [bookmarkId, companyId]) // Added companyId to dependencies

  const loadNews = async () => {
    setIsLoading(true)
    setError(null)
    try {
      console.log("[v0] Loading news for bookmark:", bookmarkId, "company:", companyId)

      let { data, error } = await supabase
        .from("company_news")
        .select("*")
        .eq("bookmark_id", bookmarkId)
        .order("published_at", { ascending: false, nullsFirst: false })

      if (error) {
        console.log("[v0] Supabase error loading news:", error)
        throw error
      }

      if (!data || data.length === 0) {
        console.log("[v0] No news by bookmark_id, trying company_id:", companyId)
        const companyResult = await supabase
          .from("company_news")
          .select("*")
          .eq("company_id", companyId)
          .order("published_at", { ascending: false, nullsFirst: false })

        if (companyResult.error) {
          console.log("[v0] Supabase error loading news by company:", companyResult.error)
        } else {
          data = companyResult.data
        }
      }

      console.log("[v0] Loaded news:", data?.length || 0)
      setNews(data || [])
    } catch (error: any) {
      console.error("[v0] Error loading news:", error)
      setError(error.message || "Error al cargar noticias")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSearchNews = async () => {
    setIsSearching(true)
    try {
      const response = await fetch("/api/research/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookmarkId,
          companyId,
          companyName,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || "Error al buscar noticias")
      }

      const result = await response.json()
      toast.success(`Se encontraron ${result.count || 0} noticias`)

      if (result.news && result.news.length > 0) {
        setNews(result.news)
      } else {
        loadNews()
      }
    } catch (error: any) {
      console.error("Error searching news:", error)
      toast.error(error.message || "Error al buscar noticias")
    } finally {
      setIsSearching(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from("company_news").delete().eq("id", id)
      if (error) throw error
      toast.success("Noticia eliminada")
      loadNews()
    } catch (error) {
      toast.error("Error al eliminar")
    }
  }

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Cargando noticias...</div>
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="py-8 text-center">
          <p className="text-destructive mb-4">{error}</p>
          <Button variant="outline" onClick={loadNews}>
            Reintentar
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-blue-600" />
            Noticias de {companyName}
          </h2>
          <p className="text-sm text-muted-foreground">Noticias relevantes para personalizar tu acercamiento</p>
        </div>

        <Button
          onClick={handleSearchNews}
          disabled={isSearching || hasResults}
          variant={hasResults ? "outline" : "default"}
        >
          {isSearching ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Buscando...
            </>
          ) : hasResults ? (
            <>
              <Sparkles className="h-4 w-4 mr-2 opacity-50" />
              Búsqueda completada
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Buscar con AI
            </>
          )}
        </Button>
      </div>

      {/* News List - RSS Style */}
      {news.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium">Sin noticias registradas</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Usa la búsqueda con AI para encontrar noticias recientes sobre {companyName}
            </p>
            <Button onClick={handleSearchNews} disabled={isSearching}>
              {isSearching ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Buscar noticias
                </>
              )}
            </Button>
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
                        {item.relevance_tags && item.relevance_tags.length > 0 && (
                          <div className="flex items-center gap-1 mt-2">
                            <Tag className="h-3 w-3 text-muted-foreground" />
                            {item.relevance_tags.map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                                {RELEVANCE_TAGS.find((t) => t.value === tag)?.label || tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => handleDelete(item.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
