import { createClient } from "@/lib/supabase/server"
import { getCurrentWorkspace } from "@/lib/v3/workspace"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Building2, Globe, Users, FileText, Calendar } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return null
  
  const workspace = await getCurrentWorkspace(user.id)
  
  if (!workspace) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Configuracion General</h2>
        <p className="text-muted-foreground">No tienes un workspace configurado.</p>
      </div>
    )
  }
  
  // Obtener stats del workspace
  const [membersResult, docsResult, campaignsResult] = await Promise.all([
    supabase
      .from("v3_workspace_members")
      .select("id", { count: "exact" })
      .eq("workspace_id", workspace.id)
      .eq("status", "active"),
    supabase
      .from("v3_workspace_documents")
      .select("id", { count: "exact" })
      .eq("workspace_id", workspace.id),
    supabase
      .from("v3_campaigns")
      .select("id", { count: "exact" })
      .eq("workspace_id", workspace.id),
  ])
  
  const memberCount = membersResult.count || 0
  const docCount = docsResult.count || 0
  const campaignCount = campaignsResult.count || 0
  
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">Configuracion General</h2>
        <p className="text-sm text-muted-foreground">
          Informacion de tu workspace
        </p>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2">
        {/* Workspace Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-5" />
              Workspace
            </CardTitle>
            <CardDescription>Informacion general</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Nombre</span>
              <span className="font-medium">{workspace.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Dominio</span>
              <Badge variant="secondary">{workspace.domain}</Badge>
            </div>
            {workspace.website_url && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Website</span>
                <a 
                  href={workspace.website_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <Globe className="size-3" />
                  {workspace.website_url.replace(/^https?:\/\//, '')}
                </a>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Creado</span>
              <span className="text-sm">
                {format(new Date(workspace.created_at), "d MMM yyyy", { locale: es })}
              </span>
            </div>
          </CardContent>
        </Card>
        
        {/* Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="size-5" />
              Estadisticas
            </CardTitle>
            <CardDescription>Uso del workspace</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="size-4" />
                Miembros
              </span>
              <span className="font-medium">{memberCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="size-4" />
                Documentos
              </span>
              <span className="font-medium">{docCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Building2 className="size-4" />
                Campanas
              </span>
              <span className="font-medium">{campaignCount}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
