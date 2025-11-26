"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Trophy,
  Plus,
  ExternalLink,
  Building2,
  Lightbulb,
  Target,
  TrendingUp,
  Trash2,
  Edit,
  ChevronDown,
  ChevronUp,
} from "lucide-react"
import { toast } from "sonner"

interface SuccessCase {
  id: string
  title: string
  client_industry: string | null
  client_size: string | null
  challenge: string | null
  solution: string | null
  results: string | null
  technologies: string[] | null
  case_url: string | null
  is_active: boolean
  created_at: string
}

interface BookmarkSuccessCasesProps {
  bookmarkId: string
  companyIndustry?: string
}

const INDUSTRIES = [
  "Banca / Finanzas",
  "Seguros",
  "Retail",
  "Manufactura",
  "Salud",
  "Telecomunicaciones",
  "Energía",
  "Gobierno",
  "Educación",
  "Logística",
  "Agroindustria",
  "Otro",
]

const CLIENT_SIZES = [
  { value: "enterprise", label: "Enterprise (>1000 empleados)" },
  { value: "mid-market", label: "Mid-Market (100-1000 empleados)" },
  { value: "smb", label: "SMB (<100 empleados)" },
]

export function BookmarkSuccessCases({ bookmarkId, companyIndustry }: BookmarkSuccessCasesProps) {
  const [cases, setCases] = useState<SuccessCase[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [expandedCases, setExpandedCases] = useState<Set<string>>(new Set())
  const [editingCase, setEditingCase] = useState<SuccessCase | null>(null)
  const supabase = createClient()

  // Form state
  const [formData, setFormData] = useState({
    title: "",
    client_industry: "",
    client_size: "",
    challenge: "",
    solution: "",
    results: "",
    technologies: "",
    case_url: "",
  })

  useEffect(() => {
    loadCases()
  }, [])

  const loadCases = async () => {
    setIsLoading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from("success_cases")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false })

      if (error) throw error
      setCases(data || [])
    } catch (error) {
      console.error("Error loading cases:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({
      title: "",
      client_industry: "",
      client_size: "",
      challenge: "",
      solution: "",
      results: "",
      technologies: "",
      case_url: "",
    })
    setEditingCase(null)
  }

  const handleOpenDialog = (caseToEdit?: SuccessCase) => {
    if (caseToEdit) {
      setEditingCase(caseToEdit)
      setFormData({
        title: caseToEdit.title,
        client_industry: caseToEdit.client_industry || "",
        client_size: caseToEdit.client_size || "",
        challenge: caseToEdit.challenge || "",
        solution: caseToEdit.solution || "",
        results: caseToEdit.results || "",
        technologies: caseToEdit.technologies?.join(", ") || "",
        case_url: caseToEdit.case_url || "",
      })
    } else {
      resetForm()
    }
    setIsDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      toast.error("El título es requerido")
      return
    }

    setIsSaving(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error("No autenticado")

      const caseData = {
        user_id: user.id,
        title: formData.title,
        client_industry: formData.client_industry || null,
        client_size: formData.client_size || null,
        challenge: formData.challenge || null,
        solution: formData.solution || null,
        results: formData.results || null,
        technologies: formData.technologies
          ? formData.technologies
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : null,
        case_url: formData.case_url || null,
      }

      if (editingCase) {
        const { error } = await supabase.from("success_cases").update(caseData).eq("id", editingCase.id)
        if (error) throw error
        toast.success("Caso actualizado")
      } else {
        const { error } = await supabase.from("success_cases").insert(caseData)
        if (error) throw error
        toast.success("Caso agregado")
      }

      resetForm()
      setIsDialogOpen(false)
      loadCases()
    } catch (error) {
      console.error("Error saving case:", error)
      toast.error("Error al guardar el caso")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from("success_cases").update({ is_active: false }).eq("id", id)
      if (error) throw error
      toast.success("Caso eliminado")
      loadCases()
    } catch (error) {
      toast.error("Error al eliminar")
    }
  }

  const toggleExpanded = (id: string) => {
    setExpandedCases((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  // Filter cases relevant to company industry
  const relevantCases = companyIndustry ? cases.filter((c) => c.client_industry === companyIndustry) : []
  const otherCases = companyIndustry ? cases.filter((c) => c.client_industry !== companyIndustry) : cases

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Cargando casos de éxito...</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            Mis Casos de Éxito
          </h2>
          <p className="text-sm text-muted-foreground">Tu portfolio de casos para referenciar en conversaciones</p>
        </div>

        <Dialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open)
            if (!open) resetForm()
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Agregar Caso
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingCase ? "Editar Caso" : "Agregar Caso de Éxito"}</DialogTitle>
              <DialogDescription>
                Documenta un caso de éxito para usar como referencia en tus conversaciones
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="title">Título del Caso *</Label>
                <Input
                  id="title"
                  placeholder="Ej: Migración a SAP S/4HANA en tiempo récord"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Industria del Cliente</Label>
                  <Select
                    value={formData.client_industry}
                    onValueChange={(value) => setFormData({ ...formData, client_industry: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar industria" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDUSTRIES.map((ind) => (
                        <SelectItem key={ind} value={ind}>
                          {ind}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tamaño del Cliente</Label>
                  <Select
                    value={formData.client_size}
                    onValueChange={(value) => setFormData({ ...formData, client_size: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar tamaño" />
                    </SelectTrigger>
                    <SelectContent>
                      {CLIENT_SIZES.map((size) => (
                        <SelectItem key={size.value} value={size.value}>
                          {size.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="challenge" className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-red-500" />
                  Desafío / Problema
                </Label>
                <Textarea
                  id="challenge"
                  placeholder="¿Qué problema tenía el cliente antes de trabajar contigo?"
                  value={formData.challenge}
                  onChange={(e) => setFormData({ ...formData, challenge: e.target.value })}
                  className="h-20 resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="solution" className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  Solución Implementada
                </Label>
                <Textarea
                  id="solution"
                  placeholder="¿Qué solución implementaste y cómo?"
                  value={formData.solution}
                  onChange={(e) => setFormData({ ...formData, solution: e.target.value })}
                  className="h-20 resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="results" className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  Resultados Obtenidos
                </Label>
                <Textarea
                  id="results"
                  placeholder="¿Qué resultados medibles se lograron? (%, tiempo, $)"
                  value={formData.results}
                  onChange={(e) => setFormData({ ...formData, results: e.target.value })}
                  className="h-20 resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="technologies">Tecnologías utilizadas</Label>
                <Input
                  id="technologies"
                  placeholder="SAP, S4HANA, Fiori, Azure (separadas por coma)"
                  value={formData.technologies}
                  onChange={(e) => setFormData({ ...formData, technologies: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="case_url">Link al caso completo (opcional)</Label>
                <Input
                  id="case_url"
                  type="url"
                  placeholder="https://..."
                  value={formData.case_url}
                  onChange={(e) => setFormData({ ...formData, case_url: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsDialogOpen(false)
                  resetForm()
                }}
              >
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={isSaving}>
                {isSaving ? "Guardando..." : editingCase ? "Actualizar" : "Agregar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Relevant Cases Section */}
      {companyIndustry && relevantCases.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-green-700 dark:text-green-400 flex items-center gap-2">
            <Target className="h-4 w-4" />
            Casos relevantes para esta industria ({companyIndustry})
          </h3>
          {relevantCases.map((caseItem) => (
            <CaseCard
              key={caseItem.id}
              caseItem={caseItem}
              isExpanded={expandedCases.has(caseItem.id)}
              onToggle={() => toggleExpanded(caseItem.id)}
              onEdit={() => handleOpenDialog(caseItem)}
              onDelete={() => handleDelete(caseItem.id)}
              isRelevant
            />
          ))}
        </div>
      )}

      {/* All/Other Cases */}
      {cases.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Trophy className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-medium">Sin casos de éxito</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Documenta tus casos de éxito para referenciarlos en conversaciones
            </p>
            <Button size="sm" onClick={() => handleOpenDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Agregar primer caso
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {companyIndustry && relevantCases.length > 0 && otherCases.length > 0 && (
            <h3 className="text-sm font-medium text-muted-foreground">Otros casos</h3>
          )}
          {otherCases.map((caseItem) => (
            <CaseCard
              key={caseItem.id}
              caseItem={caseItem}
              isExpanded={expandedCases.has(caseItem.id)}
              onToggle={() => toggleExpanded(caseItem.id)}
              onEdit={() => handleOpenDialog(caseItem)}
              onDelete={() => handleDelete(caseItem.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Subcomponent for case card
function CaseCard({
  caseItem,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  isRelevant = false,
}: {
  caseItem: SuccessCase
  isExpanded: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  isRelevant?: boolean
}) {
  return (
    <Card className={isRelevant ? "border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20" : ""}>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-3">
              <div
                className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                  isRelevant ? "bg-green-100 dark:bg-green-950" : "bg-amber-100 dark:bg-amber-950"
                }`}
              >
                <Trophy className={`h-5 w-5 ${isRelevant ? "text-green-600" : "text-amber-600"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-sm">
                    {caseItem.case_url ? (
                      <a
                        href={caseItem.case_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-amber-600 hover:underline"
                      >
                        {caseItem.title}
                        <ExternalLink className="h-3 w-3 inline ml-1 opacity-50" />
                      </a>
                    ) : (
                      caseItem.title
                    )}
                  </h3>
                </div>

                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {caseItem.client_industry && (
                    <Badge variant="outline" className="text-[10px]">
                      <Building2 className="h-3 w-3 mr-1" />
                      {caseItem.client_industry}
                    </Badge>
                  )}
                  {caseItem.client_size && (
                    <Badge variant="secondary" className="text-[10px]">
                      {CLIENT_SIZES.find((s) => s.value === caseItem.client_size)?.label || caseItem.client_size}
                    </Badge>
                  )}
                </div>

                {caseItem.technologies && caseItem.technologies.length > 0 && (
                  <div className="flex items-center gap-1 mt-2 flex-wrap">
                    {caseItem.technologies.map((tech) => (
                      <Badge
                        key={tech}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                      >
                        {tech}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Expandable content */}
                {isExpanded && (
                  <div className="mt-4 space-y-3 text-sm border-t pt-4">
                    {caseItem.challenge && (
                      <div>
                        <span className="font-medium text-red-600 dark:text-red-400 flex items-center gap-1">
                          <Target className="h-3 w-3" /> Desafío:
                        </span>
                        <p className="text-muted-foreground mt-1">{caseItem.challenge}</p>
                      </div>
                    )}
                    {caseItem.solution && (
                      <div>
                        <span className="font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <Lightbulb className="h-3 w-3" /> Solución:
                        </span>
                        <p className="text-muted-foreground mt-1">{caseItem.solution}</p>
                      </div>
                    )}
                    {caseItem.results && (
                      <div>
                        <span className="font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" /> Resultados:
                        </span>
                        <p className="text-muted-foreground mt-1">{caseItem.results}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={onToggle}>
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-blue-600"
              onClick={onEdit}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
