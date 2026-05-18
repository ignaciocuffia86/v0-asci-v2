import { NextRequest, NextResponse } from "next/server"
import { validateMcpRequest, logMcpRequest, mcpResponse, mcpError } from "@/lib/v3/mcp-auth"
import { getRecommendedJobTitles } from "@/app/actions/v3/apollo"
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
  
  // Get campaign_account_id from query params
  const campaignAccountId = req.nextUrl.searchParams.get("campaign_account_id")
  if (!campaignAccountId) {
    return NextResponse.json(
      mcpError("MISSING_PARAMETER", "campaign_account_id is required", requestId),
      { status: 400 }
    )
  }
  
  try {
    const admin = createAdminClient()
    
    // Verify access to this account
    const { data: account } = await admin
      .from("v3_campaign_accounts")
      .select(`
        id,
        company_id,
        v3_campaigns!inner (
          workspace_id
        ),
        companies:company_id (
          name
        )
      `)
      .eq("id", campaignAccountId)
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
    
    // Get recommended job titles
    const result = await getRecommendedJobTitles(campaignAccountId)
    
    // Log the request
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/get-recommended-job-titles", "GET", 200, responseTime)
    
    return NextResponse.json(
      mcpResponse({
        campaign_account_id: campaignAccountId,
        company_name: (account.companies as any)?.name,
        recommended_job_titles: result.jobTitles || [],
        reasoning: result.reasoning || "Based on detected signals and workspace profile"
      }, requestId)
    )
  } catch (error) {
    console.error("MCP get-recommended-job-titles error:", error)
    
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/get-recommended-job-titles", "GET", 500, responseTime)
    
    return NextResponse.json(
      mcpError("INTERNAL_ERROR", "Failed to get recommended job titles", requestId),
      { status: 500 }
    )
  }
}
