"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Building2, Users, ArrowRight, Loader2 } from "lucide-react"
import { createMyWorkspace, requestAccessToWorkspace } from "@/app/actions/v3/workspace"

interface OnboardingFormProps {
  domain: string
  mode: "create" | "join"
  workspaceId?: string
  workspaceName?: string
}

export function OnboardingForm({ domain, mode, workspaceId, workspaceName }: OnboardingFormProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  async function handleCreate() {
    setIsLoading(true)
    setError(null)
    
    const result = await createMyWorkspace()
    
    if (result.success) {
      router.push("/v3/docs")
    } else {
      setError(result.error || "Error al crear el workspace")
      setIsLoading(false)
    }
  }
  
  async function handleJoin() {
    if (!workspaceId) return
    
    setIsLoading(true)
    setError(null)
    
    const result = await requestAccessToWorkspace(workspaceId)
    
    if (result.success) {
      router.refresh()
    } else {
      setError(result.error || "Error al solicitar acceso")
      setIsLoading(false)
    }
  }
  
  if (mode === "create") {
    return (
      <Card className="border-border/50">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Building2 className="size-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Crear tu Workspace</CardTitle>
          <CardDescription className="text-base">
            Seras el administrador del workspace para <strong>{domain}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
            <p className="text-sm text-muted-foreground">
              Como administrador podras invitar a otros miembros de tu equipo 
              y gestionar el acceso a la plataforma.
            </p>
          </div>
          
          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
          
          <Button 
            onClick={handleCreate} 
            disabled={isLoading}
            className="w-full"
            size="lg"
          >
            {isLoading ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <ArrowRight data-icon="inline-end" />
            )}
            {isLoading ? "Creando..." : "Crear Workspace"}
          </Button>
        </CardContent>
      </Card>
    )
  }
  
  return (
    <Card className="border-border/50">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
          <Users className="size-6 text-primary" />
        </div>
        <CardTitle className="text-2xl">Unirse a {workspaceName}</CardTitle>
        <CardDescription className="text-base">
          Ya existe un workspace para <strong>{domain}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">
            Solicita acceso al administrador del workspace. 
            Recibiras una notificacion cuando tu solicitud sea aprobada.
          </p>
        </div>
        
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
        
        <Button 
          onClick={handleJoin} 
          disabled={isLoading}
          className="w-full"
          size="lg"
        >
          {isLoading ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <ArrowRight data-icon="inline-end" />
          )}
          {isLoading ? "Enviando solicitud..." : "Solicitar Acceso"}
        </Button>
      </CardContent>
    </Card>
  )
}
