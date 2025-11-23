"use client"

import type React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Plus } from "lucide-react"
import { useState } from "react"
import { createIcebreakerTemplate } from "@/app/actions/templates"
import { useRouter } from "next/navigation"

const TONE_OPTIONS = [
  { value: "profesional", label: "Profesional" },
  { value: "casual", label: "Casual" },
  { value: "directo", label: "Directo" },
  { value: "consultivo", label: "Consultivo" },
  { value: "amigable", label: "Amigable" },
]

export function CreateTemplateDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    prompt_template: "",
    tone: "profesional",
    is_active: true,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      await createIcebreakerTemplate(formData)
      setOpen(false)
      setFormData({
        name: "",
        description: "",
        prompt_template: "",
        tone: "profesional",
        is_active: true,
      })
      router.refresh()
    } catch (error) {
      console.error("Error creating template:", error)
      alert("Error al crear el template")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Crear Template
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Crear Nuevo Template</DialogTitle>
            <DialogDescription>
              Crea un template de mensaje que los usuarios podrán usar para generar icebreakers personalizados
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre del Template</Label>
              <Input
                id="name"
                placeholder="Ej: Mención de Tecnología"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Input
                id="description"
                placeholder="Describe cuándo usar este template"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tone">Tono</Label>
              <Select value={formData.tone} onValueChange={(value) => setFormData({ ...formData, tone: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt_template">Prompt Template</Label>
              <Textarea
                id="prompt_template"
                placeholder="Usa variables como {{company_name}}, {{contact_name}}, {{contact_role}}, {{signal}}, etc."
                value={formData.prompt_template}
                onChange={(e) => setFormData({ ...formData, prompt_template: e.target.value })}
                rows={8}
                className="font-mono text-sm"
                required
              />
              <p className="text-xs text-muted-foreground">
                Variables disponibles: {"{"}
                {"{"}company_name{"}"}, {"{"}contact_name{"}"}, {"{"}contact_role{"}"}, {"{"}
                signal{"}"}, {"{"}tone{"}"}
                {"}"}
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="is_active">Activar inmediatamente</Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creando..." : "Crear Template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
