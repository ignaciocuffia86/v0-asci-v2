"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  FileText,
  ExternalLink,
  Calendar,
  Trash2,
  Search,
  Loader2,
  Sparkles,
  RefreshCw,
  Clock,
  AlertCircle,
  Building,
  TrendingUp,
  AlertTriangle,
  Target,
  DollarSign,
} from "lucide-react"
import { toast } from "sonner"
import { formatDistanceToNow } from "date-fns"
import { es } from "date-fns/locale"

interface TechSignal {
  signal_type: "vendor_used" | "vendor_planned" | "tech_initiative" | "investment_planned"
  name: string
  confidence: "confirmed" | "likely" | "inferred"
  context: string
  source_quote: string
}

interface PublicDoc {
  id: string
  document_type: string
  document_title: string
  document_date: string | null
  fiscal_year: number | null
  source_url: string
  source_name: string | null
  ticker: string | null
  content_extracted: boolean
  findings: Array<{
    category: string
    finding: string
    quote?: string
    source_section?: string
    relevance?: string
    vendors_mentioned?: string[]
  }>
  tech_signals: TechSignal[]
  digest: string | null
  created_at: string
}

interface PublicDocsTabProps {
  bookmarkId: string
  companyId: string
  companyName: string
}

const DOC_TYPE_LABELS: Record<string, { label: string; icon: typeof FileText }> = {
  "10-K": { label: "Reporte Anual (10-K)", icon: FileText },
  "10-Q": { label: "Reporte Trimestral (10-Q)", icon: FileText },
  "8-K": { label: "Evento Material (8-K)", icon: AlertTriangle },
  annual_report: { label: "Memoria Anual", icon: FileText },
  earnings_call: { label: "Earnings Call", icon: DollarSign },
  sustainability: { label: "Reporte de Sostenibilidad", icon: TrendingUp },
  financial: { label: "Reporte Financiero", icon: DollarSign },
}

const FINDING_CATEGORY_CONFIG: Record<string, { label: string; icon: typeof Target; color: string }> = {
  tech_investment: { label: "Inversión Tech", icon: Target, color: "text-blue-600 bg-blue-50 dark:bg-blue-950" },
  vendor_mention: { label: "Vendor", icon: Building, color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950" },
  digital_initiative: { label: "Iniciativa Digital", icon: Sparkles, color: "text-cyan-600 bg-cyan-50 dark:bg-cyan-950" },
  pain_point: { label: "Pain Point", icon: AlertTriangle, color: "text-amber-600 bg-amber-50 dark:bg-amber-950" },
  strategy: { label: "Estrategia", icon: Building, color: "text-purple-600 bg-purple-50 dark:bg-purple-950" },
  financial: { label: "Financiero", icon: DollarSign, color: "text-green-600 bg-green-50 dark:bg-green-950" },
}

const SIGNAL_TYPE_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  vendor_used: { label: "Vendor Confirmado", color: "text-emerald-700", bgColor: "bg-emerald-100 dark:bg-emerald-900" },
  vendor_planned: { label: "Vendor Planeado", color: "text-blue-700", bgColor: "bg-blue-100 dark:bg-blue-900" },
  tech_initiative: { label: "Iniciativa Tech", color: "text-purple-700", bgColor: "bg-purple-100 dark:bg-purple-900" },
  investment_planned: { label: "Inversión Planeada", color: "text-amber-700", bgColor: "bg-amber-100 dark:bg-amber-900" },
}

const CONFIDENCE_CONFIG: Record<string, { label: string; icon: string }> = {
  confirmed: { label: "Confirmado", icon: "✓" },
  likely: { label: "Probable", icon: "~" },
  inferred: { label: "Inferido", icon: "?" },
}

interface CooldownInfo {
  canRefresh: boolean
  lastSearchDate: string | null
  daysUntilRefresh: number
}

export function PublicDocsTab({ bookmarkId, companyId, companyName }: PublicDocsTabProps) {
  const [docs, setDocs] = useState<PublicDoc[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [isPublicCompany, setIsPublicCompany] = useState<boolean | null>(null)
  const [cooldown, setCooldown] = useState<CooldownInfo>({ canRefresh: true, lastSearchDate: null, daysUntilRefresh: 0 })

  const supabase = createClient()

  useEffect(() => {
    loadDocs()
    checkUserRole()
  }, [companyId])

  const checkUserRole = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
      setIsSuperAdmin(profile?.role === "superadmin")
    }
  }

  const loadDocs = async () => {
    setIsLoading(true)
    try {
      // Load docs
      const { data, error } = await supabase
        .from("company_public_docs")
        .select("*")
        .eq("company_id", companyId)
        .order("document_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(10)

      if (error) throw error
      setDocs(data || [])

      // Get company public status
      const { data: company } = await supabase
        .from("companies")
        .select("is_public, ticker")
        .eq("id", companyId)
        .single()

      setIsPublicCompany(company?.is_public ?? null)

      // Calculate cooldown
      if (data && data.length > 0) {
        const lastCreated = new Date(data[0].created_at)
        const daysSince = (Date.now() - lastCreated.getTime()) / (1000 * 60 * 60 * 24)
        setCooldown({
          canRefresh: isSuperAdmin || daysSince >= 30,
          lastSearchDate: data[0].created_at,
          daysUntilRefresh: daysSince >= 30 ? 0 : Math.ceil(30 - daysSince),
        })
      }
    } catch (error: any) {
      console.error("Error loading docs:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSearch = async (forceRefresh = false) => {
    setIsSearching(true)
    try {
      const response = await fetch("/api/research/public-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkId, forceRefresh }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || "Error al buscar documentos")
      }

      const result = await response.json()
      setIsPublicCompany(result.isPublic)
      
      const signalsCount = result.techSignals?.length || 0
      const findingsCount = result.totalFindings || 0
      
      toast.success(
        result.isPublic
          ? `Se encontraron ${result.docs?.length || 0} documentos públicos${signalsCount > 0 ? ` con ${signalsCount} señales tech detectadas` : ""}`
          : `Se encontraron ${result.docs?.length || 0} documentos (empresa privada)${signalsCount > 0 ? ` con ${signalsCount} señales tech` : ""}`
      )

      setCooldown({
        canRefresh: result.canRefresh ?? isSuperAdmin,
        lastSearchDate: result.lastSearchDate,
        daysUntilRefresh: result.daysUntilRefresh ?? 0,
      })

      await loadDocs()
    } catch (error: any) {
      console.error("Error searching docs:", error)
      toast.error(error.message || "Error al buscar documentos")
    } finally {
      setIsSearching(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!isSuperAdmin) {
      toast.error("Solo administradores pueden eliminar")
      return
    }
    try {
      await supabase.from("company_public_docs").delete().eq("id", id)
      setDocs(docs.filter((d) => d.id !== id))
      toast.success("Documento eliminado")
    } catch {
      toast.error("Error al eliminar")
    }
  }

  const hasDocs = docs.length > 0
  const digest = docs.find(d => d.digest)?.digest
  
  // Collect all tech signals from docs (stored on first doc)
  const techSignals: TechSignal[] = docs.flatMap(d => d.tech_signals || [])
  
  // Collect all findings from all docs
  const allFindings = docs.flatMap(d => d.findings || [])
  
  // Group signals by type for display
  const signalsByType = techSignals.reduce((acc, signal) => {
    if (!acc[signal.signal_type]) acc[signal.signal_type] = []
    acc[signal.signal_type].push(signal)
    return acc
  }, {} as Record<string, TechSignal[]>)

  // Group docs by type for better organization
  const groupedDocs = docs.reduce((acc, doc) => {
    const type = doc.document_type
    if (!acc[type]) acc[type] = []
    acc[type].push(doc)
    return acc
  }, {} as Record<string, PublicDoc[]>)

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Cargando documentos...</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="h-5 w-5 text-teal-600" />
          Documentos Públicos de {companyName}
          {isPublicCompany !== null && (
            <Badge variant={isPublicCompany ? "default" : "secondary"} className="ml-2">
              {isPublicCompany ? "Empresa Pública" : "Empresa Privada"}
            </Badge>
          )}
        </h2>
        <p className="text-sm text-muted-foreground">
          SEC filings, reportes anuales, earnings calls y reportes de sostenibilidad
        </p>
      </div>

      {/* Tech Signals Section - Most Important */}
      {techSignals.length > 0 && (
        <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-purple-50/50 dark:from-indigo-950/30 dark:to-purple-950/20 dark:border-indigo-800">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-indigo-600" />
              Señales de Tecnología Detectadas
              <Badge variant="secondary" className="ml-1">{techSignals.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-4 space-y-3">
            {Object.entries(signalsByType).map(([signalType, signals]) => {
              const config = SIGNAL_TYPE_CONFIG[signalType] || { label: signalType, color: "text-gray-700", bgColor: "bg-gray-100" }
              
              return (
                <div key={signalType} className="space-y-2">
                  <h4 className={`text-xs font-medium ${config.color}`}>{config.label}</h4>
                  <div className="flex flex-wrap gap-2">
                    {signals.map((signal, idx) => (
                      <div
                        key={idx}
                        className={`group relative px-3 py-1.5 rounded-lg ${config.bgColor} cursor-help`}
                        title={`${signal.context}\n\nCita: "${signal.source_quote}"`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`font-medium text-sm ${config.color}`}>
                            {signal.name}
                          </span>
                          <span className="text-[10px] opacity-60">
                            {CONFIDENCE_CONFIG[signal.confidence]?.icon || ""}
                          </span>
                        </div>
                        {/* Tooltip on hover */}
                        <div className="absolute hidden group-hover:block z-10 bottom-full left-0 mb-2 w-64 p-2 bg-popover border rounded-md shadow-lg text-xs">
                          <p className="font-medium mb-1">{signal.context}</p>
                          {signal.source_quote && (
                            <p className="text-muted-foreground italic">"{signal.source_quote.slice(0, 150)}..."</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Digest Card */}
      {digest && (
        <Card className="border-teal-200 bg-teal-50/50 dark:bg-teal-950/20 dark:border-teal-800">
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-teal-600" />
              Resumen de Documentos
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <p className="text-sm text-muted-foreground">{digest}</p>
          </CardContent>
        </Card>
      )}

      {/* Key Findings Section */}
      {allFindings.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              Hallazgos Clave
              <Badge variant="secondary" className="ml-1">{allFindings.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-3 space-y-2">
            {allFindings.slice(0, 6).map((finding, idx) => {
              const catConfig = FINDING_CATEGORY_CONFIG[finding.category] || {
                label: finding.category,
                icon: Target,
                color: "text-gray-600 bg-gray-50",
              }
              const FindingIcon = catConfig.icon

              return (
                <div key={idx} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                  <Badge variant="secondary" className={`shrink-0 ${catConfig.color}`}>
                    <FindingIcon className="h-3 w-3 mr-1" />
                    {catConfig.label}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{finding.finding}</p>
                    {finding.quote && (
                      <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">
                        "{finding.quote}"
                      </p>
                    )}
                  </div>
                  {finding.relevance === "high" && (
                    <Badge variant="destructive" className="text-[10px] shrink-0">Alta</Badge>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {cooldown.lastSearchDate && (
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Última búsqueda: {formatDistanceToNow(new Date(cooldown.lastSearchDate), { addSuffix: true, locale: es })}
            </span>
          )}
          {!cooldown.canRefresh && !isSuperAdmin && (
            <Badge variant="outline" className="text-xs">
              <AlertCircle className="h-3 w-3 mr-1" />
              Próxima en {cooldown.daysUntilRefresh} días
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isSuperAdmin && hasDocs && (
            <Button
              onClick={() => handleSearch(true)}
              disabled={isSearching}
              variant="outline"
              size="sm"
            >
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2 hidden sm:inline">Regenerar</span>
            </Button>
          )}
          <Button
            onClick={() => handleSearch(false)}
            disabled={isSearching || (hasDocs && !cooldown.canRefresh && !isSuperAdmin)}
            variant={hasDocs ? "outline" : "default"}
            size="sm"
          >
            {isSearching ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Buscando...
              </>
            ) : hasDocs && !cooldown.canRefresh ? (
              <>
                <Clock className="h-4 w-4 mr-2 opacity-50" />
                En cooldown
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                {hasDocs ? "Actualizar" : "Buscar Documentos"}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Documents List */}
      {docs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium">Sin documentos registrados</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Busca reportes anuales, SEC filings y otros documentos públicos de {companyName}
            </p>
            <Button onClick={() => handleSearch(false)} disabled={isSearching}>
              {isSearching ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Buscar documentos
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedDocs).map(([docType, typeDocs]) => {
            const config = DOC_TYPE_LABELS[docType] || { label: docType, icon: FileText }
            const Icon = config.icon

            return (
              <div key={docType} className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {config.label}
                  <Badge variant="secondary" className="ml-1">{typeDocs.length}</Badge>
                </h3>

                <div className="space-y-2">
                  {typeDocs.map((doc) => (
                    <Card key={doc.id} className="group hover:bg-muted/30 transition-colors">
                      <CardContent className="py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <a
                                href={doc.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-sm hover:text-teal-600 hover:underline flex items-center gap-1"
                              >
                                {doc.document_title}
                                <ExternalLink className="h-3 w-3 opacity-50" />
                              </a>
                              {doc.ticker && (
                                <Badge variant="outline" className="text-[10px]">
                                  {doc.ticker}
                                </Badge>
                              )}
                              {doc.content_extracted && (
                                <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                                  Analizado
                                </Badge>
                              )}
                            </div>

                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              {doc.source_name && <span>{doc.source_name}</span>}
                              {doc.document_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {new Date(doc.document_date).toLocaleDateString("es-AR", {
                                    year: "numeric",
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </span>
                              )}
                              {doc.fiscal_year && (
                                <span>FY {doc.fiscal_year}</span>
                              )}
                            </div>

                            {/* Findings (if any) */}
                            {doc.findings && doc.findings.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {doc.findings.slice(0, 3).map((finding, idx) => {
                                  const catConfig = FINDING_CATEGORY_CONFIG[finding.category] || {
                                    label: finding.category,
                                    icon: Target,
                                    color: "text-gray-600 bg-gray-50",
                                  }
                                  const FindingIcon = catConfig.icon

                                  return (
                                    <div key={idx} className="text-xs flex items-start gap-2">
                                      <Badge variant="secondary" className={`shrink-0 ${catConfig.color}`}>
                                        <FindingIcon className="h-3 w-3 mr-1" />
                                        {catConfig.label}
                                      </Badge>
                                      <span className="text-muted-foreground line-clamp-1">
                                        {finding.finding}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>

                          {isSuperAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDelete(doc.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
