import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

interface MappingRequest {
  originalValue: string
  sourceType: "company" | "document"
  masterIndustryId: string
}

export async function POST(request: NextRequest) {
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

  const body = await request.json()
  const { mappings } = body as { mappings: MappingRequest[] }

  if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
    return NextResponse.json({ error: "Se requiere al menos un mapeo" }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Insert mappings
  const { error: insertError } = await adminClient
    .from("industry_mappings")
    .upsert(
      mappings.map(m => ({
        original_value: m.originalValue,
        source_type: m.sourceType,
        master_industry_id: m.masterIndustryId,
      })),
      { onConflict: "original_value,source_type" }
    )

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Propagate to companies
  const companyMappings = mappings.filter(m => m.sourceType === "company")
  for (const mapping of companyMappings) {
    await adminClient
      .from("companies")
      .update({ master_industry_id: mapping.masterIndustryId })
      .ilike("industry", mapping.originalValue)
  }

  // Propagate to document_tags
  const docMappings = mappings.filter(m => m.sourceType === "document")
  for (const mapping of docMappings) {
    await adminClient
      .from("document_tags")
      .update({ master_industry_id: mapping.masterIndustryId })
      .eq("tag_type", "industry")
      .ilike("tag_value", mapping.originalValue)
  }

  return NextResponse.json({ 
    success: true, 
    mapped: mappings.length 
  })
}
