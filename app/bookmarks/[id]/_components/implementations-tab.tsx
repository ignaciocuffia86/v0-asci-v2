"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, Trash2, Building2, Cpu, TrendingUp, Calendar, Loader2, Sparkles, Search } from "lucide-react"
import { toast } from "sonner"

interface Implementation {
  id: string
  title: string
  provider_name: string | null
  technology: string | null
  summary: string | null
  results: string | null
  source_url: string | null
  source_name: string | null
  published_at: string | null
  created_at: string
}

interface ImplementationsTabProps {
  bookmarkId: string
  companyId: string
  companyName: string
}

export function ImplementationsTab({ bookmarkId, companyId, companyName }: ImplementationsTabProps) {
  const [implementations, setImplementations] = useState<Implementation[]>([])
  const [loading, setLoading] = useState(true)
  const [isSearching, setIsSearching] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    loadImplementations()
  }, [bookmarkId])

  async function loadImplementations() {
    setLoading(true)
    try {
      const { data } = await supabase
        .from("company_implementations")
        .select("*")
        .eq("bookmark_id", bookmarkId)
        .order("published_at", { ascending: false, nullsFirst: false })

      setImplementations(data || [])
    } catch (error) {
      console.error("Error loading implementations:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearchImplementations = async () => {
    setIsSearching(true)
    try {
      const response = await fetch("/api/research/implementations", {
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
        throw new Error(error.message || "Error al buscar implementaciones")
      }

      const result = await response.json()
      toast.success(`Se encontraron ${result.count || 0} implementaciones`)
      loadImplementations()
    } catch (error: any) {
      console.error("Error searching implementations:", error)
      toast.error(error.message || "Error al buscar implementaciones")
    } finally {
      setIsSearching(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      const { error } = await supabase.from("company_implementations").delete().eq("id", id)

      if (error) throw error

      setImplementations(implementations.filter((impl) => impl.id !== id))
      toast.success("Implementación eliminada")
    } catch (error) {
      toast.error("Error al eliminar")
    }
  }

  const hasResults = implementations.length > 0

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-purple-600" />
            Implementaciones en {companyName}
          </h3>
          <p className="text-sm text-muted-foreground">Proyectos realizados por otros proveedores en esta empresa</p>
        </div>
        <Button
          onClick={handleSearchImplementations}
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

      {implementations.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium">Sin implementaciones registradas</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Usa la búsqueda con AI para encontrar casos de éxito y proyectos en {companyName}
            </p>
            <Button onClick={handleSearchImplementations} disabled={isSearching}>
              {isSearching ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Buscar implementaciones
                </>
              )}
            </Button>
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
                      {item.source_name && <span className="text-xs opacity-70">vía {item.source_name}</span>}
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

                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 text-muted-foreground hover:text-destructive"
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
