/**
 * Scopes por tipo de API key. FUENTE ÚNICA.
 *
 * Vive acá y no en `app/actions/v3/api-keys.ts` porque lo necesitan los dos
 * extremos: la creación de la key (server action) y la validación de cada request
 * (`lib/v3/mcp-auth.ts`, que corre en la ruta del MCP y no puede importar un
 * módulo "use server").
 *
 * EL BUG QUE MOTIVÓ SEPARARLO. El set de scopes de `standard` no incluía
 * accounts:write, contacts:write, documents:read/write ni recommendations:read.
 * Como los scopes se guardan en la fila de la key al crearla, y la validación solo
 * expandía los literales legacy "read"/"write", una key standard nueva quedaba con
 * NUEVE tools del server standard inalcanzables — entre ellas `save_account`, que
 * es el primer paso de todo el flujo: guardar la cuenta es lo que habilita
 * research, contactos y vacantes. Con OAuth funcionaba, porque el catálogo de
 * consentimiento sí ofrece esos scopes; con API key, no. Nadie lo decidió: el set
 * quedó viejo cuando se agregaron las tools.
 *
 * Al tener el set en un solo lugar y derivarlo en la validación, las keys ya
 * emitidas quedan arregladas sin migración de datos y el set no puede volver a
 * quedar desfasado.
 */

export type ApiKeyType = "standard" | "explore" | "profiles" | "admin"

/**
 * Scope marcador del perfil admin. Es lo que `keyTypeFromScopes` reconoce y lo que
 * `lib/v3/mcp-auth.ts` traduce a `principal.unrestricted`.
 *
 * Se llama por lo que HACE y no por a quién pertenece: una key con este scope no
 * "es de un admin", es una credencial que no tiene topes de cuenta ni de cupo. El
 * nombre tiene que doler un poco al leerlo en una fila de la base.
 */
export const UNRESTRICTED_SCOPE = "admin:unrestricted"

/**
 * - standard: el MCP principal (señales v2, research, icebreakers, contactos,
 *   documentos). Lleva las capas pagas porque el server las registra: el freno de
 *   costo NO es el scope sino el plan (`allowsContactEnrichment`), el cupo de
 *   cuentas guardadas y el circuito preview → planHash → confirmación.
 * - explore: el MCP paralelo sobre la tabla cruda. Incluye explore:read y los
 *   scopes de las capas pagas del embudo (scrape de vacantes y Apollo).
 * - profiles: el tercer MCP, persona-first, para búsqueda de talento. Es de solo
 *   lectura sobre la tabla cruda de contactos, así que solo lleva profiles:read
 *   (más usage:read para consultar consumo). No tiene capas pagas.
 * - admin: el perfil del equipo de ASCI. Mismos scopes que standard MAS el marcador
 *   `admin:unrestricted`. Lo que lo distingue NO son los scopes —los guards de cuenta
 *   y cupo son una capa aparte que no los mira— sino ese marcador, que apaga los
 *   topes SIN apagar la medición. Se emite con dos llaves (superadmin global +
 *   workspace de ASCI); ver `app/actions/v3/api-keys.ts`.
 */
/**
 * Los scopes del MCP principal. Viven en su propia const porque `admin` los reusa
 * enteros: si se duplicaran, volveríamos exactamente al bug que motivó este archivo
 * —un set que queda viejo cuando se agrega una tool— pero ahora en dos lugares.
 */
const SCOPES_STANDARD = [
  "companies:read",
  "signals:read",
  "accounts:read",
  // Guardar y dar de baja cuentas. Sin esto la key no puede ocupar ni liberar
  // un lugar del plan, y todo el embudo posterior queda bloqueado.
  "accounts:write",
  // Apollo. El gasto lo frenan el plan y el planHash, no el scope: sin el
  // scope la tool ni siquiera se puede previsualizar.
  "contacts:write",
  "research:run",
  "research:prepare",
  "research:submit",
  "icebreakers:generate",
  "icebreakers:prepare",
  "icebreakers:submit",
  "documents:read",
  "documents:write",
  "recommendations:read",
  "usage:read",
]

export const SCOPES_BY_TYPE: Record<ApiKeyType, { scopes: string[]; allowedModes: string[] }> = {
  standard: {
    scopes: [...SCOPES_STANDARD],
    allowedModes: ["read", "server_managed", "client_assisted"],
  },
  explore: {
    scopes: ["explore:read", "research:run", "accounts:read", "accounts:write", "contacts:write", "usage:read"],
    allowedModes: ["read", "server_managed"],
  },
  profiles: {
    scopes: ["profiles:read", "usage:read"],
    allowedModes: ["read"],
  },
  admin: {
    scopes: [...SCOPES_STANDARD, UNRESTRICTED_SCOPE],
    allowedModes: ["read", "server_managed", "client_assisted"],
  },
}

/**
 * Deriva el tipo de una key a partir de sus scopes guardados. El orden importa:
 * admin:unrestricted, profiles:read y explore:read son marcadores exclusivos; se
 * chequean antes de caer en standard.
 *
 * `admin` va PRIMERO porque comparte todos los scopes de standard: si se evaluara
 * después, una key admin se leería como standard y el límite de "una key activa por
 * tipo y por usuario" dejaría emitir las dos.
 */
export function keyTypeFromScopes(scopes: string[] | null): ApiKeyType {
  const list = scopes ?? []
  if (list.includes(UNRESTRICTED_SCOPE)) return "admin"
  if (list.includes("profiles:read")) return "profiles"
  if (list.includes("explore:read")) return "explore"
  return "standard"
}

/**
 * Si estos scopes apagan los topes de cuenta y cupo.
 *
 * Se mira el SCOPE MARCADOR y no el tipo derivado: es el mismo dato, pero así el
 * chequeo no depende del orden de `keyTypeFromScopes`. Solo aplica a API keys —
 * un token OAuth nunca es unrestricted, porque sus scopes salen del consentimiento
 * del usuario y el catálogo de consentimiento no ofrece este marcador.
 */
export function scopesAreUnrestricted(scopes: string[] | null): boolean {
  return (scopes ?? []).includes(UNRESTRICTED_SCOPE)
}

/** Scopes que otorgaban los literales legacy. Se conservan tal cual. */
const LEGACY_READ_SCOPES = ["companies:read", "signals:read", "accounts:read", "usage:read"]
const LEGACY_WRITE_SCOPES = [
  "research:run", "research:prepare", "research:submit",
  "icebreakers:generate", "icebreakers:prepare", "icebreakers:submit",
  "accounts:write",
]

/**
 * Scopes efectivos de una API key a partir de lo que tiene guardado.
 *
 * Dos caminos, y la distinción NO es cosmética:
 *
 * 1. Keys LEGACY, las que guardaron los literales "read" / "write". Se expanden
 *    exactamente como antes y NO se completan por tipo. Una key legacy de solo
 *    "read" fue emitida como de solo lectura: completarla con el set de standard
 *    le daría accounts:write, que corre en modo "read" y por lo tanto no lo frena
 *    `allowedModes`. Sería ampliar en silencio una credencial que alguien limitó a
 *    propósito.
 *
 * 2. Keys TIPADAS, las que guardaron el set concreto de su tipo. Se completan con
 *    el set canónico vigente. Es lo que arregla las standard ya emitidas sin
 *    tocar la base, y lo que impide que el set vuelva a quedar viejo.
 *
 * NO se usa para tokens OAuth: ahí los scopes salen del consentimiento del
 * usuario y tienen que respetarse tal cual se otorgaron.
 */
export function effectiveApiKeyScopes(storedScopes: string[] | null): string[] {
  const stored = storedScopes ?? []
  if (!stored.length) return [...LEGACY_READ_SCOPES]

  if (stored.includes("read") || stored.includes("write")) {
    const scopes = stored.includes("read") ? [...stored, ...LEGACY_READ_SCOPES] : [...stored]
    if (stored.includes("write")) scopes.push(...LEGACY_WRITE_SCOPES)
    return [...new Set(scopes)]
  }

  return [...new Set([...stored, ...SCOPES_BY_TYPE[keyTypeFromScopes(stored)].scopes])]
}
