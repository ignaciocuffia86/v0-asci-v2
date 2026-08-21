/**
 * URL de la foto de un contacto, lista para un `<img>`.
 *
 * Las fotos vienen de LinkedIn vía Apollo y NO se pueden hotlinkear: hay que
 * pasarlas por `/api/proxy-image`, que además está endurecido contra SSRF
 * (allowlist exacta de hosts, IP pública obligatoria, sin redirects).
 *
 * Los hosts de acá son los mismos que acepta ese proxy. Medido sobre las 5.074
 * fotos guardadas: 3.370 en `media.licdn.com`, 1.696 en `static.licdn.com` y 8
 * en `media-exp1/2.licdn.com` — esos últimos son de mayo, son URLs firmadas que
 * ya expiraron y el proxy las rechaza. Por eso caen al fallback de iniciales en
 * vez de romper.
 *
 * Módulo leaf, sin imports: lo usa código cliente de v2 y de v3.
 */
const PROXY_HOSTS = new Set([
  "salesql.s3.eu-central-1.amazonaws.com",
  "d2ojpxxtu63wzl.cloudfront.net",
  "media.licdn.com",
  "static.licdn.com",
])

export function contactPhotoUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname
    if (PROXY_HOSTS.has(host)) return `/api/proxy-image?url=${encodeURIComponent(url)}`
    // Host que el proxy no acepta: mejor no renderizar nada que mostrar un
    // hueco roto. El llamador cae a las iniciales.
    return null
  } catch {
    return null
  }
}

/** Iniciales para el avatar cuando no hay foto utilizable. */
export function contactInitials(fullName: string): string {
  const partes = fullName.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return "?"
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}
