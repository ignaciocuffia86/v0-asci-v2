"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Sparkles,
  Loader2,
  Copy,
  Check,
  Linkedin,
  Mail,
  MessageSquare,
  RefreshCw,
  Search,
  UserPlus,
  Phone,
  ExternalLink,
  BadgeCheck,
  MessageCircle,
} from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  getIcebreakers,
  generateSimplifiedIcebreaker,
  getContactsForIcebreaker,
  searchDecisionMakers,
} from "@/app/actions/workspace"
import { getActiveIcebreakerTemplates, type IcebreakerTemplate } from "@/app/actions/templates"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface Contact {
  id: string
  full_name: string
  first_name?: string
  headline?: string
  current_position_title?: string
  role?: string
  profile_picture_url?: string | null
  linkedin_url?: string | null
  email1?: string | null
  email1_status?: string | null
  phone1?: string | null
  products?: string[]
  source: "signal" | "private"
  has_signal?: boolean
}

interface IcebreakerResult {
  linkedin: string
  email: string
}

interface IcebreakerHistory {
  id: string
  generated_text: string
  message_type: string
  created_at: string
  contact_name?: string
  contact_id?: string
  contact?: {
    id: string
    full_name: string
    first_name?: string
    headline?: string
    current_position_title?: string
    profile_picture_url?: string
    linkedin_url?: string
    email1?: string
    email1_status?: string
    phone1?: string
  } | null
}

export function BookmarkIcebreakers({ bookmarkId, companyName }: { bookmarkId: string; companyName: string }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [icebreakers, setIcebreakers] = useState<IcebreakerHistory[]>([])
  const [templates, setTemplates] = useState<IcebreakerTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>("")
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedContact, setSelectedContact] = useState<string>("")
  const [generatedResult, setGeneratedResult] = useState<IcebreakerResult | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Dialog para buscar decision makers
  const [dialogOpen, setDialogOpen] = useState(false)
  const [roleQuery, setRoleQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [contactsData, icebreakersData, templatesData] = await Promise.all([
        getContactsForIcebreaker(bookmarkId),
        getIcebreakers(bookmarkId),
        getActiveIcebreakerTemplates(),
      ])
      setContacts(contactsData ?? [])
      setIcebreakers(icebreakersData ?? [])
      setTemplates(templatesData ?? [])
      if (templatesData?.length > 0 && !selectedTemplate) {
        setSelectedTemplate(templatesData[0].id)
      }
    } catch (error) {
      console.error("[v0] Error loading icebreaker data:", error)
      setContacts([])
      setIcebreakers([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [bookmarkId])

  const handleGenerate = async () => {
    if (!selectedContact) {
      return
    }

    setIsGenerating(true)
    setGeneratedResult(null)

    try {
      const contactData = contacts.find((c) => c.id === selectedContact)
      const contactSource = contactData?.source || "signal"

      const result = await generateSimplifiedIcebreaker(bookmarkId, selectedContact, contactSource, selectedTemplate || undefined)
      setGeneratedResult(result)
      await loadData()
    } catch (error) {
      console.error("Failed to generate icebreaker", error)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSearchDecisionMakers = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!roleQuery.trim()) return

    setIsSearching(true)
    try {
      await searchDecisionMakers(bookmarkId, roleQuery)
      await loadData()
      setDialogOpen(false)
      setRoleQuery("")
    } catch (error) {
      console.error("Failed to search decision makers", error)
    } finally {
      setIsSearching(false)
    }
  }

  const copyToClipboard = async (text: string, field: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const selectedContactData = (contacts ?? []).find((c) => c.id === selectedContact)

  const signalContacts = (contacts ?? []).filter((c) => c.source === "signal")
  const decisionMakerContacts = (contacts ?? []).filter((c) => c.source === "private")

  const generateWhatsAppLink = (phone: string, contactName: string) => {
    // Limpiar el número de teléfono (remover espacios, guiones, etc.)
    const cleanPhone = phone.replace(/[\s\-$$$$]/g, "").replace(/^\+/, "")

    // Mensaje corto y respetuoso para WhatsApp
    const message = `Hola ${contactName.split(" ")[0]}, disculpá el contacto por este medio. Te escribí por LinkedIn hace unos días sobre cómo desde bigua.lat podríamos colaborar con tu equipo. ¿Tendrías unos minutos para conversar?`

    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
  }

  const parseGeneratedText = (text: string): { linkedin: string; email: string } => {
    // Intentar extraer con diferentes formatos de delimitadores
    const linkedinMatch = text.match(/---LINKEDIN---\s*([\s\S]*?)(?=---EMAIL---|$)/i)
    const emailMatch = text.match(/---EMAIL---\s*([\s\S]*?)$/i)

    if (linkedinMatch && emailMatch) {
      return {
        linkedin: linkedinMatch[1].trim(),
        email: emailMatch[1].trim(),
      }
    }

    // Si no hay delimitadores, intentar dividir por patrones comunes
    const parts = text.split(/(?:Hola [^,]+, te escribí por LinkedIn)/i)
    if (parts.length === 2) {
      return {
        linkedin: parts[0].trim(),
        email: "Hola" + parts[1].trim(),
      }
    }

    // Fallback: devolver todo como linkedin
    return { linkedin: text, email: "" }
  }

  // Agrupar icebreakers por contact_id y fecha (para mostrar LinkedIn + Email juntos)
  const groupedIcebreakers = (icebreakers ?? []).reduce(
    (acc, ib) => {
      const key = `${ib.contact_id || "no-contact"}-${new Date(ib.created_at).toDateString()}`
      if (!acc[key]) {
        acc[key] = {
          contact: ib.contact,
          contact_name: ib.contact_name,
          date: ib.created_at,
          linkedin: null as IcebreakerHistory | null,
          email: null as IcebreakerHistory | null,
          parsedFromLegacy: null as { linkedin: string; email: string } | null,
        }
      }
      if (ib.message_type === "linkedin") {
        acc[key].linkedin = ib
      } else if (ib.message_type === "email") {
        acc[key].email = ib
      } else {
        acc[key].parsedFromLegacy = parseGeneratedText(ib.generated_text)
        // Crear objetos fake para mantener compatibilidad
        acc[key].linkedin = { ...ib, generated_text: acc[key].parsedFromLegacy.linkedin, message_type: "linkedin" }
        if (acc[key].parsedFromLegacy.email) {
          acc[key].email = {
            ...ib,
            id: ib.id + "-email",
            generated_text: acc[key].parsedFromLegacy.email,
            message_type: "email",
          }
        }
      }
      return acc
    },
    {} as Record<
      string,
      {
        contact: IcebreakerHistory["contact"]
        contact_name?: string
        date: string
        linkedin: IcebreakerHistory | null
        email: IcebreakerHistory | null
        parsedFromLegacy: { linkedin: string; email: string } | null
      }
    >,
  )

  return (
    <TooltipProvider>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Generator Column */}
        <div className="space-y-4">
          <Card className="border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-500">
                <Sparkles className="h-5 w-5" />
                Generar Icebreaker
              </CardTitle>
              <CardDescription>Genera un mensaje de LinkedIn y un email de seguimiento personalizados.</CardDescription>
              {/* Signal tags at tab level (shown once, not per contact) */}
              {(() => {
                const allProducts = [...new Set(signalContacts.flatMap((c) => c.products ?? []))]
                if (allProducts.length === 0) return null
                return (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {allProducts.map((p) => (
                      <Badge key={p} variant="secondary" className="text-[10px] px-1.5 h-5">
                        {p}
                      </Badge>
                    ))}
                  </div>
                )
              })()}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Selector de contacto */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Seleccionar contacto</Label>
                  <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                        <UserPlus className="h-3 w-3" />
                        Buscar DM
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Buscar Tomadores de Decisión</DialogTitle>
                        <DialogDescription>
                          Busca perfiles por cargo (ej: CEO, CTO, VP Engineering) en nuestra base de datos.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleSearchDecisionMakers}>
                        <div className="grid gap-4 py-4">
                          <div className="grid gap-2">
                            <Label htmlFor="role">Cargo / Rol</Label>
                            <Input
                              id="role"
                              placeholder="Ej: VP of Engineering"
                              value={roleQuery}
                              onChange={(e) => setRoleQuery(e.target.value)}
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button type="submit" disabled={isSearching || !roleQuery.trim()}>
                            {isSearching ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <Search className="h-4 w-4 mr-2" />
                            )}
                            Buscar y Guardar
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>

                <Select value={selectedContact} onValueChange={setSelectedContact}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un contacto..." />
                  </SelectTrigger>
                  <SelectContent>
                    {signalContacts.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                          Contactos con Senales
                        </div>
                        {signalContacts.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            <div className="flex items-center gap-2">
                              <span>{c.full_name}</span>
                              {(c.current_position_title || c.headline) && (
                                <span className="text-muted-foreground text-xs truncate max-w-[180px]">
                                  {c.current_position_title || c.headline}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </>
                    )}

                    {decisionMakerContacts.length > 0 && (
                      <>
                        <Separator className="my-1" />
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                          Tomadores de Decision
                        </div>
                        {decisionMakerContacts.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            <div className="flex items-center gap-2">
                              <span>{c.full_name}</span>
                              {c.role && (
                                <span className="text-muted-foreground text-xs truncate max-w-[180px]">
                                  {c.role}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </>
                    )}

                    {(contacts ?? []).length === 0 && (
                      <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                        No hay contactos disponibles. Busca tomadores de decisión.
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Info del contacto seleccionado - MEJORADA */}
              {selectedContactData && (
                <Card className="bg-white dark:bg-slate-900">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={selectedContactData.profile_picture_url || undefined} />
                        <AvatarFallback className="bg-amber-100 text-amber-700">
                          {selectedContactData.full_name
                            ?.split(" ")
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{selectedContactData.full_name}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {selectedContactData.current_position_title ||
                            selectedContactData.headline ||
                            selectedContactData.role ||
                            "Sin cargo"}
                        </p>
                        {selectedContactData.has_signal && (
                          <Badge variant="outline" className="text-xs mt-1">
                            Tiene señal
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Botones de acción del contacto */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {selectedContactData.linkedin_url && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-transparent" asChild>
                              <a href={selectedContactData.linkedin_url} target="_blank" rel="noopener noreferrer">
                                <Linkedin className="h-3.5 w-3.5 text-[#0077b5]" />
                                LinkedIn
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Abrir perfil de LinkedIn</TooltipContent>
                        </Tooltip>
                      )}

                      {selectedContactData.email1 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 bg-transparent"
                              onClick={() =>
                                copyToClipboard(selectedContactData.email1!, `email-${selectedContactData.id}`)
                              }
                            >
                              <Mail className="h-3.5 w-3.5 text-orange-500" />
                              {copiedField === `email-${selectedContactData.id}` ? "Copiado" : "Email"}
                              {selectedContactData.email1_status === "valid" && (
                                <BadgeCheck className="h-3.5 w-3.5 text-green-500" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {selectedContactData.email1}
                            {selectedContactData.email1_status === "valid" && " (verificado)"}
                          </TooltipContent>
                        </Tooltip>
                      )}

                      {selectedContactData.phone1 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 bg-transparent"
                              onClick={() =>
                                copyToClipboard(selectedContactData.phone1!, `phone-${selectedContactData.id}`)
                              }
                            >
                              <Phone className="h-3.5 w-3.5 text-green-600" />
                              {copiedField === `phone-${selectedContactData.id}` ? "Copiado" : "Teléfono"}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{selectedContactData.phone1}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Selector de tono */}
              {templates.length > 0 && (
                <div className="space-y-2">
                  <Label>Tono del mensaje</Label>
                  <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                    <SelectTrigger>
                      {/* Show only the name in the trigger to avoid overflow */}
                      <span className="truncate">
                        {templates.find((t) => t.id === selectedTemplate)?.name ?? "Selecciona un tono..."}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          <div className="flex flex-col gap-0.5 py-0.5">
                            <span className="font-medium">{t.name}</span>
                            {t.description && (
                              <span className="text-muted-foreground text-xs leading-snug max-w-[260px] whitespace-normal">
                                {t.description}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0"
                onClick={handleGenerate}
                disabled={isGenerating || !selectedContact}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generando mensajes...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generar Icebreaker
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Resultado generado */}
          {generatedResult && (
            <div className="space-y-4">
              {/* LinkedIn Message */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Linkedin className="h-4 w-4 text-[#0077b5]" />
                      <CardTitle className="text-sm font-medium">Mensaje de Conexión LinkedIn</CardTitle>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1"
                      onClick={() => copyToClipboard(generatedResult.linkedin, "linkedin")}
                    >
                      {copiedField === "linkedin" ? (
                        <>
                          <Check className="h-3 w-3" />
                          Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copiar
                        </>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-md text-sm whitespace-pre-wrap">
                    {generatedResult.linkedin}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {generatedResult.linkedin.length} / 300 caracteres
                  </p>
                </CardContent>
              </Card>

              {/* Email Message */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-orange-500" />
                      <CardTitle className="text-sm font-medium">Email de Seguimiento</CardTitle>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1"
                      onClick={() => copyToClipboard(generatedResult.email, "email")}
                    >
                      {copiedField === "email" ? (
                        <>
                          <Check className="h-3 w-3" />
                          Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copiar
                        </>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-md text-sm whitespace-pre-wrap">
                    {generatedResult.email}
                  </div>
                </CardContent>
              </Card>

              {/* Regenerar */}
              <Button
                variant="outline"
                className="w-full bg-transparent"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerar mensajes
              </Button>
            </div>
          )}
        </div>

        {/* History Column - REDISEÑADA */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Historial
          </h2>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : Object.keys(groupedIcebreakers).length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Sparkles className="h-8 w-8 text-muted-foreground mb-4" />
                <p className="text-muted-foreground max-w-sm">Aún no has generado mensajes para este bookmark.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4 max-h-[700px] overflow-y-auto pr-2">
              {Object.entries(groupedIcebreakers).map(([key, group]) => (
                <Card key={key} className="overflow-hidden">
                  {/* Header con info del contacto */}
                  <div className="bg-muted/30 px-4 py-3 border-b">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={group.contact?.profile_picture_url || undefined} />
                          <AvatarFallback className="bg-amber-100 text-amber-700 text-xs">
                            {(group.contact?.full_name || group.contact_name || companyName)
                              ?.split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">
                            {group.contact?.full_name || group.contact_name || companyName}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {group.contact?.current_position_title || group.contact?.headline || ""}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(group.date).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Botones de acción del contacto en historial */}
                    {group.contact && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {group.contact.linkedin_url && (
                          <Button variant="secondary" size="sm" className="h-6 text-xs gap-1 px-2" asChild>
                            <a href={group.contact.linkedin_url} target="_blank" rel="noopener noreferrer">
                              <Linkedin className="h-3 w-3 text-[#0077b5]" />
                              LinkedIn
                            </a>
                          </Button>
                        )}

                        {group.contact.email1 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-6 text-xs gap-1 px-2"
                                onClick={() => copyToClipboard(group.contact!.email1!, `hist-email-${key}`)}
                              >
                                <Mail className="h-3 w-3 text-orange-500" />
                                {copiedField === `hist-email-${key}` ? "Copiado" : "Email"}
                                {group.contact.email1_status === "valid" && (
                                  <BadgeCheck className="h-3 w-3 text-green-500" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{group.contact.email1}</TooltipContent>
                          </Tooltip>
                        )}

                        {group.contact.phone1 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-6 text-xs gap-1 px-2"
                                onClick={() => copyToClipboard(group.contact!.phone1!, `hist-phone-${key}`)}
                              >
                                <Phone className="h-3 w-3 text-green-600" />
                                {copiedField === `hist-phone-${key}` ? "Copiado" : "Tel"}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{group.contact.phone1}</TooltipContent>
                          </Tooltip>
                        )}

                        {group.contact.phone1 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-6 text-xs gap-1 px-2 bg-green-500 hover:bg-green-600 text-white dark:bg-green-600 dark:hover:bg-green-500"
                                asChild
                              >
                                <a
                                  href={generateWhatsAppLink(
                                    group.contact.phone1,
                                    group.contact.full_name || group.contact_name || "Hola",
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <MessageCircle className="h-3 w-3 text-green-600" />
                                  WhatsApp
                                </a>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Enviar mensaje por WhatsApp</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Mensajes */}
                  <CardContent className="p-4 space-y-4">
                    {/* LinkedIn */}
                    {group.linkedin && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Linkedin className="h-3.5 w-3.5 text-[#0077b5]" />
                            LinkedIn
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs gap-1 px-2"
                            onClick={() =>
                              copyToClipboard(group.linkedin!.generated_text, `hist-li-${group.linkedin!.id}`)
                            }
                          >
                            {copiedField === `hist-li-${group.linkedin!.id}` ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                        <div className="bg-muted/30 p-3 rounded-md text-sm whitespace-pre-wrap">
                          {group.linkedin.generated_text}
                        </div>
                      </div>
                    )}

                    {/* Email */}
                    {group.email && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <Mail className="h-3.5 w-3.5 text-orange-500" />
                            Email de Seguimiento
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs gap-1 px-2"
                            onClick={() => copyToClipboard(group.email!.generated_text, `hist-em-${group.email!.id}`)}
                          >
                            {copiedField === `hist-em-${group.email!.id}` ? (
                              <Check className="h-3 w-3" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                        <div className="bg-muted/30 p-3 rounded-md text-sm whitespace-pre-wrap">
                          {group.email.generated_text}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
