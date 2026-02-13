import { getIcebreakerTemplates } from "@/app/actions/templates"
import { TemplatesList } from "./_components/templates-list"
import { CreateTemplateDialog } from "./_components/create-template-dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Info } from "lucide-react"

const AUTO_INJECTED_DATA = [
  { label: "Datos del prospecto", description: "Nombre, cargo, headline, empresa, descripcion del puesto" },
  { label: "Senales detectadas", description: "Tecnologias o procesos detectados en el perfil del contacto" },
  { label: "Fragmentos del perfil", description: "Snippets relevantes del perfil de LinkedIn" },
  { label: "Propuesta de valor", description: "La propuesta de valor configurada en tu perfil" },
  { label: "Perfil de empresa", description: "Resumen generado por IA de tu empresa y capacidades" },
  { label: "Casos de exito relevantes", description: "DOCs subidos que matchean con la industria/tecnologia del prospecto (auto-seleccionados)" },
]

export default async function TemplatesPage() {
  const templates = await getIcebreakerTemplates()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Templates de Mensajes</h1>
          <p className="text-muted-foreground mt-1">
            Cada template define el tono y enfoque de los icebreakers. Los datos del prospecto y casos de exito se inyectan automaticamente.
          </p>
        </div>
        <CreateTemplateDialog />
      </div>

      {/* How it works panel */}
      <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg text-blue-700 dark:text-blue-400">
            <Info className="h-5 w-5" />
            Como funciona
          </CardTitle>
          <CardDescription>
            El prompt final se arma automaticamente combinando tus instrucciones de tono con los datos del contexto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">Datos inyectados automaticamente al prompt:</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {AUTO_INJECTED_DATA.map((item) => (
                <div
                  key={item.label}
                  className="flex flex-col gap-1 p-3 rounded-lg bg-white dark:bg-slate-900 border border-blue-100 dark:border-blue-900"
                >
                  <Badge variant="secondary" className="text-xs w-fit">{item.label}</Badge>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              <strong>Tip:</strong> En el template solo necesitas definir el estilo, enfoque y estructura de los mensajes (LinkedIn + Email). No necesitas incluir variables - la IA recibe todos los datos automaticamente.
            </p>
          </div>
        </CardContent>
      </Card>

      <TemplatesList templates={templates} />
    </div>
  )
}
