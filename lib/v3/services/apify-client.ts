import "server-only"

/**
 * Cliente del actor de LinkedIn Jobs en Apify.
 *
 * Todo lo que hay acá se verificó contra la API real, no contra documentación:
 *
 * - El actor configurado es `bebity/linkedin-jobs-scraper`.
 * - El input schema SÍ es accesible, pero NO por la API de versiones (que devuelve
 *   `sourceFiles` sin el schema). Va por la de builds:
 *     GET /v2/acts/bebity~linkedin-jobs-scraper  -> taggedBuilds.latest.buildId
 *     GET /v2/actor-builds/{buildId}             -> .data.inputSchema
 *   Campos declarados (build 0.0.49, verificado ago 2026):
 *     title           string  [requerido, default ""]      título del puesto
 *     location        string  [requerido, default "United States"]
 *     rows            integer [requerido, default 50]      techo de resultados
 *     companyName     array   filtro por nombre de empresa
 *     companyId       array   filtro por ID numérico de LinkedIn (exacto)
 *     publishedAt     enum    "" | r2592000 | r604800 | r86400
 *     workType        enum    "" | 1 on-site | 2 remote | 3 hybrid
 *     contractType    enum    "" | F P C T V I O
 *     experienceLevel enum    "" | 1..6
 *     proxy           object  default {useApifyProxy:true, groups:["RESIDENTIAL"]}
 *   `title` figura como requerido pero Apify le aplica el default "", y los runs
 *   por `companyName` sin title funcionan: no hace falta mandarlo.
 * - `companyId` es el filtro EXACTO y no tiene el problema de homónimos de
 *   `companyName`. Hoy no se usa porque no guardamos ese ID (`companies` solo tiene
 *   `linkedin_slug`/`linkedin_url`), pero el actor lo DEVUELVE en cada vacante, así
 *   que se puede ir poblando desde los propios resultados. Ver la nota de
 *   `belongsToCompany` en apify-job-ingest.ts.
 * - `publishedAt` es un ENUM cerrado. La propia API rechaza cualquier otro valor:
 *   "must be equal to one of the allowed values: "", "r2592000", "r604800",
 *   "r86400"". O sea: 1 día, 7 días, 30 días o sin límite. NO existe una ventana
 *   de 180 días, así que cualquier pedido más amplio que 30 días se traduce a ""
 *   (sin límite) en lugar de fallar o de mentir sobre la ventana aplicada.
 *   VERIFICADO que el filtro funciona y no anula resultados: ARCOR con
 *   `publishedAt: r2592000` devolvió vacantes de 1, 11 y 14 días de antigüedad,
 *   todas dentro de la ventana. Combinar `companyName` + `publishedAt` es válido y
 *   la ventana se delega al actor, sin filtrar de nuestro lado.
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

/**
 * ¿Está Apify configurado en ESTE deployment?
 *
 * Permite fallar antes de producir efectos colaterales. Sin esto el token se
 * valida recién dentro de `runLinkedinJobsActor`, o sea después de haber exigido
 * que la cuenta esté guardada y después de reservar cuota: el usuario ocupa un
 * lugar de su plan por una capacidad que este deployment no puede ejecutar.
 *
 * Pasó de verdad: `APIFY_TOKEN` estaba en un proyecto de Vercel y el dominio que
 * atendía el MCP era otro, así que la tool devolvía APIFY_TOKEN_MISSING recién al
 * final. Solo se mira el token: `APIFY_ACTOR_ID` tiene fallback.
 */
export function isApifyConfigured(): boolean {
  return Boolean(process.env.APIFY_TOKEN)
}

export interface ApifyRunResult {
  runId: string
  items: Record<string, unknown>[]
  /** Ventana realmente aplicada, que puede ser más amplia que la pedida. */
  appliedWindow: ApifyPublishedWindow
  truncatedWindow: boolean
  /**
   * Lo que Apify cobró por ESTA corrida, en dólares. `null` si no se pudo leer.
   *
   * Es el `usageTotalUsd` del objeto del run, verificado contra una corrida real
   * (35 vacantes, US$ 0,0142511). Cubre uso de plataforma: compute units, proxy
   * residencial, storage y transferencia. Es un número medido, no una estimación.
   *
   * NO INCLUYE EL ALQUILER DEL ACTOR. El scraper de vacantes se factura con
   * `pricingModel: FLAT_PRICE_PER_MONTH` a US$ 29,99 por mes, un fijo que se paga
   * exista o no la corrida. Por eso no se prorratea acá: repartir un fijo entre
   * las corridas del mes daría un número que cambia según cuántas corridas hubo
   * después, y ninguna de las dos cifras sería el costo de este informe. Lo que
   * este campo mide es el costo MARGINAL, que es el que sí depende de haberlo
   * pedido.
   */
  usageTotalUsd: number | null
}

/**
 * Lee el costo de una corrida terminada.
 *
 * Devuelve `null` ante cualquier problema y nunca tira: el scraping ya ocurrió y
 * las vacantes ya están, así que un fallo leyendo el precio no puede voltear la
 * ingesta. `null` viaja hasta el resumen de costos y ahí se muestra como "no lo
 * tenemos", que es la respuesta honesta y la que ya sabe manejar.
 *
 * Se pide de nuevo en vez de aprovechar el último poll a propósito: el poll corta
 * en el instante en que el estado deja de ser RUNNING, y la contabilidad de proxy
 * y transferencia puede cerrarse un momento después. Una llamada más, ya
 * terminado el run, es barata al lado de subreportar el costo.
 */
async function readRunCostUsd(runId: string, auth: Record<string, string>): Promise<number | null> {
  try {
    const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers: auth, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const usage = ((await res.json()) as { data?: { usageTotalUsd?: unknown } }).data?.usageTotalUsd
    // Se exige un número finito: un `undefined` de un actor que no lo reporte, o
    // un string, tienen que quedar en null y no convertirse en cero.
    return typeof usage === "number" && Number.isFinite(usage) ? usage : null
  } catch {
    return null
  }
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
   * Se ignora cuando hay `linkedinCompanyId` (el filtro exacto no necesita
   * variantes de nombre).
   */
  companyNames: string[]
  /**
   * LinkedIn company ID numérico (`companies.linkedin_company_id`). Cuando
   * está, el run filtra por `companyId` — EXACTO, sin homónimos — y omite
   * `companyName`. Es el switch de la Fase 3: la primera corrida por nombre
   * aprende el ID desde los resultados (ver apify-job-ingest) y las
   * siguientes entran por acá.
   */
  linkedinCompanyId?: number | null
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

  const linkedinCompanyId =
    typeof params.linkedinCompanyId === "number" && params.linkedinCompanyId > 0
      ? params.linkedinCompanyId
      : null

  const companyNames = params.companyNames.map((n) => n.trim()).filter((n) => n.length >= 3)
  if (!linkedinCompanyId && companyNames.length === 0) throw new Error("APIFY_COMPANY_NAMES_REQUIRED")

  // `companies.country` viene como STRING VACÍO en filas reales (la cuenta
  // "ARCOR" tiene country: ""), y `??` no captura "" porque no es null. Sin este
  // trim explícito se le mandaría `location: ""` al actor.
  const location = params.location?.trim() || "Argentina"

  const input: Record<string, unknown> = {
    // ID exacto cuando lo tenemos; variantes de nombre como único fallback.
    // No se mandan los dos juntos: el actor los intersecta y un nombre que
    // LinkedIn indexa distinto anularía los resultados del ID.
    ...(linkedinCompanyId ? { companyId: [String(linkedinCompanyId)] } : { companyName: companyNames }),
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
    // Se lee incluso si el run no terminó en SUCCEEDED: un run TIMED-OUT también
    // se paga, y ese gasto tiene que aparecer en el informe.
    usageTotalUsd: await readRunCostUsd(runId, auth),
  }
}
