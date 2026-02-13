import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateValueProfile } from "@/lib/documents/generate-value-profile"

/**
 * POST /api/documents/generate-profile
 * Generates or regenerates the consolidated value profile for the current user.
 */
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  try {
    const profile = await generateValueProfile(user.id)

    if (!profile) {
      return NextResponse.json(
        { error: "No hay documentos procesados para generar el perfil" },
        { status: 400 },
      )
    }

    return NextResponse.json({ success: true, profile })
  } catch (err: any) {
    console.error("[v0] Error generating value profile:", err)
    return NextResponse.json(
      { error: err.message || "Error al generar perfil" },
      { status: 500 },
    )
  }
}
