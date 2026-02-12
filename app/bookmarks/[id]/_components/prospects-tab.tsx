"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Users,
  Loader2,
  Linkedin,
  Mail,
  Phone,
  Search,
  Sparkles,
  X,
  Plus,
  CheckCircle2,
  AlertCircle,
  Target,
  Trash2,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  CheckSquare,
  Square,
} from "lucide-react"
import {
  inferJobTitles,
  getBookmarkSearchContext,
  searchApolloProspects,
  getProspects,
  removeProspect,
  restoreProspect,
  getRemovedProspects,
} from "@/app/actions/apollo"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { exportToCSV, exportToExcel, prepareProspectsForExport } from "@/lib/export-utils"

function proxyImageUrl(url: string | undefined | null): string {
  if (!url) return ""
  // Proxy external images to avoid CORS issues
  if (url.includes("salesql.s3") || url.includes("d2ojpxxtu63wzl") || url.includes("licdn.com")) {
    return `/api/proxy-image?url=${encodeURIComponent(url)}`
  }
  return url
}

interface Prospect {
  id: string
  full_name: string
  first_name?: string
  last_name?: string
  role?: string
  headline?: string
  email?: string
  email_status?: string
  phone?: string
  mobile_phone?: string
  linkedin_url?: string
  profile_picture_url?: string
  seniority?: string
  city?: string
  country?: string
  source?: string
  is_decision_maker?: boolean
  created_at?: string
  status?: string
}

interface ProspectsTabProps {
  bookmarkId: string
  companyName: string
  companyWebsite?: string
}

export function ProspectsTab({ bookmarkId, companyName, companyWebsite }: ProspectsTabProps) {
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [removedProspects, setRemovedProspects] = useState<Prospect[]>([])
  const [showRemoved, setShowRemoved] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  // Selección para exportación
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState(false)

  const [isLoading, setIsLoading] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [isInferring, setIsInferring] = useState(false)

  // Contexto de búsqueda
  const [technologies, setTechnologies] = useState<string[]>([])
  const [processes, setProcesses] = useState<string[]>([])
  const [company, setCompany] = useState<{ name: string; website?: string; linkedin_url?: string } | null>(null)

  // Job titles
  const [suggestedJobTitles, setSuggestedJobTitles] = useState<string[]>([])
  const [selectedJobTitles, setSelectedJobTitles] = useState<string[]>([])
  const [reasoning, setReasoning] = useState("")
  const [customJobTitle, setCustomJobTitle] = useState("")

  // Value profile for enriched job title suggestions
  const [valueProfile, setValueProfile] = useState<{
    profileSummary: string
    targetTechnologies: string[]
    targetProcesses: string[]
  } | null>(null)

  // Copiar al portapapeles
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Cargar contexto y prospectos existentes
  const loadData = useCallback(async () => {
    setIsLoading(true)

    // Cargar contexto de busqueda + value profile en paralelo
    const [context, profileRes] = await Promise.all([
      getBookmarkSearchContext(bookmarkId),
      fetch(`/api/documents/context-for-bookmark?bookmarkId=${bookmarkId}`).then((r) =>
        r.ok ? r.json() : null
      ).catch(() => null),
    ])

    setTechnologies(context.technologies)
    setProcesses(context.processes)
    setCompany(context.company)

    if (profileRes?.valueProfile) {
      setValueProfile({
        profileSummary: profileRes.valueProfile.profile_summary || "",
        targetTechnologies: profileRes.valueProfile.target_technologies || [],
        targetProcesses: profileRes.valueProfile.target_processes || [],
      })
    }

    // Cargar prospectos existentes
    const existingProspects = await getProspects(bookmarkId)
    setProspects(existingProspects)

    const removed = await getRemovedProspects(bookmarkId)
    setRemovedProspects(removed)

    setIsLoading(false)
  }, [bookmarkId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Inferir job titles con IA
  const handleInferJobTitles = async () => {
    setIsInferring(true)
    try {
      const result = await inferJobTitles(technologies, processes, valueProfile)
      setSuggestedJobTitles(result.jobTitles)
      setSelectedJobTitles(result.jobTitles.slice(0, 4)) // Seleccionar los primeros 4 por defecto
      setReasoning(result.reasoning)
    } catch (error) {
      console.error("Error inferring job titles:", error)
    }
    setIsInferring(false)
  }

  // Toggle selección de job title
  const toggleJobTitle = (title: string) => {
    setSelectedJobTitles((prev) => (prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]))
  }

  // Agregar job title personalizado
  const addCustomJobTitle = () => {
    if (customJobTitle.trim() && !selectedJobTitles.includes(customJobTitle.trim())) {
      setSelectedJobTitles((prev) => [...prev, customJobTitle.trim()])
      setSuggestedJobTitles((prev) => [...prev, customJobTitle.trim()])
      setCustomJobTitle("")
    }
  }

  // Buscar en Apollo
  const handleSearch = async () => {
    if (selectedJobTitles.length === 0) return

    setIsSearching(true)
    try {
      const result = await searchApolloProspects(bookmarkId, selectedJobTitles)
      if (result.success) {
        await loadData() // Recargar prospectos
      }
    } catch (error) {
      console.error("Error searching prospects:", error)
    }
    setIsSearching(false)
  }

  const handleRemoveProspect = async (prospectId: string) => {
    setRemovingId(prospectId)
    const result = await removeProspect(prospectId)
    if (result.success) {
      // Mover de prospects a removedProspects
      const removed = prospects.find((p) => p.id === prospectId)
      if (removed) {
        setProspects((prev) => prev.filter((p) => p.id !== prospectId))
        setRemovedProspects((prev) => [{ ...removed, status: "removed" }, ...prev])
      }
    }
    setRemovingId(null)
  }

  const handleRestoreProspect = async (prospectId: string) => {
    setRestoringId(prospectId)
    const result = await restoreProspect(prospectId)
    if (result.success) {
      // Mover de removedProspects a prospects
      const restored = removedProspects.find((p) => p.id === prospectId)
      if (restored) {
        setRemovedProspects((prev) => prev.filter((p) => p.id !== prospectId))
        setProspects((prev) => [{ ...restored, status: "active" }, ...prev])
      }
    }
    setRestoringId(null)
  }

  // Funciones de selección
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelectedIds(new Set(prospects.map((p) => p.id)))
  }

  const deselectAll = () => {
    setSelectedIds(new Set())
  }

  const isAllSelected = prospects.length > 0 && selectedIds.size === prospects.length

  // Funciones de exportación
  const handleExportCSV = () => {
    setIsExporting(true)
    try {
      const selectedProspects = prospects.filter((p) => selectedIds.has(p.id))
      const exportData = prepareProspectsForExport(selectedProspects, {
        name: companyName,
        website: companyWebsite,
      })
      exportToCSV(exportData, companyName)
    } finally {
      setIsExporting(false)
    }
  }

  const handleExportExcel = () => {
    setIsExporting(true)
    try {
      const selectedProspects = prospects.filter((p) => selectedIds.has(p.id))
      const exportData = prepareProspectsForExport(selectedProspects, {
        name: companyName,
        website: companyWebsite,
      })
      exportToExcel(exportData, companyName)
    } finally {
      setIsExporting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Target className="h-5 w-5" />
          Prospectos - Tomadores de Decisión
        </h2>
        <p className="text-sm text-muted-foreground">
          Encuentra los decision makers relevantes para tu contexto de búsqueda usando Apollo.io
        </p>
      </div>

      {/* Contexto detectado */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Contexto Detectado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Compañía */}
          {company && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Compañía:</span>
              <span className="font-medium">{company.name}</span>
              {company.website && (
                <Badge variant="outline" className="text-xs">
                  {company.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
                </Badge>
              )}
            </div>
          )}

          {/* Tecnologías y Procesos */}
          <div className="flex flex-wrap gap-2">
            {technologies.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Tecnologías:</span>
                {technologies.map((tech) => (
                  <Badge key={tech} variant="secondary" className="text-xs">
                    {tech}
                  </Badge>
                ))}
              </div>
            )}
            {processes.length > 0 && (
              <div className="flex items-center gap-2 ml-4">
                <span className="text-xs text-muted-foreground">Procesos:</span>
                {processes.map((proc) => (
                  <Badge key={proc} variant="outline" className="text-xs">
                    {proc}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {technologies.length === 0 && processes.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No hay contexto de búsqueda específico. Se usarán job titles genéricos.
            </p>
          )}

          {/* Botón para inferir job titles */}
          {suggestedJobTitles.length === 0 && (
            <Button onClick={handleInferJobTitles} disabled={isInferring} className="w-full sm:w-auto">
              {isInferring ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Sugerir Job Titles con IA
            </Button>
          )}

          {/* Job titles sugeridos */}
          {suggestedJobTitles.length > 0 && (
            <div className="space-y-3 pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  Job Titles Sugeridos por IA
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSuggestedJobTitles([])
                    setSelectedJobTitles([])
                    setReasoning("")
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {reasoning && <p className="text-xs text-muted-foreground italic">{reasoning}</p>}

              <div className="flex flex-wrap gap-2">
                {[...new Set(suggestedJobTitles)].map((title) => (
                  <Badge
                    key={title}
                    variant={selectedJobTitles.includes(title) ? "default" : "outline"}
                    className="cursor-pointer transition-colors"
                    onClick={() => toggleJobTitle(title)}
                  >
                    {title}
                    {selectedJobTitles.includes(title) && <CheckCircle2 className="h-3 w-3 ml-1" />}
                  </Badge>
                ))}
              </div>

              {/* Agregar job title personalizado */}
              <div className="flex gap-2">
                <Input
                  placeholder="Agregar otro job title..."
                  value={customJobTitle}
                  onChange={(e) => setCustomJobTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCustomJobTitle()}
                  className="flex-1"
                />
                <Button variant="outline" size="icon" onClick={addCustomJobTitle}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* Botón de búsqueda */}
              <Button
                onClick={handleSearch}
                disabled={isSearching || selectedJobTitles.length === 0}
                className="w-full"
              >
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
                Buscar Prospectos en Apollo.io
                {selectedJobTitles.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {selectedJobTitles.length} títulos
                  </Badge>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lista de prospectos */}
      {prospects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 space-y-4 text-center">
            <div className="bg-muted p-3 rounded-full">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-medium">No hay prospectos encontrados</h3>
              <p className="text-sm text-muted-foreground max-w-sm mt-1">
                Usa la búsqueda de Apollo.io para encontrar tomadores de decisión relevantes para esta cuenta.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              {prospects.length} prospecto{prospects.length !== 1 ? "s" : ""} encontrado
              {prospects.length !== 1 ? "s" : ""}
            </h3>

            {/* Barra de selección y exportación */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={isAllSelected ? deselectAll : selectAll}
                className="h-8 gap-1.5 text-xs"
              >
                {isAllSelected ? (
                  <>
                    <CheckSquare className="h-3.5 w-3.5" />
                    Deseleccionar todos
                  </>
                ) : (
                  <>
                    <Square className="h-3.5 w-3.5" />
                    Seleccionar todos
                  </>
                )}
              </Button>

              {selectedIds.size > 0 && (
                <>
                  <span className="text-xs text-muted-foreground px-2 border-l">
                    {selectedIds.size} seleccionado{selectedIds.size !== 1 ? "s" : ""}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportCSV}
                    disabled={isExporting}
                    className="h-8 gap-1.5 text-xs"
                  >
                    {isExporting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportExcel}
                    disabled={isExporting}
                    className="h-8 gap-1.5 text-xs"
                  >
                    {isExporting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                    )}
                    Excel
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <TooltipProvider>
              {prospects.map((prospect) => (
                <Card 
                  key={prospect.id} 
                  className={`group hover:border-primary/50 transition-colors ${
                    selectedIds.has(prospect.id) ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Checkbox de selección */}
                      <Checkbox
                        checked={selectedIds.has(prospect.id)}
                        onCheckedChange={() => toggleSelect(prospect.id)}
                        className="mt-1 flex-shrink-0"
                      />

                      {/* Avatar */}
                      <Avatar className="h-12 w-12 flex-shrink-0">
                        <AvatarImage src={proxyImageUrl(prospect.profile_picture_url)} />
                        <AvatarFallback>
                          {prospect.first_name?.[0]}
                          {prospect.last_name?.[0]}
                        </AvatarFallback>
                      </Avatar>

                      {/* Info principal */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium truncate">{prospect.full_name}</h4>
                          <Badge variant="secondary" className="text-[10px] px-1.5 flex-shrink-0">
                            DM
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{prospect.role}</p>
                        {prospect.headline && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{prospect.headline}</p>
                        )}

                        {/* Ubicación */}
                        {(prospect.city || prospect.country) && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {[prospect.city, prospect.country].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            onClick={() => handleRemoveProspect(prospect.id)}
                            disabled={removingId === prospect.id}
                          >
                            {removingId === prospect.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Quitar del brief</TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Acciones */}
                    <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t">
                      {/* LinkedIn */}
                      {prospect.linkedin_url && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 gap-1.5 bg-transparent" asChild>
                              <Link href={prospect.linkedin_url} target="_blank">
                                <Linkedin className="h-3.5 w-3.5 text-[#0077b5]" />
                                LinkedIn
                              </Link>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Ver perfil de LinkedIn</TooltipContent>
                        </Tooltip>
                      )}

                      {/* Email */}
                      {prospect.email && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 bg-transparent"
                              onClick={() => copyToClipboard(prospect.email!, `email-${prospect.id}`)}
                            >
                              {copiedId === `email-${prospect.id}` ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                              ) : (
                                <Mail className="h-3.5 w-3.5" />
                              )}
                              Email
                              {prospect.email_status === "verified" && (
                                <CheckCircle2 className="h-3 w-3 text-green-500" />
                              )}
                              {prospect.email_status === "guessed" && (
                                <AlertCircle className="h-3 w-3 text-amber-500" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{prospect.email}</p>
                            <p className="text-xs text-muted-foreground">
                              {prospect.email_status === "verified"
                                ? "Email verificado"
                                : prospect.email_status === "guessed"
                                  ? "Email estimado"
                                  : "Click para copiar"}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      )}

                      {/* Teléfono */}
                      {(prospect.mobile_phone || prospect.phone) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 bg-transparent"
                              onClick={() =>
                                copyToClipboard(prospect.mobile_phone || prospect.phone!, `phone-${prospect.id}`)
                              }
                            >
                              {copiedId === `phone-${prospect.id}` ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                              ) : (
                                <Phone className="h-3.5 w-3.5" />
                              )}
                              Tel
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{prospect.mobile_phone || prospect.phone}</p>
                            <p className="text-xs text-muted-foreground">Click para copiar</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TooltipProvider>
          </div>
        </div>
      )}

      {removedProspects.length > 0 && (
        <div className="border-t pt-4">
          <button
            onClick={() => setShowRemoved(!showRemoved)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            {showRemoved ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            <span>
              {removedProspects.length} prospecto{removedProspects.length !== 1 ? "s" : ""} eliminado
              {removedProspects.length !== 1 ? "s" : ""}
            </span>
          </button>

          {showRemoved && (
            <div className="mt-4 space-y-2">
              <TooltipProvider>
                {removedProspects.map((prospect) => (
                  <div
                    key={prospect.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg opacity-60"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={proxyImageUrl(prospect.profile_picture_url)} />
                        <AvatarFallback className="text-xs">
                          {prospect.first_name?.[0]}
                          {prospect.last_name?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium">{prospect.full_name}</p>
                        <p className="text-xs text-muted-foreground">{prospect.role}</p>
                      </div>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5"
                          onClick={() => handleRestoreProspect(prospect.id)}
                          disabled={restoringId === prospect.id}
                        >
                          {restoringId === prospect.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Restaurar
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Volver a incluir en el brief</TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </TooltipProvider>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
