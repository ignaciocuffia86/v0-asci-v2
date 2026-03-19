import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateBulkBookmarksExcel, type BookmarkExportData } from "@/lib/export-bookmarks"

const MAX_BOOKMARKS_PER_EXPORT = 50

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  let body: { bookmark_ids: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const { bookmark_ids } = body

  if (!Array.isArray(bookmark_ids) || bookmark_ids.length === 0) {
    return NextResponse.json({ error: "Se requieren bookmark_ids" }, { status: 400 })
  }

  if (bookmark_ids.length > MAX_BOOKMARKS_PER_EXPORT) {
    return NextResponse.json(
      { error: `Máximo ${MAX_BOOKMARKS_PER_EXPORT} bookmarks por export` },
      { status: 400 }
    )
  }

  // Verify all bookmarks belong to user
  const { data: userBookmarks, error: verifyError } = await supabase
    .from("bookmarks")
    .select("id")
    .eq("user_id", user.id)
    .in("id", bookmark_ids)

  if (verifyError) {
    return NextResponse.json({ error: "Error al verificar bookmarks" }, { status: 500 })
  }

  const validIds = new Set(userBookmarks?.map((b) => b.id) || [])
  const invalidIds = bookmark_ids.filter((id) => !validIds.has(id))

  if (invalidIds.length > 0) {
    return NextResponse.json(
      { error: `Bookmarks no encontrados o sin acceso: ${invalidIds.join(", ")}` },
      { status: 403 }
    )
  }

  // Fetch export data for each bookmark
  const bookmarksData: Array<{ data: BookmarkExportData; companyName: string }> = []

  for (const bookmarkId of bookmark_ids) {
    const { data: exportData, error } = await supabase.rpc("get_bookmark_export_data", {
      p_bookmark_id: bookmarkId,
      p_user_id: user.id,
    })

    if (error || !exportData) {
      console.error(`[bulk-export] Error fetching bookmark ${bookmarkId}:`, error)
      continue
    }

    const data = exportData as BookmarkExportData
    bookmarksData.push({
      data,
      companyName: data.company?.name || "Unknown",
    })
  }

  if (bookmarksData.length === 0) {
    return NextResponse.json({ error: "No se pudieron obtener datos de ningún bookmark" }, { status: 500 })
  }

  try {
    const buffer = await generateBulkBookmarksExcel(bookmarksData)
    const filename = `ASCI_Export_${bookmarksData.length}_empresas_${new Date().toISOString().split("T")[0]}.xlsx`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    console.error("[bulk-export] Excel generation error:", err)
    return NextResponse.json({ error: "Error al generar Excel" }, { status: 500 })
  }
}
