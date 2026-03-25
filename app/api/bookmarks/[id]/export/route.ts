import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateBookmarkExcel, type BookmarkExportData } from "@/lib/export-bookmarks"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookmarkId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  // Call RPC to get consolidated export data
  const { data: exportData, error } = await supabase.rpc("get_bookmark_export_data", {
    p_bookmark_id: bookmarkId,
    p_user_id: user.id,
  })

  if (error) {
    console.error("[export] RPC error:", error)
    return NextResponse.json({ error: "Error al obtener datos" }, { status: 500 })
  }

  if (!exportData) {
    return NextResponse.json({ error: "Bookmark no encontrado o sin acceso" }, { status: 404 })
  }

  const data = exportData as BookmarkExportData
  const companyName = data.company?.name || "Export"

  try {
    const buffer = await generateBookmarkExcel(data, companyName)

    // Sanitize filename
    const safeCompanyName = companyName
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 50)
    const filename = `ASCI_${safeCompanyName}_${new Date().toISOString().split("T")[0]}.xlsx`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    console.error("[export] Excel generation error:", err)
    return NextResponse.json({ error: "Error al generar Excel" }, { status: 500 })
  }
}
