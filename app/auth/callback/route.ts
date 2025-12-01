import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const token_hash = requestUrl.searchParams.get("token_hash")
  const type = requestUrl.searchParams.get("type")
  const next = requestUrl.searchParams.get("next") ?? "/"

  // Determinar la URL base para redirecciones
  const origin = requestUrl.origin

  const supabase = await createClient()

  // Caso 1: Code exchange (OAuth o magic link)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Caso 2: Token hash (invitaciones, recovery, etc.)
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as "invite" | "recovery" | "email" | "signup",
    })

    if (!error) {
      // Si es una invitación o recovery, redirigir a set-password
      if (type === "invite" || type === "recovery") {
        return NextResponse.redirect(`${origin}/auth/set-password`)
      }
      // Para otros tipos, redirigir al destino
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Si hay error o no hay tokens, redirigir a error
  return NextResponse.redirect(`${origin}/auth/error?message=Error al verificar el enlace`)
}
