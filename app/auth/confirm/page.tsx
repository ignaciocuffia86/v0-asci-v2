"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"

export default function AuthConfirmPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const handleAuthCallback = async () => {
      // Obtener el hash de la URL (contiene los tokens después de #)
      const hashParams = new URLSearchParams(window.location.hash.substring(1))
      const accessToken = hashParams.get("access_token")
      const refreshToken = hashParams.get("refresh_token")
      const type = hashParams.get("type")

      // También revisar query params por si viene de un link con token_hash
      const searchParams = new URLSearchParams(window.location.search)
      const tokenHash = searchParams.get("token_hash")
      const tokenType = searchParams.get("type")

      console.log("[v0] Auth confirm - hash params:", {
        accessToken: !!accessToken,
        refreshToken: !!refreshToken,
        type,
      })
      console.log("[v0] Auth confirm - search params:", { tokenHash: !!tokenHash, tokenType })

      try {
        // Caso 1: Tokens en el hash (formato antiguo de Supabase)
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })

          if (error) {
            console.error("[v0] Error setting session:", error)
            setError(error.message)
            return
          }

          // Verificar si es invitación o recovery para ir a set-password
          if (type === "invite" || type === "recovery") {
            router.push("/auth/set-password")
          } else {
            router.push("/")
          }
          return
        }

        // Caso 2: Token hash en query params (formato PKCE)
        if (tokenHash && tokenType) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: tokenType as "invite" | "recovery" | "email" | "signup",
          })

          if (error) {
            console.error("[v0] Error verifying OTP:", error)
            setError(error.message)
            return
          }

          if (tokenType === "invite" || tokenType === "recovery") {
            router.push("/auth/set-password")
          } else {
            router.push("/")
          }
          return
        }

        // Si no hay tokens, intentar obtener la sesión actual
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (session) {
          router.push("/")
        } else {
          setError("No se encontraron tokens de autenticación en la URL")
        }
      } catch (err) {
        console.error("[v0] Unexpected error:", err)
        setError("Error inesperado durante la autenticación")
      }
    }

    handleAuthCallback()
  }, [router, supabase.auth])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">Error de autenticación</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <a href="/auth/login" className="text-primary hover:underline">
              Volver al inicio de sesión
            </a>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Verificando...</CardTitle>
          <CardDescription>Por favor espera mientras verificamos tu cuenta</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    </div>
  )
}
