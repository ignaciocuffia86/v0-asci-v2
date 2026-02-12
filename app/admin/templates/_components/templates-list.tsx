"use client"

import type { IcebreakerTemplate } from "@/app/actions/templates"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Edit, Trash2, ToggleLeft, ToggleRight } from "lucide-react"
import { useState } from "react"
import { EditTemplateDialog } from "./edit-template-dialog"
import { deleteIcebreakerTemplate, toggleTemplateActive } from "@/app/actions/templates"
import { useRouter } from "next/navigation"

const TONE_LABELS: Record<string, string> = {
  industry_insight: "Insight de Industria",
  case_reference: "Caso Real",
  consultive: "Consultivo",
  direct: "Directo",
}

interface TemplatesListProps {
  templates: IcebreakerTemplate[]
}

export function TemplatesList({ templates }: TemplatesListProps) {
  const [editingTemplate, setEditingTemplate] = useState<IcebreakerTemplate | null>(null)
  const router = useRouter()

  const handleToggle = async (id: string, currentStatus: boolean) => {
    try {
      await toggleTemplateActive(id, !currentStatus)
      router.refresh()
    } catch (error) {
      console.error("Error toggling template:", error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro de eliminar este template?")) return

    try {
      await deleteIcebreakerTemplate(id)
      router.refresh()
    } catch (error) {
      console.error("Error deleting template:", error)
    }
  }

  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground">No hay templates creados aún</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4">
      {templates.map((template) => (
        <Card key={template.id}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <CardTitle>{template.name}</CardTitle>
                  <Badge variant={template.is_active ? "default" : "secondary"}>
                    {template.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                  <Badge variant="outline">{TONE_LABELS[template.tone] || template.tone}</Badge>
                </div>
                {template.description && <CardDescription>{template.description}</CardDescription>}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleToggle(template.id, template.is_active)}
                  title={template.is_active ? "Desactivar" : "Activar"}
                >
                  {template.is_active ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setEditingTemplate(template)}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(template.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Prompt Template:</p>
                <p className="text-sm bg-muted p-3 rounded-md font-mono whitespace-pre-wrap mt-1">
                  {template.prompt_template}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {editingTemplate && <EditTemplateDialog template={editingTemplate} onClose={() => setEditingTemplate(null)} />}
    </div>
  )
}
