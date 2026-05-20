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
  
  try {
    const admin = createAdminClient()
    
    // Get campaigns for this workspace
    const { data: campaigns, error } = await admin
      .schema("v3")
      .from("campaigns")
      .select(`
        id,
        name,
        type,
        created_at,
        updated_at,
        account_count
      `)
      .eq("workspace_id", auth.workspaceId)
      .order("created_at", { ascending: false })
      
    if (error) {
      throw error
    }
    
    // Log the request
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/list-campaigns", "GET", 200, responseTime)
    
    return NextResponse.json(
      mcpResponse({
        campaigns: campaigns.map(c => ({
          id: c.id,
          name: c.name,
          type: c.type,
          account_count: c.account_count,
          created_at: c.created_at,
          updated_at: c.updated_at
        })),
        total: campaigns.length
      }, requestId)
    )
  } catch (error) {
    console.error("MCP list-campaigns error:", error)
    
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/list-campaigns", "GET", 500, responseTime)
    
    return NextResponse.json(
      mcpError("INTERNAL_ERROR", "Failed to list campaigns", requestId),
      { status: 500 }
    )
  }
}
