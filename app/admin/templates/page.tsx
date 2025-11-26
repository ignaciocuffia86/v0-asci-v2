import { getIcebreakerTemplates } from "@/app/actions/templates"
import { TemplatesList } from "./_components/templates-list"
import { CreateTemplateDialog } from "./_components/create-template-dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Info } from "lucide-react"

const AVAILABLE_VARIABLES = [
  { key: "{contact_name}", description: "Nombre completo del contacto", example: "Carlos Ruiz" },
  { key: "{contact_first_name}", description: "Solo el nombre de pila", example: "Carlos" },
  { key: "{contact_role}", description: "Cargo del contacto", example: "CTO" },
  { key: "{company_name}", description: "Nombre de la empresa", example: "TechCorp" },
  { key: "{industry}", description: "Industria de la empresa", example: "Tecnología" },
  { key: "{technology}", description: "Tecnología del contexto de búsqueda", example: "AWS" },
  { key: "{process}", description: "Proceso del contexto de búsqueda", example: "DevOps" },
  { key: "{news}", description: "Últimas 3 noticias de la empresa", example: "Expansión regional, Nueva ronda..." },
  { key: "{implementations}", description: "Casos de éxito detectados", example: "Migración a cloud exitosa..." },
  { key: "{snippets}", description: "Fragmentos relevantes de perfiles", example: "Expertise en microservicios..." },
  { key: "{signals_list}", description: "Todas las señales detectadas", example: "Kubernetes, Docker, AWS..." },
  { key: "{strategy}", description: "Tu propuesta de valor configurada", example: "Ayudamos a escalar..." },
  { key: "{recommended_pitch}", description: "Pitch recomendado por IA", example: "Dado su uso de K8s..." },
]

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

      {/* Variables Reference Panel */}
      <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg text-blue-700 dark:text-blue-400">
            <Info className="h-5 w-5" />
            Variables Disponibles
          </CardTitle>
          <CardDescription>
            Usa estas variables en tus templates. La IA las reemplazará con datos reales del contexto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {AVAILABLE_VARIABLES.map((v) => (
              <div
                key={v.key}
                className="flex flex-col gap-1 p-3 rounded-lg bg-white dark:bg-slate-900 border border-blue-100 dark:border-blue-900"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono text-xs">
                    {v.key}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{v.description}</p>
                <p className="text-xs text-muted-foreground/70 italic">Ej: {v.example}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <TemplatesList templates={templates} />
    </div>
  )
}
