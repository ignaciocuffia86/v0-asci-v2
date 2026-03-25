"use client"

import { useEffect, useState, useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Bookmark,
  Info,
  User,
  Users,
  GraduationCap,
  Linkedin,
  Mail,
  Phone,
  CheckCircle2,
  AlertCircle,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  Cpu,
  Workflow,
  Filter,
  TrendingUp,
} from "lucide-react"
import { getBookmarkSmartContext } from "@/app/actions/workspace"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { BookmarkScopeEditor, type SignalTag } from "@/components/bookmarks/bookmark-scope-editor"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

type GroupedContact = {
  contactId: string
  contactName: string
  contactRole: string
  contactPhoto: string | null
  isCurrent: boolean
  keywords: string[]
  linkedinUrl: string | null
  email: string | null
  emailStatus: string | null
  emailType: string | null
  phone: string | null
  phoneType: string | null
}

type SmartContext = {
  filterType: "process" | "technology" | "general"
  totalSignals: number
  currentEmployees: GroupedContact[]
  alumni: GroupedContact[]
  logicUsed: string
}

// ─── Stat pill ──────────────────────────────────────────────────────────────
function StatPill({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType
  label: string
  value: number
  color: string
}) {
  return (
    <div className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-sm", color)}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-xs font-normal opacity-70">{label}</span>
    </div>
  )
}

// ─── Keyword tag (filterable) ────────────────────────────────────────────────
function KeywordTag({
  keyword,
  count,
  type,
  isActive,
  onClick,
}: {
  keyword: string
  count: number
  type: "technology" | "process" | "unknown"
  isActive: boolean
  onClick: () => void
}) {
  const Icon = type === "process" ? Workflow : Cpu
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all select-none",
        isActive
          ? type === "process"
            ? "bg-violet-600 text-white border-violet-600 shadow-sm"
            : "bg-blue-600 text-white border-blue-600 shadow-sm"
          : type === "process"
            ? "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-800"
            : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800",
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {keyword}
      <span className={cn("ml-0.5 font-normal tabular-nums", isActive ? "opacity-70" : "opacity-50")}>{count}</span>
    </button>
  )
}

// ─── Contact row ────────────────────────────────────────────────────────────
function ContactRow({
  contact,
  isAlumni,
  activeKeyword,
}: {
  contact: GroupedContact
  isAlumni: boolean
  activeKeyword: string | null
}) {
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(`${label} copiado`)
  }

  const getEmailStatusIcon = (status: string | null) =>
    status?.toLowerCase() === "valid" || status?.toLowerCase() === "verified" ? (
      <CheckCircle2 className="h-3 w-3 text-green-500" />
    ) : status ? (
      <AlertCircle className="h-3 w-3 text-amber-500" />
    ) : null

  const highlightedKeywords = activeKeyword
    ? contact.keywords.filter((k) => k.toLowerCase() === activeKeyword.toLowerCase())
    : contact.keywords

  const otherKeywords = activeKeyword
    ? contact.keywords.filter((k) => k.toLowerCase() !== activeKeyword.toLowerCase())
    : []

  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group">
      {/* Avatar */}
      <Avatar className="h-9 w-9 border border-slate-200 dark:border-slate-700 shrink-0 mt-0.5">
        <AvatarImage src={contact.contactPhoto || ""} />
        <AvatarFallback className="bg-slate-100 dark:bg-slate-800 text-slate-500 text-xs">
          <User className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium leading-tight truncate">{contact.contactName}</p>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{contact.contactRole}</p>
          </div>
          {/* Actions — visible on hover */}
          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <TooltipProvider delayDuration={100}>
              {contact.linkedinUrl && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-[#0077B5] hover:bg-[#0077B5]/10"
                      onClick={() => window.open(contact.linkedinUrl!, "_blank")}
                    >
                      <Linkedin className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Ver LinkedIn</TooltipContent>
                </Tooltip>
              )}
              {!isAlumni && contact.email && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => copyToClipboard(contact.email!, "Email")}
                    >
                      <Mail className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs space-y-0.5">
                      <p>{contact.email}</p>
                      <p className="text-muted-foreground">Click para copiar</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
              {!isAlumni && contact.phone && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => copyToClipboard(contact.phone!, "Teléfono")}
                    >
                      <Phone className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{contact.phone}</TooltipContent>
                </Tooltip>
              )}
            </TooltipProvider>
          </div>
        </div>

        {/* Keywords */}
        {contact.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {highlightedKeywords.map((k, i) => (
              <span
                key={i}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
              >
                {k}
              </span>
            ))}
            {otherKeywords.slice(0, 2).map((k, i) => (
              <span
                key={i}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
              >
                {k}
              </span>
            ))}
            {otherKeywords.length > 2 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] text-slate-400">
                +{otherKeywords.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Contact details (email visible, not just on hover) */}
        {!isAlumni && (contact.email || contact.phone) && (
          <div className="flex items-center gap-3 mt-1.5">
            {contact.email && (
              <button
                onClick={() => copyToClipboard(contact.email!, "Email")}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {getEmailStatusIcon(contact.emailStatus)}
                <span className="truncate max-w-[160px]">{contact.email}</span>
              </button>
            )}
            {contact.phone && (
              <button
                onClick={() => copyToClipboard(contact.phone!, "Teléfono")}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Phone className="h-2.5 w-2.5" />
                <span>{contact.phone}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Collapsible section ─────────────────────────────────────────────────────
function ContactSection({
  title,
  icon: Icon,
  iconColor,
  contacts,
  isAlumni,
  activeKeyword,
  defaultOpen = true,
}: {
  title: string
  icon: React.ElementType
  iconColor: string
  contacts: GroupedContact[]
  isAlumni: boolean
  activeKeyword: string | null
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  if (contacts.length === 0) return null

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      {/* Section header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50/80 dark:bg-slate-900/60 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className={cn("h-3.5 w-3.5", iconColor)} />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            {title}
          </span>
          <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-slate-200 dark:bg-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
            {contacts.length}
          </span>
        </div>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* Contact rows */}
      {open && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
          {contacts.map((contact) => (
            <ContactRow
              key={contact.contactId}
              contact={contact}
              isAlumni={isAlumni}
              activeKeyword={activeKeyword}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────
export function BookmarkOverview({
  bookmarkId,
  company,
  countryFilter,
  bookmarkScope,
  onScopeUpdated,
}: {
  bookmarkId: string
  company: any
  countryFilter?: string | null
  bookmarkScope?: any
  onScopeUpdated?: (newScope: any) => void
}) {
  const [smartContext, setSmartContext] = useState<SmartContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState("")
  const [activeKeyword, setActiveKeyword] = useState<string | null>(null)
  const [contactSearch, setContactSearch] = useState("")
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  }, [])

  useEffect(() => {
    const fetchContext = async () => {
      setLoading(true)
      try {
        const data = await getBookmarkSmartContext(bookmarkId, countryFilter)
        setSmartContext(data as SmartContext)
      } catch (error) {
        console.error("Failed to fetch smart context", error)
      } finally {
        setLoading(false)
      }
    }
    if (bookmarkId) fetchContext()
  }, [bookmarkId, countryFilter, bookmarkScope])

  const fetchTagsForCompany = async (): Promise<SignalTag[]> => {
    if (!company?.id) return []
    const { data, error } = await supabase
      .from("signals")
      .select("signal_id, keyword_matched, signal_type")
      .eq("company_id", company.id)
      .not("signal_id", "is", null)
    if (error || !data) return []
    const tagMap = new Map<string, SignalTag>()
    data.forEach((s: any) => {
      if (!s.signal_id || !s.keyword_matched) return
      if (tagMap.has(s.signal_id)) {
        tagMap.get(s.signal_id)!.count++
      } else {
        tagMap.set(s.signal_id, {
          id: s.signal_id,
          name: s.keyword_matched,
          type: s.signal_type === "process" ? "process" : "technology",
          count: 1,
        })
      }
    })
    return Array.from(tagMap.values()).sort((a, b) => b.count - a.count)
  }

  // Build keyword map from contacts
  const keywordMap = useMemo(() => {
    if (!smartContext) return new Map<string, { count: number; type: "technology" | "process" | "unknown" }>()
    const map = new Map<string, { count: number; type: "technology" | "process" | "unknown" }>()
    const allContacts = [...smartContext.currentEmployees, ...smartContext.alumni]
    allContacts.forEach((c) => {
      c.keywords.forEach((kw) => {
        const existing = map.get(kw)
        map.set(kw, {
          count: (existing?.count || 0) + 1,
          type: existing?.type || "unknown",
        })
      })
    })
    return map
  }, [smartContext])

  const sortedKeywords = useMemo(
    () => Array.from(keywordMap.entries()).sort((a, b) => b[1].count - a[1].count),
    [keywordMap],
  )

  // Filter contacts
  const filteredCurrent = useMemo(() => {
    if (!smartContext) return []
    return smartContext.currentEmployees.filter((c) => {
      const matchesKw = !activeKeyword || c.keywords.some((k) => k.toLowerCase() === activeKeyword.toLowerCase())
      const matchesSearch =
        !contactSearch ||
        c.contactName.toLowerCase().includes(contactSearch.toLowerCase()) ||
        c.contactRole.toLowerCase().includes(contactSearch.toLowerCase())
      return matchesKw && matchesSearch
    })
  }, [smartContext, activeKeyword, contactSearch])

  const filteredAlumni = useMemo(() => {
    if (!smartContext) return []
    return smartContext.alumni.filter((c) => {
      const matchesKw = !activeKeyword || c.keywords.some((k) => k.toLowerCase() === activeKeyword.toLowerCase())
      const matchesSearch =
        !contactSearch ||
        c.contactName.toLowerCase().includes(contactSearch.toLowerCase()) ||
        c.contactRole.toLowerCase().includes(contactSearch.toLowerCase())
      return matchesKw && matchesSearch
    })
  }, [smartContext, activeKeyword, contactSearch])

  const getFilterTypeLabel = (filterType: string) => {
    const map: Record<string, string> = { process: "Proceso", technology: "Tecnología", general: "General" }
    return map[filterType] || "General"
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
        <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        Cargando señales...
      </div>
    )
  }

  const hasData = smartContext && (smartContext.currentEmployees.length > 0 || smartContext.alumni.length > 0)

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <TrendingUp className="h-5 w-5 text-slate-400" />
        </div>
        <p className="text-sm font-medium">Sin señales disponibles</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          No se encontraron empleados o ex-empleados con señales para esta empresa.
        </p>
      </div>
    )
  }

  const totalVisible = filteredCurrent.length + filteredAlumni.length
  const totalAll = smartContext.currentEmployees.length + smartContext.alumni.length
  const isFiltered = !!activeKeyword || !!contactSearch

  return (
    <div className="space-y-4">
      {/* ── Stats bar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <StatPill
          icon={TrendingUp}
          label="señales totales"
          value={smartContext.totalSignals}
          color="bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300"
        />
        <StatPill
          icon={Users}
          label="emp. actuales"
          value={smartContext.currentEmployees.length}
          color="bg-green-50 border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-900 dark:text-green-400"
        />
        <StatPill
          icon={GraduationCap}
          label="alumni"
          value={smartContext.alumni.length}
          color="bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400"
        />
        <div className="ml-auto">
          <BookmarkScopeEditor
            bookmarkId={bookmarkId}
            userId={userId}
            companyName={company?.name || ""}
            currentScope={bookmarkScope}
            fetchAvailableTags={fetchTagsForCompany}
            onScopeUpdated={onScopeUpdated}
            trigger={
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 bg-transparent">
                <SlidersHorizontal className="h-3 w-3" />
                Búsqueda: {getFilterTypeLabel(smartContext.filterType)}
              </Button>
            }
          />
        </div>
      </div>

      {/* ── Logic hint ── */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 px-3 py-2 rounded-lg">
        <Info className="h-3.5 w-3.5 mt-0.5 text-blue-500 shrink-0" />
        <span>
          <strong className="text-foreground">{smartContext.logicUsed}.</strong>{" "}
          {smartContext.filterType === "general"
            ? "Mostrando todas las señales de la empresa."
            : "Mostrando señales que coinciden con el filtro activo."}
        </span>
      </div>

      {/* ── Keyword filter tags ── */}
      {sortedKeywords.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="h-3 w-3" />
            <span>Filtrar por señal</span>
            {activeKeyword && (
              <button
                onClick={() => setActiveKeyword(null)}
                className="ml-auto flex items-center gap-1 text-primary hover:text-primary/80 transition-colors"
              >
                <X className="h-3 w-3" />
                Limpiar
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sortedKeywords.map(([kw, { count, type }]) => (
              <KeywordTag
                key={kw}
                keyword={kw}
                count={count}
                type={type}
                isActive={activeKeyword === kw}
                onClick={() => setActiveKeyword(activeKeyword === kw ? null : kw)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Search bar ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre o cargo..."
          value={contactSearch}
          onChange={(e) => setContactSearch(e.target.value)}
          className="pl-9 h-9 text-sm bg-transparent"
        />
        {contactSearch && (
          <button
            onClick={() => setContactSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── Active filter summary ── */}
      {isFiltered && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Mostrando <strong className="text-foreground">{totalVisible}</strong> de{" "}
            <strong className="text-foreground">{totalAll}</strong> contactos
          </span>
          {activeKeyword && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Filter className="h-2.5 w-2.5" />
              {activeKeyword}
              <button onClick={() => setActiveKeyword(null)}>
                <X className="h-2.5 w-2.5 ml-0.5" />
              </button>
            </Badge>
          )}
        </div>
      )}

      {/* ── Contact sections ── */}
      <div className="space-y-3">
        <ContactSection
          title="Empleados Actuales"
          icon={Users}
          iconColor="text-green-500"
          contacts={filteredCurrent}
          isAlumni={false}
          activeKeyword={activeKeyword}
          defaultOpen={true}
        />
        <ContactSection
          title="Ex-empleados / Alumni"
          icon={GraduationCap}
          iconColor="text-slate-400"
          contacts={filteredAlumni}
          isAlumni={true}
          activeKeyword={activeKeyword}
          defaultOpen={filteredCurrent.length === 0}
        />

        {totalVisible === 0 && isFiltered && (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center border border-dashed rounded-xl">
            <Search className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Sin resultados para{" "}
              {activeKeyword ? (
                <strong>&quot;{activeKeyword}&quot;</strong>
              ) : (
                <strong>&quot;{contactSearch}&quot;</strong>
              )}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => {
                setActiveKeyword(null)
                setContactSearch("")
              }}
            >
              Limpiar filtros
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
