/**
 * Resuelve la URL publica donde Apollo debe mandar los webhooks de phone reveal.
 *
 * Orden de precedencia:
 *   1. APOLLO_WEBHOOK_URL_OVERRIDE — override TEMPORAL para debug (ej. webhook.site).
 *      Si esta definida, se usa tal cual. Util para descartar si Apollo llega a
 *      alguna URL publica (aislando si el problema es Apollo o nuestro handler).
 *   2. NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_APP_URL / VERCEL_URL — base del deploy.
 *   3. Fallback hardcoded a asci.bigua.lat (dominio estable).
 *
 * Retorna la URL completa incluyendo el path /api/webhooks/apollo (raw, sin encodear).
 * Apollo URL-encode aplica al pasarla como query param, no al armarla.
 */
export function getApolloWebhookUrl(): string {
  const override = process.env.APOLLO_WEBHOOK_URL_OVERRIDE?.trim()
  if (override) return override

  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    "https://asci.bigua.lat"

  return `${base.replace(/\/$/, "")}/api/webhooks/apollo`
}
