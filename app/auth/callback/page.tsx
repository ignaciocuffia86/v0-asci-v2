"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Check URL hash for tokens (implicit flow)
        const hash = window.location.hash
        
        if (hash && hash.includes("access_token")) {
          // Parse hash parameters
          const params = new URLSearchParams(hash.substring(1))
          const accessToken = params.get("access_token")
          const refreshToken = params.get("refresh_token")
          const type = params.get("type")

          if (accessToken && refreshToken) {
            // Set the session with the tokens from the hash
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })

            if (sessionError) {
              console.error("[v0] Error setting session:", sessionError.message)
              setError(sessionError.message)
              setIsProcessing(false)
              return
            }

            // Clear the hash from the URL for security
            window.history.replaceState(null, "", window.location.pathname)

            // Redirect based on type
            if (type === "invite" || type === "recovery") {
              router.push("/auth/set-password")
            } else {
              router.push("/")
            }
            return
          }
        }

        // Check URL params for error
        const urlParams = new URLSearchParams(window.location.search)
        const errorParam = urlParams.get("error")
        const errorDescription = urlParams.get("error_description")

        if (errorParam) {
          setError(errorDescription || errorParam)
          setIsProcessing(false)
          return
        }

        // If no hash tokens and no error, check if we have a session already
        const { data: { session } } = await supabase.auth.getSession()
        
        if (session) {
          router.push("/")
          return
        }

        // No tokens found anywhere
        setError("No se encontraron tokens de autenticación")
        setIsProcessing(false)
      } catch (err) {
        console.error("[v0] Auth callback error:", err)
        setError("Error procesando la autenticación")
        setIsProcessing(false)
      }
    }

    handleAuthCallback()
  }, [router, supabase.auth])

  if (isProcessing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Procesando autenticación...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Error de autenticación</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">{error}</p>
            <Button onClick={() => router.push("/auth/login")} className="w-full">
              Volver al Login
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return null
}
