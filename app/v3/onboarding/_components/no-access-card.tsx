"use client"

import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MailQuestion, LogOut } from "lucide-react"

export function NoAccessCard() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/auth/login")
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
          <MailQuestion className="size-6 text-primary" />
        </div>
        <CardTitle className="text-2xl text-balance">Necesitás una invitación</CardTitle>
        <CardDescription className="text-base text-pretty">
          El acceso a los workspaces es solo por invitación.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Tu cuenta todavía no pertenece a ningún workspace. Pedile a un administrador
            que te invite por email. Cuando aceptes la invitación, vas a entrar
            automáticamente.
          </p>
        </div>

        <Button onClick={handleSignOut} variant="outline" className="w-full">
          <LogOut data-icon="inline-start" />
          Cerrar sesión
        </Button>
      </CardContent>
    </Card>
  )
}
