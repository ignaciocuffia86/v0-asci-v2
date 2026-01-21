import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const token_hash = requestUrl.searchParams.get("token_hash")
  const type = requestUrl.searchParams.get("type")
  const next = requestUrl.searchParams.get("next") ?? "/"
  const error_param = requestUrl.searchParams.get("error")
  const error_description = requestUrl.searchParams.get("error_description")

  // Determinar la URL base para redirecciones
  const origin = requestUrl.origin

  // Si Supabase envió un error, redirigir a la página de error
  if (error_param) {
    console.log("[v0] Auth callback received error from Supabase:", error_param, error_description)
    return NextResponse.redirect(`${origin}/auth/error?message=${encodeURIComponent(error_description || error_param)}`)
  }

  const supabase = await createClient()

  // Caso 1: Code exchange (OAuth, magic link, o PKCE flow)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Si es una invitación o recovery, redirigir a set-password
      if (type === "invite" || type === "recovery") {
        return NextResponse.redirect(`${origin}/auth/set-password`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.log("[v0] Code exchange failed:", error.message)
    return NextResponse.redirect(`${origin}/auth/error?message=${encodeURIComponent(error.message)}`)
  }

  // Caso 2: Token hash directo (cuando Supabase no usa PKCE)
  // NOTA: En flujo normal, Supabase verifica el token en /verify y luego 
  // redirige con hash fragments (#access_token). Ese caso lo maneja /auth/confirm.
  // Este caso es solo si recibimos token_hash directamente sin code.
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as "invite" | "recovery" | "email" | "signup",
    })

    if (!error) {
      if (type === "invite" || type === "recovery") {
        return NextResponse.redirect(`${origin}/auth/set-password`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.log("[v0] verifyOtp failed:", error.message)
    return NextResponse.redirect(`${origin}/auth/error?message=${encodeURIComponent(error.message)}`)
  }

  // Si llegamos aquí sin code ni token_hash, redirigir a login
  return NextResponse.redirect(`${origin}/auth/login`)
}
