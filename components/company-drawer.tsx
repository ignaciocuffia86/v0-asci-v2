"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Building2, ExternalLink, Linkedin, Bookmark, Mail, Phone, CheckCircle2, LinkedinIcon } from "lucide-react"
import { bookmarkCompany, unbookmarkCompany } from "@/app/actions/bookmarks"
import { useToast } from "@/hooks/use-toast"

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
  contact_id: string
  signal_id: string
  contact: {
    id?: string // Added id to contact
    name: string // Changed full_name to name for consistency or handle mapping
    full_name: string
    headline: string
    linkedin_url?: string // Added linkedin_url
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
    company_id?: string // Added for comparison
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
  const [dictionaryNames, setDictionaryNames] = useState<string[]>([])
  const supabase = createClient()
  const { toast } = useToast()

  useEffect(() => {
    if (isOpen && companyId) {
      fetchCompanyData()
    }
  }, [companyId, isOpen])

  const fetchCompanyData = async () => {
    // Fetch company details
    const { data: companyData } = await supabase.from("companies").select("*").eq("id", companyId).single()

    setCompany(companyData)

    if (filterSignalIds && filterSignalIds.length > 0 && filterType) {
      const table = filterType === "process" ? "dictionary_processes" : "dictionary_products"
      const { data: dictData } = await supabase.from(table).select("name").in("id", filterSignalIds)

      if (dictData) {
        setDictionaryNames(dictData.map((d) => d.name))
      }
    } else {
      setDictionaryNames([])
    }

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
        company_id,
        contact_id,
        signal_id,
        contacts:contact_id (
          id,
          full_name,
          headline,
          linkedin_url,
          profile_picture_url,
          current_position_title,
          current_company_id,
          previous_positions,
          email1, email1_type, email1_status, 
          email2, email2_type, email2_status, 
          phone1, phone1_type, 
          phone2, phone2_type,
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

    const { data: signalsData, error: signalsError } = await signalsQuery.limit(200)

    console.log("[v0] Signals fetched:", signalsData?.length, "Error:", signalsError)
    console.log("[v0] Filter type:", filterType, "Filter IDs:", filterSignalIds)

    // Enrich with signal names
    if (signalsData) {
      const enrichedSignals = await Promise.all(
        signalsData.map(async (signal: any) => {
          const signalName = signal.keyword_matched

          return {
            ...signal,
            contact: {
              ...signal.contacts,
              name: signal.contacts?.full_name || "Unknown", // Map full_name to name for SignalCard
              company_id: signal.company_id, // Pass company_id to contact object for easy comparison in SignalCard
            },
            signal_name: signalName,
          }
        }),
      )

      console.log("[v0] Enriched signals after filter:", enrichedSignals.length)
      setSignals(enrichedSignals as any)
    } else {
      setSignals([])
    }

    const contactsQuery = supabase
      .from("contacts")
      .select(
        "id, full_name, headline, linkedin_url, profile_picture_url, current_position_title, email1, email1_type, email1_status, email2, email2_type, email2_status, phone1, phone1_type, phone2, phone2_type",
      )
      .eq("current_company_id", companyId)

    // Optimization: Get contact IDs from the filtered signals first
    const filteredContactIds = signals.map((s) => s.contact_id).filter(Boolean) || []

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
      await unbookmarkCompany(user.id, companyId)
      setIsBookmarked(false)
    } else {
      let contextNames: string[] = []

      if (dictionaryNames.length > 0) {
        contextNames = dictionaryNames
      } else {
        // Fallback to existing logic using keywords
        contextNames = signals
          .filter((s) => filterSignalIds?.includes(s.signal_id))
          .map((s) => s.keyword_matched)
          .filter((value, index, self) => self.indexOf(value) === index)
      }

      const filtersUsed = {
        technology: filterType === "technology" ? contextNames : [],
        process: filterType === "process" ? contextNames : [],
      }

      await bookmarkCompany(user.id, companyId, {
        filterSignalIds: filterSignalIds || [],
        filterType: filterType || "generic",
        filtersUsed, // Add filtersUsed with human-readable names
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

  if (!company) return null

  const uniqueSignals = signals.filter(
    (signal, index, self) =>
      index ===
      self.findIndex(
        (t) =>
          t.contact.id === signal.contact.id &&
          t.keyword_matched.toLowerCase() === signal.keyword_matched.toLowerCase(),
      ),
  )

  const currentEmployeeSignals = uniqueSignals.filter((s) => s.is_current_employee)
  const alumniSignals = uniqueSignals.filter((s) => !s.is_current_employee)

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto bg-white dark:bg-slate-950 p-0 flex flex-col h-full">
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

                <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
                  <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                    Tecnologías y Procesos Principales
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {getTagCloud().map(([keyword, count]) => (
                      <Badge
                        key={keyword}
                        variant="secondary"
                        className="bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-0 px-2.5 py-1 text-xs"
                      >
                        {keyword}
                        <span className="ml-1.5 text-slate-400 font-normal">{count}</span>
                      </Badge>
                    ))}
                  </div>
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
                  {currentEmployeeSignals.length}
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
                  {alumniSignals.length}
                </Badge>
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-50/30 dark:bg-slate-900">
            <TabsContent value="current" className="p-6 space-y-4 m-0">
              {currentEmployeeSignals.length > 0 ? (
                currentEmployeeSignals.map((signal) => <SignalCard key={`${signal.id}-current`} signal={signal} />)
              ) : (
                <div className="text-center py-12 text-muted-foreground bg-white dark:bg-slate-900 rounded-xl border border-dashed">
                  No se encontraron empleados actuales con estas señales.
                </div>
              )}
            </TabsContent>

            <TabsContent value="alumni" className="p-6 space-y-4 m-0">
              {alumniSignals.length > 0 ? (
                alumniSignals.map((signal) => <SignalCard key={`${signal.id}-alumni`} signal={signal} />)
              ) : (
                <div className="text-center py-12 text-muted-foreground bg-white dark:bg-slate-900 rounded-xl border border-dashed">
                  No se encontraron ex-empleados con estas señales.
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

function SignalCard({ signal }: { signal: Signal }) {
  const { toast } = useToast()

  const formatSourceField = (field: string) => {
    const map: Record<string, string> = {
      about: "Acerca de",
      current_position: "Posición Actual",
      headline: "Titular",
      previous_position: "Posición Anterior",
    }
    return map[field] || field
  }

  const getPreviousCompanyContext = (signal: Signal) => {
    if (signal.source_field !== "previous_position") return null

    const positions = signal.contact.previous_positions || []

    // Find the position that likely generated this signal
    const matchingPosition = positions.find((pos: any) => {
      const text = `${pos.title || ""} ${pos.description || ""}`.toLowerCase()
      return text.includes(signal.keyword_matched.toLowerCase())
    })

    if (matchingPosition) {
      // Only show "misma empresa" logic if they are CURRENTLY working there and referring to a previous role there
      // We check if they are marked as current employee AND the previous role company ID matches current company ID
      const isInternalPromotion =
        signal.is_current_employee && matchingPosition.company_id === signal.contact.current_company_id

      if (isInternalPromotion) {
        return `en Posición Anterior (misma empresa)`
      }
      // For everyone else (including Alumni), explicitly state the company name
      return `en Posición Anterior en ${matchingPosition.company_name || "otra empresa"}`
    }

    return "en Posición Anterior"
  }

  const prevContext = getPreviousCompanyContext(signal)
  const sourceLabel = formatSourceField(signal.source_field)

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden transition-all hover:shadow-md bg-white dark:bg-slate-900">
      <div className="p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex gap-4 w-full">
            <Avatar className="h-14 w-14 border-2 border-white shadow-sm ring-1 ring-slate-100 shrink-0">
              <AvatarImage
                src={signal.contact.profile_picture_url || ""}
                alt={signal.contact.name}
                className="object-cover"
              />
              <AvatarFallback className="text-lg bg-primary/10 text-primary font-medium">
                {signal.contact.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h4 className="font-bold text-base truncate">{signal.contact.name}</h4>
                {/* LinkedIn Button */}
                {signal.contact.linkedin_url && !signal.contact.linkedin_url.includes("placeholder") && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-[#0077b5] hover:text-[#0077b5]/80 -my-1 shrink-0"
                    asChild
                  >
                    <a href={signal.contact.linkedin_url} target="_blank" rel="noopener noreferrer">
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
              {signal.contact.current_position_title ? (
                <>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {signal.contact.current_position_title}
                    {signal.is_current_employee && signal.contact.current_company && (
                      <span className="text-slate-500 font-normal ml-1">en {signal.contact.current_company.name}</span>
                    )}
                  </p>
                  {/* Show headline as secondary info if different and exists */}
                  {signal.contact.headline && signal.contact.headline !== signal.contact.current_position_title && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{signal.contact.headline}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground line-clamp-1">
                  {signal.contact.headline || "Sin cargo definido"}
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
                    const e1 = signal.contact.email1
                    const e1t = signal.contact.email1_type
                    const e1s = signal.contact.email1_status
                    const e2 = signal.contact.email2
                    const e2t = signal.contact.email2_type
                    const e2s = signal.contact.email2_status

                    let primaryEmail = null
                    let primaryEmailStatus = null
                    let primaryEmailType = null

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
                      const emailLabel = getEmailLabel(primaryEmailType)

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
                  {signal.contact.phone1_type === "personal" && signal.contact.phone1 && (
                    <Badge
                      variant="outline"
                      className="font-normal bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100 cursor-pointer gap-1.5 py-0.5 px-2 h-6 transition-colors"
                      onClick={() => {
                        navigator.clipboard.writeText(signal.contact.phone1 || "")
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
                  {signal.contact.current_position_title && signal.contact.current_company && (
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
              {signal.keyword_matched}
            </Badge>
            <span>
              {prevContext ? <span className="font-medium text-foreground">{prevContext}</span> : sourceLabel}
            </span>
          </div>

          <div className="relative pl-3 border-l-2 border-primary/20">
            <p className="text-sm text-slate-600 dark:text-slate-300 italic leading-relaxed line-clamp-4">
              "{signal.snippet}"
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
