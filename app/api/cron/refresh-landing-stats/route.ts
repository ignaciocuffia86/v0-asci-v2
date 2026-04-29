import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * CRON semanal: refresca la fila singleton de `public.landing_stats`
 * con los valores actuales de contacts, companies, dictionary y signals.
 * Configurado en vercel.json para correr lunes 5 AM UTC (~ 2 AM ART).
 *
 * Tambien acepta llamadas manuales con header `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (
    authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
    process.env.NODE_ENV === "production"
  ) {
    console.warn("[refresh-landing-stats] Unauthorized attempt")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  try {
    const { data, error } = await supabase.rpc("refresh_landing_stats")

    if (error) {
      console.error("[refresh-landing-stats] Error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log("[refresh-landing-stats] Result:", data)
    return NextResponse.json({ success: true, result: data })
  } catch (err: any) {
    console.error("[refresh-landing-stats] Unexpected error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
