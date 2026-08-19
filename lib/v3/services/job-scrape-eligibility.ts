// Decisión PURA de elegibilidad del corredor de scraping (Fase 4, diseño 6.3.b).
// Sin "server-only" para poder testearla directo; el corredor le pasa los hechos
// y esta función decide, así la regla anti-re-ejecución tiene tests y no vive
// desparramada en el route handler.

export const SCRAPE_COOLDOWN_DAYS = 25
export const SCRAPE_MAX_FAILED_ATTEMPTS = 3

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
  | { eligible: true; reason: "first_pass" | "monthly" }
  | { eligible: false; skip: "cooldown" | "attempts" | "not_due" }

/**
 * Reglas, en orden:
 * 1. Sin ningún batch → primera pasada (alta nueva). El batch se crea AL LANZAR
 *    el run, así que "sin batch" implica que nadie lo está corriendo ni lo corrió.
 * 2. Con batches pero 3+ fallidos desde el último éxito → agotó reintentos.
 * 3. refresh_day == hoy y el último éxito tiene 25+ días → refresh mensual.
 *    El cooldown es lo que evita que el corredor (que pasa cada 10 min) repita
 *    a la misma compañía durante todo su refresh_day.
 * 4. Todo lo demás → no le toca.
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

  if (!facts.dueToday) return { eligible: false, skip: "not_due" }

  if (facts.failedSinceLastSuccess >= SCRAPE_MAX_FAILED_ATTEMPTS) {
    return { eligible: false, skip: "attempts" }
  }

  const cooldownMs = SCRAPE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  if (now.getTime() - new Date(facts.latestNonFailedAt).getTime() < cooldownMs) {
    return { eligible: false, skip: "cooldown" }
  }

  return { eligible: true, reason: "monthly" }
}
