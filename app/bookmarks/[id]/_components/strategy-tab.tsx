"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { BrainCircuit, Save } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { getStrategy, saveSenderContext } from "@/app/actions/workspace"
import { toast } from "sonner"

interface BookmarkStrategyProps {
  bookmarkId: string
  companyName: string
}

export function BookmarkStrategy({ bookmarkId, companyName }: BookmarkStrategyProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  // Sender context state
  const [senderContext, setSenderContext] = useState("")
  const [saveAsDefault, setSaveAsDefault] = useState(false)

  useEffect(() => {
    loadStrategy()
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

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Cargando...</div>
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            <CardTitle>Mi Propuesta de Valor</CardTitle>
          </div>
          <CardDescription>
            Define tu propuesta de valor para {companyName}. Este contexto se usará para generar icebreakers
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
              placeholder="Describe quién eres, qué ofreces y por qué eres relevante para este prospecto...

Ejemplo: Soy especialista en automatización de procesos financieros con 10 años de experiencia ayudando a bancos regionales a reducir tiempos de cierre contable. Hemos trabajado con instituciones similares logrando reducciones del 40% en tiempos de proceso."
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
