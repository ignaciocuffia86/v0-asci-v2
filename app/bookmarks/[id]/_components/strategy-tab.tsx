"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { BrainCircuit, Lightbulb, Target, RefreshCw } from "lucide-react"
import { getStrategy, analyzeStrategy, saveSenderContext } from "@/app/actions/workspace"
import { toast } from "sonner"

interface BookmarkStrategyProps {
  companyId: string
  companyName: string
  website?: string
}

export function BookmarkStrategy({ companyId, companyName, website }: BookmarkStrategyProps) {
  const [strategy, setStrategy] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Sender context state
  const [senderContext, setSenderContext] = useState("")

  useEffect(() => {
    loadStrategy()
  }, [companyId])

  const loadStrategy = async () => {
    setIsLoading(true)
    try {
      const data = await getStrategy(companyId)
      if (data) {
        setStrategy(data)
        setSenderContext(data.sender_context_override || "") // Or fall back to global profile later
      }
    } catch (error) {
      console.error("Error loading strategy:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleAnalyze = async () => {
    if (!website) {
      toast.error("La empresa no tiene sitio web para analizar")
      return
    }

    setIsAnalyzing(true)
    try {
      const result = await analyzeStrategy(companyId, website, senderContext)
      if (result.success) {
        setStrategy(result.data)
        toast.success("Estrategia generada con éxito")
      } else {
        toast.error("Error al generar estrategia: " + result.error)
      }
    } catch (error) {
      toast.error("Error inesperado")
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleSaveContext = async () => {
    setIsSaving(true)
    try {
      await saveSenderContext(companyId, senderContext)
      toast.success("Contexto guardado")
    } catch (error) {
      toast.error("Error al guardar contexto")
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Cargando estrategia...</div>
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full">
      {/* Left Column: Target Analysis */}
      <div className="md:col-span-2 space-y-6">
        <Card className="bg-gradient-to-br from-blue-50 to-white dark:from-slate-900 dark:to-slate-950 border-blue-100 dark:border-slate-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-5 w-5 text-blue-600" />
                <CardTitle>Análisis de Cuenta</CardTitle>
              </div>
              <Button
                onClick={handleAnalyze}
                disabled={isAnalyzing || !website}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isAnalyzing ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Analizando...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    {strategy ? "Regenerar Análisis" : "Analizar Web"}
                  </>
                )}
              </Button>
            </div>
            <CardDescription>
              Inteligencia artificial aplicada para entender a {companyName} y cómo venderles.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!strategy ? (
              <div className="text-center py-12 border-2 border-dashed rounded-lg bg-white/50 dark:bg-slate-900/50">
                <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium text-lg">Sin estrategia definida</h3>
                <p className="text-muted-foreground max-w-sm mx-auto mt-2 mb-6">
                  Ejecuta el análisis para obtener un resumen de la empresa y ángulos de venta recomendados.
                </p>
                <Button onClick={handleAnalyze} disabled={!website}>
                  Analizar {companyName}
                </Button>
                {!website && <p className="text-xs text-red-500 mt-2">Falta URL del sitio web</p>}
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center gap-2 text-slate-700 dark:text-slate-200">
                    <Target className="h-4 w-4" />
                    Resumen del Negocio
                  </h3>
                  <div className="p-4 bg-white dark:bg-slate-900 rounded-lg border text-sm leading-relaxed">
                    {strategy.target_summary}
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center gap-2 text-slate-700 dark:text-slate-200">
                    <Lightbulb className="h-4 w-4" />
                    Propuesta de Valor Recomendada
                  </h3>
                  <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/50 rounded-lg text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                    {strategy.recommended_pitch}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right Column: Sender Context */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mi Contexto</CardTitle>
            <CardDescription>Define quién eres para este prospecto.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="context">About Me & My Value Prop</Label>
              <Textarea
                id="context"
                value={senderContext}
                onChange={(e) => setSenderContext(e.target.value)}
                placeholder="Ej: Soy experto en Fintech ayudando a bancos a reducir fraude..."
                className="h-[300px] resize-none text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Este contexto se usará para generar la estrategia y los icebreakers.
              </p>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSaveContext} disabled={isSaving} className="w-full bg-transparent" variant="outline">
              {isSaving ? "Guardando..." : "Guardar Contexto"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}

function Sparkles(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  )
}
