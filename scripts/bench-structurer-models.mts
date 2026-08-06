/**
 * Benchmark de modelos para `structureWithLLM`.
 *
 * Motivo: el default era `google/gemini-2.0-flash`, que el AI Gateway retiró
 * (devuelve model_not_found). Hay que elegir el reemplazo MIDIENDO, no por
 * intuición, porque la tarea real no es "razonar" sino devolver JSON válido que
 * respete un schema con campos obligatorios.
 *
 * Se miden dos familias de prompts reales, no sintéticas:
 *   A) noticias      → el system prompt de app/api/research/news/route.ts
 *   B) radar técnico → el system prompt de lib/tech-radar.ts
 *
 * Y el insumo también es real: excerpts que devuelve Parallel para empresas que
 * existen en la base, y texto de investigación ya guardado en
 * public.radar_research_runs.
 *
 * Lo que importa medir:
 *   - JSON válido al PRIMER intento (un reintento paga los tokens dos veces)
 *   - que respete los campos obligatorios (source_index en noticias): los items
 *     sin ese campo los descarta el código, así que un modelo que los omite
 *     "responde bien" pero produce cero resultados útiles
 *   - items extraídos, latencia, tokens y costo
 *
 * Uso: npx tsx --env-file=/vercel/share/.env.project scripts/bench-structurer-models.mts
 */
import { readFileSync } from "node:fs"
import { generateText } from "ai"
import pg from "pg"
import { estimateCostUsd } from "@/lib/v3/usage"

const CANDIDATOS = [
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-flash",
  "google/gemini-3.5-flash-lite",
]

/** Extrae un system prompt (template literal sin interpolación) del código fuente. */
function extraerPrompt(archivo: string, constante: string): string {
  const src = readFileSync(archivo, "utf8")
  const m = src.match(new RegExp(`const ${constante} = \`([\\s\\S]*?)\`\\n`))
  if (!m) throw new Error(`No se pudo extraer ${constante} de ${archivo}`)
  return m[1]
}

function stripFences(text: string): string {
  let t = text.trim()
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")
  return t.trim()
}

async function conectar() {
  const url = (process.env.POSTGRES_URL_NON_POOLING || "").replace(/[?&]sslmode=[^&]*/g, "")
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await c.connect()
  return c
}

interface Caso {
  familia: "noticias" | "radar"
  etiqueta: string
  systemPrompt: string
  userPrompt: string
  maxOutputTokens: number
}

async function construirCasos(): Promise<Caso[]> {
  const casos: Caso[] = []
  const NEWS_SYSTEM = extraerPrompt("app/api/research/news/route.ts", "GEMINI_SYSTEM")
  const RADAR_SYSTEM = extraerPrompt("lib/tech-radar.ts", "TECH_RADAR_SYSTEM")
  const c = await conectar()

  // ── Familia A: noticias, con fuentes REALES ya guardadas ──
  //
  // Nota honesta sobre el insumo: lo ideal sería pegarle a Parallel para tener
  // los excerpts crudos, pero PARALLEL_API_KEY no está disponible en el sandbox.
  // Se reconstruyen las "Fuente N" con noticias reales de public.company_news
  // (títulos, URLs, medios y resúmenes reales). La diferencia es que el texto ya
  // viene resumido, así que la extracción es algo MÁS FÁCIL que en producción;
  // por eso la familia B usa texto largo y crudo, que es el caso difícil.
  const empresasNoticias = await c.query(
    `SELECT co.name AS empresa,
            json_agg(json_build_object(
              'title', cn.title, 'url', cn.source_url,
              'source_name', cn.source_name, 'published_at', cn.published_at,
              'summary', cn.summary
            ) ORDER BY cn.published_at DESC) AS fuentes
       FROM public.company_news cn
       JOIN public.companies co ON co.id = cn.company_id
      WHERE cn.title IS NOT NULL AND cn.summary IS NOT NULL
      GROUP BY co.id, co.name
     HAVING count(*) >= 6
      LIMIT 2`
  )
  for (const emp of empresasNoticias.rows) {
    const fuentes = (emp.fuentes as any[]).slice(0, 10)
    const excerptText = fuentes
      .map(
        (e, i) =>
          `--- Fuente ${i + 1}: ${e.title} (${e.url}) [fecha: ${e.published_at ? String(e.published_at).slice(0, 10) : "desconocida"}] ---\n${e.source_name ?? ""}\n${e.summary ?? ""}`
      )
      .join("\n\n")
    casos.push({
      familia: "noticias",
      etiqueta: `noticias/${emp.empresa}`,
      systemPrompt: NEWS_SYSTEM,
      userPrompt: `Empresa: "${emp.empresa}"\n\nExcerpts de busqueda web:\n\n${excerptText}\n\nExtrae las noticias relevantes en JSON.`,
      maxOutputTokens: 4000,
    })
    console.log(`  caso noticias listo: ${emp.empresa} (${fuentes.length} fuentes reales)`)
  }

  // ── Familia B: radar, con texto de investigación REAL ya guardado ──
  const runs = await c.query(
    `SELECT rr.bundle, co.name, rr.raw_research
       FROM public.radar_research_runs rr
       JOIN public.companies co ON co.id = rr.company_id
      WHERE rr.status = 'completed' AND length(coalesce(rr.raw_research,'')) > 3000
      ORDER BY rr.created_at DESC LIMIT 2`
  )
  for (const r of runs.rows) {
    casos.push({
      familia: "radar",
      etiqueta: `radar/${r.name}/${r.bundle}`,
      systemPrompt: RADAR_SYSTEM,
      userPrompt: `Empresa objetivo: "${r.name}"\n\nExcerpts agrupados por bundle:\n\n--- Fuente 1 [bundle: ${r.bundle}] investigación (interna) [fecha: desconocida] ---\n${String(r.raw_research).slice(0, 12000)}\n\nExtrae los hallazgos en JSON segun el formato indicado.`,
      maxOutputTokens: 6000,
    })
    console.log(`  caso radar listo: ${r.name}/${r.bundle} (${String(r.raw_research).length} chars)`)
  }

  await c.end()
  return casos
}

interface Resultado {
  modelo: string
  caso: string
  ok: boolean
  jsonValido: boolean
  items: number
  camposObligatoriosOk: number
  ms: number
  inp: number
  out: number
  costo: number
  finishReason?: string
  reasoning?: number
  error?: string
}

/** true si el modelo NO está en la tabla de precios (el costo sale del fallback). */
function precioEsEstimado(modelo: string): boolean {
  // El fallback de usage.ts es 3/15 por millón. Se detecta comparando.
  return estimateCostUsd(modelo, 1_000_000, 0) === 3
}

async function correr(modelo: string, caso: Caso): Promise<Resultado> {
  const t0 = Date.now()
  const base: Resultado = {
    modelo,
    caso: caso.etiqueta,
    ok: false,
    jsonValido: false,
    items: 0,
    camposObligatoriosOk: 0,
    ms: 0,
    inp: 0,
    out: 0,
    costo: 0,
  }
  try {
    const { text, usage, finishReason } = await generateText({
      model: modelo,
      system: caso.systemPrompt,
      prompt: caso.userPrompt,
      temperature: 0.2,
      maxOutputTokens: caso.maxOutputTokens,
      providerOptions: { google: { responseMimeType: "application/json" } },
    })
    base.ms = Date.now() - t0
    base.inp = usage?.inputTokens ?? 0
    base.out = usage?.outputTokens ?? 0
    base.finishReason = String(finishReason ?? "?")
    // Tokens de razonamiento: si el modelo "piensa", ese pensamiento consume el
    // presupuesto de salida y puede cortar el JSON a mitad.
    base.reasoning = (usage as any)?.reasoningTokens ?? 0
    base.costo = estimateCostUsd(modelo, base.inp, base.out)
    base.ok = true
    try {
      const parsed = JSON.parse(stripFences(text))
      base.jsonValido = true
      const arr: any[] = caso.familia === "noticias" ? (parsed.news ?? []) : (parsed.findings ?? [])
      base.items = arr.length
      // Campos obligatorios REALES de cada schema (sin ellos el código descarta
      // el item). Ojo: el schema del radar no tiene `category` —tiene
      // `evidence_level`— así que pedir `category` daba 0 válidos siempre y
      // parecía un problema de los modelos cuando era de la medición.
      base.camposObligatoriosOk =
        caso.familia === "noticias"
          ? arr.filter((x) => Number.isInteger(x?.source_index) && x.source_index >= 1).length
          : arr.filter(
              (x) =>
                Number.isInteger(x?.source_index) &&
                x.source_index >= 1 &&
                typeof x?.title === "string" &&
                x.title.length > 0 &&
                ["directa", "convergente", "inferencia"].includes(x?.evidence_level)
            ).length
    } catch {
      base.jsonValido = false
    }
  } catch (err: any) {
    base.ms = Date.now() - t0
    base.error = String(err?.message ?? err).slice(0, 90)
  }
  return base
}

async function main() {
  console.log("Construyendo casos con datos reales...\n")
  const casos = await construirCasos()
  if (!casos.length) {
    console.log("Sin casos, aborto.")
    return
  }

  console.log(`\n${casos.length} casos. Probando ${CANDIDATOS.length} modelos.\n`)
  const todos: Resultado[] = []
  for (const modelo of CANDIDATOS) {
    for (const caso of casos) {
      const r = await correr(modelo, caso)
      todos.push(r)
      const estado = r.error
        ? `ERROR ${r.error}`
        : `${r.jsonValido ? "json-ok" : "JSON-INVALIDO"} items=${r.items} validos=${r.camposObligatoriosOk} fin=${r.finishReason} razon_tk=${r.reasoning} ${r.ms}ms $${r.costo.toFixed(6)}`
      console.log(`  ${modelo.padEnd(30)} ${r.caso.slice(0, 34).padEnd(35)} ${estado}`)
    }
  }

  console.log("\n\n=== RESUMEN POR MODELO ===")
  console.log("modelo                          | ok  | json | items | validos | ms_prom | costo_total")
  for (const m of CANDIDATOS) {
    const rs = todos.filter((r) => r.modelo === m)
    const ok = rs.filter((r) => r.ok).length
    const jv = rs.filter((r) => r.jsonValido).length
    const items = rs.reduce((a, r) => a + r.items, 0)
    const val = rs.reduce((a, r) => a + r.camposObligatoriosOk, 0)
    const ms = rs.filter((r) => r.ok).length
      ? Math.round(rs.filter((r) => r.ok).reduce((a, r) => a + r.ms, 0) / rs.filter((r) => r.ok).length)
      : 0
    const costo = rs.reduce((a, r) => a + r.costo, 0)
    const nota = precioEsEstimado(m) ? "  <- SIN precio en la tabla: costo NO confiable (fallback 3/15)" : ""
    console.log(
      `${m.padEnd(31)} | ${String(ok).padStart(2)}/${rs.length} | ${String(jv).padStart(4)} | ${String(items).padStart(5)} | ${String(val).padStart(7)} | ${String(ms).padStart(7)} | $${costo.toFixed(6)}${nota}`
    )
  }
  console.log("\nvalidos = items que el codigo NO descarta (con los campos obligatorios reales del schema)")
  console.log("fin=length significa que la respuesta se CORTO por maxOutputTokens -> JSON partido")
}

main().catch((e) => {
  console.error("fallo:", e)
  process.exit(1)
})
