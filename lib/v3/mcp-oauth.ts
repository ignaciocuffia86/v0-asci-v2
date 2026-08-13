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
  // MCP Explore (empresa-first sobre la tabla cruda). Mismo problema que Perfiles:
  // explore:read existía como scope de API key pero no en el catálogo OAuth, así
  // que sanitizeScopes lo descartaba y el embudo de Explore no se podía usar con un
  // token OAuth. Las capas pagas de Explore ya las cubren research/accounts/contacts.
  "explore:read",
  // Tercer MCP (Perfiles, persona-first). Sin este scope en el catálogo,
  // sanitizeScopes descartaba profiles:read y ningún token OAuth podía usar
  // profiles_search: el consentimiento no lo ofrecía y la conexión OAuth moría
  // con SCOPE_REQUIRED por más que se reconectara. Es solo lectura.
  "profiles:read",
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
  // Scope base (solo lectura) de cada MCP paralelo. Se agrupan aparte para que el
  // consentimiento pueda ofrecerlos y pre-seleccionarlos según a qué MCP conectás.
  // Las capas pagas de Explore (scrape de vacantes, Apollo) usan research/accounts/
  // contacts, que son grupos propios: otorgar el embudo nunca habilita gasto.
  explore: ["explore:read"],
  profiles: ["profiles:read"],
} as const

/**
 * Metadata protected-resource POR MCP. Antes había una sola (hardcodeada al server
 * standard, con TODOS los scopes), así que los tres MCP anunciaban lo mismo y el
 * cliente OAuth no podía saber a cuál se conectaba: el consentimiento no tenía cómo
 * pre-seleccionar el permiso correcto. Con una entrada por server, cada MCP publica
 * SU `resource` y SOLO sus scopes, y el consent deriva de ahí qué tildar.
 *
 * `key` es el segmento de la URL del MCP (/api/v3/mcp/<key>/...), que es también lo
 * que se usa para reconstruir el `resource` y para el match en el consentimiento.
 */
export const MCP_RESOURCE_SERVERS = {
  server: {
    scopes: [...MCP_OAUTH_SCOPES],
    // El MCP standard reparte sus permisos en varios grupos; el consent arranca en
    // lectura y el usuario suma lo que necesite.
    consentGroups: ["read"],
  },
  explore: {
    // Solo el scope base (embudo de lectura). Las capas pagas (scrape de vacantes,
    // Apollo) se otorgan tildando a mano Research / Guardar cuentas / Contactos, para
    // no pre-seleccionar gasto al conectar.
    scopes: ["explore:read", "usage:read"],
    consentGroups: ["explore"],
  },
  profiles: {
    scopes: ["profiles:read", "usage:read"],
    consentGroups: ["profiles"],
  },
} as const

export type McpResourceKey = keyof typeof MCP_RESOURCE_SERVERS

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
