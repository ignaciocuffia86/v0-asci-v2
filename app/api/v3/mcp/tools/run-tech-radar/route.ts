import { NextRequest, NextResponse } from "next/server"
import { validateMcpRequest, logMcpRequest, mcpResponse, mcpError } from "@/lib/v3/mcp-auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { runTechRadarForAccount } from "@/app/actions/v3/tech-radar"

export async function POST(req: NextRequest) {
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
  
  try {
    const body = await req.json()
    const { campaign_account_id } = body
    
    if (!campaign_account_id) {
      return NextResponse.json(
        mcpError("MISSING_PARAMETER", "campaign_account_id is required", requestId),
        { status: 400 }
      )
    }
    
    const admin = createAdminClient()
    
    // Verify access to this account
    const { data: account } = await admin
      .from("v3_campaign_accounts")
      .select(`
        id,
        company_id,
        v3_campaigns!inner (
          workspace_id,
          type
        ),
        companies:company_id (
          id,
          name,
          domain,
          linkedin_url
        )
      `)
      .eq("id", campaign_account_id)
      .single()
      
    if (!account) {
      return NextResponse.json(
        mcpError("NOT_FOUND", "Campaign account not found", requestId),
        { status: 404 }
      )
    }
    
    const campaign = account.v3_campaigns as any
    if (campaign.workspace_id !== auth.workspaceId) {
      return NextResponse.json(
        mcpError("ACCESS_DENIED", "Access denied to this account", requestId),
        { status: 403 }
      )
    }
    
    // Check campaign type allows tech radar
    if (campaign.type === "monitorear") {
      return NextResponse.json(
        mcpError("FEATURE_DISABLED", "Tech Radar is not available for monitoring campaigns", requestId),
        { status: 400 }
      )
    }
    
    // Run tech radar (this calls the v2 function internally)
    const result = await runTechRadarForAccount(campaign_account_id)
    
    // Log the request
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/run-tech-radar", "POST", result.success ? 200 : 500, responseTime)
    
    if (!result.success) {
      return NextResponse.json(
        mcpError("TECH_RADAR_FAILED", result.error || "Tech Radar failed", requestId),
        { status: 500 }
      )
    }
    
    return NextResponse.json(
      mcpResponse({
        campaign_account_id,
        company_name: (account.companies as any)?.name,
        findings_count: result.findingsCount,
        news_count: result.newsCount,
        message: "Tech Radar completed successfully"
      }, requestId)
    )
  } catch (error) {
    console.error("MCP run-tech-radar error:", error)
    
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/run-tech-radar", "POST", 500, responseTime)
    
    return NextResponse.json(
      mcpError("INTERNAL_ERROR", "Failed to run Tech Radar", requestId),
      { status: 500 }
    )
  }
}
