"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { BrainCircuit, Save, Sparkles, FileText, Loader2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { getStrategy, saveSenderContext } from "@/app/actions/workspace"
import { toast } from "sonner"
import Link from "next/link"

interface BookmarkStrategyProps {
  bookmarkId: string
  companyName: string
}

interface ValueProfile {
  profile_summary: string
  target_industries: string[]
  target_technologies: string[]
  target_processes: string[]
}

interface DocItem {
  id: string
  title: string
  type: string
  summary: string | null
  matchedTags: { type: string; value: string }[]
  score: number
  isRecommended: boolean
}

const MAX_SELECTED = 5

export function BookmarkStrategy({ bookmarkId, companyName }: BookmarkStrategyProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)

  // Sender context state
  const [senderContext, setSenderContext] = useState("")
  const [saveAsDefault, setSaveAsDefault] = useState(false)

  // Docs state
  const [valueProfile, setValueProfile] = useState<ValueProfile | null>(null)
  const [recommended, setRecommended] = useState<DocItem[]>([])
  const [others, setOthers] = useState<DocItem[]>([])
  const [hasDocuments, setHasDocuments] = useState(false)
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set())
  const [showOthers, setShowOthers] = useState(false)

  useEffect(() => {
    loadStrategy()
    loadDocsContext()
  }, [bookmarkId])

  const loadStrategy = async () => {
    setIsLoading(true)
    try {
      const result = await getStrategy(bookmarkId)
      if (result) {
        const strategyData = result.strategy
        const defaultContext = result.defaultContext || ""
        if (strategyData?.sender_context_override) {
          setSenderContext(strategyData.sender_context_override)
        } else if (defaultContext) {
          setSenderContext(defaultContext)
        }
      }
    } catch (error) {
      console.error("Error loading strategy:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadDocsContext = async () => {
    try {
      const res = await fetch(`/api/documents/context-for-bookmark?bookmarkId=${bookmarkId}`)
      if (res.ok) {
        const data = await res.json()
        setValueProfile(data.valueProfile || null)
        setHasDocuments(data.hasDocuments || false)

        const rec: DocItem[] = data.recommended || []
        const oth: DocItem[] = data.others || []
        setRecommended(rec)
        setOthers(oth)

        // Pre-select recommended docs
        setSelectedDocIds(new Set(rec.map((d) => d.id)))
      }
    } catch (error) {
      console.error("Error loading docs context:", error)
    }
  }

  const toggleDoc = (id: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (next.size >= MAX_SELECTED) return prev
        next.add(id)
      }
      return next
    })
  }

  const handleSaveContext = async () => {
    setIsSaving(true)
    try {
      await saveSenderContext(bookmarkId, senderContext, saveAsDefault)
      toast.success(saveAsDefault ? "Propuesta de valor guardada y establecida como predeterminada" : "Propuesta de valor guardada")
    } catch (error) {
      toast.error("Error al guardar")
    } finally {
      setIsSaving(false)
    }
  }

  const handleGenerateFromDocs = async () => {
    setIsGenerating(true)
    try {
      const res = await fetch("/api/documents/context-for-bookmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookmarkId,
          selectedDocIds: Array.from(selectedDocIds),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Error al generar estrategia")
      }

      const data = await res.json()
      setSenderContext(data.strategy)
      toast.success("Estrategia generada con ASCI Docs. Podes editarla antes de guardar.")
    } catch (error: any) {
      toast.error(error.message || "Error al generar desde Docs")
    } finally {
      setIsGenerating(false)
    }
  }

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Cargando...</div>
  }

  const totalDocs = recommended.length + others.length
  const selectedCount = selectedDocIds.size
  const atLimit = selectedCount >= MAX_SELECTED

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* ASCI Docs Context Card */}
      {hasDocuments ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">ASCI Docs</CardTitle>
              </div>
              {totalDocs > 0 && (
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {selectedCount}/{MAX_SELECTED} seleccionados
                </Badge>
              )}
            </div>
            <CardDescription>
              ASCI aprendio de tus documentos. Selecciona cuales usar para generar la propuesta para {companyName}.
            </CardDescription>
          </CardHeader>

          {totalDocs > 0 && (
            <CardContent className="space-y-4 pt-0">
              {/* Recommended docs */}
              {recommended.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Recomendados para esta cuenta
                  </p>
                  <div className="space-y-1.5">
                    {recommended.map((doc) => (
                      <DocRow
                        key={doc.id}
                        doc={doc}
                        checked={selectedDocIds.has(doc.id)}
                        disabled={atLimit && !selectedDocIds.has(doc.id)}
                        onToggle={() => toggleDoc(doc.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Other docs — collapsed by default */}
              {others.length > 0 && (
                <div className="space-y-2">
                  <button
                    onClick={() => setShowOthers((v) => !v)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
                  >
                    {showOthers ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    Otros documentos ({others.length})
                  </button>
                  {showOthers && (
                    <div className="space-y-1.5">
                      {others.map((doc) => (
                        <DocRow
                          key={doc.id}
                          doc={doc}
                          checked={selectedDocIds.has(doc.id)}
                          disabled={atLimit && !selectedDocIds.has(doc.id)}
                          onToggle={() => toggleDoc(doc.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {atLimit && (
                <p className="text-xs text-muted-foreground">
                  Maximo {MAX_SELECTED} documentos seleccionados. Deselecciona uno para agregar otro.
                </p>
              )}

              <Button
                onClick={handleGenerateFromDocs}
                disabled={isGenerating}
                className="w-full"
                variant="default"
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                {selectedCount > 0
                  ? `Generar Propuesta con ${selectedCount} documento${selectedCount !== 1 ? "s" : ""}`
                  : "Generar Propuesta sin documentos"}
              </Button>
            </CardContent>
          )}

          {totalDocs === 0 && valueProfile && (
            <CardContent className="pt-0">
              <Button
                onClick={handleGenerateFromDocs}
                disabled={isGenerating}
                className="w-full"
                variant="default"
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Generar Propuesta con ASCI Docs
              </Button>
            </CardContent>
          )}
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">
                  Subi tus casos de exito, brochures y propuestas en{" "}
                  <Link href="/docs" className="text-primary hover:underline font-medium">
                    Docs
                  </Link>{" "}
                  para que ASCI genere estrategias contextualizadas automaticamente.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual strategy card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            <CardTitle>Mi Propuesta de Valor</CardTitle>
          </div>
          <CardDescription>
            Define tu propuesta de valor para {companyName}. Este contexto se usara para generar icebreakers
            personalizados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="context">Propuesta de Valor</Label>
            <Textarea
              id="context"
              value={senderContext}
              onChange={(e) => setSenderContext(e.target.value)}
              placeholder="Describe quien eres, que ofreces y por que eres relevante para este prospecto...

Ejemplo: Soy especialista en automatizacion de procesos financieros con 10 anos de experiencia ayudando a bancos regionales a reducir tiempos de cierre contable. Hemos trabajado con instituciones similares logrando reducciones del 40% en tiempos de proceso."
              className="min-h-[250px] resize-none text-sm"
            />
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="save-default"
              checked={saveAsDefault}
              onCheckedChange={(checked) => setSaveAsDefault(checked as boolean)}
            />
            <label
              htmlFor="save-default"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-muted-foreground"
            >
              Guardar como mi propuesta de valor predeterminada para futuros bookmarks
            </label>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleSaveContext} disabled={isSaving} className="w-full">
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? "Guardando..." : "Guardar Propuesta de Valor"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DocRow — individual document row with checkbox
// ---------------------------------------------------------------------------
function DocRow({
  doc,
  checked,
  disabled,
  onToggle,
}: {
  doc: DocItem
  checked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer transition-colors
        ${checked ? "border-primary/40 bg-primary/5" : "border-border bg-background"}
        ${disabled ? "opacity-50 cursor-not-allowed" : "hover:bg-muted/50"}`}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
        className="mt-0.5 flex-shrink-0"
      />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium truncate">{doc.title}</span>
        </div>
        {doc.matchedTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {doc.matchedTags.slice(0, 3).map((tag, j) => (
              <Badge key={j} variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                {tag.value}
              </Badge>
            ))}
            {doc.matchedTags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{doc.matchedTags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </label>
  )
}
