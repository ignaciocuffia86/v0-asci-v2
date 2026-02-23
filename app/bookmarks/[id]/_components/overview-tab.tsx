"use client"

import { useEffect, useState } from "react"
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
} from "lucide-react"
import { getBookmarkSmartContext } from "@/app/actions/workspace"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"

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

export function BookmarkOverview({ bookmarkId, company, countryFilter }: { bookmarkId: string; company: any; countryFilter?: string | null }) {
  const [smartContext, setSmartContext] = useState<SmartContext | null>(null)
  const [loading, setLoading] = useState(true)

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
  }, [bookmarkId, countryFilter])

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

            {/* Email */}
            {!isAlumni && contact.email && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 gap-1 bg-transparent"
                    onClick={() => copyToClipboard(contact.email!, "Email")}
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {getEmailStatusIcon(contact.emailStatus)}
                    <span className="text-xs max-w-[100px] truncate">{contact.email}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-xs">
                    <div>{contact.email}</div>
                    <div className="text-muted-foreground">
                      {getEmailStatusLabel(contact.emailStatus, contact.emailType)}
                    </div>
                    <div className="text-muted-foreground mt-1">Click para copiar</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Teléfono */}
            {!isAlumni && contact.phone && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 gap-1 bg-transparent"
                    onClick={() => copyToClipboard(contact.phone!, "Teléfono")}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    <span className="text-xs">{contact.phone}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-xs">
                    <div>{contact.phone}</div>
                    {contact.phoneType && <div className="text-muted-foreground">{contact.phoneType}</div>}
                    <div className="text-muted-foreground mt-1">Click para copiar</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
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

              {smartContext.currentEmployees.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wider">
                    <Users className="h-3.5 w-3.5" />
                    Empleados Actuales ({smartContext.currentEmployees.length})
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {smartContext.currentEmployees.map((contact) => (
                      <ContactCard key={contact.contactId} contact={contact} isAlumni={false} />
                    ))}
                  </div>
                </div>
              )}

              {smartContext.alumni.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    <GraduationCap className="h-3.5 w-3.5" />
                    Ex-empleados / Alumni ({smartContext.alumni.length})
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {smartContext.alumni.map((contact) => (
                      <ContactCard key={contact.contactId} contact={contact} isAlumni={true} />
                    ))}
                  </div>
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
