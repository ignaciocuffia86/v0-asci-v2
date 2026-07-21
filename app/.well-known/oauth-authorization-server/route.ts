import { getOAuthIssuer, MCP_OAUTH_SCOPES } from "@/lib/v3/mcp-oauth"

export async function GET(request: Request) {
  const issuer = getOAuthIssuer(request)
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/api/v3/mcp/oauth/authorize`,
    token_endpoint: `${issuer}/api/v3/mcp/oauth/token`,
    registration_endpoint: `${issuer}/api/v3/mcp/oauth/register`,
    revocation_endpoint: `${issuer}/api/v3/mcp/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: MCP_OAUTH_SCOPES,
  })
}
