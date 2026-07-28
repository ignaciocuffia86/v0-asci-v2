import "server-only"

/**
 * Cliente del actor de LinkedIn Jobs en Apify.
 *
 * Todo lo que hay acá se verificó contra la API real, no contra documentación:
 *
 * - El actor configurado es `bebity/linkedin-jobs-scraper`.
 * - Su input NO publica inputSchema por la API de versiones, así que los campos se
 *   tomaron de un run exitoso real: `{title, location, publishedAt, rows, proxy}`.
 * - `publishedAt` es un ENUM cerrado. La propia API rechaza cualquier otro valor:
 *   "must be equal to one of the allowed values: "", "r2592000", "r604800",
 *   "r86400"". O sea: 1 día, 7 días, 30 días o sin límite. NO existe una ventana
 *   de 180 días, así que cualquier pedido más amplio que 30 días se traduce a ""
 *   (sin límite) en lugar de fallar o de mentir sobre la ventana aplicada.
 * - `title` es el término de búsqueda por TÍTULO DE PUESTO, no un filtro de
 *   empresa. Buscar con title="Arcor" devolvió 20 vacantes de las cuales solo 5
 *   eran de Grupo Arcor: el resto era de Medifé, ArcelorMittal y Worley.
 * - `companyName` SÍ existe y acepta un ARRAY de nombres. Filtra en origen: dos
 *   corridas con `["Grupo Arcor","Arcor"]` devolvieron 10/10 y 15/15 vacantes de
 *   Grupo Arcor, 100% de pureza contra el 25% de `title`. Por eso es el input que
 *   se usa: el nombre sale de nuestra tabla `companies`, no de una adivinanza.
 * - `rows` es un techo, no una cantidad exacta: con rows=25 devolvió 15.
 * - `rows: 1000` con `proxy.useApifyProxy: false` EXPIRA (run TIMED-OUT a los
 *   260s, con solo 10 items rescatados del parcial). De ahí el techo de `rows` y
 *   el proxy residencial, que sí completó.
 */

const ACTOR_FALLBACK = "bebity~linkedin-jobs-scraper"

/** Valores que la API acepta para `publishedAt`, verificados por su propio error. */
const PUBLISHED_AT_VALUES = {
  day: "r86400",
  week: "r604800",
  month: "r2592000",
  any: "",
} as const

export type ApifyPublishedWindow = keyof typeof PUBLISHED_AT_VALUES

/**
 * Traduce días a la ventana más ajustada que el actor soporta de verdad.
 *
 * Se redondea hacia ARRIBA (a la ventana más amplia que contiene el pedido) para
 * no perder vacantes que el usuario espera ver. Más de 30 días cae en "sin
 * límite", porque el actor no ofrece nada entre 30 días e infinito.
 */
export function toPublishedWindow(days: number | null | undefined): ApifyPublishedWindow {
  if (days == null) return "any"
  if (days <= 1) return "day"
  if (days <= 7) return "week"
  if (days <= 30) return "month"
  return "any"
}

/**
 * Variantes del nombre de empresa para pasarle al filtro `companyName`.
 *
 * LinkedIn indexa el nombre de fantasía, que no siempre coincide con el razón
 * social que guardamos: nuestra fila dice "Grupo Arcor" pero también existe
 * "Arcor". Como `companyName` acepta un array, se mandan las variantes razonables
 * en vez de apostar a una sola y volver con cero resultados.
 *
 * NO se inventan variantes agresivas (siglas, traducciones): cada variante extra
 * amplía lo que el actor considera aceptable, y de ahí podría entrar una empresa
 * ajena. La verificación de pertenencia de la ingesta sigue siendo la red final.
 */
export function companyNameVariants(name: string, linkedinUrl?: string | null): string[] {
  const out: string[] = []
  const push = (v: string) => {
    const t = v.trim()
    if (t.length >= 3 && !out.some((e) => e.toLowerCase() === t.toLowerCase())) out.push(t)
  }

  push(name)

  // Sin prefijo societario ("Grupo Arcor" -> "Arcor").
  push(name.replace(/^\s*(grupo|group|holding)\s+/i, ""))
  // Sin sufijo societario ("ARCOR S.A.I.C." -> "ARCOR").
  push(name.replace(/\s*(s\.?a\.?i\.?c\.?|s\.?a\.?s\.?|s\.?a\.?|s\.?r\.?l\.?|inc\.?|llc|ltd\.?|corp\.?)\s*$/i, ""))

  // El slug de LinkedIn es la forma que LinkedIn mismo usa, así que es la
  // variante más confiable de todas cuando está disponible.
  const slug = linkedinUrl?.match(/\/company\/([^/?#]+)/i)?.[1]
  if (slug) push(slug.replace(/-/g, " "))

  return out.slice(0, 4)
}

export interface ApifyRunResult {
  runId: string
  items: Record<string, unknown>[]
  /** Ventana realmente aplicada, que puede ser más amplia que la pedida. */
  appliedWindow: ApifyPublishedWindow
  truncatedWindow: boolean
}

/**
 * Corre el actor y espera el dataset.
 *
 * Usa `run-sync-get-dataset-items`, que corre y devuelve los items en una sola
 * llamada. El timeout se pasa también como query param porque el del actor por
 * defecto es 3600s: sin acotarlo, un run colgado bloquearía el request.
 */
export async function runLinkedinJobsActor(params: {
  /**
   * Nombres de la empresa objetivo. Filtra en origen: es lo que evita traer
   * vacantes de otras empresas. Sale de `companies.name`, no de input libre.
   */
  companyNames: string[]
  /** País o región de la empresa, de `companies.country`. */
  location?: string
  /**
   * Término opcional para acotar por título de puesto DENTRO de la empresa.
   * Sin esto se traen todas las vacantes de la empresa, que es lo habitual.
   */
  titleQuery?: string | null
  windowDays?: number | null
  maxRows?: number
  timeoutSecs?: number
}): Promise<ApifyRunResult> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error("APIFY_TOKEN_MISSING")

  // El id puede venir con "/" o con "~": la URL necesita "~".
  const actor = (process.env.APIFY_ACTOR_ID || ACTOR_FALLBACK).replace("/", "~")

  const requestedWindow = toPublishedWindow(params.windowDays)
  const timeoutSecs = params.timeoutSecs ?? 180

  const companyNames = params.companyNames.map((n) => n.trim()).filter((n) => n.length >= 3)
  if (companyNames.length === 0) throw new Error("APIFY_COMPANY_NAMES_REQUIRED")

  const input: Record<string, unknown> = {
    companyName: companyNames,
    location: params.location ?? "Argentina",
    publishedAt: PUBLISHED_AT_VALUES[requestedWindow],
    // Techo deliberadamente bajo: con rows=1000 el run expira sin devolver nada
    // útil. Es mejor traer 50 vacantes reales que perder el run entero.
    rows: Math.min(params.maxRows ?? 50, 200),
    proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
  }
  // `title` solo se manda si se pidió acotar: mandarlo vacío angosta la búsqueda
  // sin que nadie lo haya pedido.
  if (params.titleQuery?.trim()) input.title = params.titleQuery.trim()

  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=${timeoutSecs}`

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      // El actor puede tardar: se le da margen sobre su propio timeout.
      signal: AbortSignal.timeout((timeoutSecs + 30) * 1000),
    })
  } catch (error) {
    // Se distingue el timeout del resto para que la capa de arriba pueda sugerir
    // reintentar con una ventana más chica en lugar de mostrar un error opaco.
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("APIFY_RUN_TIMEOUT:El scraping tardó demasiado. Probá una ventana más corta o menos filas.")
    }
    throw new Error(`APIFY_RUN_FAILED:${error instanceof Error ? error.message : "error de red"}`)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    // El cuerpo del error de Apify es informativo (enumera los valores válidos),
    // así que se propaga recortado en vez de descartarlo. Nunca incluye el token.
    throw new Error(`APIFY_RUN_HTTP_${response.status}:${body.slice(0, 300)}`)
  }

  const payload = (await response.json()) as unknown
  if (!Array.isArray(payload)) {
    throw new Error("APIFY_RUN_UNEXPECTED_PAYLOAD:el actor no devolvió una lista de items")
  }

  return {
    // El endpoint sync no devuelve el runId en el body, así que se compone uno
    // trazable con el actor y el instante: alcanza para auditar el batch.
    runId: `${actor}-${Date.now()}`,
    items: payload as Record<string, unknown>[],
    appliedWindow: requestedWindow,
    truncatedWindow: params.windowDays != null && params.windowDays > 30,
  }
}
