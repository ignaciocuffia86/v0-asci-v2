import { NextRequest, NextResponse } from "next/server"
import { validateMcpRequest, logMcpRequest, mcpResponse, mcpError } from "@/lib/v3/mcp-auth"
import { createAdminClient } from "@/lib/supabase/admin"

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
    const { query, limit = 10 } = body
    
    if (!query || typeof query !== "string") {
      return NextResponse.json(
        mcpError("MISSING_PARAMETER", "query is required", requestId),
        { status: 400 }
      )
    }
    
    const admin = createAdminClient()
    
    // Search by name or domain
    const searchTerm = query.toLowerCase().trim()
    
    const { data: companies, error } = await admin
      .from("companies")
      .select("id, name, domain, linkedin_url, industry, employee_count, headquarters")
      .or(`name.ilike.%${searchTerm}%,domain.ilike.%${searchTerm}%,normalized_name.ilike.%${searchTerm}%`)
      .limit(Math.min(limit, 50))
      .order("name")
      
    if (error) {
      throw error
    }
    
    // Log the request
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/search-companies", "POST", 200, responseTime)
    
    return NextResponse.json(
      mcpResponse({
        query,
        companies: companies || [],
        total: companies?.length || 0
      }, requestId)
    )
  } catch (error) {
    console.error("MCP search-companies error:", error)
    
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/search-companies", "POST", 500, responseTime)
    
    return NextResponse.json(
      mcpError("INTERNAL_ERROR", "Failed to search companies", requestId),
      { status: 500 }
    )
  }
}
