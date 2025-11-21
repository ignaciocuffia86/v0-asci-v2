"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search, ExternalLink, Loader2 } from "lucide-react"
import { getPrivateSignals, searchWebSignals } from "@/app/actions/workspace"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"

export function BookmarkSignals({ companyId }: { companyId: string }) {
  const [signals, setSignals] = useState<any[]>([])
  const [query, setQuery] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isSearching, setIsSearching] = useState(false)

  const loadSignals = async () => {
    setIsLoading(true)
    const data = await getPrivateSignals(companyId)
    setSignals(data)
    setIsLoading(false)
  }

  useEffect(() => {
    loadSignals()
  }, [companyId])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setIsSearching(true)
    await searchWebSignals(companyId, query)
    await loadSignals()
    setIsSearching(false)
    setQuery("")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Investigación Web Privada</h2>
          <p className="text-sm text-muted-foreground">
            Busca señales, noticias y casos de éxito específicos. Solo tú verás estos resultados.
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="flex gap-4">
            <Input
              placeholder="Ej: Transformación digital, Implementación SAP, Recortes de presupuesto..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isSearching}
            />
            <Button type="submit" disabled={isSearching || !query.trim()}>
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Buscar en la Web
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Results List */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : signals.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-10 space-y-4 text-center">
              <div className="bg-muted p-3 rounded-full">
                <Search className="h-6 w-6 text-muted-foreground" />
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
