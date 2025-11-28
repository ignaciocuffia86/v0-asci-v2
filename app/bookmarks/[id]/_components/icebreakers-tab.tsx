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

interface Contact {
  id: string
  full_name: string
  first_name: string | null
  role: string | null
  profile_picture_url: string | null
  source: "signal" | "private"
  has_signal: boolean
  signal_products?: string[]
}

interface IcebreakerResult {
  linkedin: string
  email: string
}

export function BookmarkIcebreakers({ bookmarkId, companyName }: { bookmarkId: string; companyName: string }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [icebreakers, setIcebreakers] = useState<any[]>([])
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
    const [contactsData, icebreakersData] = await Promise.all([
      getContactsForIcebreaker(bookmarkId),
      getIcebreakers(bookmarkId),
    ])
    setContacts(contactsData)
    setIcebreakers(icebreakersData)
    setIsLoading(false)
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

      const result = await generateSimplifiedIcebreaker(bookmarkId, selectedContact, contactSource)
      setGeneratedResult(result)
      await loadData() // Refresh history
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

  const selectedContactData = contacts.find((c) => c.id === selectedContact)

  // Separar contactos por tipo
  const signalContacts = contacts.filter((c) => c.source === "signal")
  const decisionMakerContacts = contacts.filter((c) => c.source === "private")

  return (
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
                        Contactos con Señales
                      </div>
                      {signalContacts.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <div className="flex items-center gap-2">
                            <span>{c.full_name}</span>
                            {c.signal_products && c.signal_products.length > 0 && (
                              <Badge variant="secondary" className="text-[10px] px-1 h-4">
                                {c.signal_products.slice(0, 2).join(", ")}
                              </Badge>
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
                        Tomadores de Decisión
                      </div>
                      {decisionMakerContacts.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <div className="flex items-center gap-2">
                            <span>{c.full_name}</span>
                            <span className="text-muted-foreground text-xs">({c.role})</span>
                          </div>
                        </SelectItem>
                      ))}
                    </>
                  )}

                  {contacts.length === 0 && (
                    <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                      No hay contactos disponibles. Busca tomadores de decisión.
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Info del contacto seleccionado */}
            {selectedContactData && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-white dark:bg-slate-900 border">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={selectedContactData.profile_picture_url || undefined} />
                  <AvatarFallback>
                    {selectedContactData.full_name
                      ?.split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{selectedContactData.full_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{selectedContactData.role || "Sin cargo"}</p>
                </div>
                {selectedContactData.has_signal && (
                  <Badge variant="outline" className="text-xs shrink-0">
                    Tiene señal
                  </Badge>
                )}
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
                <p className="text-xs text-muted-foreground mt-2">{generatedResult.linkedin.length} / 300 caracteres</p>
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

      {/* History Column */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Historial
        </h2>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : icebreakers.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Sparkles className="h-8 w-8 text-muted-foreground mb-4" />
              <p className="text-muted-foreground max-w-sm">Aún no has generado mensajes para este bookmark.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
            {icebreakers.map((ib) => (
              <Card key={ib.id} className="relative">
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs font-normal">
                        {ib.contact_name || companyName}
                      </Badge>
                      <Badge variant="secondary" className="text-xs font-normal">
                        {ib.message_type === "linkedin" ? "LinkedIn" : "Email"}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(ib.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-4 pb-3">
                  <div className="bg-muted/30 p-3 rounded-md text-sm whitespace-pre-wrap text-muted-foreground line-clamp-4">
                    {ib.generated_text}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs gap-1 mt-2"
                    onClick={() => copyToClipboard(ib.generated_text, ib.id)}
                  >
                    {copiedField === ib.id ? (
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
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
