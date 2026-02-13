"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sparkles, RefreshCw, Loader2, Building2, Cpu, Workflow } from "lucide-react"
import type { UserValueProfile } from "@/app/actions/documents"
import { toast } from "sonner"
import { useState } from "react"

interface ValueProfileCardProps {
  profile: UserValueProfile | null
  documentCount: number
  onRegenerate: () => Promise<void>
}

export function ValueProfileCard({ profile, documentCount, onRegenerate }: ValueProfileCardProps) {
  const [isRegenerating, setIsRegenerating] = useState(false)

  const handleRegenerate = async () => {
    setIsRegenerating(true)
    try {
      await onRegenerate()
      toast.success("Perfil de propuesta actualizado")
    } catch {
      toast.error("Error al regenerar el perfil")
    } finally {
      setIsRegenerating(false)
    }
  }

  if (!profile && documentCount === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-6 text-center">
          <Sparkles className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-foreground">Tu propuesta de valor</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Subi documentos como casos de exito, brochures o URLs de tu web para que ASCI entienda que vendes y pueda generar mejores estrategias para cada cuenta.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (!profile && documentCount > 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-foreground">Perfil de propuesta de valor</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Tenes {documentCount} documento{documentCount !== 1 ? "s" : ""} cargado{documentCount !== 1 ? "s" : ""}. Genera tu perfil para desbloquear estrategias personalizadas.
              </p>
            </div>
            <Button onClick={handleRegenerate} disabled={isRegenerating} size="sm" className="gap-2">
              {isRegenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generar perfil
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Perfil de propuesta de valor
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
            disabled={isRegenerating}
            className="gap-1.5 text-xs h-7"
          >
            {isRegenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Regenerar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {profile?.profile_summary && (
          <p className="text-sm text-muted-foreground leading-relaxed">{profile.profile_summary}</p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          {/* Industries */}
          {profile?.target_industries && profile.target_industries.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                Industrias
              </div>
              <div className="flex flex-wrap gap-1">
                {profile.target_industries.map((ind) => (
                  <Badge key={ind} variant="outline" className="text-[10px] border-emerald-200 text-emerald-700 bg-emerald-50">
                    {ind}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Technologies */}
          {profile?.target_technologies && profile.target_technologies.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Cpu className="h-3.5 w-3.5" />
                Tecnologias
              </div>
              <div className="flex flex-wrap gap-1">
                {profile.target_technologies.map((tech) => (
                  <Badge key={tech} variant="outline" className="text-[10px] border-blue-200 text-blue-700 bg-blue-50">
                    {tech}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Processes */}
          {profile?.target_processes && profile.target_processes.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Workflow className="h-3.5 w-3.5" />
                Procesos
              </div>
              <div className="flex flex-wrap gap-1">
                {profile.target_processes.map((proc) => (
                  <Badge key={proc} variant="outline" className="text-[10px] border-purple-200 text-purple-700 bg-purple-50">
                    {proc}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {profile?.generated_at && (
          <p className="text-[10px] text-muted-foreground">
            Generado: {new Date(profile.generated_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
