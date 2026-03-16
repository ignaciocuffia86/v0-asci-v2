import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 })
  }

  // Verify superadmin
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "superadmin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 })
  }

  const adminClient = createAdminClient()

  // Get master industries with counts
  const { data: masterIndustries, error } = await adminClient
    .from("master_industries")
    .select("*")
    .order("display_order")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get counts for each industry
  const industriesWithCounts = await Promise.all(
    (masterIndustries || []).map(async (industry) => {
      const [{ count: companyCount }, { count: docCount }] = await Promise.all([
        adminClient
          .from("companies")
          .select("*", { count: "exact", head: true })
          .eq("master_industry_id", industry.id),
        adminClient
          .from("document_tags")
          .select("*", { count: "exact", head: true })
          .eq("tag_type", "industry")
          .eq("master_industry_id", industry.id),
      ])

      return {
        ...industry,
        companyCount: companyCount || 0,
        documentCount: docCount || 0,
      }
    })
  )

  return NextResponse.json({ industries: industriesWithCounts })
}
