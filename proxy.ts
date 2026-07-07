import { updateSession } from "@/lib/supabase/middleware"
import { NextResponse, type NextRequest } from "next/server"

export async function proxy(request: NextRequest) {
  // Normalizar URLs v3 mal formadas por navegación relativa
  // (ej: /search/v3/chat, /search/v3/v3/v3/chat -> /v3/chat)
  const { pathname } = request.nextUrl
  const malformedV3 = pathname.match(/^\/(?!v3(\/|$))(?!api\/)[^]*?\/v3(?:\/(.*))?$/)
  if (malformedV3) {
    const rest = (malformedV3[2] ?? "").replace(/^(v3\/)+/, "").replace(/^v3$/, "")
    const url = request.nextUrl.clone()
    url.pathname = `/v3${rest ? `/${rest}` : ""}`
    return NextResponse.redirect(url)
  }

  return await updateSession(request)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|_vercel|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
