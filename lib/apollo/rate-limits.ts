/**
 * Lectura de la cuota de Apollo desde los headers de cada response.
 *
 * Apollo no publica un limite fijo por endpoint: cada cuenta tiene el suyo
 * segun el plan, con ventana fija por minuto / hora / dia, y lo informa en los
 * headers de CADA llamada. Hasta ahora los tirabamos, asi que no teniamos
 * forma de saber cuanta cuota nos queda ni de dimensionar un barrido grande.
 *
 * Los nombres de header cambiaron de forma historicamente (x-rate-limit-minute
 * vs x-minute-requests-left vs el X-RateLimit-* generico), asi que leemos las
 * tres familias y nos quedamos con lo que exista.
 */

export type ApolloRateLimit = {
  /** Limite total de la ventana */
  limit: number | null
  /** Requests que quedan en la ventana */
  remaining: number | null
  /** Consumidas en la ventana */
  used: number | null
}

export type ApolloRateLimits = {
  minute: ApolloRateLimit
  hourly: ApolloRateLimit
  daily: ApolloRateLimit
  /** Segundos a esperar; solo viene cuando nos frenaron (429) */
  retryAfterSeconds: number | null
  /** Todos los headers de cuota crudos, para diagnostico cuando Apollo cambie los nombres */
  raw: Record<string, string>
}

function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const EMPTY: ApolloRateLimit = { limit: null, remaining: null, used: null }

/**
 * Extrae la cuota de un Headers de fetch. Nunca tira: si Apollo no manda nada,
 * devuelve la estructura vacia.
 */
export function extractRateLimits(
  headers: Headers | null | undefined,
): ApolloRateLimits {
  const raw: Record<string, string> = {}
  if (headers && typeof headers.forEach === "function") {
    headers.forEach((value, key) => {
      const k = key.toLowerCase()
      // Guardamos cualquier header que hable de cuota, incluso los que todavia
      // no sabemos interpretar: si Apollo renombra algo, queda la evidencia.
      if (
        /^(x-)?(rate-?limit|minute|hourly|hour|daily|day|24-hour)/.test(k) ||
        k === "retry-after"
      ) {
        raw[k] = value
      }
    })
  }

  const get = (...names: string[]): string | null => {
    for (const n of names) {
      if (raw[n] !== undefined) return raw[n]
    }
    return null
  }

  // Apollo no usa UN nombre por ventana sino varios. Medido en produccion
  // (26-ago-2026) nuestra cuenta devuelve `x-rate-limit-24-hour`, NO
  // `x-rate-limit-daily`. Sin estos alias la ventana diaria quedaba en null
  // aunque Apollo la estuviera informando. Se prueban todos los conocidos.
  const ALIASES: Record<"minute" | "hourly" | "daily", string[]> = {
    minute: ["minute"],
    hourly: ["hourly", "hour"],
    daily: ["24-hour", "daily", "day"],
  }

  const window = (
    win: "minute" | "hourly" | "daily",
    generic: boolean,
  ): ApolloRateLimit => {
    const names = ALIASES[win]
    return {
      limit: num(
        get(
          ...names.map((n) => `x-rate-limit-${n}`),
          ...(generic ? ["x-ratelimit-limit"] : []),
        ),
      ),
      remaining: num(
        get(
          ...names.map((n) => `x-${n}-requests-left`),
          ...(generic ? ["x-ratelimit-remaining"] : []),
        ),
      ),
      used: num(get(...names.map((n) => `x-${n}-usage`))),
    }
  }

  return {
    // Solo la ventana de minuto hereda los headers genericos X-RateLimit-*:
    // cuando Apollo manda esos, se refieren a la ventana mas corta.
    minute: window("minute", true),
    hourly: window("hourly", false),
    daily: window("daily", false),
    retryAfterSeconds: num(get("retry-after")),
    raw,
  }
}

/** true si alguna ventana quedo por debajo del margen de seguridad. */
export function isNearLimit(limits: ApolloRateLimits, margin = 5): boolean {
  return [limits.minute, limits.hourly, limits.daily].some(
    (w) => w.remaining !== null && w.remaining <= margin,
  )
}

export const EMPTY_RATE_LIMIT = EMPTY
