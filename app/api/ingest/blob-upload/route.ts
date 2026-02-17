import { put } from "@vercel/blob"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function PUT(request: NextRequest) {
  // Authenticate
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  const filename = request.nextUrl.searchParams.get("filename")
  if (!filename) {
    return NextResponse.json({ error: "Falta filename" }, { status: 400 })
  }

  if (!request.body) {
    return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 })
  }

  // Upload to Vercel Blob with a unique path
  const blob = await put(`ingest/${Date.now()}-${filename}`, request.body, {
    access: "public",
  })

  return NextResponse.json({ url: blob.url })
}
