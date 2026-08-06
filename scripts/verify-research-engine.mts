/**
 * Verificacion del motor unificado de research (`lib/research/engine.ts`).
 *
 * El caso 2 es el que importa: REPRODUCE el modo de falla que estuvo 2 meses
 * oculto (salida truncada por limite de tokens) y prueba que ahora LANZA en vez
 * de degradarse en silencio. Si algun dia alguien vuelve a poner un
 * `maxOutputTokens` chico "para ahorrar", este caso lo detecta.
 *
 * Uso:
 *   npx tsx scripts/verify-research-engine.mts
 *   npx tsx scripts/verify-research-engine.mts --skip-collect   # sin gastar en busqueda
 */

import { z } from "zod"

import { STRUCTURER_MODEL, RESEARCH_MODEL } from "@/lib/ai-models"
import { collect, structure, verify } from "@/lib/research/engine"

const skipCollect = process.argv.includes("--skip-collect")

const EMPRESA = "Banco Galicia"
const PAIS = "AR"

const NoticiasSchema = z.object({
  news: z
    .array(
      z.object({
        title: z.string(),
        summary: z.string(),
        source_url: z.string(),
        category: z.string(),
      })
    )
    .max(15),
  digest: z.string().nullable(),
})

let fallos = 0
const ok = (m: string) => console.log(`  OK   ${m}`)
const fail = (m: string) => {
  fallos++
  console.log(`  FALLA ${m}`)
}

console.log(`[v0] Verificando motor de research`)
console.log(`[v0] collect=${RESEARCH_MODEL}  structure=${STRUCTURER_MODEL}\n`)

// ── Caso 1: estructurar texto real a objeto validado ──────────────────────
console.log(`── Caso 1: structure() con schema Zod ──`)
const textoDePrueba = `
Banco Galicia anuncio una inversion de USD 100 millones en su plataforma digital
para 2026, con foco en migrar su core bancario a la nube. Fuente: Infobae,
https://www.infobae.com/economia/. El banco tambien nombro a un nuevo CTO,
segun La Nacion (https://www.lanacion.com.ar/economia/). Ademas, Mercado Libre
lanzo un producto de credito, pero eso no involucra a Galicia.
`

try {
  const res = await structure({
    schema: NoticiasSchema,
    systemPrompt:
      `Extrae noticias sobre "${EMPRESA}" del texto. Responde solo con los campos del schema. ` +
      `La empresa debe ser el SUJETO de la noticia; si solo se menciona al pasar, excluila. ` +
      `El title y el summary deben nombrar a la empresa. Usa las URLs que aparecen en el texto.`,
    userPrompt: textoDePrueba,
    context: "verify-caso1",
  })
  ok(`devolvio objeto validado: ${res.news.length} noticias, digest=${res.digest ? "si" : "no"}`)
  if (res.news.length === 0) fail(`no extrajo ninguna noticia de un texto que tiene 2`)
  for (const n of res.news) console.log(`       - [${n.category}] ${n.title.slice(0, 60)}`)
} catch (err) {
  fail(`structure() lanzo: ${String((err as Error).message).slice(0, 160)}`)
}

// ── Caso 2 (EL IMPORTANTE): la salida truncada LANZA ─────────────────────
console.log(`\n── Caso 2: salida truncada -> debe LANZAR, no degradarse ──`)
console.log(`   (maxOutputTokens: 40 fuerza el corte a mitad de JSON)`)
try {
  await structure({
    schema: NoticiasSchema,
    systemPrompt: `Extrae TODAS las noticias sobre "${EMPRESA}" con resumenes largos y detallados.`,
    userPrompt: textoDePrueba.repeat(3),
    maxOutputTokens: 40,
    context: "verify-caso2",
  })
  fail(`NO lanzo con salida truncada: la clase de bug sigue viva`)
} catch (err) {
  const msg = String((err as Error).message)
  ok(`lanzo como se espera`)
  if (msg.includes("CORTO por limite de tokens")) {
    ok(`el mensaje explica la causa y como arreglarla`)
  } else {
    console.log(`  NOTA  lanzo pero por otro motivo: ${msg.slice(0, 140)}`)
  }
}

// ── Caso 3: verify() descarta lo irrelevante ─────────────────────────────
console.log(`\n── Caso 3: verify() filtra por relevancia ──`)
const items = [
  { title: `${EMPRESA} invierte en la nube`, summary: "…", source_url: "https://www.infobae.com/" },
  { title: "Mercado Libre lanza credito", summary: "sin relacion", source_url: "https://www.lanacion.com.ar/" },
  { title: "Noticia con URL muerta", summary: `${EMPRESA} algo`, source_url: "https://dominio-que-no-existe-jamas-12345.com/x" },
]
const res3 = await verify({
  items,
  companyName: EMPRESA,
  textFields: ["title", "summary"],
  urlField: "source_url",
  context: "verify-caso3",
})
if (res3.descartadosPorRelevancia === 1) ok(`descarto 1 item irrelevante (Mercado Libre)`)
else fail(`esperaba 1 descarte por relevancia, hubo ${res3.descartadosPorRelevancia}`)
if (res3.descartadosPorUrl === 1) ok(`descarto 1 item con dominio inexistente`)
else fail(`esperaba 1 descarte por URL muerta, hubo ${res3.descartadosPorUrl}`)

// ── Caso 4: collect() trae fuentes citadas de verdad ─────────────────────
if (skipCollect) {
  console.log(`\n── Caso 4: collect() SALTEADO (--skip-collect) ──`)
} else {
  console.log(`\n── Caso 4: collect() con busqueda web real ──`)
  try {
    const c = await collect({
      prompt:
        `Busca noticias recientes (ultimos 6 meses) sobre la empresa "${EMPRESA}" de Argentina: ` +
        `inversiones, tecnologia, ejecutivos, expansion. Resume lo que encuentres citando las fuentes.`,
      companyName: EMPRESA,
      countryISO: PAIS,
      maxSearches: 3,
      context: "verify-caso4",
    })
    if (c.searchCount > 0) ok(`ejecuto ${c.searchCount} busquedas web`)
    else fail(`no ejecuto ninguna busqueda web`)
    if (c.sources.length > 0) ok(`trajo ${c.sources.length} fuentes CITADAS`)
    else fail(`no trajo fuentes citadas`)
    if (c.text.length > 200) ok(`trajo ${c.text.length} chars de texto`)
    else fail(`texto sospechosamente corto: ${c.text.length} chars`)
    for (const s of c.sources.slice(0, 5)) console.log(`       - ${s.url.slice(0, 72)}`)

    // Encadenar collect -> structure prueba el circuito completo.
    const est = await structure({
      schema: NoticiasSchema,
      systemPrompt:
        `Extrae noticias sobre "${EMPRESA}". La empresa debe ser el sujeto principal. ` +
        `Usa SOLO estas URLs: ${c.sources.map((s) => s.url).join(", ")}`,
      userPrompt: c.text,
      context: "verify-caso4-est",
    })
    ok(`circuito completo: ${est.news.length} noticias estructuradas desde busqueda real`)
  } catch (err) {
    fail(`collect() lanzo: ${String((err as Error).message).slice(0, 200)}`)
  }
}

console.log(`\n${"=".repeat(70)}`)
console.log(fallos === 0 ? `[v0] TODO OK` : `[v0] ${fallos} FALLA(S)`)
console.log(`${"=".repeat(70)}`)
process.exit(fallos === 0 ? 0 : 1)
