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
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useState } from "react"
import { type IcebreakerTemplate, updateIcebreakerTemplate } from "@/app/actions/templates"
import { useRouter } from "next/navigation"

const TONE_OPTIONS = [
  { value: "profesional", label: "Profesional" },
  { value: "casual", label: "Casual" },
  { value: "directo", label: "Directo" },
  { value: "consultivo", label: "Consultivo" },
  { value: "amigable", label: "Amigable" },
]

interface EditTemplateDialogProps {
  template: IcebreakerTemplate
  onClose: () => void
}

export function EditTemplateDialog({ template, onClose }: EditTemplateDialogProps) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const [formData, setFormData] = useState({
    name: template.name,
    description: template.description || "",
    prompt_template: template.prompt_template,
    tone: template.tone,
    is_active: template.is_active,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      await updateIcebreakerTemplate(template.id, formData)
      onClose()
      router.refresh()
    } catch (error) {
      console.error("Error updating template:", error)
      alert("Error al actualizar el template")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Editar Template</DialogTitle>
            <DialogDescription>Modifica los detalles del template de icebreaker</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre del Template</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Input
                id="description"
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
              <Label htmlFor="is_active">Template activo</Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
