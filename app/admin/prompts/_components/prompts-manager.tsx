"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Save, Loader2, Info } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

const AVAILABLE_VARIABLES = [
  { key: "{company_name}", description: "Nombre de la empresa", example: "Banco Galicia" },
  { key: "{website}", description: "Sitio web de la empresa", example: "https://bancogalicia.com" },
  { key: "{industry}", description: "Industria de la empresa", example: "Banking" },
  { key: "{linkedin_url}", description: "URL de LinkedIn", example: "https://linkedin.com/company/..." },
  { key: "{keywords}", description: "Keywords detectados (señales)", example: "SAP, DevOps, Azure" },
  { key: "{vendors}", description: "Vendors detectados", example: "SAP, Oracle, Microsoft" },
  { key: "{products}", description: "Productos detectados", example: "S4HANA, OCI, Azure" },
  { key: "{processes}", description: "Procesos detectados", example: "DevOps, QA, Cloud" },
]

type AdminPrompt = {
  id: string
  prompt_key: string
  prompt_text: string
  description: string | null
  is_active: boolean
}

export function PromptsManager({ initialPrompts }: { initialPrompts: AdminPrompt[] }) {
  const [prompts, setPrompts] = useState(initialPrompts)
  const [saving, setSaving] = useState<string | null>(null)
  const [showVariables, setShowVariables] = useState(false)
  const { toast } = useToast()

  const insertVariable = (promptId: string, variable: string) => {
    const textarea = document.getElementById(`prompt-${promptId}`) as HTMLTextAreaElement
    if (textarea) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const currentPrompt = prompts.find((p) => p.id === promptId)
      if (currentPrompt) {
        const newText =
          currentPrompt.prompt_text.substring(0, start) + variable + currentPrompt.prompt_text.substring(end)
        updatePrompt(promptId, "prompt_text", newText)
        // Restore cursor position after React re-render
        setTimeout(() => {
          textarea.focus()
          textarea.setSelectionRange(start + variable.length, start + variable.length)
        }, 0)
      }
    }
  }

  const handleSave = async (prompt: AdminPrompt) => {
    setSaving(prompt.id)

    try {
      const response = await fetch("/api/admin/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: prompt.id,
          prompt_text: prompt.prompt_text,
          description: prompt.description,
          is_active: prompt.is_active,
        }),
      })

      if (!response.ok) throw new Error("Error al guardar")

      toast({
        title: "Prompt guardado",
        description: "Los cambios se aplicarán en las próximas búsquedas",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo guardar el prompt",
        variant: "destructive",
      })
    } finally {
      setSaving(null)
    }
  }

  const updatePrompt = (id: string, field: keyof AdminPrompt, value: string | boolean) => {
    setPrompts(prompts.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
  }

  const getPromptLabel = (key: string) => {
    const labels: Record<string, string> = {
      news_research: "Búsqueda de Noticias",
      implementations_research: "Búsqueda de Implementaciones",
    }
    return labels[key] || key
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="cursor-pointer" onClick={() => setShowVariables(!showVariables)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Variables Disponibles</CardTitle>
            </div>
            <Badge variant="outline">{showVariables ? "Ocultar" : "Mostrar"}</Badge>
          </div>
          <CardDescription>
            Usa estas variables en tus prompts - serán reemplazadas con datos reales del bookmark
          </CardDescription>
        </CardHeader>
        {showVariables && (
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {AVAILABLE_VARIABLES.map((variable) => (
                <div key={variable.key} className="flex items-start gap-2 p-2 rounded-md bg-muted/50">
                  <code className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono whitespace-nowrap">
                    {variable.key}
                  </code>
                  <div className="text-sm">
                    <p className="font-medium">{variable.description}</p>
                    <p className="text-muted-foreground text-xs">Ej: {variable.example}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {prompts.map((prompt) => (
        <Card key={prompt.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {getPromptLabel(prompt.prompt_key)}
                  <Badge variant={prompt.is_active ? "default" : "secondary"}>
                    {prompt.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                </CardTitle>
                {prompt.description && <CardDescription className="mt-1">{prompt.description}</CardDescription>}
              </div>
              <Button onClick={() => handleSave(prompt)} disabled={saving === prompt.id} size="sm">
                {saving === prompt.id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Guardar
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor={`desc-${prompt.id}`}>Descripción</Label>
              <Input
                id={`desc-${prompt.id}`}
                value={prompt.description || ""}
                onChange={(e) => updatePrompt(prompt.id, "description", e.target.value)}
                placeholder="Descripción del prompt"
                className="mt-1.5"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label htmlFor={`prompt-${prompt.id}`}>Prompt</Label>
                <div className="flex gap-1 flex-wrap">
                  {["{company_name}", "{industry}", "{keywords}", "{vendors}"].map((v) => (
                    <Button
                      key={v}
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs font-mono"
                      onClick={() => insertVariable(prompt.id, v)}
                    >
                      {v}
                    </Button>
                  ))}
                </div>
              </div>
              <Textarea
                id={`prompt-${prompt.id}`}
                value={prompt.prompt_text}
                onChange={(e) => updatePrompt(prompt.id, "prompt_text", e.target.value)}
                rows={10}
                className="mt-1.5 font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
