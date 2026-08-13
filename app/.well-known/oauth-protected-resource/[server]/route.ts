import { NextResponse } from "next/server"
import { getOAuthIssuer, MCP_RESOURCE_SERVERS, type McpResourceKey } from "@/lib/v3/mcp-oauth"

/**
 * Metadata protected-resource (RFC 9728) POR MCP.
 *
 * La versión raíz (../route.ts) anuncia el server standard con TODOS los scopes y la
 * comparten los tres MCP, así que el cliente OAuth no puede distinguir a cuál se
 * conecta. Los MCP Explore y Perfiles apuntan su `resourceMetadataPath` acá
 * (/.well-known/oauth-protected-resource/<server>), y cada uno publica SU `resource`
 * y SOLO sus scopes. Con eso el cliente pide lo justo y el consentimiento
 * pre-selecciona el permiso correcto según el MCP.
 */
export async function GET(request: Request, { params }: { params: Promise<{ server: string }> }) {
  const { server } = await params
  const config = MCP_RESOURCE_SERVERS[server as McpResourceKey]
  if (!config) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const issuer = getOAuthIssuer(request)
  return NextResponse.json({
    resource: `${issuer}/api/v3/mcp/${server}/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: config.scopes,
  })
}
