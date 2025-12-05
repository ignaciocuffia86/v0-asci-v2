import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { previewDigest } from "@/app/actions/digest"

export async function GET(request: Request) {
  const supabase = await createClient()

  // Verificar autenticación
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Obtener userId del query param o usar el del usuario autenticado
  const { searchParams } = new URL(request.url)
  const targetUserId = searchParams.get("userId") || user.id

  // Solo admins pueden ver el preview de otros usuarios
  if (targetUserId !== user.id) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  try {
    const result = await previewDigest(targetUserId)

    // Si no hay items, informar
    if (result.itemCount === 0) {
      return NextResponse.json({
        success: true,
        message: "No hay novedades para mostrar en el digest",
        itemCount: 0,
        html: "",
      })
    }

    // Si se pide HTML puro (para preview en iframe)
    if (searchParams.get("format") === "html") {
      return new NextResponse(result.html, {
        headers: { "Content-Type": "text/html" },
      })
    }

    return NextResponse.json({
      success: true,
      items: result.items,
      itemCount: result.itemCount,
      html: result.html,
    })
  } catch (error: any) {
    console.error("Preview digest error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
