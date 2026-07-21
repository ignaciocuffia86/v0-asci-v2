"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { appendOAuthResult, hashOAuthValue, randomOAuthValue, sanitizeScopes } from "@/lib/v3/mcp-oauth"

export async function getOAuthConsentContext(clientId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "AUTH_REQUIRED" }
  const admin = createAdminClient()
  const [{ data: client }, { data: memberships }] = await Promise.all([
    admin.schema("v3").from("mcp_oauth_clients").select("client_id, client_name").eq("client_id", clientId).maybeSingle(),
    admin.schema("v3").from("workspace_members").select("workspace_id, role, workspace:workspaces(id, name)").eq("user_id", user.id).eq("status", "active"),
  ])
  if (!client) return { success: false, error: "CLIENT_NOT_FOUND" }
  return { success: true, clientName: client.client_name, workspaces: (memberships ?? []).map((item) => ({ id: item.workspace_id, name: (item.workspace as unknown as { name: string })?.name || "Workspace", role: item.role })) }
}

export async function approveOAuthConsent(input: { clientId: string; redirectUri: string; state?: string; codeChallenge: string; workspaceId: string; scopes: string[] }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: "Inicia sesión nuevamente" }
  const admin = createAdminClient()
  const [{ data: client }, { data: membership }] = await Promise.all([
    admin.schema("v3").from("mcp_oauth_clients").select("redirect_uris").eq("client_id", input.clientId).maybeSingle(),
    admin.schema("v3").from("workspace_members").select("id").eq("workspace_id", input.workspaceId).eq("user_id", user.id).eq("status", "active").maybeSingle(),
  ])
  if (!client || !client.redirect_uris.includes(input.redirectUri) || !membership) return { success: false, error: "Solicitud OAuth inválida" }
  const scopes = sanitizeScopes(input.scopes)
  if (!scopes.length) return { success: false, error: "Selecciona al menos un permiso" }
  const code = randomOAuthValue("asci_code")
  const { error } = await admin.schema("v3").from("mcp_oauth_authorization_codes").insert({ code_hash: hashOAuthValue(code), client_id: input.clientId, user_id: user.id, workspace_id: input.workspaceId, redirect_uri: input.redirectUri, scopes, code_challenge: input.codeChallenge, code_challenge_method: "S256", expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() })
  if (error) return { success: false, error: "No se pudo autorizar la conexión" }
  return { success: true, redirectTo: appendOAuthResult(input.redirectUri, { code, state: input.state }) }
}
