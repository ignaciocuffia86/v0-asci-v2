// Normalización de las fechas de publicación que devuelve el actor de LinkedIn.
//
// Incidente real (ago 2026, primer scraping en producción): el actor devolvió
// `postedTime` como fecha RELATIVA ("4 weeks ago", "7 hours ago") y el RPC
// `process_job_batch_internal` castea esas claves directo a TIMESTAMPTZ
// (COALESCE(postedTime, publishedAt, post_date)::TIMESTAMPTZ), así que cada
// fila moría con "invalid input syntax for type timestamp with time zone" y el
// batch quedaba clavado en processing con 0 vacantes visibles.
//
// Se normaliza acá, en el adaptador, y no en el PL/pgSQL: el RPC es compartido
// con la ingesta CSV histórica (que siempre trajo fechas absolutas) y tocarlo
// arriesga a todo el ETL; el row_data de Apify, en cambio, lo armamos nosotros.
//
// Sin "server-only" para poder testearlo directo; es puro.

const RELATIVE_RE = /(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/i

const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
}

/** Claves de fecha que el RPC castea a TIMESTAMPTZ (mantener alineadas). */
export const POSTED_DATE_KEYS = ["postedTime", "publishedAt", "post_date"] as const

/**
 * Convierte un valor de fecha del actor a ISO-8601.
 * - Fecha absoluta parseable → tal cual (el RPC ya la castea bien).
 * - Relativa ("4 weeks ago", "yesterday") → now - offset, en ISO.
 * - Cualquier otra cosa → null (mejor posted_at NULL→now() que una fila muerta).
 */
export function normalizePostedDate(value: unknown, now: Date = new Date()): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const trimmed = value.trim()

  const relative = trimmed.match(RELATIVE_RE)
  if (relative) {
    const amount = Number.parseInt(relative[1], 10)
    const unit = relative[2].toLowerCase()
    return new Date(now.getTime() - amount * UNIT_MS[unit]).toISOString()
  }
  if (/^yesterday$/i.test(trimmed)) return new Date(now.getTime() - UNIT_MS.day).toISOString()
  if (/^(today|just now)$/i.test(trimmed)) return now.toISOString()

  const parsed = Date.parse(trimmed)
  if (!Number.isNaN(parsed)) return trimmed

  return null
}

/**
 * Devuelve una copia del item con las claves de fecha saneadas: las relativas
 * se convierten a ISO y las incasteables se eliminan (un NULL cae en el
 * COALESCE del RPC y termina en now(), que es aceptable para una vacante
 * recién scrapeada).
 */
export function normalizePostedDates<T extends Record<string, unknown>>(
  item: T,
  now: Date = new Date(),
): T {
  const out: Record<string, unknown> = { ...item }
  for (const key of POSTED_DATE_KEYS) {
    if (!(key in out)) continue
    const normalized = normalizePostedDate(out[key], now)
    if (normalized === null) delete out[key]
    else out[key] = normalized
  }
  return out as T
}
