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

  // Get stats in parallel
  const [
    { count: masterCount },
    { count: companyMappingsCount },
    { count: documentMappingsCount },
    { count: companiesWithIndustry },
    { count: companiesNormalized },
    { count: docTagsIndustry },
    { count: docTagsNormalized },
  ] = await Promise.all([
    adminClient.from("master_industries").select("*", { count: "exact", head: true }),
    adminClient.from("industry_mappings").select("*", { count: "exact", head: true }).eq("source_type", "company"),
    adminClient.from("industry_mappings").select("*", { count: "exact", head: true }).eq("source_type", "document"),
    adminClient.from("companies").select("*", { count: "exact", head: true }).not("industry", "is", null).neq("industry", ""),
    adminClient.from("companies").select("*", { count: "exact", head: true }).not("master_industry_id", "is", null),
    adminClient.from("document_tags").select("*", { count: "exact", head: true }).eq("tag_type", "industry"),
    adminClient.from("document_tags").select("*", { count: "exact", head: true }).eq("tag_type", "industry").not("master_industry_id", "is", null),
  ])

  return NextResponse.json({
    masterIndustries: masterCount || 0,
    companyMappings: {
      total: companiesWithIndustry || 0,
      mapped: companiesNormalized || 0,
      unmapped: (companiesWithIndustry || 0) - (companiesNormalized || 0),
      mappingRules: companyMappingsCount || 0,
    },
    documentMappings: {
      total: docTagsIndustry || 0,
      mapped: docTagsNormalized || 0,
      unmapped: (docTagsIndustry || 0) - (docTagsNormalized || 0),
      mappingRules: documentMappingsCount || 0,
    },
  })
}
