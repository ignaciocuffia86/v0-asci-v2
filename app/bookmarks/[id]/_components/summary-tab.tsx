"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  FileDown,
  FileText,
  RefreshCw,
  Loader2,
  AlertCircle,
  Users,
  Newspaper,
  Briefcase,
  Target,
  Linkedin,
  Mail,
  Phone,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { jsPDF } from "jspdf"

const BIGUA_LOGO_URL = "/images/isologo-negro.png"

interface KeyContact {
  name: string
  role: string
  email: string | null
  phone: string | null
  linkedin: string | null
  source: "prospect" | "signal"
}

interface SummaryTabProps {
  bookmarkId: string
  companyName: string
}

export function SummaryTab({ bookmarkId, companyName }: SummaryTabProps) {
  const [summary, setSummary] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    fetchSummary()
  }, [bookmarkId])

  const fetchSummary = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from("bookmark_summaries")
        .select("*")
        .eq("bookmark_id", bookmarkId)
        .maybeSingle()

      if (error) throw error
      setSummary(data)
    } catch (error: any) {
      console.error("Error fetching summary:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleGenerateSummary = async () => {
    setIsGenerating(true)
    try {
      const response = await fetch(`/api/bookmarks/${bookmarkId}/generate-summary`, {
        method: "POST",
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Error generando brief")
      }

      const data = await response.json()
      setSummary(data.summary)

      toast({
        title: "Brief generado",
        description: "El brief ejecutivo ha sido generado exitosamente",
      })
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "No se pudo generar el brief",
        variant: "destructive",
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const handleDownloadPDF = async () => {
    if (!summary) return

    setIsDownloading(true)

    try {
      const sections = parseSummary(summary.summary)
      const keyContacts: KeyContact[] = summary.metadata?.key_contacts || []
      const generatedDate = new Date(summary.generated_at).toLocaleDateString("es-ES", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })

      // Create PDF with jsPDF
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      })

      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 20
      const contentWidth = pageWidth - margin * 2
      let yPosition = margin

      let logoLoaded = false
      let logoImage: HTMLImageElement | null = null

      try {
        logoImage = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.crossOrigin = "anonymous"
          img.onload = () => resolve(img)
          img.onerror = reject
          img.src = BIGUA_LOGO_URL
        })
        logoLoaded = true
      } catch (e) {
        console.warn("[v0] Could not load logo, continuing without it")
      }

      // Helper function to add text with word wrap
      const addWrappedText = (text: string, fontSize: number, isBold = false, color: number[] = [51, 65, 85]) => {
        doc.setFontSize(fontSize)
        doc.setFont("helvetica", isBold ? "bold" : "normal")
        doc.setTextColor(color[0], color[1], color[2])

        const lines = doc.splitTextToSize(text, contentWidth)

        for (const line of lines) {
          if (yPosition > pageHeight - margin - 10) {
            doc.addPage()
            yPosition = margin
          }
          doc.text(line, margin, yPosition)
          yPosition += fontSize * 0.4
        }

        return yPosition
      }

      const addSection = (title: string, content: string, iconColor: number[]) => {
        // Add spacing before section
        yPosition += 5

        // Check if we need a new page
        if (yPosition > pageHeight - 50) {
          doc.addPage()
          yPosition = margin
        }

        // Section title with colored bar
        doc.setFillColor(iconColor[0], iconColor[1], iconColor[2])
        doc.rect(margin, yPosition - 4, 3, 8, "F")

        doc.setFontSize(12)
        doc.setFont("helvetica", "bold")
        doc.setTextColor(30, 64, 175)
        doc.text(title, margin + 6, yPosition)
        yPosition += 8

        const processedContent = content || "No disponible."

        // Section content
        addWrappedText(processedContent, 10, false, [71, 85, 105])
        yPosition += 3
      }

      const addContactsSection = (contacts: KeyContact[], iconColor: number[]) => {
        yPosition += 5

        if (yPosition > pageHeight - 50) {
          doc.addPage()
          yPosition = margin
        }

        // Section title with colored bar
        doc.setFillColor(iconColor[0], iconColor[1], iconColor[2])
        doc.rect(margin, yPosition - 4, 3, 8, "F")

        doc.setFontSize(12)
        doc.setFont("helvetica", "bold")
        doc.setTextColor(30, 64, 175)
        doc.text("3. Contactos Clave", margin + 6, yPosition)
        yPosition += 8

        if (contacts.length === 0) {
          addWrappedText("No hay contactos identificados.", 10, false, [71, 85, 105])
        } else {
          for (const contact of contacts) {
            if (yPosition > pageHeight - margin - 15) {
              doc.addPage()
              yPosition = margin
            }

            // Contact line
            const contactLine = `- ${contact.name} | ${contact.role} | ${contact.email || "No disponible"} | ${contact.phone || "No disponible"}`
            addWrappedText(contactLine, 9, false, [71, 85, 105])

            // LinkedIn on separate line if available
            if (contact.linkedin) {
              doc.setFontSize(8)
              doc.setTextColor(37, 99, 235)
              doc.textWithLink(contact.linkedin, margin + 5, yPosition, { url: contact.linkedin })
              yPosition += 4
            }
            yPosition += 2
          }
        }
        yPosition += 3
      }

      doc.setFillColor(37, 99, 235)
      doc.rect(0, 0, pageWidth, 40, "F")

      // Agregar logo si se cargó
      if (logoLoaded && logoImage) {
        doc.setFillColor(255, 255, 255)
        doc.circle(margin + 10, 20, 12, "F")
        doc.addImage(logoImage, "PNG", margin + 2, 8, 16, 16)
      }

      const titleX = logoLoaded ? margin + 25 : margin

      doc.setFontSize(18)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(255, 255, 255)
      doc.text(`Brief Ejecutivo: ${companyName}`, titleX, 18)

      doc.setFontSize(10)
      doc.setFont("helvetica", "normal")
      doc.text(`Generado el ${generatedDate}`, titleX, 26)

      if (summary.metadata) {
        const statsText = `${summary.metadata.signals_count || 0} señales • ${summary.metadata.decision_makers_count || 0} contactos • ${summary.metadata.news_count || 0} noticias`
        doc.text(statsText, titleX, 34)
      }

      yPosition = 50

      // Sections
      addSection("1. Señales Detectadas", sections.signals, [249, 115, 22])
      addSection("2. Contexto de Mercado", sections.context, [59, 130, 246])
      addContactsSection(keyContacts, [34, 197, 94])
      addSection("4. Playbook de Abordaje", sections.playbook, [168, 85, 247])

      // Footer on each page
      const pageCount = doc.internal.pages.length - 1
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i)
        doc.setFontSize(8)
        doc.setTextColor(148, 163, 184)
        doc.text(
          `Brief generado por Biguá • ${companyName} • Página ${i} de ${pageCount}`,
          pageWidth / 2,
          pageHeight - 10,
          { align: "center" },
        )
      }

      // Download
      doc.save(`brief_${companyName.replace(/[^a-z0-9]/gi, "_")}.pdf`)

      toast({
        title: "PDF descargado",
        description: "El brief ha sido descargado exitosamente",
      })
    } catch (error: any) {
      console.error("[v0] PDF generation error:", error)
      toast({
        title: "Error",
        description: error.message || "No se pudo generar el PDF",
        variant: "destructive",
      })
    } finally {
      setIsDownloading(false)
    }
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const parseSummary = (text: string) => {
    const sections = {
      title: "",
      signals: "",
      context: "",
      contacts: "",
      playbook: "",
    }

    // Extract title
    const titleMatch = text.match(/\*\*BRIEF EJECUTIVO PARA (.+?)\*\*/i)
    if (titleMatch) {
      sections.title = titleMatch[1]
    }

    // Extract sections
    const signalsMatch = text.match(/\*\*1\. SEÑALES DETECTADAS\*\*\n([\s\S]*?)(?=\*\*2\.|$)/i)
    if (signalsMatch) sections.signals = signalsMatch[1].trim()

    const contextMatch = text.match(/\*\*2\. CONTEXTO DE MERCADO\*\*\n([\s\S]*?)(?=\*\*3\.|$)/i)
    if (contextMatch) sections.context = contextMatch[1].trim()

    const contactsMatch = text.match(/\*\*3\. CONTACTOS CLAVE\*\*\n([\s\S]*?)(?=\*\*4\.|$)/i)
    if (contactsMatch) sections.contacts = contactsMatch[1].trim()

    const playbookMatch = text.match(/\*\*4\. PLAYBOOK DE ABORDAJE\*\*\n([\s\S]*?)$/i)
    if (playbookMatch) sections.playbook = playbookMatch[1].trim()

    return sections
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-12 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  if (!summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Brief Ejecutivo
          </CardTitle>
          <CardDescription>
            Genera un brief ejecutivo completo con análisis de señales, contexto de mercado, contactos clave y playbook
            de abordaje.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              El brief se genera bajo demanda. Asegúrate de tener información completa en las otras pestañas (noticias,
              implementaciones, contactos, señales y estrategia) antes de generar el brief.
            </AlertDescription>
          </Alert>

          <div className="bg-muted/30 rounded-lg p-6 space-y-4">
            <h4 className="font-medium text-sm">El brief incluirá:</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-start gap-2">
                <Target className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Señales Detectadas</p>
                  <p className="text-muted-foreground text-xs">Personas con señales y posiciones abiertas</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Newspaper className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Contexto de Mercado</p>
                  <p className="text-muted-foreground text-xs">Noticias e implementaciones relevantes</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Users className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Contactos Clave</p>
                  <p className="text-muted-foreground text-xs">Decision makers con datos de contacto</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Briefcase className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Playbook de Abordaje</p>
                  <p className="text-muted-foreground text-xs">Estrategia y tono recomendado</p>
                </div>
              </div>
            </div>

            <Button onClick={handleGenerateSummary} disabled={isGenerating} className="w-full gap-2 mt-4">
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generando brief ejecutivo...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  Generar Brief Ejecutivo
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const sections = parseSummary(summary.summary)
  const keyContacts: KeyContact[] = summary.metadata?.key_contacts || []

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Brief Ejecutivo para {companyName}
              </CardTitle>
              <CardDescription>Generado el {formatDate(summary.generated_at)}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateSummary}
                disabled={isGenerating}
                className="gap-2 bg-transparent"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Regenerando...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Regenerar
                  </>
                )}
              </Button>
              <Button onClick={handleDownloadPDF} disabled={isDownloading} className="gap-2">
                {isDownloading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Descargando...
                  </>
                ) : (
                  <>
                    <FileDown className="h-4 w-4" />
                    Descargar PDF
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Stats */}
      {summary.metadata && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-orange-500" />
              <div>
                <div className="text-xl font-bold">{summary.metadata.signals_count || 0}</div>
                <div className="text-xs text-muted-foreground">Señales</div>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <Newspaper className="h-4 w-4 text-blue-500" />
              <div>
                <div className="text-xl font-bold">
                  {(summary.metadata.news_count || 0) + (summary.metadata.implementations_count || 0)}
                </div>
                <div className="text-xs text-muted-foreground">Noticias / Impl.</div>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-green-500" />
              <div>
                <div className="text-xl font-bold">{summary.metadata.decision_makers_count || 0}</div>
                <div className="text-xs text-muted-foreground">Decision Makers</div>
              </div>
            </div>
          </Card>
          <Card className="p-3">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-purple-500" />
              <div>
                <div className="text-xl font-bold">{summary.metadata.job_postings_count || 0}</div>
                <div className="text-xs text-muted-foreground">Posiciones</div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Brief Sections */}
      <div className="grid gap-4">
        {/* Señales Detectadas */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-orange-500" />
              1. Señales Detectadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none text-sm text-muted-foreground whitespace-pre-line">
              {sections.signals || "No se detectaron señales en este análisis."}
            </div>
          </CardContent>
        </Card>

        {/* Contexto de Mercado */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Newspaper className="h-4 w-4 text-blue-500" />
              2. Contexto de Mercado
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none text-sm text-muted-foreground whitespace-pre-line">
              {sections.context || "No hay suficiente contexto de mercado disponible."}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-green-500" />
              3. Contactos Clave
            </CardTitle>
          </CardHeader>
          <CardContent>
            {keyContacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay contactos identificados.</p>
            ) : (
              <div className="space-y-3">
                {keyContacts.map((contact, index) => (
                  <div
                    key={index}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 bg-muted/30 rounded-lg"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{contact.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{contact.role}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {contact.linkedin && (
                        <a
                          href={contact.linkedin}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded"
                        >
                          <Linkedin className="h-3 w-3" />
                          LinkedIn
                        </a>
                      )}
                      {contact.email && (
                        <a
                          href={`mailto:${contact.email}`}
                          className="inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-800 bg-green-50 px-2 py-1 rounded"
                        >
                          <Mail className="h-3 w-3" />
                          {contact.email}
                        </a>
                      )}
                      {contact.phone && (
                        <a
                          href={`tel:${contact.phone}`}
                          className="inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 bg-purple-50 px-2 py-1 rounded"
                        >
                          <Phone className="h-3 w-3" />
                          {contact.phone}
                        </a>
                      )}
                      {!contact.linkedin && !contact.email && !contact.phone && (
                        <span className="text-xs text-muted-foreground">Sin datos de contacto</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Playbook de Abordaje */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-purple-500" />
              4. Playbook de Abordaje
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-sm max-w-none text-sm whitespace-pre-line">
              {sections.playbook || "No hay recomendaciones de abordaje disponibles."}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
