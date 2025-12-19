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
} from "lucide-react"
import Link from "next/link"

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
  const supabase = createClient()

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
      }

      setIsLoading(false)
    }

    if (bookmarkId) {
      fetchBookmarkAndCompany()
    }
  }, [bookmarkId, router])

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
      <header className="border-b bg-card px-6 py-4">
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
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">{company.name}</h1>
                <Badge variant="outline" className="text-xs px-2 py-0.5 whitespace-nowrap">
                  {bookmark.notes || "Sin notas"}
                </Badge>
              </div>

              <div className="flex items-center gap-2 text-muted-foreground mt-1">
                <span>{company.industry || "Industria no especificada"}</span>
                {company.country && (
                  <>
                    <span>•</span>
                    <span>{company.country}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
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
              </div>
            </div>
          </div>

          {company.description && (
            <div className="lg:max-w-md xl:max-w-lg bg-muted/30 rounded-lg p-3 border">
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">{company.description}</p>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-auto">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="bg-muted/50 p-1 flex-wrap h-auto gap-1">
            <TabsTrigger value="overview" className="gap-2">
              <Building2 className="h-4 w-4" />
              Resumen
            </TabsTrigger>
            <TabsTrigger value="summary" className="gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Brief Ejecutivo
            </TabsTrigger>
            <TabsTrigger value="jobpostings" className="gap-2">
              <Flame className="h-4 w-4 text-orange-500" />
              Posiciones
            </TabsTrigger>
            <TabsTrigger value="news" className="gap-2">
              <Newspaper className="h-4 w-4 text-blue-500" />
              Noticias
            </TabsTrigger>
            <TabsTrigger value="implementations" className="gap-2">
              <Briefcase className="h-4 w-4 text-purple-500" />
              Implementaciones
            </TabsTrigger>
            <TabsTrigger value="strategy" className="gap-2">
              <BrainCircuit className="h-4 w-4" />
              Estrategia
            </TabsTrigger>
            <TabsTrigger value="prospects" className="gap-2">
              <Target className="h-4 w-4 text-green-500" />
              Prospectos
              <Badge variant="secondary" className="ml-1 text-[10px] px-1 h-4">
                Apollo
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="icebreakers" className="gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Icebreakers
              <Badge variant="secondary" className="ml-1 text-[10px] px-1 h-4">
                AI
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="m-0 focus-visible:ring-0">
            <BookmarkOverview bookmarkId={bookmarkId} company={company} />
          </TabsContent>

          <TabsContent value="summary" className="m-0 focus-visible:ring-0">
            <SummaryTab
              bookmarkId={bookmarkId}
              companyName={company.name}
              companyLogoUrl={company.logo_url}
              companyWebsite={company.website}
            />
          </TabsContent>

          <TabsContent value="jobpostings" className="m-0 focus-visible:ring-0">
            <BookmarkJobPostings bookmarkId={bookmarkId} />
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
            <ProspectsTab bookmarkId={bookmarkId} />
          </TabsContent>

          <TabsContent value="icebreakers" className="m-0 focus-visible:ring-0">
            <BookmarkIcebreakers bookmarkId={bookmarkId} companyName={company.name} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
