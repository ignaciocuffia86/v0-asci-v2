"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ExternalLink, Loader2, Briefcase, Flame } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

type JobPosting = {
  id: string
  title: string
  location: string | null
  posted_at: string
  apply_url: string | null
  detected_keywords: any[]
  is_recent: boolean
}

export function BookmarkJobPostings({ bookmarkId, countryFilter }: { bookmarkId: string; countryFilter?: string | null }) {
  const [jobPostings, setJobPostings] = useState<JobPosting[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadJobPostings()
  }, [bookmarkId, countryFilter])

  const loadJobPostings = async () => {
    setIsLoading(true)
    try {
      // Get bookmark to retrieve company_id and filter_signal_ids
      const { data: bookmark } = await supabase
        .from("bookmarks")
        .select("company_id, search_context")
        .eq("id", bookmarkId)
        .single()

      if (!bookmark) {
        setJobPostings([])
        setIsLoading(false)
        return
      }

      const filterSignalIds = bookmark.search_context?.filterSignalIds || null

      const isGeneralBookmark = !filterSignalIds || filterSignalIds.length === 0

      // Fetch job postings using RPC
      const { data: jobPostingsData } = await supabase.rpc("get_company_job_postings", {
        p_company_id: bookmark.company_id,
        p_signal_ids: isGeneralBookmark ? null : filterSignalIds,
        p_limit: 100,
        p_location_filter: countryFilter || null,
      })

      setJobPostings(jobPostingsData || [])
    } catch (error) {
      console.error("Error loading job postings:", error)
      setJobPostings([])
    } finally {
      setIsLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return `Hoy, ${date.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`
    if (diffDays === 1) return `Ayer, ${date.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`
    if (diffDays < 7) return date.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })
    if (diffDays < 30) return date.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })
    return date.toLocaleDateString("es-ES", { year: "numeric", month: "short", day: "numeric" })
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (jobPostings.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 space-y-4 text-center">
          <div className="bg-orange-100 dark:bg-orange-950/20 p-4 rounded-full">
            <Flame className="h-8 w-8 text-orange-600 dark:text-orange-500" />
          </div>
          <div>
            <h3 className="font-medium text-lg">No hay búsquedas laborales recientes</h3>
            <p className="text-sm text-muted-foreground max-w-md mt-2">
              Esta empresa no tiene ofertas laborales activas en los últimos 6 meses.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-600" />
            Búsquedas Laborales Recientes
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Ofertas laborales de los últimos 6 meses.</p>
        </div>
        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-sm px-3 py-1">
          {jobPostings.length} {jobPostings.length === 1 ? "búsqueda" : "búsquedas"}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {jobPostings.slice(0, 10).map((jp) => (
          <Card key={jp.id} className="group hover:border-orange-200 hover:shadow-md transition-all">
            <CardHeader className="pb-3">
              <div className="flex items-start gap-3">
                <div className="bg-orange-100 dark:bg-orange-950/30 p-2 rounded-lg shrink-0">
                  <Briefcase className="h-4 w-4 text-orange-600 dark:text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 mb-1">
                    <CardTitle className="text-sm font-semibold leading-tight line-clamp-2 flex-1">
                      {jp.title}
                    </CardTitle>
                    {jp.is_recent && (
                      <Badge
                        variant="outline"
                        className="bg-green-50 text-green-700 border-green-200 text-[10px] px-1.5 py-0 h-5 shrink-0"
                      >
                        Reciente
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDate(jp.posted_at)}{jp.location ? ` · ${jp.location}` : ""}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {/* Detected Keywords */}
              {jp.detected_keywords && jp.detected_keywords.length > 0 && (
                <div>
                  <div className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                    Detectado:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {jp.detected_keywords.slice(0, 3).map((kw: any, idx: number) => (
                      <Badge
                        key={idx}
                        variant="secondary"
                        className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-[10px] px-2 py-0.5"
                      >
                        {kw.signal_name || kw.keyword}
                      </Badge>
                    ))}
                    {jp.detected_keywords.length > 3 && (
                      <Badge variant="outline" className="text-[10px] px-2 py-0.5 text-muted-foreground">
                        +{jp.detected_keywords.length - 3} más
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Apply Button */}
              {jp.apply_url && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/20 dark:hover:bg-orange-950/30 group-hover:bg-orange-100"
                  asChild
                >
                  <a href={jp.apply_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3 mr-1.5" />
                    Ver Oferta Completa
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {jobPostings.length > 10 && (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">
            Mostrando las primeras 10 búsquedas. Total: {jobPostings.length}
          </p>
        </div>
      )}
    </div>
  )
}
