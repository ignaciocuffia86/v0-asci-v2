import crypto from "crypto"
import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { hashOAuthValue } from "@/lib/v3/mcp-oauth"
import type { McpPrincipal } from "./mcp-usage"

export interface McpAuthResult extends Partial<McpPrincipal> {
  success: boolean
  error?: { code: string; message: string; status: number }
}

export interface McpResponse<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string }
  meta: { requestId: string; timestamp: string }
}

export function mcpResponse<T>(data: T, requestId = crypto.randomUUID()): McpResponse<T> {
  return { success: true, data, meta: { requestId, timestamp: new Date().toISOString() } }
}

export function mcpError(code: string, message: string, requestId = crypto.randomUUID()): McpResponse<never> {
  return { success: false, error: { code, message }, meta: { requestId, timestamp: new Date().toISOString() } }
}

export async function validateMcpRequest(req: NextRequest): Promise<McpAuthResult> {
  const header = req.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) return failure("UNAUTHORIZED", "Usá Authorization: Bearer <api_key>", 401)
  const rawKey = header.slice(7)
  const admin = createAdminClient()

  if (rawKey.startsWith("asci_oauth_")) {
    const { data: token } = await admin.schema("v3").from("mcp_oauth_tokens")
      .select("id,workspace_id,user_id,scopes,expires_at,revoked_at")
      .eq("token_hash", hashOAuthValue(rawKey)).maybeSingle()
    if (!token || token.revoked_at || new Date(token.expires_at) <= new Date()) return failure("INVALID_TOKEN", "Token OAuth inválido o vencido", 401)
    const { data: membership } = await admin.schema("v3").from("workspace_members")
      .select("id").eq("workspace_id", token.workspace_id).eq("user_id", token.user_id).eq("status", "active").maybeSingle()
    if (!membership) return failure("MEMBERSHIP_INACTIVE", "El usuario ya no pertenece al workspace", 403)
    await admin.schema("v3").from("mcp_oauth_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", token.id)
    const scopes: string[] = token.scopes ?? []
    return { success: true, workspaceId: token.workspace_id, userId: token.user_id, keyId: token.id, scopes, allowedModes: resolveAllowedModes(scopes) }
  }

  if (!rawKey.startsWith("asci_")) return failure("INVALID_KEY_FORMAT", "Formato de credencial inválido", 401)
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex")
  const { data: key } = await admin.schema("v3").from("mcp_api_keys")
    .select("id,workspace_id,owner_user_id,rate_limit_per_minute,revoked_at,scopes,allowed_modes,request_count")
    .eq("key_hash", keyHash).maybeSingle()
  if (!key) return failure("INVALID_KEY", "API key inválida", 401)
  if (key.revoked_at) return failure("KEY_REVOKED", "La API key fue revocada", 401)
  const { data: membership } = await admin.schema("v3").from("workspace_members")
    .select("id").eq("workspace_id", key.workspace_id).eq("user_id", key.owner_user_id).eq("status", "active").maybeSingle()
  if (!membership) return failure("MEMBERSHIP_INACTIVE", "El propietario de la API key ya no es miembro activo", 403)
  const oneMinuteAgo = new Date(Date.now() - 60000).toISOString()
  const { count } = await admin.schema("v3").from("mcp_request_logs").select("id", { count: "exact", head: true }).eq("api_key_id", key.id).gte("created_at", oneMinuteAgo)
  if ((count ?? 0) >= (key.rate_limit_per_minute ?? 60)) return failure("RATE_LIMITED", "Se excedió el límite general de requests por minuto", 429)
  await admin.schema("v3").from("mcp_api_keys").update({ last_used_at: new Date().toISOString(), request_count: (key.request_count ?? 0) + 1 }).eq("id", key.id)
  const storedScopes: string[] = key.scopes ?? []
  const readScopes = ["companies:read", "signals:read", "accounts:read", "usage:read"]
  const aiScopes = ["research:run", "research:prepare", "research:submit", "icebreakers:generate", "icebreakers:prepare", "icebreakers:submit", "accounts:write"]
  const scopes = storedScopes.includes("read") ? [...new Set([...storedScopes, ...readScopes])] : storedScopes
  if (storedScopes.includes("write")) scopes.push(...aiScopes)
  const allowedModes = key.allowed_modes?.length === 1 && key.allowed_modes[0] === "read" && storedScopes.includes("write")
    ? ["read", "server_managed", "client_assisted"]
    : (key.allowed_modes ?? ["read"])
  return {
    success: true,
    workspaceId: key.workspace_id,
    userId: key.owner_user_id,
    keyId: key.id,
    scopes: [...new Set(scopes.length ? scopes : readScopes)],
    allowedModes,
  }
}

function resolveAllowedModes(scopes: string[]) {
  const modes = ["read"]
  if (scopes.some((scope) => scope.endsWith(":run") || scope.endsWith(":generate"))) modes.push("server_managed")
  if (scopes.some((scope) => scope.endsWith(":prepare") || scope.endsWith(":submit"))) modes.push("client_assisted")
  return modes
}

function failure(code: string, message: string, status: number): McpAuthResult {
  return { success: false, error: { code, message, status } }
}

export async function logMcpRequest(params: {
  principal: McpPrincipal
  toolName?: string
  method: string
  statusCode: number
  responseTimeMs?: number
  mode?: "read" | "server_managed" | "client_assisted"
  requestId?: string
  idempotencyKey?: string
  units?: number
  errorCode?: string
  metadata?: Record<string, unknown>
}) {
  const admin = createAdminClient()
  await admin.schema("v3").from("mcp_request_logs").insert({
    api_key_id: params.principal.keyId,
    workspace_id: params.principal.workspaceId,
    user_id: params.principal.userId,
    endpoint: "/api/v3/mcp/server",
    method: params.method,
    status_code: params.statusCode,
    response_time_ms: params.responseTimeMs ?? 0,
    tool_name: params.toolName,
    mode: params.mode ?? "read",
    request_id: params.requestId ?? crypto.randomUUID(),
    idempotency_key: params.idempotencyKey,
    units: params.units ?? 0,
    error_code: params.errorCode,
    metadata: params.metadata ?? {},
  })
}
