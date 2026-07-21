import { upsertPublicClient } from "@/lib/v3/mcp-oauth"

export async function POST(request: Request) {
  try {
    const body = await request.json() as { client_name?: string; redirect_uris?: string[]; token_endpoint_auth_method?: string }
    if (!Array.isArray(body.redirect_uris)) return Response.json({ error: "invalid_client_metadata" }, { status: 400 })
    const client = await upsertPublicClient({ clientName: body.client_name, redirectUris: body.redirect_uris, tokenEndpointAuthMethod: body.token_endpoint_auth_method })
    return Response.json(client, { status: 201, headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ error: "invalid_client_metadata" }, { status: 400 })
  }
}
