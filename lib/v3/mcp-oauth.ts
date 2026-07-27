import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase/admin"

export const MCP_OAUTH_SCOPES = [
  "companies:read",
  "signals:read",
  "accounts:read",
  // `accounts:write` ya lo exigían save_account y remove_workspace_account, pero
  // faltaba en este catálogo: ningún cliente OAuth podía pedirlo, así que esas
  // tools solo funcionaban con API keys de scope "*".
  "accounts:write",
  // Enrichment de contactos vía Apollo (Fase 3). Separado de accounts:write
  // porque gasta créditos de Apollo, no solo cupo de cuentas del plan.
  "contacts:write",
  "research:run",
  "research:prepare",
  "research:submit",
  "icebreakers:generate",
  "icebreakers:prepare",
  "icebreakers:submit",
  "usage:read",
  "documents:read",
  "documents:write",
  "recommendations:read",
] as const

export const MCP_SCOPE_GROUPS = {
  read: ["companies:read", "signals:read", "accounts:read", "usage:read", "documents:read", "recommendations:read"],
  // Escrituras que consumen cupo o créditos. Se agrupan aparte de `read` para
  // que otorgar lectura nunca habilite gasto por accidente.
  accounts: ["accounts:write"],
  contacts: ["contacts:write"],
  research: ["research:run", "research:prepare", "research:submit"],
  icebreakers: ["icebreakers:generate", "icebreakers:prepare", "icebreakers:submit"],
  documents: ["documents:read", "documents:write", "recommendations:read"],
} as const

export const hashOAuthValue = (value: string) => crypto.createHash("sha256").update(value).digest("hex")
export const randomOAuthValue = (prefix: string) => `${prefix}_${crypto.randomBytes(32).toString("base64url")}`

export function getOAuthIssuer(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "")
  return configured || new URL(request.url).origin
}

export function sanitizeScopes(scope: string | string[]) {
  const requested = Array.isArray(scope) ? scope : scope.split(/\s+/)
  return [...new Set(requested.filter((item): item is typeof MCP_OAUTH_SCOPES[number] =>
    MCP_OAUTH_SCOPES.includes(item as typeof MCP_OAUTH_SCOPES[number])
  ))]
}

export function appendOAuthResult(redirectUri: string, values: Record<string, string | undefined>) {
  const url = new URL(redirectUri)
  Object.entries(values).forEach(([key, value]) => { if (value) url.searchParams.set(key, value) })
  return url.toString()
}

export async function upsertPublicClient(input: {
  clientId?: string
  clientName?: string
  redirectUris: string[]
  tokenEndpointAuthMethod?: string
}) {
  const admin = createAdminClient()
  const clientId = input.clientId || randomOAuthValue("mcp_client")
  const redirectUris = input.redirectUris.filter((uri) => {
    try { const parsed = new URL(uri); return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" } catch { return false }
  })
  if (!redirectUris.length) throw new Error("INVALID_REDIRECT_URI")
  const authMethod = input.tokenEndpointAuthMethod === "client_secret_post" ? "client_secret_post" : "none"
  const clientSecret = authMethod === "client_secret_post" ? randomOAuthValue("mcp_secret") : undefined
  const { error } = await admin.schema("v3").from("mcp_oauth_clients").upsert({
    client_id: clientId,
    client_secret_hash: clientSecret ? hashOAuthValue(clientSecret) : null,
    client_name: input.clientName?.slice(0, 120) || "MCP Client",
    redirect_uris: redirectUris,
    token_endpoint_auth_method: authMethod,
  }, { onConflict: "client_id" })
  if (error) throw error
  return { client_id: clientId, client_secret: clientSecret, client_name: input.clientName || "MCP Client", redirect_uris: redirectUris, token_endpoint_auth_method: authMethod, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }
}
