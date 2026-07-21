import { createAdminClient } from "@/lib/supabase/admin"
import { hashOAuthValue } from "@/lib/v3/mcp-oauth"

export async function POST(request: Request) {
  const form = await request.formData()
  const token = String(form.get("token") || "")
  if (token) {
    const admin = createAdminClient()
    const hash = hashOAuthValue(token)
    await admin.schema("v3").from("mcp_oauth_tokens").update({ revoked_at: new Date().toISOString() }).or(`token_hash.eq.${hash},refresh_token_hash.eq.${hash}`)
  }
  return new Response(null, { status: 200 })
}
