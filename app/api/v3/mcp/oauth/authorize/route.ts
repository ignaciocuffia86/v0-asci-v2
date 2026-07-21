import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"

export async function GET(request: Request) {
  const source = new URL(request.url)
  const clientId = source.searchParams.get("client_id") || ""
  const redirectUri = source.searchParams.get("redirect_uri") || ""
  const codeChallenge = source.searchParams.get("code_challenge") || ""
  const method = source.searchParams.get("code_challenge_method")
  const responseType = source.searchParams.get("response_type")
  const admin = createAdminClient()
  const { data: client } = await admin.schema("v3").from("mcp_oauth_clients").select("redirect_uris").eq("client_id", clientId).maybeSingle()
  if (!client || !client.redirect_uris.includes(redirectUri) || method !== "S256" || responseType !== "code" || !codeChallenge) {
    return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400, headers: { "Content-Type": "application/json" } })
  }
  const consent = new URL("/v3/oauth/authorize", source.origin)
  source.searchParams.forEach((value, key) => consent.searchParams.set(key, value))
  redirect(consent.toString())
}
