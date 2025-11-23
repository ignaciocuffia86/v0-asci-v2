"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ExternalLink, Loader2, Newspaper, Trophy, Briefcase } from "lucide-react"
import { getPrivateSignals, searchWebSignals } from "@/app/actions/workspace"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"

export function BookmarkSignals({ bookmarkId }: { bookmarkId: string }) {
  const [signals, setSignals] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [activeSearch, setActiveSearch] = useState<string | null>(null)

  const loadSignals = async () => {
    setIsLoading(true)
    const data = await getPrivateSignals(bookmarkId)
    setSignals(data)
    setIsLoading(false)
  }

  useEffect(() => {
    loadSignals()
  }, [bookmarkId])

  const handleSearch = async (category: string) => {
    setActiveSearch(category)
    await searchWebSignals(bookmarkId, category)
    await loadSignals()
    setActiveSearch(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Investigación Web Privada</h2>
          <p className="text-sm text-muted-foreground">
            Busca señales, noticias y casos de éxito específicos para este bookmark.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          className="hover:border-blue-500/50 transition-colors cursor-pointer"
          onClick={() => !activeSearch && handleSearch("news")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Newspaper className="h-4 w-4 text-blue-500" />
              Noticias y Señales
            </CardTitle>
            <CardDescription className="text-xs">
              Busca noticias recientes, cambios corporativos y señales de mercado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              variant="secondary"
              size="sm"
              disabled={activeSearch !== null}
              onClick={(e) => {
                e.stopPropagation()
                handleSearch("news")
              }}
            >
              {activeSearch === "news" ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : "Buscar Noticias"}
            </Button>
          </CardContent>
        </Card>

        <Card
          className="hover:border-amber-500/50 transition-colors cursor-pointer"
          onClick={() => !activeSearch && handleSearch("success_story")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-500" />
              Casos de Éxito
            </CardTitle>
            <CardDescription className="text-xs">
              Encuentra implementaciones tecnológicas previas y resultados.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              variant="secondary"
              size="sm"
              disabled={activeSearch !== null}
              onClick={(e) => {
                e.stopPropagation()
                handleSearch("success_story")
              }}
            >
              {activeSearch === "success_story" ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : "Buscar Casos"}
            </Button>
          </CardContent>
        </Card>

        <Card
          className="hover:border-green-500/50 transition-colors cursor-pointer"
          onClick={() => !activeSearch && handleSearch("job_posting")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-green-500" />
              Job Postings
            </CardTitle>
            <CardDescription className="text-xs">
              Detecta tecnologías y dolores a través de sus búsquedas laborales.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              variant="secondary"
              size="sm"
              disabled={activeSearch !== null}
              onClick={(e) => {
                e.stopPropagation()
                handleSearch("job_posting")
              }}
            >
              {activeSearch === "job_posting" ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : "Buscar Vacantes"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : signals.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-10 space-y-4 text-center">
              <div className="bg-muted p-3 rounded-full">
                <Newspaper className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-medium">Sin señales privadas aún</h3>
                <p className="text-sm text-muted-foreground max-w-sm mt-1">
                  Realiza una búsqueda web para encontrar noticias recientes o casos de éxito.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {signals.map((signal) => (
              <Card key={signal.id} className="overflow-hidden hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start gap-2">
                    <Badge variant="secondary" className="mb-2 capitalize">
                      {signal.signal_type.replace("_", " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(signal.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <CardTitle className="text-base line-clamp-2 leading-tight">{signal.title}</CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  <p className="text-sm text-muted-foreground line-clamp-3 mb-4">{signal.content}</p>
                  <Button variant="outline" size="sm" asChild className="w-full bg-transparent">
                    <Link href={signal.source_url} target="_blank">
                      <ExternalLink className="h-3 w-3 mr-2" />
                      Leer Fuente Original
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
