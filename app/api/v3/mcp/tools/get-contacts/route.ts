import { NextRequest, NextResponse } from "next/server"
import { validateMcpRequest, logMcpRequest, mcpResponse, mcpError } from "@/lib/v3/mcp-auth"
import { getCompanyContacts } from "@/lib/v3/cache-reader"

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
    const contacts = await getCompanyContacts(companyId)
    
    // Log the request
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/get-contacts", "GET", 200, responseTime)
    
    return NextResponse.json(
      mcpResponse({
        company_id: companyId,
        contacts: contacts.map(c => ({
          id: c.id,
          name: c.name,
          title: c.title,
          email: c.email,
          linkedin_url: c.linkedin_url,
          phone: c.phone,
          seniority: c.seniority,
          departments: c.departments
        })),
        total: contacts.length
      }, requestId)
    )
  } catch (error) {
    console.error("MCP get-contacts error:", error)
    
    const responseTime = Date.now() - startTime
    await logMcpRequest(auth.keyId!, "/api/v3/mcp/tools/get-contacts", "GET", 500, responseTime)
    
    return NextResponse.json(
      mcpError("INTERNAL_ERROR", "Failed to get contacts", requestId),
      { status: 500 }
    )
  }
}
