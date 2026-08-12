"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  FileDown,
  FileText,
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Users,
  Newspaper,
  Briefcase,
  Target,
  TrendingUp,
  Shield,
  Copy,
  Check,
  Save,
  Sparkles,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface FitReason {
  reason: string
  source: string
  confidence: "high" | "medium" | "low"
  evidenceCount: number
  snippet?: string
}

interface Risk {
  type: string
  description: string
  confidence: string
  source: string
  mitigation?: string
}

interface Summary {
  id: string
  bookmark_id: string
  summary: string
  html_content: string | null
  generated_at: string
  version: number
  fit_score: number | null
  fit_reasons: FitReason[] | null
  risks: Risk[] | null
  context_hash: string | null
  user_email: string | null
  metadata: any
}

interface SummaryTabProps {
  bookmarkId: string
  companyName: string
  companyLogoUrl?: string
  companyWebsite?: string
  companyIndustry?: string
  companyCountry?: string
}

export function SummaryTab({
  bookmarkId,
  companyName,
  companyLogoUrl,
  companyWebsite,
  companyIndustry,
  companyCountry,
}: SummaryTabProps) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    fetchSummary()
    checkSuperAdmin()
  }, [bookmarkId])

  const checkSuperAdmin = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
      setIsSuperAdmin(profile?.role === "superadmin")
    }
  }

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

  const handleGenerateSummary = async (force = false) => {
    setIsGenerating(true)
    try {
      const response = await fetch(`/api/bookmarks/${bookmarkId}/generate-brief`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ force }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Error generando brief")
      }

      const data = await response.json()

      if (data.cached) {
        toast({
          title: "Brief cargado",
          description: "El contexto no ha cambiado. Mostrando brief existente.",
        })
      } else {
        toast({
          title: "Brief generado",
          description: force
            ? "El brief ha sido regenerado forzadamente (superadmin)"
            : "El brief ejecutivo ha sido generado exitosamente",
        })
      }

      setSummary(data.summary)
      setHasChanges(false)
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

  const handleSaveChanges = async () => {
    if (!summary || !editorRef.current) return

    setIsSaving(true)
    try {
      const newHtmlContent = editorRef.current.innerHTML

      const { error } = await supabase
        .from("bookmark_summaries")
        .update({
          html_content: newHtmlContent,
          updated_at: new Date().toISOString(),
        })
        .eq("id", summary.id)

      if (error) throw error

      setSummary((prev) => (prev ? { ...prev, html_content: newHtmlContent } : null))
      setHasChanges(false)

      toast({
        title: "Cambios guardados",
        description: "El brief ha sido actualizado",
      })
    } catch (error: any) {
      toast({
        title: "Error",
        description: "No se pudieron guardar los cambios",
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCopyText = async () => {
    if (!editorRef.current) return

    try {
      const htmlContent = editorRef.current.innerHTML
      const textContent = editorRef.current.innerText || editorRef.current.textContent || ""

      // Use ClipboardItem to copy both HTML and plain text formats
      const clipboardItem = new ClipboardItem({
        "text/html": new Blob([htmlContent], { type: "text/html" }),
        "text/plain": new Blob([textContent], { type: "text/plain" }),
      })

      await navigator.clipboard.write([clipboardItem])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast({
        title: "Copiado",
        description: "Brief copiado con formato al portapapeles",
      })
    } catch {
      toast({
        title: "Error",
        description: "No se pudo copiar el brief",
        variant: "destructive",
      })
    }
  }

  const handleEditorChange = () => {
    setHasChanges(true)
  }

  const getFitScoreColor = (score: number) => {
    if (score >= 70) return "text-green-600"
    if (score >= 40) return "text-yellow-600"
    return "text-red-600"
  }

  const getFitScoreProgressColor = (score: number) => {
    if (score >= 70) return "bg-green-500"
    if (score >= 40) return "bg-yellow-500"
    return "bg-red-500"
  }

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case "high":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[10px]">
            ALTO
          </Badge>
        )
      case "medium":
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 text-[10px]">
            MEDIO
          </Badge>
        )
      case "low":
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[10px]">
            BAJO
          </Badge>
        )
      default:
        return null
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
            Genera un brief ejecutivo completo con análisis de FIT, señales detectadas, riesgos y playbook de abordaje.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              El brief se genera bajo demanda utilizando IA. Asegúrate de tener información completa en las otras
              pestañas antes de generar.
            </AlertDescription>
          </Alert>

          <div className="bg-muted/30 rounded-lg p-6 space-y-4">
            <h4 className="font-medium text-sm">El brief incluirá:</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-start gap-2">
                <TrendingUp className="h-4 w-4 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium">FIT Score (0-100)</p>
                  <p className="text-muted-foreground text-xs">Qué tan bien hace fit con tu propuesta de valor</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Target className="h-4 w-4 text-orange-600 mt-0.5" />
                <div>
                  <p className="font-medium">Señales Detectadas</p>
                  <p className="text-muted-foreground text-xs">Contactos y posiciones con evidencia</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Shield className="h-4 w-4 text-red-600 mt-0.5" />
                <div>
                  <p className="font-medium">Riesgos y Bloqueos</p>
                  <p className="text-muted-foreground text-xs">Incumbentes, compliance, datos faltantes</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Briefcase className="h-4 w-4 text-purple-600 mt-0.5" />
                <div>
                  <p className="font-medium">Playbook de Abordaje</p>
                  <p className="text-muted-foreground text-xs">Estrategia y acciones recomendadas</p>
                </div>
              </div>
            </div>

            <Button
              onClick={() => handleGenerateSummary(isSuperAdmin)}
              disabled={isGenerating}
              className="w-full gap-2 mt-4"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generando brief ejecutivo...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generar Brief Ejecutivo
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const fitScore = summary.fit_score || summary.metadata?.fitScore || 0
  const fitReasons = summary.fit_reasons || summary.metadata?.fitReasons || []
  const risks = summary.risks || summary.metadata?.risks || []
  const sourcesSummary = summary.metadata?.sourcesSummary || {}

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Brief Ejecutivo para {companyName}
              </CardTitle>
              <CardDescription>
                Generado el {formatDate(summary.generated_at)} | Versión {summary.version}
                {summary.user_email && ` | Por: ${summary.user_email}`}
              </CardDescription>
            </div>

            <div className="text-right">
              <div className="flex items-center gap-2 justify-end">
                <span className="text-sm text-muted-foreground">FIT Score</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <span className={`text-3xl font-bold ${getFitScoreColor(fitScore)}`}>{fitScore}</span>
                      <span className="text-lg text-muted-foreground">/100</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">
                        Match de señales con búsqueda, contactos relevantes, calidad de datos y recencia
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Progress value={fitScore} className={`h-2 w-32 mt-1 ${getFitScoreProgressColor(fitScore)}`} />
            </div>
          </div>
        </CardHeader>
      </Card>

      {fitReasons.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              Top Razones de FIT
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {fitReasons.map((reason: FitReason, idx: number) => (
              <div key={idx} className="flex items-start gap-2 p-2 bg-muted/30 rounded-lg">
                <span className="text-sm font-bold text-muted-foreground">{idx + 1}.</span>
                <div className="flex-1">
                  <p className="text-sm">{reason.reason}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {getConfidenceBadge(reason.confidence)}
                    <span className="text-[10px] text-muted-foreground">
                      ({reason.source}) - {reason.evidenceCount} evidencias
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {risks.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              Riesgos y Bloqueos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {risks.map((risk: Risk, idx: number) => (
              <div key={idx} className="p-2 bg-white/50 rounded-lg border border-amber-100">
                <p className="text-sm font-medium text-amber-900">{risk.description}</p>
                {risk.mitigation && (
                  <p className="text-xs text-amber-700 mt-1">
                    <span className="font-medium">Mitigación:</span> {risk.mitigation}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-green-500" />
            <div>
              <div className="text-lg font-bold">{sourcesSummary.currentEmployeesCount || 0}</div>
              <div className="text-[10px] text-muted-foreground">Contactos</div>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-400" />
            <div>
              <div className="text-lg font-bold">{sourcesSummary.alumniCount || 0}</div>
              <div className="text-[10px] text-muted-foreground">Alumni</div>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-orange-500" />
            <div>
              <div className="text-lg font-bold">{sourcesSummary.jobPostingsCount || 0}</div>
              <div className="text-[10px] text-muted-foreground">Posiciones</div>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-blue-500" />
            <div>
              <div className="text-lg font-bold">{sourcesSummary.newsCount || 0}</div>
              <div className="text-[10px] text-muted-foreground">Noticias</div>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-purple-500" />
            <div>
              <div className="text-lg font-bold">{sourcesSummary.implementationsCount || 0}</div>
              <div className="text-[10px] text-muted-foreground">Implement.</div>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-green-600" />
            <div>
              <div className="text-lg font-bold">{sourcesSummary.prospectsCount || 0}</div>
              <div className="text-[10px] text-muted-foreground">Prospectos</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleGenerateSummary(false)}
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

          {/* Botón de forzar regeneración solo para superadmins */}
          {isSuperAdmin && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateSummary(true)}
                    disabled={isGenerating}
                    className="gap-2 bg-transparent border-amber-300 text-amber-700 hover:bg-amber-50"
                  >
                    <Shield className="h-4 w-4" />
                    Forzar
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Regenerar ignorando cache (solo superadmin)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <Button variant="outline" size="sm" onClick={handleCopyText} className="gap-2 bg-transparent">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiado" : "Copiar Texto"}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {hasChanges && (
            <Button size="sm" onClick={handleSaveChanges} disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar Cambios
            </Button>
          )}

          <Button
            size="sm"
            onClick={() => console.log("Download PDF functionality removed")}
            disabled
            className="gap-2"
          >
            <FileDown className="h-4 w-4" />
            Descargar PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Brief Ejecutivo</CardTitle>
          <CardDescription>Haz clic en el texto para editar. Los cambios se guardan manualmente.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleEditorChange}
            className="min-h-[400px] p-4 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{
              __html: summary.html_content || summary.summary.replace(/\n/g, "<br>"),
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
