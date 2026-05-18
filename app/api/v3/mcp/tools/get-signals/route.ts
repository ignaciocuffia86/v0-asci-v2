import { NextRequest, NextResponse } from "next/server"
import { validateMcpRequest, logMcpRequest, mcpResponse, mcpError } from "@/lib/v3/mcp-auth"
import { getCompanySignals } from "@/lib/v3/cache-reader"

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
  
  // Get company_id from query params
  const companyId = req.nextUrl.searchParams.get("company_id")
  if (!companyId) {
    return NextResponse.json(
      mcpError("MISSING_PARAMETER", "company_id is required", requestId),
      { status: 400 }
    )
  }
  
  try {
    const signals = await getCompanySignals(companyId)
    
    // Log the request
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/get-signals", "GET", 200, responseTime)
    
    return NextResponse.json(
      mcpResponse({
        company_id: companyId,
        signals: signals.map(s => ({
          id: s.id,
          type: s.signal_type,
          name: s.dictionary_processes?.name || s.dictionary_products?.name || "Unknown",
          confidence: s.confidence_score,
          detected_at: s.detected_at
        })),
        total: signals.length
      }, requestId)
    )
  } catch (error) {
    console.error("MCP get-signals error:", error)
    
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/get-signals", "GET", 500, responseTime)
    
    return NextResponse.json(
      mcpError("INTERNAL_ERROR", "Failed to get signals", requestId),
      { status: 500 }
    )
  }
}
