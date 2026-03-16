import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
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

  const searchParams = request.nextUrl.searchParams
  const source = searchParams.get("source") || "all"

  const adminClient = createAdminClient()

  const results: { originalValue: string; sourceType: string; count: number }[] = []

  // Get unmapped company industries
  if (source === "all" || source === "company") {
    const { data: unmappedCompanies } = await adminClient.rpc("get_unmapped_company_industries")
    if (unmappedCompanies) {
      results.push(...unmappedCompanies.map((r: { industry: string; count: number }) => ({
        originalValue: r.industry,
        sourceType: "company",
        count: r.count,
      })))
    }
  }

  // Get unmapped document tags
  if (source === "all" || source === "document") {
    const { data: unmappedDocs } = await adminClient.rpc("get_unmapped_document_industries")
    if (unmappedDocs) {
      results.push(...unmappedDocs.map((r: { tag_value: string; count: number }) => ({
        originalValue: r.tag_value,
        sourceType: "document",
        count: r.count,
      })))
    }
  }

  // Sort by count descending
  results.sort((a, b) => b.count - a.count)

  return NextResponse.json({ unmapped: results })
}
