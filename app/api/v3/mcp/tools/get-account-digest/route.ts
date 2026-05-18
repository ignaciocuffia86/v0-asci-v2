import { NextRequest, NextResponse } from "next/server"
import { validateMcpRequest, logMcpRequest, mcpResponse, mcpError } from "@/lib/v3/mcp-auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateAccountDigest } from "@/lib/v3/digest"

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
    
    // Get campaign account and verify access
    const { data: account } = await admin
      .from("v3_campaign_accounts")
      .select(`
        id,
        campaign_id,
        company_id,
        status,
        prospection_status,
        tech_radar_run_at,
        apollo_run_at,
        v3_campaigns!inner (
          workspace_id
        ),
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
      .eq("id", campaignAccountId)
      .single()
      
    if (!account) {
      return NextResponse.json(
        mcpError("NOT_FOUND", "Campaign account not found", requestId),
        { status: 404 }
      )
    }
    
    // Verify workspace access
    const campaign = account.v3_campaigns as any
    if (campaign.workspace_id !== auth.workspaceId) {
      return NextResponse.json(
        mcpError("ACCESS_DENIED", "Access denied to this account", requestId),
        { status: 403 }
      )
    }
    
    // Generate digest
    const digest = await generateAccountDigest(
      campaignAccountId,
      account.company_id,
      auth.workspaceId!
    )
    
    // Log the request
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/get-account-digest", "GET", 200, responseTime)
    
    return NextResponse.json(
      mcpResponse({
        account: {
          id: account.id,
          status: account.status,
          prospection_status: account.prospection_status,
          tech_radar_run_at: account.tech_radar_run_at,
          apollo_run_at: account.apollo_run_at
        },
        company: account.companies,
        digest: {
          news: digest.news,
          implementations: digest.implementations,
          signals: digest.signals,
          contacts: digest.contacts,
          recommended_job_titles: digest.recommendedJobTitles,
          stats: digest.stats
        }
      }, requestId)
    )
  } catch (error) {
    console.error("MCP get-account-digest error:", error)
    
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/get-account-digest", "GET", 500, responseTime)
    
    return NextResponse.json(
      mcpError("INTERNAL_ERROR", "Failed to get account digest", requestId),
      { status: 500 }
    )
  }
}
