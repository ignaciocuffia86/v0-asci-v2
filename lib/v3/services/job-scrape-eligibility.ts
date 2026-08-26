// Decisión PURA de elegibilidad del corredor de scraping (Fase 4, diseño 6.3.b).
// Sin "server-only" para poder testearla directo; el corredor le pasa los hechos
// y esta función decide, así la regla anti-re-ejecución tiene tests y no vive
// desparramada en el route handler.

export const SCRAPE_COOLDOWN_DAYS = 25
export const SCRAPE_MAX_FAILED_ATTEMPTS = 3
/**
 * Antigüedad a partir de la cual la data se considera vencida y se rehace la
 * pasada COMPLETA, sin esperar al refresh_day.
 *
 * Un refresh mensual normal deja el último batch con ~30-31 días encima al
 * llegar el próximo refresh_day (refresh_day va de 1 a 28, así que el hueco
 * máximo entre dos corridas consecutivas es 31 días). 60 días significa que la
 * compañía se salteó al menos un ciclo entero: estuvo sin follows activos, o el
 * corredor no llegó (cuota, lock, cron caído). El margen entre 31 y 60 es lo
 * que evita que la cadencia normal caiga sola en este camino.
 */
export const SCRAPE_STALE_DAYS = 60

export interface CompanyScrapeFacts {
  /** ¿Existe ALGÚN batch apify:// para la compañía (cualquier estado)?
   *  Incluye el marcador en `uploading` de un run en vuelo. */
  hasAnyBatch: boolean
  /** created_at del último batch NO fallido, o null. */
  latestNonFailedAt: string | null
  /** Batches `failed` posteriores al último no-fallido (reintentos agotables). */
  failedSinceLastSuccess: number
  /** ¿Algún follow activo de la compañía tiene refresh_day == hoy? */
  dueToday: boolean
}

export type ScrapeDecision =
  | { eligible: true; reason: "first_pass" | "monthly" | "stale" }
  | { eligible: false; skip: "cooldown" | "attempts" | "not_due" }

/**
 * Reglas, en orden:
 * 1. Sin ningún batch → primera pasada (alta nueva). El batch se crea AL LANZAR
 *    el run, así que "sin batch" implica que nadie lo está corriendo ni lo corrió.
 * 2. Con batches pero 3+ fallidos desde el último éxito → agotó reintentos.
 *    Se evalúa ANTES que todo lo demás para que ningún camino posterior
 *    (incluido `stale`) pueda saltear el tope de gasto.
 * 3. Último éxito con 60+ días → `stale`: pasada completa, SIN esperar al
 *    refresh_day. Es el camino de reparación (ver `SCRAPE_STALE_DAYS`); sin él,
 *    una compañía que se dejó de seguir y se volvió a seguir se queda con la
 *    data vieja hasta su refresh_day y encima refresca con ventana de 30 días,
 *    que nunca cubre el hueco.
 * 4. refresh_day == hoy y el último éxito tiene 25+ días → refresh mensual.
 *    El cooldown es lo que evita que el corredor (que pasa cada 10 min) repita
 *    a la misma compañía durante todo su refresh_day.
 * 5. Todo lo demás → no le toca.
 *
 * `stale` no necesita su propio anti-repetición: el corredor marca el intento
 * antes de gastar (batch `uploading` en import_batches), y ese marcador cuenta
 * como último no-fallido, así que en la pasada siguiente la compañía ya no es
 * stale. Si el run falla, suma a los reintentos y la regla 2 lo corta.
 */
export function decideScrape(facts: CompanyScrapeFacts, now: Date): ScrapeDecision {
  if (!facts.hasAnyBatch) return { eligible: true, reason: "first_pass" }

  if (facts.latestNonFailedAt === null) {
    // Solo tiene fallidos: se reintenta como primera pasada hasta agotar.
    if (facts.failedSinceLastSuccess >= SCRAPE_MAX_FAILED_ATTEMPTS) {
      return { eligible: false, skip: "attempts" }
    }
    return { eligible: true, reason: "first_pass" }
  }

  if (facts.failedSinceLastSuccess >= SCRAPE_MAX_FAILED_ATTEMPTS) {
    return { eligible: false, skip: "attempts" }
  }

  const ageMs = now.getTime() - new Date(facts.latestNonFailedAt).getTime()

  if (ageMs >= SCRAPE_STALE_DAYS * 24 * 60 * 60 * 1000) {
    return { eligible: true, reason: "stale" }
  }

  if (!facts.dueToday) return { eligible: false, skip: "not_due" }

  if (ageMs < SCRAPE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) {
    return { eligible: false, skip: "cooldown" }
  }

  return { eligible: true, reason: "monthly" }
}
