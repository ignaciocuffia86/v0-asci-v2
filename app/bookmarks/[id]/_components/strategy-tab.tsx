"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { BrainCircuit, Save, Sparkles, FileText, Loader2, AlertCircle } from "lucide-react"
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

interface RelevantDoc {
  title: string
  type: string
  matchedTags: { type: string; value: string }[]
}

export function BookmarkStrategy({ bookmarkId, companyName }: BookmarkStrategyProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)

  // Sender context state
  const [senderContext, setSenderContext] = useState("")
  const [saveAsDefault, setSaveAsDefault] = useState(false)

  // Docs state
  const [valueProfile, setValueProfile] = useState<ValueProfile | null>(null)
  const [relevantDocs, setRelevantDocs] = useState<RelevantDoc[]>([])
  const [hasDocuments, setHasDocuments] = useState(false)

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
        setRelevantDocs(data.relevantDocs || [])
        setHasDocuments(data.hasDocuments || false)
      }
    } catch (error) {
      console.error("Error loading docs context:", error)
    }
  }

  const handleSaveContext = async () => {
    setIsSaving(true)
    try {
      await saveSenderContext(bookmarkId, senderContext, saveAsDefault)

      let successMsg = "Propuesta de valor guardada"
      if (saveAsDefault) {
        successMsg += " y establecida como predeterminada"
      }
      toast.success(successMsg)
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
        body: JSON.stringify({ bookmarkId }),
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

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* ASCI Docs Context Card */}
      {hasDocuments && (valueProfile || relevantDocs.length > 0) ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">ASCI Docs</CardTitle>
              </div>
              {relevantDocs.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {relevantDocs.length} doc{relevantDocs.length !== 1 ? "s" : ""} relevante{relevantDocs.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <CardDescription>
              ASCI aprendio de tus documentos. Usa esta informacion para generar una propuesta contextualizada para {companyName}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Relevant docs for this bookmark */}
            {relevantDocs.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Documentos con FIT para esta cuenta:</p>
                {relevantDocs.map((doc, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{doc.title}</span>
                    <div className="flex gap-1 flex-shrink-0">
                      {doc.matchedTags.map((tag, j) => (
                        <Badge key={j} variant="outline" className="text-[10px] px-1.5 py-0">
                          {tag.value}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
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
              Generar Propuesta con ASCI Docs
            </Button>
          </CardContent>
        </Card>
      ) : !hasDocuments ? (
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
      ) : null}

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
