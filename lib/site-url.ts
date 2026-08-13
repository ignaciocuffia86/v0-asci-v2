/**
 * Fuente única de la base-URL de la plataforma (OPT / C4 del informe).
 *
 * Antes cada lugar resolvía la URL a mano con su propio fallback hard-coded, y
 * algunos apuntaban a dominios equivocados o inexistentes (`app.asci.ai`,
 * `asci.vercel.app`). Si `NEXT_PUBLIC_APP_URL` faltaba, se generaban links al
 * dominio incorrecto en silencio. Este helper centraliza el orden de resolución
 * (`NEXT_PUBLIC_APP_URL` → `NEXT_PUBLIC_SITE_URL` → fallback) en un solo lugar.
 *
 * La plataforma tiene dos productos con dominios distintos:
 *   - v2 (sitio público):      https://asci.bigua.lat   (fallback por defecto)
 *   - v3 (bot / multitenant):  https://bot.bigua.lat
 * En cada deploy de Vercel las env vars están seteadas al dominio correcto; el
 * fallback es solo la red de seguridad para una config faltante. Por eso cada
 * caller v3 debe pasar el fallback de v3 explícitamente.
 */

export const V2_BASE_URL = "https://asci.bigua.lat"
export const V3_BASE_URL = "https://bot.bigua.lat"

/**
 * Devuelve la base-URL de la plataforma, sin barra final.
 * @param fallback URL a usar si no hay env var. Default: dominio v2.
 */
export function getAppUrl(fallback: string = V2_BASE_URL): string {
  const url =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    fallback
  return url.replace(/\/+$/, "")
}
