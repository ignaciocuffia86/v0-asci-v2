"use client"

import { useEffect, useMemo, useState, useDeferredValue } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
  Search,
  X,
} from "lucide-react"
import { getBookmarkSmartContext } from "@/app/actions/workspace"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"

type ContactEmail = { value: string; status: string | null; type: string | null }
type ContactPhone = { value: string; type: string | null; status: string | null }

type GroupedContact = {
  contactId: string
  contactName: string
  contactRole: string
  contactPhoto: string | null
  isCurrent: boolean
  keywords: string[]
  linkedinUrl: string | null
  emails: ContactEmail[]
  phones: ContactPhone[]
}

type SmartContext = {
  filterType: "process" | "technology" | "general"
  totalSignals: number
  currentEmployees: GroupedContact[]
  alumni: GroupedContact[]
  logicUsed: string
}

export function BookmarkOverview({ bookmarkId, company, countryFilter, scopeVersion }: { bookmarkId: string; company: any; countryFilter?: string | null; scopeVersion?: number }) {
  const [smartContext, setSmartContext] = useState<SmartContext | null>(null)
  const [loading, setLoading] = useState(true)
  // Buscador por keyword: filtra las senales por nombre/apellido, cargo y keywords
  const [searchQuery, setSearchQuery] = useState("")
  const deferredQuery = useDeferredValue(searchQuery)

  // Filtrado client-side. Match case/diacritic-insensitive sobre nombre+apellido,
  // cargo (contactRole) y keywords/senales detectadas asociadas al contacto.
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")

  const filterContacts = (contacts: GroupedContact[], q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return contacts
    const needle = normalize(trimmed)
    return contacts.filter((c) => {
      const haystack = [
        c.contactName || "",
        c.contactRole || "",
        ...(c.keywords || []),
      ]
        .map((s) => normalize(String(s)))
        .join(" | ")
      return haystack.includes(needle)
    })
  }

  const filteredCurrentEmployees = useMemo(
    () => (smartContext ? filterContacts(smartContext.currentEmployees, deferredQuery) : []),
    [smartContext, deferredQuery],
  )
  const filteredAlumni = useMemo(
    () => (smartContext ? filterContacts(smartContext.alumni, deferredQuery) : []),
    [smartContext, deferredQuery],
  )
  const totalFiltered = filteredCurrentEmployees.length + filteredAlumni.length
  const totalUnfiltered = smartContext
    ? smartContext.currentEmployees.length + smartContext.alumni.length
    : 0
  const isSearching = deferredQuery.trim().length > 0

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

    if (bookmarkId) {
      fetchContext()
    }
  }, [bookmarkId, countryFilter, scopeVersion])

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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(`${label} copiado al portapapeles`)
  }

  const getEmailStatusIcon = (status: string | null) => {
    if (!status) return null
    const isValid = status.toLowerCase() === "valid" || status.toLowerCase() === "verified"
    return isValid ? (
      <CheckCircle2 className="h-3 w-3 text-green-500" />
    ) : (
      <AlertCircle className="h-3 w-3 text-amber-500" />
    )
  }

  const getEmailStatusLabel = (status: string | null, type: string | null) => {
    const parts: string[] = []
    if (status) parts.push(status === "valid" || status === "verified" ? "Verificado" : status)
    if (type) parts.push(type === "professional" ? "Corporativo" : type)
    return parts.join(" · ") || "Email"
  }

  const ContactCard = ({ contact, isAlumni = false }: { contact: GroupedContact; isAlumni?: boolean }) => (
    <div className="flex items-start gap-3 p-3 bg-white dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800">
      <Avatar className="h-10 w-10 border border-slate-200 shrink-0">
        <AvatarImage src={contact.contactPhoto || ""} />
        <AvatarFallback className="bg-slate-100 text-slate-500">
          <User className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <p className="text-sm font-medium truncate">{contact.contactName}</p>
          <p className="text-xs text-muted-foreground truncate">{contact.contactRole}</p>
        </div>

        {/* Botones de acción */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <TooltipProvider delayDuration={100}>
            {/* LinkedIn */}
            {contact.linkedinUrl && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 gap-1 text-[#0077B5] border-[#0077B5]/30 hover:bg-[#0077B5]/10 bg-transparent"
                    onClick={() => window.open(contact.linkedinUrl!, "_blank")}
                  >
                    <Linkedin className="h-3.5 w-3.5" />
                    <span className="text-xs">LinkedIn</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Abrir perfil de LinkedIn</TooltipContent>
              </Tooltip>
            )}

            {/* Emails: se muestran TODOS los disponibles (corporativo + personales),
                antes se colapsaba a uno solo y el corporativo quedaba oculto. */}
            {!isAlumni &&
              contact.emails.map((em, i) => (
                <Tooltip key={`email-${i}-${em.value}`}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 gap-1 bg-transparent"
                      onClick={() => copyToClipboard(em.value, "Email")}
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {getEmailStatusIcon(em.status)}
                      <span className="text-xs max-w-[100px] truncate">{em.value}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs">
                      <div>{em.value}</div>
                      <div className="text-muted-foreground">{getEmailStatusLabel(em.status, em.type)}</div>
                      <div className="text-muted-foreground mt-1">Click para copiar</div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}

            {/* Teléfonos: se muestran TODOS los disponibles. */}
            {!isAlumni &&
              contact.phones.map((ph, i) => (
                <Tooltip key={`phone-${i}-${ph.value}`}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 gap-1 bg-transparent"
                      onClick={() => copyToClipboard(ph.value, "Teléfono")}
                    >
                      <Phone className="h-3.5 w-3.5" />
                      <span className="text-xs">{ph.value}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs">
                      <div>{ph.value}</div>
                      {ph.type && <div className="text-muted-foreground">{ph.type}</div>}
                      <div className="text-muted-foreground mt-1">Click para copiar</div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
          </TooltipProvider>
        </div>

        {/* Keywords/Señales */}
        <div className="flex flex-wrap gap-1">
          {contact.keywords.slice(0, 3).map((keyword, i) => (
            <Badge key={i} variant="secondary" className="text-[10px] bg-slate-100 text-slate-700 whitespace-nowrap">
              {keyword}
            </Badge>
          ))}
          {contact.keywords.length > 3 && (
            <Badge variant="outline" className="text-[10px] whitespace-nowrap">
              +{contact.keywords.length - 3}
            </Badge>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="grid gap-6">
      {/* Context Card - Only shown if context exists */}
      {smartContext && (smartContext.currentEmployees.length > 0 || smartContext.alumni.length > 0) ? (
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

              {/* Buscador por keyword sobre las senales filtradas (cliente-side). */}
              <div className="flex flex-col gap-1">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar por nombre, apellido, cargo o señal..."
                    className="h-9 pl-8 pr-9 bg-white dark:bg-slate-900"
                    aria-label="Buscar dentro de las señales del bookmark"
                  />
                  {searchQuery && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                      onClick={() => setSearchQuery("")}
                      aria-label="Limpiar búsqueda"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {isSearching && (
                  <p className="text-[11px] text-muted-foreground pl-1">
                    {totalFiltered === 0
                      ? "Sin coincidencias"
                      : `${totalFiltered} de ${totalUnfiltered} señal${totalUnfiltered === 1 ? "" : "es"} coincide${totalFiltered === 1 ? "" : "n"}`}
                  </p>
                )}
              </div>

              {filteredCurrentEmployees.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wider">
                    <Users className="h-3.5 w-3.5" />
                    Empleados Actuales (
                    {isSearching
                      ? `${filteredCurrentEmployees.length}/${smartContext.currentEmployees.length}`
                      : smartContext.currentEmployees.length}
                    )
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredCurrentEmployees.map((contact) => (
                      <ContactCard key={contact.contactId} contact={contact} isAlumni={false} />
                    ))}
                  </div>
                </div>
              )}

              {filteredAlumni.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    <GraduationCap className="h-3.5 w-3.5" />
                    Ex-empleados / Alumni (
                    {isSearching
                      ? `${filteredAlumni.length}/${smartContext.alumni.length}`
                      : smartContext.alumni.length}
                    )
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredAlumni.map((contact) => (
                      <ContactCard key={contact.contactId} contact={contact} isAlumni={true} />
                    ))}
                  </div>
                </div>
              )}

              {isSearching && totalFiltered === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground bg-white/40 dark:bg-black/20 rounded-lg border border-dashed border-blue-200/60 dark:border-blue-900/40">
                  <Search className="h-5 w-5 mx-auto mb-2 opacity-50" />
                  No encontramos coincidencias para <strong className="text-foreground">&quot;{deferredQuery}&quot;</strong> dentro de las señales del bookmark.
                </div>
              )}
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
