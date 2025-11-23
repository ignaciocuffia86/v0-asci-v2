import { getIcebreakerTemplates } from "@/app/actions/templates"
import { TemplatesList } from "./_components/templates-list"
import { CreateTemplateDialog } from "./_components/create-template-dialog"

export default async function TemplatesPage() {
  const templates = await getIcebreakerTemplates()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Templates de Icebreakers</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona los templates que usarán los usuarios para generar mensajes personalizados
          </p>
        </div>
        <CreateTemplateDialog />
      </div>

      <TemplatesList templates={templates} />
    </div>
  )
}
