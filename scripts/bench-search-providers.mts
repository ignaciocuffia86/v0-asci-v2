/**
 * Benchmark de proveedores de BUSQUEDA gateway-native vs el baseline de Parallel.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 * El objetivo es centralizar todo el consumo de IA en el AI Gateway. Se verifico
 * contra `GET /v1/models` que **Parallel NO es un provider del Gateway** (316
 * modelos, 34 providers, ninguno es Parallel): es una API de busqueda con su
 * propio SDK (`parallel-web`), no un LLM. Asi que centralizar = reemplazarlo por
 * busqueda nativa del Gateway. Este script mide a los candidatos.
 *
 * ── La asimetria, dicha de frente ──────────────────────────────────────────
 * `PARALLEL_API_KEY` no se sincroniza al sandbox, asi que Parallel NO se puede
 * llamar en vivo desde aca. Su lado sale de las noticias que YA produjo en
 * `public.company_news`.
 *
 * Y hay una asimetria mas importante: **ese baseline es de dic-2025/ene-2026 y
 * hoy es ago-2026**. Comparar "encontro los mismos articulos" seria una medicion
 * invalida: los candidatos buscan hoy y van a traer noticias mas nuevas, lo cual
 * no es un defecto. Por eso NO se compara solapamiento de articulos. Se compara:
 *
 *   1. Solapamiento de DOMINIOS  — ¿llega a los mismos medios? Esto si es
 *      comparable entre epocas y es la señal mas honesta de "calidad de fuente".
 *   2. URLs vivas               — mismo `checkUrlsAlive` que produccion.
 *   3. Relevancia               — mismo `filterRelevantToCompany` que produccion.
 *   4. Latencia / tokens / costo.
 *
 * Ademas se mide la supervivencia de las URLs del baseline HOY, que es un dato
 * real y simetrico: cuanto link rot tiene lo que Parallel trajo hace 8 meses.
 *
 * ── Costo ───────────────────────────────────────────────────────────────────
 * Hace llamadas REALES y algunas con Opus, que es caro. Por defecto corre 2
 * empresas; usar `--companies N` para ampliar. Al final imprime el gasto total.
 *
 * Uso:
 *   npx tsx scripts/bench-search-providers.mts
 *   npx tsx scripts/bench-search-providers.mts --companies 4
 *   npx tsx scripts/bench-search-providers.mts --skip-opus     # ahorra plata
 */

import { generateText, stepCountIs } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import pg from "pg"
import { checkUrlsAlive, filterRelevantToCompany } from "@/lib/ai-structurer"
import { estimateCostUsd } from "@/lib/v3/usage"

const args = process.argv.slice(2)
const nCompanies = args.includes("--companies") ? Number(args[args.indexOf("--companies") + 1]) : 2
const skipOpus = args.includes("--skip-opus")

/** Cuantas busquedas web se le permiten a los modelos que las ejecutan server-side. */
const MAX_SEARCHES = 3

type Candidato = {
  nombre: string
  modelo: string
  /** true = ejecuta busqueda server-side via tool de Anthropic */
  usaToolAnthropic: boolean
}

const CANDIDATOS: Candidato[] = [
  // Perplexity busca de forma nativa: no necesita declarar tool.
  { nombre: "sonar", modelo: "perplexity/sonar", usaToolAnthropic: false },
  { nombre: "sonar-pro", modelo: "perplexity/sonar-pro", usaToolAnthropic: false },
  // Haiku es la version barata del patron que v3 ya usa en produccion.
  { nombre: "haiku+search", modelo: "anthropic/claude-haiku-4.5", usaToolAnthropic: true },
  // Opus es EXACTAMENTE lo que corre hoy el radar de v3: es el titular a batir.
  { nombre: "opus+search", modelo: "anthropic/claude-opus-4.5", usaToolAnthropic: true },
]

/** Prompt unico para todos los candidatos, para que la comparacion sea limpia. */
function prompt(empresa: string): string {
  return `Busca noticias recientes sobre la empresa "${empresa}" que sirvan como señales de compra B2B (inversiones, transformacion digital, expansion, cambios de ejecutivos, alianzas, regulacion).

Devuelve UNICAMENTE un JSON valido con esta forma, sin markdown ni texto extra:
{"news":[{"title":"...","summary":"...","url":"https://...","source_name":"...","published_at":"YYYY-MM-DD o null"}]}

Reglas:
- La empresa "${empresa}" debe ser el SUJETO PRINCIPAL de cada noticia, no una mencion al pasar.
- El title y el summary deben mencionar explicitamente a "${empresa}".
- Cada item DEBE traer la url real de la fuente. Nunca inventes URLs.
- Maximo 10 noticias. Si no hay nada relevante, devuelve {"news":[]}.`
}

function dominio(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return ""
  }
}

/** Extrae el primer objeto JSON del texto, tolerando fences y prosa alrededor. */
function parseJson(texto: string): { news?: unknown[] } | null {
  const limpio = texto
    .replace(/^[\s\S]*?```(?:json)?/i, "")
    .replace(/```[\s\S]*$/i, "")
    .trim()
  for (const candidato of [limpio, texto]) {
    const i = candidato.indexOf("{")
    const j = candidato.lastIndexOf("}")
    if (i < 0 || j <= i) continue
    try {
      return JSON.parse(candidato.slice(i, j + 1))
    } catch {
      /* sigue */
    }
  }
  return null
}

type Resultado = {
  candidato: string
  empresa: string
  ok: boolean
  error?: string
  latenciaMs: number
  inTok: number
  outTok: number
  costo: number
  costoConfiable: boolean
  parseOk: boolean
  items: number
  relevantes: number
  urls: number
  urlsVivas: number
  dominios: Set<string>
  busquedas: number
}

async function correrCandidato(c: Candidato, empresa: string, preciado: boolean): Promise<Resultado> {
  const base: Resultado = {
    candidato: c.nombre,
    empresa,
    ok: false,
    latenciaMs: 0,
    inTok: 0,
    outTok: 0,
    costo: 0,
    costoConfiable: preciado,
    parseOk: false,
    items: 0,
    relevantes: 0,
    urls: 0,
    urlsVivas: 0,
    dominios: new Set<string>(),
    busquedas: 0,
  }

  const t0 = Date.now()
  try {
    const res = await generateText({
      model: c.modelo,
      prompt: prompt(empresa),
      temperature: 0.3,
      maxOutputTokens: 4096,
      ...(c.usaToolAnthropic
        ? {
            tools: {
              web_search: anthropic.tools.webSearch_20250305({ maxUses: MAX_SEARCHES }),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            stopWhen: stepCountIs(MAX_SEARCHES + 2),
          }
        : {}),
    })

    base.latenciaMs = Date.now() - t0
    base.ok = true
    base.inTok = res.usage?.inputTokens ?? 0
    base.outTok = res.usage?.outputTokens ?? 0
    base.costo = estimateCostUsd(c.modelo, base.inTok, base.outTok)

    for (const step of res.steps ?? []) {
      for (const call of step.toolCalls ?? []) {
        if (call.toolName === "web_search") base.busquedas++
      }
    }

    // URLs declaradas por el modelo en el JSON.
    const json = parseJson(res.text ?? "")
    base.parseOk = json !== null
    const items = Array.isArray(json?.news) ? (json!.news as Record<string, unknown>[]) : []
    base.items = items.length

    // Mismo guardrail de relevancia que produccion.
    base.relevantes = filterRelevantToCompany(items, empresa, ["title", "summary"]).length

    // URLs citadas por el proveedor (mas confiables que las del texto) + las del JSON.
    const urls = new Set<string>()
    for (const s of res.sources ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = (s as any)?.url
      if (typeof u === "string" && u) urls.add(u)
    }
    for (const it of items) {
      const u = it.url
      if (typeof u === "string" && u.startsWith("http")) urls.add(u)
    }
    base.urls = urls.size
    for (const u of urls) {
      const d = dominio(u)
      if (d) base.dominios.add(d)
    }

    // Mismo chequeo de URLs vivas que produccion.
    if (urls.size > 0) {
      const vivas = await checkUrlsAlive(Array.from(urls), { context: `bench:${c.nombre}` })
      base.urlsVivas = vivas.size
    }
  } catch (e) {
    base.latenciaMs = Date.now() - t0
    base.error = String((e as Error).message ?? e).slice(0, 110)
  }
  return base
}

// ── main ────────────────────────────────────────────────────────────────────

console.log(`[v0] Benchmark de busqueda gateway-native vs baseline de Parallel`)
console.log(`[v0] Empresas: ${nCompanies}  |  Opus: ${skipOpus ? "SALTEADO" : "incluido"}\n`)

// 1. Que modelos tienen precio REAL en el catalogo. Sin esto, el costo que
//    reporta estimateCostUsd es el fallback 3/15 y seria un numero inventado.
const catalogo = await fetch("https://ai-gateway.vercel.sh/v1/models", {
  headers: { authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` },
})
  .then((r) => r.json())
  .catch(() => ({ data: [] }))
const precios = new Map<string, boolean>()
for (const m of (catalogo as { data?: { id: string; pricing?: Record<string, unknown> }[] }).data ?? []) {
  precios.set(m.id, Object.keys(m.pricing ?? {}).length > 0)
}

const activos = CANDIDATOS.filter((c) => !(skipOpus && c.nombre === "opus+search"))
for (const c of activos) {
  const p = precios.get(c.modelo)
  console.log(
    `[v0] ${c.nombre.padEnd(12)} ${c.modelo.padEnd(30)} ${
      p === undefined ? "NO ESTA EN EL CATALOGO" : p ? "con precio" : "SIN PRECIO -> costo no comparable"
    }`
  )
}

// 2. Empresas de prueba: las que tienen baseline SANO de Parallel.
const url = (process.env.POSTGRES_URL_NON_POOLING || "").replace(/[?&]sslmode=[^&]*/g, "")
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()

const { rows: empresas } = await db.query<{ id: string; name: string }>(
  `SELECT co.id, co.name
     FROM public.company_news n JOIN public.companies co ON co.id = n.company_id
    WHERE n.ai_provider IS NOT NULL AND n.ai_provider <> 'degraded-fallback'
    GROUP BY co.id, co.name HAVING count(*) >= 4
    ORDER BY count(*) DESC LIMIT $1`,
  [nCompanies]
)

// 3. Baseline de Parallel por empresa (lo que ya produjo, medido hoy).
/**
 * `noticias` es el ACUMULADO de todas las corridas historicas de Parallel para
 * esa empresa, no el resultado de una busqueda. Compararlo de frente contra los
 * items de UNA corrida de un candidato seria inflar a Parallel ~10x.
 *
 * Por eso se calcula `porCorrida`: cada `created_at::date` distinto se toma como
 * una corrida del pipeline, y se promedia. Es una aproximacion (si dos refreshes
 * cayeron el mismo dia cuentan como uno), pero es MUCHO mas comparable que el
 * acumulado, y el sesgo va en contra de los candidatos, no a favor.
 */
type Baseline = {
  noticias: number
  corridas: number
  porCorrida: number
  dominios: Set<string>
  urls: string[]
  vivas: number
  desde: string
}
const baselines = new Map<string, Baseline>()

console.log(`\n${"=".repeat(80)}\nBASELINE DE PARALLEL (lo que ya trajo, con su link rot medido HOY)\n${"=".repeat(80)}`)
for (const emp of empresas) {
  const { rows } = await db.query<{ source_url: string; created_at: Date }>(
    `SELECT source_url, created_at FROM public.company_news
      WHERE company_id = $1 AND ai_provider <> 'degraded-fallback' AND source_url IS NOT NULL`,
    [emp.id]
  )
  const urls = rows.map((r) => r.source_url)
  const dominios = new Set(urls.map(dominio).filter(Boolean))
  const vivas = urls.length > 0 ? (await checkUrlsAlive(urls, { context: "bench:baseline" })).size : 0
  const desde = rows.length
    ? new Date(Math.min(...rows.map((r) => +new Date(r.created_at)))).toISOString().slice(0, 10)
    : "?"
  // Cada dia distinto con noticias = una corrida del pipeline (aproximacion).
  const dias = new Set(rows.map((r) => new Date(r.created_at).toISOString().slice(0, 10)))
  const corridas = Math.max(dias.size, 1)
  const porCorrida = rows.length / corridas
  baselines.set(emp.id, { noticias: rows.length, corridas, porCorrida, dominios, urls, vivas, desde })
  const pct = urls.length ? Math.round((100 * vivas) / urls.length) : 0
  console.log(
    `  ${emp.name.padEnd(24)} ${String(rows.length).padStart(3)} noticias en ${String(corridas).padStart(2)} corridas ` +
      `= ${porCorrida.toFixed(1)}/corrida  ${String(dominios.size).padStart(3)} dominios  ` +
      `URLs vivas ${vivas}/${urls.length} (${pct}%)  desde ${desde}`
  )
}

// 4. Correr los candidatos.
const resultados: Resultado[] = []
for (const emp of empresas) {
  console.log(`\n${"─".repeat(80)}\n${emp.name}\n${"─".repeat(80)}`)
  for (const c of activos) {
    const preciado = precios.get(c.modelo) === true
    const r = await correrCandidato(c, emp.name, preciado)
    resultados.push(r)
    if (!r.ok) {
      console.log(`  ${c.nombre.padEnd(12)} FALLO: ${r.error}`)
      continue
    }
    const bl = baselines.get(emp.id)!
    const comunes = [...r.dominios].filter((d) => bl.dominios.has(d)).length
    console.log(
      `  ${c.nombre.padEnd(12)} ${String(r.latenciaMs / 1000).padStart(5)}s  ` +
        `items ${String(r.items).padStart(2)} (relev ${String(r.relevantes).padStart(2)})  ` +
        `urls ${String(r.urls).padStart(2)} (vivas ${String(r.urlsVivas).padStart(2)})  ` +
        `dominios ${String(r.dominios.size).padStart(2)} (${comunes} comunes)  ` +
        `json ${r.parseOk ? "ok " : "FALLO"}  ` +
        `${r.busquedas ? `${r.busquedas} busq  ` : ""}` +
        `$${r.costo.toFixed(4)}${r.costoConfiable ? "" : "*"}`
    )
  }
}

// 5. Resumen agregado.
console.log(`\n${"=".repeat(80)}\nRESUMEN POR CANDIDATO\n${"=".repeat(80)}`)
console.log(
  `${"candidato".padEnd(13)}${"ok".padEnd(6)}${"json".padEnd(6)}${"items".padEnd(7)}${"relev".padEnd(7)}` +
    `${"urls".padEnd(6)}${"vivas".padEnd(7)}${"dom".padEnd(5)}${"comunes".padEnd(9)}${"lat".padEnd(8)}costo`
)
let gastoTotal = 0
for (const c of activos) {
  const rs = resultados.filter((r) => r.candidato === c.nombre)
  const oks = rs.filter((r) => r.ok)
  const sum = (f: (r: Resultado) => number) => oks.reduce((a, r) => a + f(r), 0)
  const comunes = oks.reduce((a, r) => {
    const emp = empresas.find((e) => e.name === r.empresa)!
    const bl = baselines.get(emp.id)!
    return a + [...r.dominios].filter((d) => bl.dominios.has(d)).length
  }, 0)
  const costo = sum((r) => r.costo)
  gastoTotal += costo
  const lat = oks.length ? sum((r) => r.latenciaMs) / oks.length / 1000 : 0
  const dom = oks.reduce((a, r) => a + r.dominios.size, 0)
  console.log(
    `${c.nombre.padEnd(13)}${`${oks.length}/${rs.length}`.padEnd(6)}` +
      `${`${oks.filter((r) => r.parseOk).length}/${oks.length}`.padEnd(6)}` +
      `${String(sum((r) => r.items)).padEnd(7)}${String(sum((r) => r.relevantes)).padEnd(7)}` +
      `${String(sum((r) => r.urls)).padEnd(6)}${String(sum((r) => r.urlsVivas)).padEnd(7)}` +
      `${String(dom).padEnd(5)}${String(comunes).padEnd(9)}${`${lat.toFixed(1)}s`.padEnd(8)}` +
      `$${costo.toFixed(4)}${oks.some((r) => !r.costoConfiable) ? " *" : ""}`
  )
}

// Fila de Parallel NORMALIZADA por corrida, para que sea comparable con los
// candidatos (que corrieron una sola vez por empresa).
const blTot = [...baselines.values()]
const blPorCorrida = blTot.reduce((a, b) => a + b.porCorrida, 0)
const blVivasPct = blTot.reduce((a, b) => a + b.urls.length, 0)
  ? (100 * blTot.reduce((a, b) => a + b.vivas, 0)) / blTot.reduce((a, b) => a + b.urls.length, 0)
  : 0
console.log(
  `${"PARALLEL/run".padEnd(13)}${"—".padEnd(6)}${"—".padEnd(6)}` +
    `${blPorCorrida.toFixed(1).padEnd(7)}${"—".padEnd(7)}` +
    `${blPorCorrida.toFixed(1).padEnd(6)}${`${blVivasPct.toFixed(0)}%`.padEnd(7)}` +
    `${"—".padEnd(5)}${"—".padEnd(9)}${"—".padEnd(8)}(sin API key)`
)
console.log(
  `\n[v0] Parallel acumulo ${blTot.reduce((a, b) => a + b.noticias, 0)} noticias en ` +
    `${blTot.reduce((a, b) => a + b.corridas, 0)} corridas historicas; la fila de arriba ya esta`
)
console.log(`[v0] normalizada a UNA corrida para que sea comparable con los candidatos.`)

console.log(`\n[v0] Gasto real de esta corrida: $${gastoTotal.toFixed(4)}`)
if (resultados.some((r) => !r.costoConfiable && r.ok)) {
  console.log(`[v0] (*) modelo SIN precio en el catalogo: el costo sale del fallback 3/15, NO es comparable.`)
}
console.log(`[v0] Nota: el baseline es de ${blTot[0]?.desde ?? "?"} y hoy es ${new Date().toISOString().slice(0, 10)}.`)
console.log(`[v0] Por eso se compara SOLAPAMIENTO DE DOMINIOS, no de articulos: los candidatos`)
console.log(`[v0] buscan hoy y traen noticias mas nuevas, lo cual no es un defecto.`)

await db.end()
