import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { hashOAuthValue, randomOAuthValue } from "@/lib/v3/mcp-oauth"

const tokenResponse = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } })
const verifyPkce = (verifier: string, challenge: string) => crypto.createHash("sha256").update(verifier).digest("base64url") === challenge

export async function POST(request: Request) {
  const form = await request.formData()
  const grantType = String(form.get("grant_type") || "")
  const clientId = String(form.get("client_id") || "")
  const admin = createAdminClient()
  const { data: client } = await admin.schema("v3").from("mcp_oauth_clients").select("*").eq("client_id", clientId).maybeSingle()
  if (!client) return tokenResponse({ error: "invalid_client" }, 401)

  if (client.token_endpoint_auth_method === "client_secret_post") {
    const secret = String(form.get("client_secret") || "")
    if (!secret || hashOAuthValue(secret) !== client.client_secret_hash) return tokenResponse({ error: "invalid_client" }, 401)
  }

  if (grantType === "authorization_code") {
    const code = String(form.get("code") || "")
    const verifier = String(form.get("code_verifier") || "")
    const redirectUri = String(form.get("redirect_uri") || "")
    const { data: authCode } = await admin.schema("v3").from("mcp_oauth_authorization_codes").select("*").eq("code_hash", hashOAuthValue(code)).eq("client_id", clientId).is("used_at", null).gt("expires_at", new Date().toISOString()).maybeSingle()
    if (!authCode || authCode.redirect_uri !== redirectUri || !verifyPkce(verifier, authCode.code_challenge)) return tokenResponse({ error: "invalid_grant" }, 400)
    const now = new Date(); const accessToken = randomOAuthValue("asci_oauth"); const refreshToken = randomOAuthValue("asci_refresh")
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); const refreshExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const { error } = await admin.schema("v3").from("mcp_oauth_tokens").insert({ token_hash: hashOAuthValue(accessToken), refresh_token_hash: hashOAuthValue(refreshToken), client_id: clientId, user_id: authCode.user_id, workspace_id: authCode.workspace_id, scopes: authCode.scopes, expires_at: expiresAt.toISOString(), refresh_expires_at: refreshExpiresAt.toISOString() })
    if (error) return tokenResponse({ error: "server_error" }, 500)
    await admin.schema("v3").from("mcp_oauth_authorization_codes").update({ used_at: now.toISOString() }).eq("id", authCode.id)
    return tokenResponse({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshToken, scope: authCode.scopes.join(" ") })
  }

  if (grantType === "refresh_token") {
    const refreshTokenValue = String(form.get("refresh_token") || "")
    const { data: token } = await admin.schema("v3").from("mcp_oauth_tokens").select("*").eq("refresh_token_hash", hashOAuthValue(refreshTokenValue)).eq("client_id", clientId).is("revoked_at", null).gt("refresh_expires_at", new Date().toISOString()).maybeSingle()
    if (!token) return tokenResponse({ error: "invalid_grant" }, 400)
    const accessToken = randomOAuthValue("asci_oauth"); const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    await admin.schema("v3").from("mcp_oauth_tokens").update({ token_hash: hashOAuthValue(accessToken), expires_at: expiresAt.toISOString() }).eq("id", token.id)
    return tokenResponse({ access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshTokenValue, scope: token.scopes.join(" ") })
  }

  return tokenResponse({ error: "unsupported_grant_type" }, 400)
}
