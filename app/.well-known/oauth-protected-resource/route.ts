import { getOAuthIssuer, MCP_OAUTH_SCOPES } from "@/lib/v3/mcp-oauth"

export async function GET(request: Request) {
  const issuer = getOAuthIssuer(request)
  return Response.json({
    resource: `${issuer}/api/v3/mcp/server/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: MCP_OAUTH_SCOPES,
  })
}
