"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import useSWR from "swr"
import { createClient } from "@/lib/supabase/client"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SignalCardAvatar } from "@/components/signal-card-avatar"
import {
  Building2,
  ExternalLink,
  Linkedin,
  Bookmark,
  Mail,
  Phone,
  CheckCircle2,
  LinkedinIcon,
  Flame,
  Briefcase,
  Loader2,
  FolderOpen,
  BookmarkCheck,
  SlidersHorizontal,
} from "lucide-react"
import {
  canonicalizeSignals,
  countPeople,
  groupBySignal,
  type CanonicalSignal,
  type SignalRowInput,
} from "@/lib/shared/canonical-signals"
import { bookmarkCompany, unbookmarkCompany, checkBookmarkWithContext } from "@/app/actions/bookmarks"
import { useToast } from "@/hooks/use-toast"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useRouter } from "next/navigation"
import { BookmarkScopeEditor } from "@/components/bookmarks/bookmark-scope-editor"
import type React from "react"

type CompanyDetails = {
  id: string
  name: string
  linkedin_url: string | null
  website: string | null
  industry: string | null
  country: string | null
  logo_url: string | null
}

type Signal = {
  id: string
  signal_type: string
  keyword_matched: string
  source_field: string
  snippet: string
  is_current_employee: boolean
  company_id: string
  contact_id: string | null
  job_posting_id: string | null
  signal_id: string
  source_url: string | null
  created_at?: string | null
  process?: string | null
  contact: {
    id?: string
    name: string
    full_name: string
    headline: string
    linkedin_url?: string
    profile_picture_url: string | null
    current_position_title: string | null
    current_company_id: string | null
    current_company: {
      name: string
    } | null
    previous_positions: any[] | null
    email1?: string | null
    email1_type?: string | null
    email1_status?: string | null
    email2?: string | null
    email2_type?: string | null
    email2_status?: string | null
    phone1?: string | null
    phone1_type?: string | null
    phone2?: string | null
    phone2_type?: string | null
    company_id?: string
    created_at?: string | null
    updated_at?: string | null
  } | null
  job_posting?: {
    id: string
    title: string
    posted_at: string
    apply_url: string | null
  } | null
  signal_name: string
}

type Contact = {
  id: string
  full_name: string
  headline: string
  linkedin_url: string
  profile_picture_url: string | null
  signal_count: number
  current_position_title: string | null
  email1: string | null
  email1_type: string | null
  email1_status: string | null
  email2: string | null
  email2_type: string | null
  email2_status: string | null
  phone1: string | null
  phone1_type: string | null
  phone2: string | null
  phone2_type: string | null
}

type JobPosting = {
  id: string
  title: string
  posted_at: string
  apply_url: string | null
  detected_keywords: any[]
  is_recent: boolean
}

type DrawerData = {
  company: CompanyDetails
  dictionary_names: string[]
  signals: Signal[]
  contacts: Contact[]
  job_postings: any[]
  /** Total de vacantes en la ventana de 6 meses, sin el cupo del detalle. Ausente hasta que se aplique la migración. */
  job_postings_window_count?: number
  alumni_signals: Signal[]
}

/** Fila de `signals` tal como la devuelve el RPC, traducida a la unidad canónica. */
function toSignalInput(signal: Signal): SignalRowInput {
  return {
    rowId: signal.id,
    signalType: signal.signal_type,
    signalId: signal.signal_id ?? null,
    // El RPC ya resuelve el nombre de diccionario en `signal_name`. Agrupar por
    // `keyword_matched` es lo que hacía que "Microsoft Intune" e "Intune"
    // aparecieran como dos señales distintas de la misma entrada.
    label: signal.signal_name ?? null,
    keyword: signal.keyword_matched ?? null,
    sourceField: signal.source_field ?? null,
    snippet: signal.snippet ?? null,
    sourceUrl: signal.source_url ?? null,
    occurredAt: signal.created_at ?? null,
    companyId: signal.company_id ?? null,
    jobPostingId: signal.job_posting_id ?? null,
    person: signal.contact?.id
      ? {
          contactId: signal.contact.id,
          fullName: signal.contact.full_name ?? null,
          linkedinUrl: signal.contact.linkedin_url ?? null,
          email: signal.contact.email1 ?? signal.contact.email2 ?? null,
          updatedAt: signal.contact.updated_at ?? signal.contact.created_at ?? null,
        }
      : null,
  }
}

type CompanyDrawerProps = {
  companyId: string
  isOpen: boolean
  onClose: () => void
  filterSignalIds?: string[]
  filterType?: "process" | "technology"
  /**
   * Contador de búsquedas del listado de resultados (histórico completo, sin ventana de fecha).
   * El drawer solo muestra las publicadas en los últimos 6 meses, así que sirve para explicar
   * la diferencia en vez de dejar al usuario con dos números que no cierran.
   */
  jobPostingsTotal?: number
}

export function CompanyDrawer({
  companyId,
  isOpen,
  onClose,
  filterSignalIds,
  filterType,
  jobPostingsTotal,
}: CompanyDrawerProps) {
  const [isBookmarked, setIsBookmarked] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [bookmarkState, setBookmarkState] = useState<{
    hasExactMatch: boolean
    exactMatchId?: string
    otherBookmarks: Array<{ id: string; context: string; created_at: string }>
    isLoading: boolean
    isSaving: boolean
  }>({
    hasExactMatch: false,
    otherBookmarks: [],
    isLoading: true,
    isSaving: false,
  })

  const supabase = createClient()
  const { toast } = useToast()
  const router = useRouter()

  const cacheKey = useMemo(() => {
    if (!isOpen || !companyId) return null
    const filterKey = filterSignalIds?.sort().join(",") || "none"
    return `drawer-${companyId}-${filterType || "none"}-${filterKey}`
  }, [companyId, isOpen, filterSignalIds, filterType])

  const fetcher = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_company_drawer_data", {
      p_company_id: companyId,
      p_filter_signal_ids: filterSignalIds || null,
      p_filter_type: filterType || null,
    })

    if (error) {
      console.error("Error fetching drawer data:", error)
      throw error
    }

    return data as DrawerData
  }, [companyId, filterSignalIds, filterType, supabase])

  const {
    data: drawerData,
    error,
    isLoading,
  } = useSWR(cacheKey, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000, // 1 minute deduplication
    keepPreviousData: true,
  })

  const company = drawerData?.company || null
  const signals = drawerData?.signals || []
  const contacts = drawerData?.contacts || []
  const dictionaryNames = drawerData?.dictionary_names || []
  const alumniSignalsData = drawerData?.alumni_signals || []

  const jobPostings = useMemo(() => {
    if (!drawerData?.job_postings) return []

    const oneMonthAgo = new Date()
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1)

    // Group by job posting ID and collect all keywords
    const grouped = drawerData.job_postings.reduce((acc: Record<string, JobPosting>, jp: any) => {
      const postedDate = new Date(jp.posted_at)

      if (!acc[jp.id]) {
        acc[jp.id] = {
          id: jp.id,
          title: jp.title,
          posted_at: jp.posted_at,
          apply_url: jp.apply_url,
          detected_keywords: [],
          is_recent: postedDate >= oneMonthAgo,
        }
      }

      // Una vacante que dice "Intune" y "Microsoft Intune" menciona UNA
      // tecnología, no dos: se agrupa por término de diccionario.
      const label = jp.signal_name || jp.keyword_matched
      if (!acc[jp.id].detected_keywords.some((kw: any) => kw.signal_name === label)) {
        acc[jp.id].detected_keywords.push({
          keyword: jp.keyword_matched,
          signal_name: label,
          snippet: jp.snippet,
        })
      }

      return acc
    }, {})

    return Object.values(grouped).sort((a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime())
  }, [drawerData?.job_postings])

  // ── Unidad canónica de señal ──
  // Todo lo que se cuenta o se lista abajo sale de acá: una señal es
  // (entrada de diccionario, persona resuelta), y las menciones en distintos
  // campos —o en dos filas de `contacts` del mismo perfil— son evidencia de esa
  // única señal.
  const signalUnits = useMemo(() => canonicalizeSignals(signals, toSignalInput), [signals])
  const currentEmployeeUnits = useMemo(
    () => signalUnits.filter((unit) => unit.person && unit.mentions.some((mention) => mention.row.is_current_employee)),
    [signalUnits],
  )
  const alumniUnits = useMemo(() => canonicalizeSignals(alumniSignalsData, toSignalInput), [alumniSignalsData])
  const tagCloud = useMemo(() => groupBySignal(signalUnits).slice(0, 10), [signalUnits])

  // Tres números distintos, y conviene no confundirlos:
  // - historicJobPostings: lo que cuenta el listado de resultados (histórico completo, sin ventana)
  // - windowJobPostings: las publicadas en los últimos 6 meses (lo que mide esta solapa)
  // - jobPostings.length: las que realmente llegaron, que el RPC capea en las 100 más recientes
  const windowJobPostings = drawerData?.job_postings_window_count ?? jobPostings.length
  const historicJobPostings = Math.max(jobPostingsTotal ?? 0, windowJobPostings)
  const olderJobPostings = historicJobPostings - windowJobPostings
  const truncatedJobPostings = windowJobPostings - jobPostings.length
  const showJobPostingsTab = jobPostings.length > 0 || historicJobPostings > 0

  useEffect(() => {
    if (isOpen && companyId) {
      checkBookmarkStatus()
    }
  }, [companyId, isOpen, filterSignalIds, filterType])

  const checkBookmarkStatus = async () => {
    setBookmarkState((prev) => ({ ...prev, isLoading: true }))

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      setUserId(user.id)
      const result = await checkBookmarkWithContext(user.id, companyId, filterSignalIds, filterType)

      setBookmarkState({
        hasExactMatch: result.hasExactMatch,
        exactMatchId: result.exactMatchId,
        otherBookmarks: result.otherBookmarks,
        isLoading: false,
        isSaving: false,
      })
    } else {
      setBookmarkState((prev) => ({ ...prev, isLoading: false, isSaving: false }))
    }
  }

  const handleBookmark = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const wasBookmarked = bookmarkState.hasExactMatch
    const previousState = { ...bookmarkState }

    // Mostrar estado de loading
    setBookmarkState((prev) => ({
      ...prev,
      isSaving: true,
    }))

    try {
      if (wasBookmarked && bookmarkState.exactMatchId) {
        // Eliminar solo el bookmark específico de este contexto
        const result = await unbookmarkCompany(user.id, companyId, bookmarkState.exactMatchId)

        if (result.success) {
          setBookmarkState((prev) => ({
            ...prev,
            hasExactMatch: false,
            exactMatchId: undefined,
            isSaving: false,
          }))
        } else {
          setBookmarkState({ ...previousState, isSaving: false })
        }
      } else {
        let contextNames: string[] = []

        if (dictionaryNames.length > 0) {
          contextNames = dictionaryNames
        } else {
          contextNames = signals
            .filter((s) => filterSignalIds?.includes(s.signal_id))
            .map((s) => s.keyword_matched)
            .filter((value, index, self) => self.indexOf(value) === index)
        }

        const filtersUsed = {
          technology: filterType === "technology" ? contextNames : [],
          process: filterType === "process" ? contextNames : [],
        }

        const result = await bookmarkCompany(user.id, companyId, {
          filterSignalIds: filterSignalIds || [],
          filterType: filterType || "generic",
          filtersUsed,
        })

        if (result.success && result.bookmarkId) {
          setBookmarkState((prev) => ({
            ...prev,
            hasExactMatch: true,
            exactMatchId: result.bookmarkId,
            isSaving: false,
          }))
        } else {
          setBookmarkState({ ...previousState, isSaving: false })
        }
      }
    } catch (error) {
      console.error("Error en handleBookmark:", error)
      setBookmarkState({ ...previousState, isSaving: false })
    }
  }

  const goToBookmark = (bookmarkId: string) => {
    onClose()
    router.push(`/bookmarks/${bookmarkId}`)
  }

  const getJobPostingTags = () => {
    const tagCounts = new Map<string, Set<string>>()
    jobPostings.forEach((jp) => {
      jp.detected_keywords?.forEach((kw: any) => {
        const keyword = kw.signal_name || kw.keyword
        if (!tagCounts.has(keyword)) {
          tagCounts.set(keyword, new Set())
        }
        tagCounts.get(keyword)!.add(jp.id)
      })
    })
    return Array.from(tagCounts.entries())
      .map(([keyword, jobPostingSet]) => [keyword, jobPostingSet.size] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }

  if (isLoading && !drawerData) {
    return (
      <Sheet open={isOpen} onOpenChange={onClose}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto bg-white dark:bg-slate-950 p-0 flex flex-col h-full items-center justify-center">
          <SheetTitle className="sr-only">Cargando empresa</SheetTitle>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-muted-foreground">Cargando información...</p>
        </SheetContent>
      </Sheet>
    )
  }

  if (!company) return null

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto bg-white dark:bg-slate-900 p-0 flex flex-col h-full" data-onboarding="company-drawer">
        {isLoading && drawerData && (
          <div className="absolute top-4 right-14 z-10">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        <div className="p-6 pb-0">
          <SheetHeader className="space-y-4 pb-6">
            <div className="flex items-start gap-6">
              <div className="w-24 h-24 bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl flex items-center justify-center flex-shrink-0 border border-primary/10 shadow-sm">
                {company.logo_url ? (
                  <img
                    src={company.logo_url || "/placeholder.svg"}
                    alt={company.name}
                    className="w-full h-full object-contain rounded-xl p-2"
                  />
                ) : (
                  <Building2 className="h-10 w-10 text-primary/60" />
                )}
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <SheetTitle className="text-3xl font-bold text-slate-900 dark:text-slate-100">
                    {company.name}
                  </SheetTitle>
                  <SheetDescription className="mt-2 text-base flex items-center gap-2">
                    {company.industry && (
                      <span className="font-medium text-slate-700 dark:text-slate-300">{company.industry}</span>
                    )}
                    {company.country && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-600 dark:text-slate-400">{company.country}</span>
                      </>
                    )}
                  </SheetDescription>
                </div>

                <div className="flex items-center gap-3">
                  {company.website && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 bg-white dark:bg-slate-900 hover:bg-slate-50"
                      asChild
                    >
                      <a href={company.website} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-2 text-slate-500" />
                        Sitio Web
                      </a>
                    </Button>
                  )}
                  {company.linkedin_url && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 bg-white dark:bg-slate-900 hover:bg-slate-50"
                      asChild
                    >
                      <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer">
                        <Linkedin className="h-4 w-4 mr-2 text-[#0077b5]" />
                        LinkedIn
                      </a>
                    </Button>
                  )}

                  <div className="flex items-center gap-2 ml-auto">
                    {bookmarkState.otherBookmarks.length > 0 && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-9 text-muted-foreground hover:text-foreground"
                              onClick={() => goToBookmark(bookmarkState.otherBookmarks[0].id)}
                            >
                              <FolderOpen className="h-4 w-4 mr-1" />+{bookmarkState.otherBookmarks.length}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <p className="font-medium mb-1">Otros workspaces guardados:</p>
                            <ul className="text-xs space-y-1">
                              {bookmarkState.otherBookmarks.map((b) => (
                                <li key={b.id} className="flex items-center gap-1">
                                  <span className="text-muted-foreground">•</span>
                                  {b.context}
                                </li>
                              ))}
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}

                    {bookmarkState.isSaving ? (
                      <Button disabled variant="outline" size="sm">
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Guardando...
                      </Button>
                    ) : bookmarkState.hasExactMatch && bookmarkState.exactMatchId ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => goToBookmark(bookmarkState.exactMatchId!)}
                          className="gap-2"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Ir al Workspace
                        </Button>
                        {userId && bookmarkState.exactMatchId && (
                          <BookmarkScopeEditor
                            bookmarkId={bookmarkState.exactMatchId}
                            userId={userId}
                            companyId={companyId}
                            companyName={company?.name || ""}
                            currentScope={{
                              filterSignalIds: filterSignalIds || [],
                              filterType: filterType || null,
                            }}
                            onScopeUpdated={() => {
                              checkBookmarkStatus()
                            }}
                            trigger={
                              <Button variant="outline" size="sm" className="gap-1">
                                <SlidersHorizontal className="h-3.5 w-3.5" />
                                Scope
                              </Button>
                            }
                          />
                        )}
                        <Button variant="outline" size="sm" onClick={handleBookmark}>
                          <BookmarkCheck className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <Button variant="outline" size="sm" onClick={handleBookmark} data-onboarding="bookmark-button">
                        <Bookmark className="h-4 w-4 mr-2" />
                        Guardar
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                    Tecnologías y Procesos Principales
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {tagCloud.map((group) => (
                      <Badge
                        key={group.signalKey}
                        variant="secondary"
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-0 px-2.5 py-1 text-xs"
                        title={`${group.people} ${group.people === 1 ? "persona" : "personas"}${group.jobPostings ? ` · ${group.jobPostings} ${group.jobPostings === 1 ? "vacante" : "vacantes"}` : ""}`}
                      >
                        {group.label}
                        <span className="ml-1.5 text-slate-400 font-normal">{group.entities}</span>
                      </Badge>
                    ))}
                  </div>

                  {jobPostings.length > 0 && getJobPostingTags().length > 0 && (
                    <div className="mt-4 pt-4 border-t border-orange-100 dark:border-orange-900/30">
                      <h4 className="text-xs font-medium text-orange-600 dark:text-orange-500 mb-3 uppercase tracking-wider flex items-center gap-1.5">
                        <Flame className="h-3.5 w-3.5" />
                        Ahora Buscando
                        <span className="normal-case tracking-normal text-muted-foreground font-normal">
                          · últimos 6 meses
                        </span>
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {getJobPostingTags().map(([keyword, count]) => (
                          <Badge
                            key={keyword}
                            variant="secondary"
                            className="bg-orange-50 hover:bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400 border border-orange-200 dark:border-orange-900/50 px-2.5 py-1 text-xs"
                          >
                            <Flame className="h-3 w-3 mr-1" />
                            {keyword}
                            <span className="ml-1.5 text-orange-400 dark:text-orange-600 font-normal">{count}</span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {filterType && (
                  <div className="pt-1">
                    <Badge
                      variant="outline"
                      className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 shadow-sm"
                    >
                      Filtrado por {filterType === "process" ? "Proceso" : "Tecnología"}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          </SheetHeader>
        </div>

        <Tabs defaultValue="current" className="flex-1 flex flex-col">
          <div className="px-6 border-b bg-slate-50/50 dark:bg-slate-900/50">
            <TabsList className="w-full justify-start h-12 bg-transparent p-0 space-x-8">
              <TabsTrigger
                value="current"
                className="h-full rounded-none border-b-2 border-transparent px-0 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-medium"
              >
                Empleados Actuales
                <Badge
                  variant="secondary"
                  className="ml-2 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs hover:bg-blue-200"
                >
                  {countPeople(currentEmployeeUnits)}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value="alumni"
                className="h-full rounded-none border-b-2 border-transparent px-0 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-medium"
              >
                Alumni (Ex-empleados)
                <Badge
                  variant="secondary"
                  className="ml-2 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs hover:bg-blue-200"
                >
                  {countPeople(alumniUnits)}
                </Badge>
              </TabsTrigger>
              {showJobPostingsTab && (
                <TabsTrigger
                  value="jobpostings"
                  className="h-full rounded-none border-b-2 border-transparent px-0 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none font-medium"
                >
                  <Flame className="h-4 w-4 mr-1.5 text-orange-500" />
                  Búsquedas Laborales
                  <Badge
                    variant="secondary"
                    className="ml-2 bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300 text-xs hover:bg-orange-200"
                  >
                    {windowJobPostings}
                  </Badge>
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-50/30 dark:bg-slate-900">
            <TabsContent value="current" className="p-6 space-y-4 m-0">
              {currentEmployeeUnits.length > 0 ? (
                currentEmployeeUnits.map((unit) => (
                  <SignalCard key={`${unit.key}-current`} unit={unit} company={company} />
                ))
              ) : (
                <div className="text-center py-12 text-muted-foreground bg-white dark:bg-slate-900 rounded-xl border border-dashed">
                  No se encontraron empleados actuales con estas señales.
                </div>
              )}
            </TabsContent>

            <TabsContent value="alumni" className="p-6 space-y-4 m-0">
              {alumniUnits.length > 0 ? (
                alumniUnits.map((unit) => (
                  <SignalCard key={`${unit.key}-alumni`} unit={unit} company={company} />
                ))
              ) : (
                <div className="text-center py-12 text-muted-foreground bg-white dark:bg-slate-900 rounded-xl border border-dashed">
                  No se encontraron ex-empleados con estas señales.
                </div>
              )}
            </TabsContent>

            {showJobPostingsTab && (
              <TabsContent value="jobpostings" className="p-6 space-y-4 m-0">
                <p className="text-xs text-muted-foreground">
                  Búsquedas publicadas en los <span className="font-medium">últimos 6 meses</span> con señales
                  detectadas.
                  {olderJobPostings > 0 && (
                    <>
                      {" "}
                      El contador del listado ({historicJobPostings}) incluye todo el histórico:{" "}
                      {olderJobPostings === 1
                        ? "1 búsqueda es más antigua"
                        : `${olderJobPostings} búsquedas son más antiguas`}{" "}
                      y no se muestra acá.
                    </>
                  )}
                  {truncatedJobPostings > 0 && (
                    <>
                      {" "}
                      Se listan las <span className="font-medium">{jobPostings.length} más recientes</span> de las{" "}
                      {windowJobPostings} de la ventana.
                    </>
                  )}
                </p>

                {jobPostings.length > 0 ? (
                  jobPostings.map((jp) => <JobPostingCard key={jp.id} jobPosting={jp} />)
                ) : (
                  <div className="text-center py-12 text-muted-foreground bg-white dark:bg-slate-900 rounded-xl border border-dashed">
                    Sin búsquedas publicadas en los últimos 6 meses.
                    {historicJobPostings > 0 && (
                      <>
                        <br />
                        Las {historicJobPostings} del listado corresponden a vacantes más antiguas.
                      </>
                    )}
                  </div>
                )}
              </TabsContent>
            )}
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

function highlightKeyword(text: string, keyword: string): React.ReactNode {
  if (!keyword || !text) return <>...{text}...</>

  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
  const parts = text.split(regex)

  return (
    <>
      ...
      {parts.map((part, index) =>
        regex.test(part) ? (
          <span key={index} className="bg-primary/20 text-primary font-medium px-0.5 rounded not-italic">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
      ...
    </>
  )
}

/**
 * Una señal de una persona, con TODAS sus menciones plegadas.
 *
 * Antes era una card por fila de `signals`, y por eso la misma persona podía
 * aparecer dos veces con el mismo término. Ahora la card es la unidad canónica
 * —(persona, entrada de diccionario)— y cada mención es una cita más abajo.
 */
const SignalCard = ({ unit, company }: { unit: CanonicalSignal<Signal>; company: CompanyDetails }) => {
  const { toast } = useToast()
  // Perfil a mostrar: la fila de `contacts` más fresca de esa persona. Cuando el
  // mismo perfil está duplicado, la vieja trae el cargo desactualizado.
  const signal = unit.representative

  const formatSourceField = (field: string) => {
    const map: Record<string, string> = {
      about: "Acerca de",
      current_position: "Posición Actual",
      current_position_description: "Descripción del Puesto Actual",
      headline: "Titular",
      previous_position: "Posición Anterior",
      job_description: "Descripción del Puesto",
      job_title: "Título del Puesto",
      summary: "Resumen",
      experience: "Experiencia",
      skills: "Habilidades",
    }
    return map[field] || field
  }

  /** Dónde se dijo: "en Posición Actual en X", "Titular", "Posición Anterior en Y". */
  const mentionContext = (mention: (typeof unit.mentions)[number]) => {
    const row = mention.row
    if (row.contact?.previous_positions?.some((pos: any) => pos.company_id === company.id)) {
      return `en Posición Anterior en ${company.name}`
    }
    if (mention.sourceField === "current_position" || mention.sourceField === "current_position_description") {
      return `en Posición Actual en ${company.name}`
    }
    return formatSourceField(mention.sourceField || "")
  }

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden transition-all hover:shadow-md bg-white dark:bg-slate-900">
      <div className="p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex gap-4 w-full">
            <SignalCardAvatar imageUrl={signal.contact?.profile_picture_url} fullName={signal.contact?.full_name} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h4 className="font-bold text-base truncate">{signal.contact?.full_name}</h4>
                {/* LinkedIn Button */}
                {signal.contact?.linkedin_url && !signal.contact.linkedin_url.includes("placeholder") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-[#0077b5] hover:text-[#0077b5]/80 -my-1 shrink-0"
                    asChild
                  >
                    <a href={signal.contact?.linkedin_url} target="_blank" rel="noopener noreferrer">
                      <LinkedinIcon className="h-4 w-4" />
                    </a>
                  </Button>
                )}
                <div className="ml-auto">
                  <Badge
                    variant="secondary"
                    className="bg-slate-100 text-slate-500 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
                  >
                    {signal.process || "Tech"}
                  </Badge>
                </div>
              </div>

              {/* Job Title Logic: Prefer Current Title > Headline */}
              {signal.contact?.current_position_title ? (
                <>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {signal.contact.current_position_title}
                    {signal.is_current_employee && signal.contact?.current_company && (
                      <span className="text-slate-500 font-normal ml-1">en {signal.contact.current_company.name}</span>
                    )}
                  </p>
                  {/* Show headline as secondary info if different and exists */}
                  {signal.contact?.headline && signal.contact.headline !== signal.contact.current_position_title && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{signal.contact.headline}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground line-clamp-1">
                  {signal.contact?.headline || "Sin cargo definido"}
                </p>
              )}

              {/* Contact Info Badges */}
              {signal.is_current_employee && (
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {/* Corporate Email Prioritization Logic:
                    1. Check for 'main job' type in either email1 or email2
                    2. If not found, check for any 'job' type
                    3. Fallback to personal/other
                  */}
                  {(() => {
                    const e1 = signal.contact?.email1
                    const e1t = signal.contact?.email1_type
                    const e1s = signal.contact?.email1_status
                    const e2 = signal.contact?.email2
                    const e2t = signal.contact?.email2_type
                    const e2s = signal.contact?.email2_status

                    let primaryEmail: string | null = null
                    let primaryEmailStatus: string | null | undefined = null
                    let primaryEmailType: string | null | undefined = null

                    // 1. Main Job Priority
                    if (e1 && e1t === "main job") {
                      primaryEmail = e1
                      primaryEmailStatus = e1s
                      primaryEmailType = e1t
                    } else if (e2 && e2t === "main job") {
                      primaryEmail = e2
                      primaryEmailStatus = e2s
                      primaryEmailType = e2t
                    }
                    // 2. Job Priority
                    else if (e1 && e1t?.includes("job")) {
                      primaryEmail = e1
                      primaryEmailStatus = e1s
                      primaryEmailType = e1t
                    } else if (e2 && e2t?.includes("job")) {
                      primaryEmail = e2
                      primaryEmailStatus = e2s
                      primaryEmailType = e2t
                    }
                    // 3. Fallback
                    else if (e1) {
                      primaryEmail = e1
                      primaryEmailStatus = e1s
                      primaryEmailType = e1t
                    } else if (e2) {
                      primaryEmail = e2
                      primaryEmailStatus = e2s
                      primaryEmailType = e2t
                    }

                    const getEmailLabel = (type: string | null) => {
                      if (!type) return null
                      if (type.includes("job") || type === "main job") return "Laboral"
                      if (type === "personal") return "Personal"
                      return null
                    }

                    if (primaryEmail) {
                      const emailLabel = getEmailLabel(primaryEmailType ?? null)

                      return (
                        <Badge
                          variant="outline"
                          className="font-normal bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100 cursor-pointer gap-1.5 py-0.5 pl-2 pr-1.5 h-6 transition-colors"
                          onClick={() => {
                            navigator.clipboard.writeText(primaryEmail || "")
                            toast({ title: "Copiado", description: "Email copiado al portapapeles" })
                          }}
                        >
                          <Mail className="h-3 w-3" />
                          {primaryEmail}
                          {primaryEmailStatus === "valid" && (
                            <CheckCircle2 className="h-3 w-3 text-green-500 fill-green-100" />
                          )}
                          {emailLabel && (
                            <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider opacity-70 border-l border-blue-200 pl-1.5 leading-none">
                              {emailLabel}
                            </span>
                          )}
                        </Badge>
                      )
                    }
                    return null
                  })()}

                  {/* Personal Phone */}
                  {signal.contact?.phone1_type === "personal" && signal.contact.phone1 && (
                    <Badge
                      variant="outline"
                      className="font-normal bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100 cursor-pointer gap-1.5 py-0.5 px-2 h-6 transition-colors"
                      onClick={() => {
                        navigator.clipboard.writeText(signal.contact?.phone1 || "")
                        toast({ title: "Copiado", description: "Teléfono copiado al portapapeles" })
                      }}
                    >
                      <Phone className="h-3 w-3" />
                      {signal.contact.phone1}
                    </Badge>
                  )}
                </div>
              )}

              {!signal.is_current_employee && (
                <div className="flex items-center mt-2 text-amber-600/90 text-xs font-medium bg-amber-50 px-2 py-1 rounded-md w-fit border border-amber-100/50">
                  Ex-empleado
                  {signal.contact?.current_position_title && signal.contact.current_company && (
                    <span className="text-amber-600/70 font-normal ml-1">
                      • Actualmente {signal.contact.current_position_title} en {signal.contact.current_company.name}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg p-4 border border-slate-100 dark:border-slate-800">
          <div className="flex items-baseline gap-2 mb-2 text-sm text-muted-foreground flex-wrap">
            <span>Mencionó:</span>
            <Badge
              variant="outline"
              className="bg-white dark:bg-slate-950 font-semibold shadow-sm text-primary border-primary/20"
            >
              {unit.label}
            </Badge>
            {unit.mentions.length > 1 && (
              <span className="text-xs text-muted-foreground">
                · {unit.mentions.length} menciones en su perfil
              </span>
            )}
          </div>

          <div className="space-y-3">
            {unit.mentions.map((mention) => (
              <div key={mention.rowId}>
                <p className="text-xs text-muted-foreground mb-1 font-medium text-foreground/70">
                  {mentionContext(mention)}
                </p>
                <div className="relative pl-3 border-l-2 border-primary/20">
                  <p className="text-sm text-slate-600 dark:text-slate-300 italic leading-relaxed line-clamp-4">
                    {highlightKeyword(mention.snippet || "", mention.keyword || "")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function JobPostingCard({ jobPosting }: { jobPosting: JobPosting }) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

    // Show "Hoy" only if it's actually today
    if (diffDays === 0) {
      return `Hoy, ${date.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`
    }

    // For recent posts (less than 7 days), show date with year if needed
    const currentYear = now.getFullYear()
    const postYear = date.getFullYear()

    if (currentYear === postYear) {
      return date.toLocaleDateString("es-ES", { day: "numeric", month: "short" })
    } else {
      return date.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })
    }
  }

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden transition-all hover:shadow-md bg-white dark:bg-slate-900">
      <div className="p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex gap-3 items-start flex-1 min-w-0">
            <div className="bg-orange-100 dark:bg-orange-950/30 p-2 rounded-lg shrink-0">
              <Briefcase className="h-5 w-5 text-orange-600 dark:text-orange-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2 mb-1">
                <h4 className="font-semibold text-base leading-tight">{jobPosting.title}</h4>
                {jobPosting.is_recent && (
                  <Badge
                    variant="outline"
                    className="bg-green-50 text-green-700 border-green-200 text-[10px] px-1.5 py-0 h-5 shrink-0"
                  >
                    Reciente
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">Publicado {formatDate(jobPosting.posted_at)}</p>
            </div>
          </div>
        </div>

        {/* Detected Keywords */}
        {jobPosting.detected_keywords && jobPosting.detected_keywords.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
              Tecnologías/Procesos Detectados:
            </div>
            <div className="flex flex-wrap gap-2">
              {jobPosting.detected_keywords.map((kw: any, idx: number) => (
                <Badge
                  key={idx}
                  variant="secondary"
                  className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-xs"
                >
                  {kw.signal_name || kw.keyword}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Apply Button */}
        {jobPosting.apply_url && (
          <Button
            variant="outline"
            size="sm"
            className="w-full bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/20 dark:hover:bg-orange-950/30"
            asChild
          >
            <a href={jobPosting.apply_url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-2" />
              Ver Publicación Completa
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}
