"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Loader2, Save, ArrowLeft } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import Link from "next/link"

type Profile = {
  id: string
  full_name: string | null
  company: string | null
  value_proposition: string | null
  role: string
  email?: string
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const fetchProfile = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single()

      if (data) {
        setProfile({ ...data, email: user.email })
      }
      setIsLoading(false)
    }
    fetchProfile()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return

    setIsSaving(true)
    setMessage(null)

    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: profile.full_name,
          company: profile.company,
          value_proposition: profile.value_proposition,
        })
        .eq("id", profile.id)

      if (error) throw error
      setMessage({ type: "success", text: "Perfil actualizado correctamente." })
    } catch (error) {
      setMessage({ type: "error", text: "Error al actualizar el perfil." })
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!profile) return null

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mi Perfil</h1>
          <p className="text-muted-foreground">Gestiona tu información personal y propuesta de valor.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/search">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver a Búsqueda
          </Link>
        </Button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Información Personal</CardTitle>
            <CardDescription>Tus datos básicos de contacto e identificación.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <Avatar className="h-20 w-20">
                <AvatarFallback className="text-2xl">{profile.full_name?.charAt(0) || "U"}</AvatarFallback>
              </Avatar>
              <div>
                <div className="font-medium text-lg">{profile.full_name}</div>
                <div className="text-muted-foreground">{profile.email}</div>
                <div className="text-xs bg-muted px-2 py-1 rounded mt-1 inline-block uppercase">{profile.role}</div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fullName">Nombre Completo</Label>
                <Input
                  id="fullName"
                  value={profile.full_name || ""}
                  onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company">Empresa</Label>
                <Input
                  id="company"
                  value={profile.company || ""}
                  onChange={(e) => setProfile({ ...profile, company: e.target.value })}
                  placeholder="Tu empresa actual"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Propuesta de Valor</CardTitle>
            <CardDescription>
              Define el mensaje clave que utilizaremos para generar icebreakers personalizados.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="valueProp">Propuesta de Valor</Label>
              <Textarea
                id="valueProp"
                value={profile.value_proposition || ""}
                onChange={(e) => setProfile({ ...profile, value_proposition: e.target.value })}
                placeholder="Ej: Ayudamos a empresas de retail a optimizar su cadena de suministro mediante IA..."
                rows={6}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Este texto será utilizado como contexto para generar mensajes de contacto más relevantes.
              </p>
            </div>
          </CardContent>
        </Card>

        {message && (
          <Alert
            variant={message.type === "error" ? "destructive" : "default"}
            className={
              message.type === "success"
                ? "border-green-500 text-green-700 bg-green-50 dark:bg-green-900/20 dark:text-green-300"
                : ""
            }
          >
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Guardar Cambios
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
