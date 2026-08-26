import crypto from "crypto"
import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { effectiveApiKeyScopes, scopesAreUnrestricted } from "./mcp-key-scopes"
import { hashOAuthValue } from "@/lib/v3/mcp-oauth"
import { principalColumns, type McpPrincipal } from "./mcp-usage"

/**
 * Tope de requests por minuto para tokens OAuth. Las API keys lo tienen por fila
 * (`rate_limit_per_minute`); los tokens OAuth no tienen esa columna, así que se
 * usa el mismo default que las keys (60).
 */
const OAUTH_RATE_LIMIT_PER_MINUTE = 60

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
    // Rate limiting para OAuth. Esta rama retornaba antes de cualquier chequeo,
    // así que el tráfico OAuth no tenía tope de requests: solo lo tenían las API
    // keys. Se cuenta sobre principal_id, que cubre los dos tipos de credencial.
    const oauthWindowStart = new Date(Date.now() - 60000).toISOString()
    const { count: oauthCount } = await admin.schema("v3").from("mcp_request_logs")
      .select("id", { count: "exact", head: true })
      .eq("principal_id", token.id).gte("created_at", oauthWindowStart)
      // Solo las filas de transporte (`tool_name` null), que son 1 por request HTTP y se
      // escriben ANTES de ejecutar. Las filas por tool son auditoría, se escriben después
      // y contarlas acá reduciría el tope real a la mitad. Ver nota en logMcpRequest.
      .is("tool_name", null)
    if ((oauthCount ?? 0) >= OAUTH_RATE_LIMIT_PER_MINUTE) {
      return failure("RATE_LIMITED", "Se excedió el límite general de requests por minuto", 429)
    }
    await admin.schema("v3").from("mcp_oauth_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", token.id)
    const scopes: string[] = token.scopes ?? []
    // `unrestricted: false` es literal y deliberado. Los scopes de un token OAuth
    // salen del consentimiento del usuario, y el catálogo de consentimiento no
    // ofrece el marcador de admin; dejarlo derivar de los scopes abriría la puerta
    // a que un consentimiento manipulado emita una credencial sin topes.
    return { success: true, workspaceId: token.workspace_id, userId: token.user_id, keyId: token.id, keyType: "oauth_token", scopes, allowedModes: resolveAllowedModes(scopes), unrestricted: false }
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
  // `.is("tool_name", null)`: ver la nota de la rama OAuth. El contador mira solo las
  // filas de transporte para que sumar auditoría por tool no achique el tope.
  const { count } = await admin.schema("v3").from("mcp_request_logs").select("id", { count: "exact", head: true }).eq("api_key_id", key.id).gte("created_at", oneMinuteAgo).is("tool_name", null)
  if ((count ?? 0) >= (key.rate_limit_per_minute ?? 60)) return failure("RATE_LIMITED", "Se excedió el límite general de requests por minuto", 429)
  await admin.schema("v3").from("mcp_api_keys").update({ last_used_at: new Date().toISOString(), request_count: (key.request_count ?? 0) + 1 }).eq("id", key.id)
  const storedScopes: string[] = key.scopes ?? []
  // La expansión vive en lib/v3/mcp-key-scopes.ts, que es la MISMA fuente que usa
  // la creación de la key. Antes estaba duplicada acá con su propia lista, y esa
  // duplicación es la que dejó nueve tools del server standard inalcanzables: se
  // agregaron scopes nuevos al set de creación y esta copia nunca se enteró.
  const scopes = effectiveApiKeyScopes(storedScopes)
  const allowedModes = key.allowed_modes?.length === 1 && key.allowed_modes[0] === "read" && storedScopes.includes("write")
    ? ["read", "server_managed", "client_assisted"]
    : (key.allowed_modes ?? ["read"])
  return {
    success: true,
    workspaceId: key.workspace_id,
    userId: key.owner_user_id,
    keyId: key.id,
    keyType: "api_key",
    scopes,
    allowedModes,
    // Se deriva de lo GUARDADO en la fila, no de `scopes` ya expandido: la
    // expansión completa por tipo, y no queremos que un día un cambio en la
    // expansión termine otorgando el marcador a una key que nunca lo tuvo.
    unrestricted: scopesAreUnrestricted(storedScopes),
  }
}

function resolveAllowedModes(scopes: string[]) {
  const modes = ["read"]
  // Los scopes de escritura (accounts:write, contacts:write) terminan en `:write`,
  // que no matcheaba ningún sufijo de acá. Resultado: un token OAuth con
  // contacts:write pasaba el chequeo de scope y moría después con
  // MODE_NOT_ALLOWED:server_managed. Guardar una cuenta o enriquecer contactos son
  // operaciones que el server ejecuta de punta a punta, así que son server_managed.
  if (scopes.some((s) => s.endsWith(":run") || s.endsWith(":generate") || s.endsWith(":write"))) {
    modes.push("server_managed")
  }
  if (scopes.some((scope) => scope.endsWith(":prepare") || scope.endsWith(":submit"))) modes.push("client_assisted")
  return modes
}

function failure(code: string, message: string, status: number): McpAuthResult {
  return { success: false, error: { code, message, status } }
}

/**
 * ⚠️ `mcp_request_logs` cumple DOS funciones, y conviene no mezclarlas:
 *
 * 1. **Contador de rate limit** — las filas con `tool_name` NULL son "tickets" de
 *    transporte: una por request HTTP, escritas ANTES de ejecutar nada (desde el callback
 *    de auth). Son las únicas que cuentan los chequeos de frecuencia de este archivo.
 * 2. **Auditoría por tool** — las filas con `tool_name` informado se escriben DESPUÉS de
 *    que la tool terminó, con su duración, status real y código de error.
 *
 * Por eso los dos contadores filtran `.is("tool_name", null)`: si contaran todo, cada
 * llamada gastaría 2 unidades del tope y el límite efectivo sería la mitad del configurado.
 */
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
  // Antes se escribía siempre en api_key_id, así que para principales OAuth el
  // insert violaba la FK y el request quedaba sin auditoría. El error además se
  // tragaba (nadie chequeaba `error`), por eso la falla era invisible.
  const { error } = await admin.schema("v3").from("mcp_request_logs").insert({
    ...principalColumns(params.principal),
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
  // No se lanza: perder una línea de auditoría no debe tumbar una tool que ya
  // hizo su trabajo. Pero se deja rastro, para que la próxima falla no vuelva a
  // pasar inadvertida meses como pasó con los logs OAuth.
  if (error) console.error("[v0] logMcpRequest falló:", error.message)
}
