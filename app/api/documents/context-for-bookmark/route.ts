import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"
import { rankDocumentsForBookmark } from "@/lib/documents/rank-documents-for-bookmark"

export async function GET(req: NextRequest) {
  const bookmarkId = req.nextUrl.searchParams.get("bookmarkId")
  if (!bookmarkId) {
    return NextResponse.json({ error: "bookmarkId required" }, { status: 400 })
  }

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    // Check if user has any documents
    const { count } = await supabase
      .from("user_documents")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "ready")

    const hasDocuments = (count || 0) > 0

    // Get value profile
    const { data: valueProfile } = await supabase
      .from("user_value_profiles")
      .select("profile_summary, target_industries, target_technologies, target_processes")
      .eq("user_id", user.id)
      .maybeSingle()

    // Get bookmark for context
    const { data: bookmark } = await supabase
      .from("bookmarks")
      .select("company_id, search_context")
      .eq("id", bookmarkId)
      .eq("user_id", user.id)
      .single()

    if (!bookmark) {
      return NextResponse.json({ error: "Bookmark not found" }, { status: 404 })
    }

    // Get company industry
    const { data: company } = await supabase
      .from("companies")
      .select("industry")
      .eq("id", bookmark.company_id)
      .single()

    const searchContext = (bookmark.search_context as any) || {}
    const filterSignalIds: string[] = searchContext.filterSignalIds || []

    // Rank documents
    const rankedDocs = hasDocuments
      ? await rankDocumentsForBookmark(user.id, {
          companyIndustry: company?.industry || null,
          filterSignalIds,
        })
      : []

    return NextResponse.json({
      hasDocuments,
      valueProfile: valueProfile || null,
      relevantDocs: rankedDocs.map((d) => ({
        title: d.title,
        type: d.type,
        matchedTags: d.matchedTags,
      })),
    })
  } catch (error: any) {
    console.error("[v0] Error fetching docs context:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
