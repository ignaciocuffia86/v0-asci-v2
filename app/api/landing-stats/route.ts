import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

// Endpoint publico (sin auth) que devuelve la fila singleton de
// `public.landing_stats`. Cacheado 1 hora en CDN para no martillar la DB.
// El CRON semanal escribe la tabla; este endpoint solo lee.
export const revalidate = 3600

export async function GET() {
  // Usamos el cliente publico (anon) ya que la policy SELECT es publica.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const { data, error } = await supabase
    .from("landing_stats")
    // NOTE: the column is `refreshed_at` (see scripts/162_landing_stats.sql).
    // Selecting a non-existent `last_refreshed_at` made PostgREST reject the
    // whole query, so this endpoint returned 500 and the landing silently fell
    // back to its hardcoded April snapshot.
    .select("contacts_analyzed, companies_indexed, technologies_processes, signals_detected, refreshed_at")
    .eq("id", 1)
    .maybeSingle()

  if (error) {
    console.error("[landing-stats] Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: "stats not initialized" }, { status: 404 })
  }

  return NextResponse.json(data, {
    headers: {
      // Cacheo agresivo: el CRON corre semanal, los datos cambian poco.
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  })
}
