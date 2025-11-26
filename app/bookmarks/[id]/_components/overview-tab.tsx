"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Bookmark, Sparkles, Info, User } from "lucide-react"
import { getBookmarkSmartContext } from "@/app/actions/workspace"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

type SmartContext = {
  filterType: "process" | "technology" | "general"
  totalSignals: number
  detailedSignals: {
    keyword: string
    contactName: string
    contactRole: string
    contactPhoto: string | null
    isCurrent: boolean
  }[]
  logicUsed: string
}

export function BookmarkOverview({ bookmarkId, company }: { bookmarkId: string; company: any }) {
  const [smartContext, setSmartContext] = useState<SmartContext | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchContext = async () => {
      try {
        const data = await getBookmarkSmartContext(bookmarkId)
        setSmartContext(data as SmartContext)
      } catch (error) {
        console.error("Failed to fetch smart context", error)
      } finally {
        setLoading(false)
      }
    }

    if (bookmarkId) {
      fetchContext()
    }
  }, [bookmarkId])

  if (loading) {
    return <div className="p-4 text-center text-muted-foreground">Cargando contexto...</div>
  }

  const getFilterTypeLabel = (filterType: string) => {
    switch (filterType) {
      case "process":
        return "Proceso"
      case "technology":
        return "Tecnología"
      case "general":
        return "General"
      default:
        return "General"
    }
  }

  return (
    <div className="grid gap-6">
      {/* Context Card - Only shown if context exists */}
      {smartContext ? (
        <Card className="bg-blue-50/50 border-blue-100 dark:bg-blue-950/10 dark:border-blue-900">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-blue-800 dark:text-blue-300 flex items-center gap-2">
              <Bookmark className="h-4 w-4" />
              Contexto del Bookmark
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="text-xs uppercase bg-white text-blue-700 border-blue-200 hover:bg-blue-50 h-7"
            >
              Búsqueda {getFilterTypeLabel(smartContext.filterType)}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-white/50 dark:bg-black/20 p-2 rounded border border-blue-100/50 dark:border-blue-900/30">
                <Info className="h-3.5 w-3.5 mt-0.5 text-blue-500" />
                <span>
                  Criterio de Inteligencia: <strong className="text-foreground">{smartContext.logicUsed}</strong>.
                  {smartContext.filterType === "general"
                    ? " Mostrando todas las señales de esta empresa."
                    : " Mostrando señales que coinciden con tus filtros de búsqueda."}
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  Coincidencias en nuestra base ({smartContext.totalSignals})
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {smartContext.detailedSignals.map((signal, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800"
                    >
                      <Avatar className="h-8 w-8 border border-slate-200">
                        <AvatarImage src={signal.contactPhoto || ""} />
                        <AvatarFallback className="bg-slate-100 text-slate-500">
                          <User className="h-4 w-4" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium truncate">{signal.contactName}</p>
                          {!signal.isCurrent && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-slate-500">
                              Alumni
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{signal.contactRole}</p>
                      </div>
                      <Badge variant="secondary" className="text-xs bg-slate-100 text-slate-700 whitespace-nowrap">
                        {signal.keyword}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground text-sm">
            No hay señales disponibles para esta empresa.
          </CardContent>
        </Card>
      )}
    </div>
  )
}
