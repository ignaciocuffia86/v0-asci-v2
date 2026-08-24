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

export type ApiKeyType = "standard" | "explore" | "profiles"

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
 */
export const SCOPES_BY_TYPE: Record<ApiKeyType, { scopes: string[]; allowedModes: string[] }> = {
  standard: {
    scopes: [
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
    ],
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
}

/**
 * Deriva el tipo de una key a partir de sus scopes guardados. El orden importa:
 * profiles:read y explore:read son marcadores exclusivos de cada MCP; se chequean
 * antes de caer en standard.
 */
export function keyTypeFromScopes(scopes: string[] | null): ApiKeyType {
  const list = scopes ?? []
  if (list.includes("profiles:read")) return "profiles"
  if (list.includes("explore:read")) return "explore"
  return "standard"
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
