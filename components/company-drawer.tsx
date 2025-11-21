"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Building2, Globe, Linkedin, Bookmark } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

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
  is_current_employee: boolean // Added field
  contact: {
    full_name: string
    headline: string
    profile_picture_url: string | null
    current_position_title: string | null // Added field
    current_company: {
      // Added field
      name: string
    } | null
  }
  signal_name: string
}

type Contact = {
  id: string
  full_name: string
  headline: string
  linkedin_url: string
  profile_picture_url: string | null
  signal_count: number
}

export function CompanyDrawer({
  companyId,
  isOpen,
  onClose,
  filterSignalIds,
  filterType,
}: {
  companyId: string
  isOpen: boolean
  onClose: () => void
  filterSignalIds?: string[]
  filterType?: "process" | "technology"
}) {
  const [company, setCompany] = useState<CompanyDetails | null>(null)
  const [signals, setSignals] = useState<Signal[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [isBookmarked, setIsBookmarked] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (isOpen && companyId) {
      fetchCompanyData()
    }
  }, [companyId, isOpen])

  const fetchCompanyData = async () => {
    // Fetch company details
    const { data: companyData } = await supabase.from("companies").select("*").eq("id", companyId).single()

    setCompany(companyData)

    // Fetch signals with contact and signal name
    let signalsQuery = supabase
      .from("signals")
      .select(`
        id,
        signal_type,
        keyword_matched,
        source_field,
        snippet,
        is_current_employee, 
        contacts:contact_id (
          full_name,
          headline,
          profile_picture_url,
          current_position_title,
          current_company:current_company_id (
            name
          )
        )
      `)
      .eq("company_id", companyId)

    if (filterSignalIds && filterSignalIds.length > 0) {
      signalsQuery = signalsQuery.in("signal_id", filterSignalIds)
    }

    if (filterType === "process") {
      signalsQuery = signalsQuery.eq("is_current_employee", true)
    }

    const { data: signalsData } = await signalsQuery.limit(50)

    // Enrich with signal names
    if (signalsData) {
      const enrichedSignals = await Promise.all(
        signalsData.map(async (signal) => {
          const signalName = signal.keyword_matched

          // This is a simplified version - in production we'd need to join properly
          // For now we just use the keyword matched

          return {
            ...signal,
            contact: signal.contacts,
            signal_name: signalName,
          }
        }),
      )
      setSignals(enrichedSignals as any)
    }

    const contactsQuery = supabase
      .from("contacts")
      .select("id, full_name, headline, linkedin_url, profile_picture_url")
      .eq("current_company_id", companyId)

    // Optimization: Get contact IDs from the filtered signals first
    const filteredContactIds = signalsData?.map((s) => (s as any).contacts?.id).filter(Boolean) || []

    // If we have a filter active, only show contacts that have those signals
    if (filterSignalIds && filterSignalIds.length > 0) {
      // If no signals found for filter, no contacts to show
      if (filteredContactIds.length === 0) {
        setContacts([])
        return
      }
      // Only fetch contacts that are in our filtered list (and are current employees)
      // We already filtered by current_company_id above, which implies current employees only.
      // If we want alumni for tech search, we need to remove that constraint or handle it differently.
      // However, the drawer currently only shows "Contactos" tab which seems to imply current roster.
      // Let's stick to the current behavior but filtered by signal.

      // We can't easily use .in() with a potentially large array if we had thousands,
      // but for 50 signals it's fine.
      // However, let's just use the contacts we found in the signals?
      // No, signals might be from alumni.

      // Let's keep the logic simple: Show contacts who are CURRENT employees AND have the signal.
      // If filterType is technology, we might want to show alumni in the signals tab, but the Contacts tab usually implies "People at this company".
      // Let's filter the contacts query to only include those who have the relevant signals.

      // Actually, a better approach for the "Contacts" tab when filtering is:
      // "Show me people at this company who match the search criteria"

      // Let's fetch all current contacts, and then for each, count the RELEVANT signals.
      // If signal_count > 0, keep them.
    }

    const { data: contactsData } = await contactsQuery

    if (contactsData) {
      const contactsWithSignals = await Promise.all(
        contactsData.map(async (contact) => {
          let countQuery = supabase
            .from("signals")
            .select("id", { count: "exact", head: true })
            .eq("contact_id", contact.id)

          if (filterSignalIds && filterSignalIds.length > 0) {
            countQuery = countQuery.in("signal_id", filterSignalIds)
          }

          const { count } = await countQuery
          return { ...contact, signal_count: count || 0 }
        }),
      )

      const activeContacts =
        filterSignalIds && filterSignalIds.length > 0
          ? contactsWithSignals.filter((c) => c.signal_count > 0)
          : contactsWithSignals

      setContacts(activeContacts)
    }

    // Check if bookmarked
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const { data: bookmark } = await supabase
        .from("bookmarks")
        .select("id")
        .eq("user_id", user.id)
        .eq("company_id", companyId)
        .single()
      setIsBookmarked(!!bookmark)
    }
  }

  const handleBookmark = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    if (isBookmarked) {
      await supabase.from("bookmarks").delete().eq("user_id", user.id).eq("company_id", companyId)
      setIsBookmarked(false)
    } else {
      await supabase.from("bookmarks").insert({
        user_id: user.id,
        company_id: companyId,
        priority: "transaccional",
      })
      setIsBookmarked(true)
    }
  }

  const getTagCloud = () => {
    const tagCounts = new Map<string, number>()
    signals.forEach((signal) => {
      const keyword = signal.keyword_matched
      tagCounts.set(keyword, (tagCounts.get(keyword) || 0) + 1)
    })
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  }

  const formatSourceField = (field: string, snippet?: string) => {
    switch (field) {
      case "about":
        return "Acerca de"
      case "current_position":
        return "Posición Actual"
      case "headline":
        return "Titular"
      case "previous_position":
        // Try to extract position title from snippet if possible, or just generic
        // The snippet usually contains "Title Description..."
        // We can't easily parse the title back perfectly, but we can say "Posición Anterior"
        // The user asked: "menciono %producto% cuando trabaja de "previous_position""
        // We can try to use the snippet context or just say "Posición Anterior"
        return "Posición Anterior"
      default:
        return field
    }
  }
  // </CHANGE>

  if (!company) return null

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto bg-white dark:bg-slate-950 p-0">
        <div className="p-6">
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
                        <Globe className="h-4 w-4 mr-2 text-slate-500" />
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
                  <Button
                    variant={isBookmarked ? "default" : "outline"}
                    size="sm"
                    className={`h-9 ml-auto ${isBookmarked ? "bg-primary text-primary-foreground" : "bg-white dark:bg-slate-900"}`}
                    onClick={handleBookmark}
                  >
                    <Bookmark className={`h-4 w-4 mr-2 ${isBookmarked ? "fill-current" : ""}`} />
                    {isBookmarked ? "Guardado" : "Guardar"}
                  </Button>
                </div>

                {signals.length > 0 && (
                  <div className="pt-2">
                    <div className="flex flex-wrap gap-2">
                      {getTagCloud().map(([keyword, count]) => (
                        <Badge
                          key={keyword}
                          variant="secondary"
                          className="px-2.5 py-0.5 text-xs font-medium bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 transition-colors"
                        >
                          {keyword} <span className="ml-1 text-slate-400 font-normal">{count}</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {/* </CHANGE> */}

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

          <Separator className="mb-6" />

          <Tabs defaultValue="signals" className="w-full">
            <TabsList className="w-full grid grid-cols-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <TabsTrigger
                value="signals"
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                Señales{" "}
                <span className="ml-1.5 text-xs opacity-70 bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">
                  {signals.length}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="contacts"
                className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                Contactos{" "}
                <span className="ml-1.5 text-xs opacity-70 bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">
                  {contacts.length}
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="signals" className="space-y-4 mt-6">
              {signals.map((signal) => (
                <div
                  key={signal.id}
                  className="group border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4 hover:border-primary/30 hover:shadow-md transition-all bg-white dark:bg-slate-900"
                >
                  <div className="flex items-start gap-4">
                    <Avatar className="h-14 w-14 border-2 border-white shadow-sm ring-1 ring-slate-100">
                      <AvatarImage src={signal.contact?.profile_picture_url || undefined} className="object-cover" />
                      <AvatarFallback className="text-lg font-semibold bg-slate-100 text-slate-600">
                        {signal.contact?.full_name?.charAt(0) || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 pt-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-bold text-lg text-slate-900 dark:text-slate-100 truncate">
                          {signal.contact?.full_name}
                        </div>
                        <Badge
                          variant={signal.signal_type === "technology" ? "default" : "secondary"}
                          className="shrink-0 shadow-sm"
                        >
                          {signal.signal_type === "technology" ? "Tech" : "Proceso"}
                        </Badge>
                      </div>

                      <div className="text-sm text-slate-500 truncate font-medium">{signal.contact?.headline}</div>

                      {!signal.is_current_employee && signal.contact?.current_company && (
                        <div className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1 font-medium">
                          <span>
                            Ex-empleado • Actualmente {signal.contact.current_position_title || "trabaja"} en{" "}
                            {signal.contact.current_company.name}
                          </span>
                        </div>
                      )}
                      {/* </CHANGE> */}
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-4 border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-sm text-slate-500">Mencionó:</span>
                      <Badge className="px-3 py-1 bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 shadow-sm text-sm font-semibold">
                        {signal.keyword_matched}
                      </Badge>
                      <span className="text-sm text-slate-500">
                        en{" "}
                        <span className="font-medium text-slate-700 dark:text-slate-300">
                          {signal.source_field === "previous_position"
                            ? `su posición anterior`
                            : formatSourceField(signal.source_field)}
                        </span>
                      </span>
                    </div>

                    {signal.snippet && (
                      <div className="text-sm text-slate-600 dark:text-slate-400 italic leading-relaxed pl-3 border-l-2 border-primary/30">
                        "{signal.snippet}"
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {signals.length === 0 && (
                <div className="text-center py-16 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <Building2 className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                  <p className="text-slate-500 font-medium">No hay señales disponibles</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="contacts" className="space-y-3 mt-6">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between hover:border-primary/30 hover:shadow-sm transition-all bg-white dark:bg-slate-900"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <Avatar className="h-12 w-12 border border-slate-100 shadow-sm">
                      <AvatarImage src={contact.profile_picture_url || undefined} className="object-cover" />
                      <AvatarFallback className="text-base font-semibold bg-slate-100 text-slate-600">
                        {contact.full_name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-base text-slate-900 dark:text-slate-100 truncate">
                        {contact.full_name}
                      </div>
                      <div className="text-sm text-slate-500 truncate">{contact.headline}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge
                      variant="secondary"
                      className="px-2.5 py-0.5 bg-slate-100 text-slate-600 border-slate-200 shadow-sm"
                    >
                      {contact.signal_count} {contact.signal_count === 1 ? "señal" : "señales"}
                    </Badge>
                    {contact.linkedin_url && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-[#0077b5] hover:bg-blue-50"
                        asChild
                      >
                        <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer">
                          <Linkedin className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {contacts.length === 0 && (
                <div className="text-center py-16 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <Building2 className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                  <p className="text-slate-500 font-medium">No hay contactos disponibles</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  )
}
