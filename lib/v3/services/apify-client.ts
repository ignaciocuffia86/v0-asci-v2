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
 *
 * Los nombres de `companies` vienen sucios de la ingesta CSV: hay filas reales
 * como `- Ing. Tangari S.A.`, `"Boston Cafe" - Iturdesi Cafe S.A.`,
 * `«Russkiy Svet» S.A.` y `- Ormas SA / Benito Roggio e Hijos SA`. Mandarlos tal
 * cual al filtro devuelve cero resultados y gasta la cuota en un run inútil, así
 * que se limpian antes de armar las variantes.
 */
export function companyNameVariants(name: string, linkedinUrl?: string | null): string[] {
  const out: string[] = []
  const push = (v: string) => {
    const t = v.replace(/\s+/g, " ").trim()
    if (t.length >= 3 && !out.some((e) => e.toLowerCase() === t.toLowerCase())) out.push(t)
  }

  // Se quitan comillas de todo tipo y la puntuación de los bordes, y se corta en
  // `/` porque esas filas traen dos empresas y la primera es la principal.
  const clean = name
    .replace(/["'«»“”‘’]/g, " ")
    .split("/")[0]
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}.]+$/u, "")
    .replace(/\s+/g, " ")
    .trim()

  push(clean)

  // Sin prefijo societario ("Grupo Arcor" -> "Arcor").
  push(clean.replace(/^\s*(grupo|group|holding)\s+/i, ""))
  // Sin sufijo societario ("ARCOR S.A.I.C." -> "ARCOR").
  push(clean.replace(/\s*(s\.?a\.?i\.?c\.?|s\.?a\.?s\.?|s\.?a\.?|s\.?r\.?l\.?|inc\.?|llc|ltd\.?|corp\.?)\s*$/i, ""))

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
 * Arranca el run, espera a que termine y lee el dataset (tres llamadas). NO usa
 * `run-sync-get-dataset-items`: ver la nota del encabezado sobre el 502.
 * El timeout se pasa como query param porque el del actor por defecto es 3600s:
 * sin acotarlo, un run colgado dejaría el request esperando.
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

  // `companies.country` viene como STRING VACÍO en filas reales (la cuenta
  // "ARCOR" tiene country: ""), y `??` no captura "" porque no es null. Sin este
  // trim explícito se le mandaría `location: ""` al actor.
  const location = params.location?.trim() || "Argentina"

  const input: Record<string, unknown> = {
    companyName: companyNames,
    location,
    publishedAt: PUBLISHED_AT_VALUES[requestedWindow],
    // Techo deliberadamente bajo: con rows=1000 el run expira sin devolver nada
    // útil. Es mejor traer 50 vacantes reales que perder el run entero.
    rows: Math.min(params.maxRows ?? 50, 200),
    proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
  }
  // `title` solo se manda si se pidió acotar: mandarlo vacío angosta la búsqueda
  // sin que nadie lo haya pedido.
  if (params.titleQuery?.trim()) input.title = params.titleQuery.trim()

  const auth = { Authorization: `Bearer ${token}` }

  // ── Paso 1: arrancar el run y quedarse con el runId ──────────────────────
  //
  // Se usa el endpoint asincrónico en vez de `run-sync-get-dataset-items` porque
  // el gateway sincrónico es frágil: en una prueba real devolvió 502 mientras el
  // run terminaba SUCCEEDED en 19 segundos. Con el endpoint sync eso significa
  // pagar el scraping y perder los datos, sin forma de recuperarlos. Teniendo el
  // runId, un fallo de red durante la espera no pierde nada.
  let startResponse: Response
  try {
    startResponse = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?timeout=${timeoutSecs}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    throw new Error(`APIFY_RUN_START_FAILED:${error instanceof Error ? error.message : "error de red"}`)
  }
  if (!startResponse.ok) {
    const body = await startResponse.text().catch(() => "")
    // El cuerpo del error de Apify es informativo (enumera los valores válidos de
    // los enums), así que se propaga recortado. Nunca incluye el token.
    throw new Error(`APIFY_RUN_HTTP_${startResponse.status}:${body.slice(0, 300)}`)
  }

  const started = (await startResponse.json()) as { data?: { id?: string; defaultDatasetId?: string } }
  const runId = started.data?.id
  const datasetId = started.data?.defaultDatasetId
  if (!runId || !datasetId) throw new Error("APIFY_RUN_NO_ID:Apify no devolvió el id del run")

  // ── Paso 2: esperar a que termine ────────────────────────────────────────
  const deadline = Date.now() + (timeoutSecs + 30) * 1000
  let status = "READY"
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    try {
      const poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers: auth, signal: AbortSignal.timeout(20_000) })
      if (!poll.ok) continue // Un error puntual del gateway no invalida el run.
      status = ((await poll.json()) as { data?: { status?: string } }).data?.status ?? status
    } catch {
      continue // Idem: se reintenta hasta la fecha límite.
    }
    if (status !== "RUNNING" && status !== "READY") break
  }

  // ── Paso 3: leer el dataset ──────────────────────────────────────────────
  //
  // Se leen los items incluso si el run no terminó en SUCCEEDED: un run
  // TIMED-OUT suele dejar resultados parciales válidos, y descartarlos sería
  // tirar vacantes reales que ya se pagaron.
  let items: Record<string, unknown>[] = []
  try {
    const data = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?limit=1000`, { headers: auth, signal: AbortSignal.timeout(60_000) })
    if (data.ok) {
      const payload = (await data.json()) as unknown
      if (Array.isArray(payload)) items = payload as Record<string, unknown>[]
    }
  } catch {
    // Se cae al chequeo de abajo, que da un mensaje accionable con el runId.
  }

  if (items.length === 0 && status !== "SUCCEEDED") {
    throw new Error(`APIFY_RUN_${status}:El scraping terminó en ${status} sin resultados. runId ${runId}.`)
  }

  return {
    runId,
    items,
    appliedWindow: requestedWindow,
    truncatedWindow: params.windowDays != null && params.windowDays > 30,
  }
}
