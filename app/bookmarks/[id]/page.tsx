"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ArrowLeft,
  Building2,
  Globe,
  Linkedin,
  FileText,
  BrainCircuit,
  Flame,
  Newspaper,
  Briefcase,
  Target,
  Sparkles,
  MapPin,
  Download,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { 
  BOOKMARK_STATUS_CONFIG, 
  PRIORITY_CONFIG,
  type BookmarkStatus,
} from "@/lib/bookmark-types"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import { BookmarkOverview } from "./_components/overview-tab"
import { BookmarkJobPostings } from "./_components/job-postings-tab"
import { BookmarkNews } from "./_components/news-tab"
import { ImplementationsTab } from "./_components/implementations-tab"
import { BookmarkIcebreakers } from "./_components/icebreakers-tab"
import { BookmarkStrategy } from "./_components/strategy-tab"
import { ProspectsTab } from "./_components/prospects-tab"
import { SummaryTab } from "./_components/summary-tab"

export default function BookmarkWorkspacePage() {
  const params = useParams()
  const router = useRouter()
  const bookmarkId = params.id as string
  const [bookmark, setBookmark] = useState<any>(null)
  const [company, setCompany] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [countryFilter, setCountryFilter] = useState<string>("")
  const [availableCountries, setAvailableCountries] = useState<string[]>([])
  const [isExporting, setIsExporting] = useState(false)
  const supabase = createClient()

  const handleExportExcel = async () => {
    setIsExporting(true)
    try {
      const response = await fetch(`/api/bookmarks/${bookmarkId}/export`)
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Error al exportar")
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = response.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "export.xlsx"
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      a.remove()
      toast.success("Excel exportado correctamente")
    } catch (err: any) {
      toast.error(err.message || "Error al exportar")
    } finally {
      setIsExporting(false)
    }
  }

  useEffect(() => {
    const fetchBookmarkAndCompany = async () => {
      setIsLoading(true)

      // 1. Fetch Bookmark to get company_id
      const { data: bookmarkData, error: bookmarkError } = await supabase
        .from("bookmarks")
        .select("*")
        .eq("id", bookmarkId)
        .single()

      if (bookmarkError || !bookmarkData) {
        console.error("Error fetching bookmark:", bookmarkError)
        router.push("/bookmarks")
        return
      }
      setBookmark(bookmarkData)

      // 2. Fetch Company Details
      const { data: companyData, error: companyError } = await supabase
        .from("companies")
        .select("*")
        .eq("id", bookmarkData.company_id)
        .single()

      if (companyError) {
        console.error("Error fetching company:", companyError)
      } else {
        setCompany(companyData)
        // Default country filter to company's country
        if (companyData.country) {
          setCountryFilter(companyData.country)
        }
      }

      // 3. Fetch distinct countries from contacts linked to this company's signals
      const { data: contactCountries } = await supabase
        .from("signals")
        .select("contacts!inner(country)")
        .eq("company_id", bookmarkData.company_id)
        .not("contact_id", "is", null)

      if (contactCountries) {
        const countriesSet = new Set<string>()
        contactCountries.forEach((s: any) => {
          const country = (s.contacts as any)?.country
          if (country && country.trim()) countriesSet.add(country.trim())
        })
        // Sort and add company country at top if not present
        const sorted = Array.from(countriesSet).sort()
        setAvailableCountries(sorted)
      }

      setIsLoading(false)
    }

    if (bookmarkId) {
      fetchBookmarkAndCompany()
    }
  }, [bookmarkId, router])

  const updateBookmarkField = async (field: string, value: string) => {
    const { error } = await supabase
      .from("bookmarks")
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq("id", bookmarkId)

    if (!error) {
      setBookmark((prev: any) => ({ ...prev, [field]: value }))
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!company || !bookmark) {
    return (
      <div className="flex flex-col items-center justify-center h-screen space-y-4">
        <h2 className="text-xl font-semibold">Bookmark no encontrado</h2>
        <Button onClick={() => router.push("/bookmarks")}>Volver a mis bookmarks</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="border-b bg-card px-4 md:px-6 py-4">
        <div className="flex items-center gap-4 mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/bookmarks")}
            className="pl-0 hover:pl-2 transition-all"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver a la lista
          </Button>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-16 w-16 bg-muted rounded-lg border flex items-center justify-center overflow-hidden flex-shrink-0">
              {company.logo_url ? (
                <img
                  src={company.logo_url || "/placeholder.svg"}
                  alt={company.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Building2 className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{company.name}</h1>

              <div className="flex items-center gap-2 text-muted-foreground mt-1">
                <span>{company.industry || "Industria no especificada"}</span>
                {company.country_normalized && (
                  <>
                    <span>•</span>
                    <span>{company.country_normalized}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 mt-3">
                {company.website && (
                  <Button variant="outline" size="sm" asChild className="h-7 text-xs px-3 bg-transparent">
                    <Link href={company.website} target="_blank">
                      <Globe className="h-3 w-3 mr-1.5" />
                      Website
                    </Link>
                  </Button>
                )}
                {company.linkedin_url && (
                  <Button variant="outline" size="sm" asChild className="h-7 text-xs px-3 bg-transparent">
                    <Link href={company.linkedin_url} target="_blank">
                      <Linkedin className="h-3 w-3 mr-1.5" />
                      LinkedIn
                    </Link>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-3 bg-transparent"
                  onClick={handleExportExcel}
                  disabled={isExporting}
                >
                  {isExporting ? (
                    <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3 mr-1.5" />
                  )}
                  Exportar
                </Button>
              </div>
            </div>
          </div>

          {/* Status, Priority, and Country Controls */}
          <div className="flex flex-col sm:flex-row gap-3 lg:items-start">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                Filtro de Pais
              </span>
              <Select
                value={countryFilter || "_all"}
                onValueChange={(val) => setCountryFilter(val === "_all" ? "" : val)}
              >
                <SelectTrigger className="w-[170px] h-9">
                  <SelectValue placeholder="Todos los paises" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos los paises</SelectItem>
                  {availableCountries.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground font-medium">Estado</span>
              <Select
                value={bookmark.status || "nuevo"}
                onValueChange={(val) => updateBookmarkField("status", val)}
              >
                <SelectTrigger className={cn(
                  "w-[150px] h-9",
                  BOOKMARK_STATUS_CONFIG[(bookmark.status || "nuevo") as BookmarkStatus]?.color
                )}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(BOOKMARK_STATUS_CONFIG) as BookmarkStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      <span className={cn("px-2 py-0.5 rounded text-xs", BOOKMARK_STATUS_CONFIG[s].color)}>
                        {BOOKMARK_STATUS_CONFIG[s].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground font-medium">Prioridad (Tier)</span>
              <Select
                value={bookmark.priority || "sin_prioridad"}
                onValueChange={(val) => updateBookmarkField("priority", val === "sin_prioridad" ? "" : val)}
              >
                <SelectTrigger className={cn(
                  "w-[150px] h-9",
                  bookmark.priority && PRIORITY_CONFIG[bookmark.priority as keyof typeof PRIORITY_CONFIG]?.color
                )}>
                  <SelectValue placeholder="Sin prioridad" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="alta">
                    <span className={cn("px-2 py-0.5 rounded text-xs", PRIORITY_CONFIG.alta.color)}>Alta</span>
                  </SelectItem>
                  <SelectItem value="transaccional">
                    <span className={cn("px-2 py-0.5 rounded text-xs", PRIORITY_CONFIG.transaccional.color)}>Transaccional</span>
                  </SelectItem>
                  <SelectItem value="baja">
                    <span className={cn("px-2 py-0.5 rounded text-xs", PRIORITY_CONFIG.baja.color)}>Baja</span>
                  </SelectItem>
                  <SelectItem value="sin_prioridad">
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-50 text-gray-500">Sin prioridad</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        <Tabs defaultValue="overview" className="space-y-4 md:space-y-6">
          <TabsList className="bg-muted/50 p-1 flex-wrap h-auto gap-1" data-onboarding="workspace-tabs">
            <TabsTrigger value="overview" className="gap-1.5 text-xs md:text-sm">
              <Building2 className="h-3.5 w-3.5 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Resumen</span>
              <span className="sm:hidden">Info</span>
            </TabsTrigger>
            <TabsTrigger value="jobpostings" className="gap-1.5 text-xs md:text-sm">
              <Flame className="h-3.5 w-3.5 md:h-4 md:w-4 text-orange-500" />
              <span className="hidden sm:inline">Posiciones</span>
              <span className="sm:hidden">Jobs</span>
            </TabsTrigger>
            <TabsTrigger value="news" className="gap-1.5 text-xs md:text-sm" data-onboarding="workspace-tab-news">
              <Newspaper className="h-3.5 w-3.5 md:h-4 md:w-4 text-blue-500" />
              Noticias
            </TabsTrigger>
            <TabsTrigger value="implementations" className="gap-1.5 text-xs md:text-sm" data-onboarding="workspace-tab-implementations">
              <Briefcase className="h-3.5 w-3.5 md:h-4 md:w-4 text-purple-500" />
              <span className="hidden sm:inline">Implementaciones</span>
              <span className="sm:hidden">Impl.</span>
            </TabsTrigger>
            <TabsTrigger value="strategy" className="gap-1.5 text-xs md:text-sm" data-onboarding="workspace-tab-strategy">
              <BrainCircuit className="h-3.5 w-3.5 md:h-4 md:w-4" />
              Estrategia
            </TabsTrigger>
            <TabsTrigger value="prospects" className="gap-1.5 text-xs md:text-sm" data-onboarding="workspace-tab-prospects">
              <Target className="h-3.5 w-3.5 md:h-4 md:w-4 text-green-500" />
              Prospectos
              <Badge variant="secondary" className="ml-1 text-[10px] px-1 h-4 hidden md:inline-flex">
                Apollo
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="icebreakers" className="gap-1.5 text-xs md:text-sm" data-onboarding="workspace-tab-icebreakers">
              <Sparkles className="h-3.5 w-3.5 md:h-4 md:w-4 text-amber-500" />
              <span className="hidden sm:inline">Icebreakers</span>
              <span className="sm:hidden">Ice.</span>
              <Badge variant="secondary" className="ml-1 text-[10px] px-1 h-4 hidden md:inline-flex">
                AI
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="summary" className="gap-1.5 text-xs md:text-sm" data-onboarding="workspace-tab-brief">
              <FileText className="h-3.5 w-3.5 md:h-4 md:w-4 text-primary" />
              <span className="hidden sm:inline">Brief Ejecutivo</span>
              <span className="sm:hidden">Brief</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="m-0 focus-visible:ring-0">
            <BookmarkOverview bookmarkId={bookmarkId} company={company} countryFilter={countryFilter || null} />
          </TabsContent>

          <TabsContent value="jobpostings" className="m-0 focus-visible:ring-0">
            <BookmarkJobPostings bookmarkId={bookmarkId} countryFilter={countryFilter || null} />
          </TabsContent>

          <TabsContent value="news" className="m-0 focus-visible:ring-0">
            <BookmarkNews bookmarkId={bookmarkId} companyId={company.id} companyName={company.name} />
          </TabsContent>

          <TabsContent value="implementations" className="m-0 focus-visible:ring-0">
            <ImplementationsTab bookmarkId={bookmarkId} companyId={company.id} companyName={company.name} />
          </TabsContent>

          <TabsContent value="strategy" className="m-0 focus-visible:ring-0">
            <BookmarkStrategy bookmarkId={bookmarkId} companyName={company.name} />
          </TabsContent>

          <TabsContent value="prospects" className="m-0 focus-visible:ring-0">
            <ProspectsTab 
              bookmarkId={bookmarkId} 
              companyName={company.name}
              companyWebsite={company.website}
              defaultCountry={countryFilter || company.country || ""}
            />
          </TabsContent>

          <TabsContent value="icebreakers" className="m-0 focus-visible:ring-0">
            <BookmarkIcebreakers bookmarkId={bookmarkId} companyName={company.name} />
          </TabsContent>

          <TabsContent value="summary" className="m-0 focus-visible:ring-0">
            <SummaryTab
              bookmarkId={bookmarkId}
              companyName={company.name}
              companyLogoUrl={company.logo_url}
              companyWebsite={company.website}
              companyIndustry={company.industry}
              companyCountry={company.country}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
