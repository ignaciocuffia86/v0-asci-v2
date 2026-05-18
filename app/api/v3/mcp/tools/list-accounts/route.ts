import { NextRequest, NextResponse } from "next/server"
import { validateMcpRequest, logMcpRequest, mcpResponse, mcpError } from "@/lib/v3/mcp-auth"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET(req: NextRequest) {
  const startTime = Date.now()
  const requestId = crypto.randomUUID()
  
  // Validate API key
  const auth = await validateMcpRequest(req)
  if (!auth.success) {
    return NextResponse.json(
      mcpError(auth.error!.code, auth.error!.message, requestId),
      { status: auth.error!.status }
    )
  }
  
  // Get campaign_id from query params
  const campaignId = req.nextUrl.searchParams.get("campaign_id")
  if (!campaignId) {
    return NextResponse.json(
      mcpError("MISSING_PARAMETER", "campaign_id is required", requestId),
      { status: 400 }
    )
  }
  
  try {
    const admin = createAdminClient()
    
    // Verify campaign belongs to workspace
    const { data: campaign } = await admin
      .from("v3_campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("workspace_id", auth.workspaceId)
      .single()
      
    if (!campaign) {
      return NextResponse.json(
        mcpError("NOT_FOUND", "Campaign not found or access denied", requestId),
        { status: 404 }
      )
    }
    
    // Get accounts for this campaign
    const { data: accounts, error } = await admin
      .from("v3_campaign_accounts")
      .select(`
        id,
        status,
        match_source,
        prospection_status,
        tech_radar_run_at,
        apollo_run_at,
        added_at,
        companies:company_id (
          id,
          name,
          domain,
          linkedin_url,
          industry,
          employee_count,
          headquarters
        )
      `)
      .eq("campaign_id", campaignId)
      .order("added_at", { ascending: false })
      
    if (error) {
      throw error
    }
    
    // Log the request
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/list-accounts", "GET", 200, responseTime)
    
    return NextResponse.json(
      mcpResponse({
        campaign_id: campaignId,
        accounts: accounts.map(a => ({
          id: a.id,
          status: a.status,
          match_source: a.match_source,
          prospection_status: a.prospection_status,
          tech_radar_run_at: a.tech_radar_run_at,
          apollo_run_at: a.apollo_run_at,
          added_at: a.added_at,
          company: a.companies
        })),
        total: accounts.length
      }, requestId)
    )
  } catch (error) {
    console.error("MCP list-accounts error:", error)
    
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/list-accounts", "GET", 500, responseTime)
    
    return NextResponse.json(
      mcpError("INTERNAL_ERROR", "Failed to list accounts", requestId),
      { status: 500 }
    )
  }
}
