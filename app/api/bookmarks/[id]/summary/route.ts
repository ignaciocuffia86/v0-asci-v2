import { createClient } from "@/lib/supabase/server"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: bookmarkId } = await params

  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    // Fetch summary
    const { data: summary, error: summaryError } = await supabase
      .from("bookmark_summaries")
      .select("*")
      .eq("bookmark_id", bookmarkId)
      .maybeSingle()

    if (summaryError) {
      return NextResponse.json({ error: summaryError.message }, { status: 500 })
    }

    if (!summary) {
      return NextResponse.json({ summary: null, pdfContext: null })
    }

    // Fetch bookmark
    const { data: bookmark } = await supabase
      .from("bookmarks")
      .select("*")
      .eq("id", bookmarkId)
      .eq("user_id", user.id)
      .single()

    if (!bookmark) {
      return NextResponse.json({ error: "Bookmark no encontrado" }, { status: 404 })
    }

    // Fetch company
    const { data: company } = await supabase.from("companies").select("*").eq("id", bookmark.company_id).single()

    // Fetch all context data for PDF
    const [{ data: news }, { data: implementations }, { data: jobPostings }, { data: prospects }, { data: strategy }] =
      await Promise.all([
        supabase
          .from("company_news")
          .select("title, summary, category, published_at, source_name")
          .eq("company_id", bookmark.company_id)
          .order("published_at", { ascending: false })
          .limit(10),

        supabase
          .from("company_implementations")
          .select("title, summary, provider_name, technology, published_at")
          .eq("company_id", bookmark.company_id)
          .order("published_at", { ascending: false })
          .limit(10),

        supabase
          .from("job_postings")
          .select("title, location, posted_at")
          .eq("company_id", bookmark.company_id)
          .order("posted_at", { ascending: false })
          .limit(5),

        supabase
          .from("user_company_contacts")
          .select("full_name, role, email, phone")
          .eq("company_id", bookmark.company_id)
          .eq("user_id", user.id)
          .limit(10),

        supabase
          .from("user_company_strategies")
          .select("*")
          .eq("bookmark_id", bookmarkId)
          .eq("user_id", user.id)
          .maybeSingle(),
      ])

    return NextResponse.json({
      summary,
      pdfContext: {
        company,
        bookmark,
        news: news || [],
        implementations: implementations || [],
        jobPostings: jobPostings || [],
        prospects: prospects || [],
        strategy,
      },
    })
  } catch (error: any) {
    console.error("[v0] Error fetching summary:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
