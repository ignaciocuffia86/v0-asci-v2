"use client"

import { Badge } from "@/components/ui/badge"
import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sparkles, Loader2, Copy, MessageSquare } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { getIcebreakers, generateIcebreaker, getPrivateContacts } from "@/app/actions/workspace"
import { getActiveIcebreakerTemplates } from "@/app/actions/templates"

export function BookmarkIcebreakers({ bookmarkId, companyName }: { bookmarkId: string; companyName: string }) {
  const [icebreakers, setIcebreakers] = useState<any[]>([])
  const [contacts, setContacts] = useState<any[]>([])
  const [templates, setTemplates] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)

  const [selectedContact, setSelectedContact] = useState<string>("")
  const [selectedTemplate, setSelectedTemplate] = useState<string>("")

  const loadData = async () => {
    setIsLoading(true)
    const [ibData, cData, tData] = await Promise.all([
      getIcebreakers(bookmarkId),
      getPrivateContacts(bookmarkId),
      getActiveIcebreakerTemplates(),
    ])
    setIcebreakers(ibData)
    setContacts(cData)
    setTemplates(tData)

    if (tData.length > 0 && !selectedTemplate) {
      setSelectedTemplate(tData[0].id)
    }

    setIsLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [bookmarkId])

  const handleGenerate = async () => {
    if (!selectedTemplate) {
      alert("Por favor selecciona un template")
      return
    }

    setIsGenerating(true)
    try {
      await generateIcebreaker(bookmarkId, selectedContact === "general" ? null : selectedContact, selectedTemplate)
      await loadData()
    } catch (error) {
      console.error("Failed to generate", error)
    } finally {
      setIsGenerating(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Generator Column */}
      <div className="lg:col-span-1 space-y-6">
        <Card className="border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-500">
              <Sparkles className="h-5 w-5" />
              Nuevo Icebreaker
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Destinatario</Label>
              <Select value={selectedContact} onValueChange={setSelectedContact}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un contacto..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General (Equipo / Sin contacto)</SelectItem>
                  {contacts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name} ({c.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Estrategia / Template</Label>
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un template..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      <div className="flex flex-col items-start">
                        <span>{template.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0"
              onClick={handleGenerate}
              disabled={isGenerating || !selectedTemplate}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generando con IA...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generar Mensaje
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* History Column */}
      <div className="lg:col-span-2 space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Historial Generado
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
          <div className="grid gap-4">
            {icebreakers.map((ib) => (
              <Card key={ib.id} className="relative group">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs font-normal">
                          {ib.contact ? `Para: ${ib.contact.full_name}` : `Para: ${companyName}`}
                        </Badge>
                        <Badge variant="secondary" className="text-xs font-normal">
                          {ib.template_name || ib.template_used}
                        </Badge>
                        <Badge variant="outline" className="text-xs font-normal capitalize">
                          {ib.tone}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(ib.created_at).toLocaleString()}</span>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => copyToClipboard(ib.generated_text)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="bg-muted/30 p-4 rounded-md text-sm whitespace-pre-wrap font-mono text-muted-foreground">
                    {ib.generated_text}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
