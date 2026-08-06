/**
 * Mide la señal de país ANTES de activarla en producción.
 *
 * La pregunta que responde no es "¿atrapa las de OXXO?" -eso es fácil- sino
 * **"¿a cuántas noticias legítimas marcaría?"**. Un guardrail que atrapa la
 * basura pero se lleva noticias reales es peor que no tener guardrail, y esa
 * parte solo se puede saber midiendo contra el pool sano.
 *
 * Uso:  npx tsx scripts/measure-country-guard.mts
 */
import pg from "pg"
import { evaluarPais } from "@/lib/news-country-guard"

const url = (process.env.POSTGRES_URL_NON_POOLING || "").replace(/[?&]sslmode=[^&]*/g, "")
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await c.connect()

// ── Cobertura: la señal necesita el pais de la cuenta ──
// `country_normalized` guarda el NOMBRE del pais y esta poblada solo en una
// fraccion de las empresas, asi que el techo de aplicabilidad se mide primero.
const cob = await c.query(`
  SELECT count(*)::int total,
         count(co.country_normalized)::int con_pais
    FROM public.company_news cn
    JOIN public.companies co ON co.id = cn.company_id`)
const { total, con_pais } = cob.rows[0]
console.log(`\n${"=".repeat(72)}`)
console.log(`COBERTURA`)
console.log(`${"=".repeat(72)}`)
console.log(`  noticias totales:            ${total}`)
console.log(`  con pais de cuenta conocido: ${con_pais} (${Math.round((100 * con_pais) / total)}%)`)
console.log(`  sin pais -> la señal devuelve null y NO opina`)

// ── Medicion sobre el pool SANO ──
const sanas = await c.query(`
  SELECT cn.id, co.name empresa, co.country_normalized pais,
         cn.title, cn.summary, cn.source_url
    FROM public.company_news cn
    JOIN public.companies co ON co.id = cn.company_id
   WHERE cn.ai_provider <> 'degraded-fallback'
     AND co.country_normalized IS NOT NULL
     AND cn.title IS NOT NULL`)

let evaluadas = 0
let sospechosas = 0
const detalle: Array<{ empresa: string; pais: string; titulo: string; ev: string }> = []

for (const f of sanas.rows) {
  const s = evaluarPais({
    paisCuenta: f.pais,
    titulo: f.title,
    resumen: f.summary,
    sourceUrl: f.source_url,
  })
  if (!s) continue
  evaluadas++
  if (s.sospechosa) {
    sospechosas++
    detalle.push({
      empresa: f.empresa,
      pais: s.paisCuenta,
      titulo: String(f.title).slice(0, 62),
      ev: s.evidencia.join(" "),
    })
  }
}

console.log(`\n${"=".repeat(72)}`)
console.log(`FALSOS POSITIVOS SOBRE EL POOL SANO`)
console.log(`${"=".repeat(72)}`)
console.log(`  noticias sanas evaluables: ${evaluadas}`)
console.log(`  marcadas sospechosas:      ${sospechosas} (${evaluadas ? ((100 * sospechosas) / evaluadas).toFixed(1) : 0}%)`)
console.log(`\n  Estas son noticias que hoy se publican y la señal cuestionaria.`)
console.log(`  Hay que leerlas: si son legitimas, son el costo de activar el filtro.\n`)
for (const d of detalle.slice(0, 25)) {
  console.log(`  [${d.empresa} / ${d.pais}] ${d.titulo}`)
  console.log(`     ${d.ev}`)
}
if (detalle.length > 25) console.log(`  ... y ${detalle.length - 25} mas`)

// ── Verificacion positiva: las 4 de OXXO que motivaron todo esto ──
const oxxo = await c.query(`
  SELECT cn.id, co.name empresa, co.country_normalized pais,
         cn.title, cn.summary, cn.source_url
    FROM public.company_news cn
    JOIN public.companies co ON co.id = cn.company_id
   WHERE cn.id = ANY($1::uuid[])`,
  [[
    "b47a2293-19fa-4962-8bbd-03ceae9fc493", // PDF consolidado FEMSA
    "c119f113-d509-409d-98b6-2fb2f49a2c2b", // Spin by OXXO Mexico
    "9655d566-6516-4b49-acc5-a344c0cf9446", // Visa Mexico
    "91125eea-b9bd-49d6-867e-16b749f81110", // Arequipa, Peru
  ]]
)

console.log(`\n${"=".repeat(72)}`)
console.log(`VERIFICACION POSITIVA: las 4 de OXXO Chile`)
console.log(`${"=".repeat(72)}`)
let atrapadas = 0
for (const f of oxxo.rows) {
  const s = evaluarPais({ paisCuenta: f.pais, titulo: f.title, resumen: f.summary, sourceUrl: f.source_url })
  if (!s) {
    console.log(`  SIN-SEÑAL  pais de cuenta = ${f.pais ?? "null"}  | ${String(f.title).slice(0, 48)}`)
    continue
  }
  if (s.sospechosa) atrapadas++
  console.log(`  ${s.sospechosa ? "ATRAPADA" : "PASA    "}  ${String(f.title).slice(0, 52)}`)
  console.log(`     cuenta=${s.paisCuenta} evidencia=[${s.evidencia.join(" ")}]`)
}
console.log(`\n  atrapadas: ${atrapadas}/${oxxo.rows.length}`)

console.log(`\n${"=".repeat(72)}`)
console.log(`VEREDICTO`)
console.log(`${"=".repeat(72)}`)
const tasaFP = evaluadas ? (100 * sospechosas) / evaluadas : 0
console.log(`  atrapa ${atrapadas}/4 de las conocidas malas`)
console.log(`  cuestiona ${sospechosas}/${evaluadas} sanas (${tasaFP.toFixed(1)}%)`)
console.log(
  tasaFP > 10
    ? `  -> tasa ALTA: usar solo como señal loguable, NO filtrar`
    : `  -> tasa baja: candidata a filtrar, pero revisar el detalle de arriba primero`
)

await c.end()
