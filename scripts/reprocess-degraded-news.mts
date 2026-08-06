/**
 * Reproceso de las noticias que quedaron en modo degradado.
 *
 * ── Contexto ──
 * Entre el 3-jun-2026 y el 3-ago-2026 el default de `structureWithLLM` apuntaba
 * a `google/gemini-2.0-flash`, un modelo RETIRADO del AI Gateway. Cada llamada
 * daba `model_not_found`, el endpoint caia a `buildDegradedNewsItems()` y
 * publicaba los excerpts CRUDOS de Parallel: titulos con el nombre del sitio
 * pegado, resumenes que arrancan en markdown y hasta avisos de empleo colados
 * como noticias. Esas filas quedaron marcadas con `ai_provider =
 * 'degraded-fallback'`, que es lo que permite encontrarlas ahora.
 *
 * ── Que hace ──
 * Reprocesa esas filas con el prompt EXACTO de produccion (se importa
 * `GEMINI_SYSTEM` de `lib/news-prompt.ts`, no se copia, para que no derive) y
 * compara el antes/despues. Dos veredictos por fila:
 *   - LIMPIAR: el modelo la reconocio como noticia real -> nuevo titulo,
 *     resumen y categoria.
 *   - DESCARTAR: el modelo NO la devolvio, o no pasa el guardrail de mencion
 *     explicita de la empresa. Son los avisos de empleo y el ruido de scraping.
 *
 * ── Seguridad ──
 * Escribe en `public.company_news`, que es v2 PRODUCTIVO. Por eso:
 *   - DRY RUN por defecto: sin `--commit` no toca nada, solo muestra el diff.
 *   - Los DELETE piden ADEMAS `--delete-irrelevant`. Borrar es mas destructivo
 *     que corregir, asi que no viaja escondido en el mismo flag.
 *   - Se verifico que `direction` y `verified_at` son NULL en las 47 filas, o
 *     sea NO hay curaduria humana que se pierda al reescribirlas. El script lo
 *     re-chequea en caliente y aborta si aparece alguna curada.
 *
 * ── Limitacion honesta del insumo ──
 * `buildDegradedNewsItems` guardo el excerpt cortado a 240 caracteres
 * (`.slice(0, 240)`), mientras que el endpoint original le pasaba al modelo
 * hasta 4000 por fuente. Reprocesando desde la base tenemos ~6% del texto
 * original. Alcanza de sobra para lo que mas duele —detectar que NO es noticia,
 * limpiar el titulo y asignar categoria— pero los resumenes nuevos van a ser
 * mas pobres que si se re-consultara Parallel. Un refetch completo es la opcion
 * de mayor calidad y se deja anotada abajo; no se hace por defecto porque
 * cuesta llamadas a Parallel y reescribe tambien las URLs.
 *
 * ── Uso ──
 *   node --experimental-strip-types scripts/reprocess-degraded-news.mts
 *   ... --commit                          # persiste las correcciones
 *   ... --commit --delete-irrelevant      # ademas borra las que no son noticia
 *   ... --limit 5                         # probar con pocas empresas primero
 */

import pg from "pg"
import { structureWithLLM, filterRelevantToCompany, STRUCTURER_DEFAULT_MODEL } from "@/lib/ai-structurer"
import { GEMINI_SYSTEM } from "@/lib/news-prompt"

const args = process.argv.slice(2)
const commit = args.includes("--commit")
const limitIdx = args.indexOf("--limit")
const limitEmpresas = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity

// Borrado SOLO por ids explicitos, nunca por heuristica.
//
// La primera version tenia un `--delete-irrelevant` que borraba todo lo que el
// modelo no devolvia. Probandolo se vio que no se puede automatizar: entre los
// descartes hay basura obvia (una homepage, un PDF ilegible) junto a noticias
// legitimas que el modelo omitio por exigir la razon social literal (los
// resultados anuales de "Antofagasta PLC" cuando la cuenta es "Grupo Antofagasta
// Minerals"). Y la heuristica inversa —"el titulo nombra la empresa"— tambien
// falla: marca como valida una nota de Dynabook porque comparte la palabra
// "recuerdo" con la cuenta "Parque del Recuerdo".
// Con 9 filas en juego, revisarlas a ojo es mas barato y mas seguro que seguir
// afinando un clasificador.
const deleteIdsIdx = args.indexOf("--delete-ids")
const idsABorrar = deleteIdsIdx >= 0 ? String(args[deleteIdsIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : []

const MARCA = "degraded-fallback"

interface FilaDegradada {
  id: string
  company_id: string
  empresa: string
  title: string | null
  summary: string | null
  source_url: string
  source_name: string | null
  published_at: string | null
  category: string | null
}

function cliente() {
  const url = (process.env.POSTGRES_URL_NON_POOLING || "").replace(/[?&]sslmode=[^&]*/g, "")
  if (!url) throw new Error("Falta POSTGRES_URL_NON_POOLING")
  return new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
}

function recorta(s: string | null | undefined, n: number) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n) + "…" : t
}

async function main() {
  const c = cliente()
  await c.connect()

  console.log(`[v0] Modo: ${commit ? "COMMIT (escribe en v2 productivo)" : "DRY RUN (no escribe nada)"}`)
  console.log(`[v0] Borrado de irrelevantes: ${deleteIrrelevant ? "SI" : "no (solo se reportan)"}`)
  console.log(`[v0] Modelo: ${STRUCTURER_DEFAULT_MODEL}\n`)

  // Guardia: si alguna fila degradada fue curada a mano, no la pisamos.
  const curadas = await c.query(
    `SELECT count(*)::int n FROM public.company_news
      WHERE ai_provider = $1 AND (direction IS NOT NULL OR verified_at IS NOT NULL)`,
    [MARCA]
  )
  if (curadas.rows[0].n > 0) {
    console.error(
      `[v0] ABORTA: ${curadas.rows[0].n} fila(s) degradada(s) tienen direction/verified_at seteados ` +
        `(curaduria humana). Reprocesarlas perderia ese trabajo. Revisar a mano antes de seguir.`
    )
    await c.end()
    process.exit(1)
  }

  const { rows } = await c.query<FilaDegradada>(
    `SELECT cn.id, cn.company_id, co.name AS empresa, cn.title, cn.summary,
            cn.source_url, cn.source_name, cn.published_at::text, cn.category
       FROM public.company_news cn
       JOIN public.companies co ON co.id = cn.company_id
      WHERE cn.ai_provider = $1
      ORDER BY co.name, cn.published_at DESC NULLS LAST`,
    [MARCA]
  )

  if (rows.length === 0) {
    console.log("[v0] No hay filas degradadas. Nada que hacer.")
    await c.end()
    return
  }

  // Agrupar por empresa: el prompt de produccion trabaja por empresa, con todas
  // sus fuentes juntas, porque asi puede generar tambien el digest del lote.
  const porEmpresa = new Map<string, FilaDegradada[]>()
  for (const f of rows) {
    const k = `${f.company_id}::${f.empresa}`
    if (!porEmpresa.has(k)) porEmpresa.set(k, [])
    porEmpresa.get(k)!.push(f)
  }

  console.log(`[v0] ${rows.length} filas degradadas en ${porEmpresa.size} empresas\n`)

  const aActualizar: Array<{ fila: FilaDegradada; nuevo: any }> = []
  const aDescartar: Array<{ fila: FilaDegradada; motivo: string; revisarAMano: boolean }> = []
  const digestPorEmpresa = new Map<string, string | null>()
  let empresasProcesadas = 0

  for (const [clave, filas] of porEmpresa) {
    if (empresasProcesadas >= limitEmpresas) break
    empresasProcesadas++
    const empresa = clave.split("::")[1]

    // Se reconstruyen los bloques "Fuente N" con la misma forma que el endpoint,
    // para que `source_index` signifique lo mismo. El indice (1-based) mapea
    // deterministicamente a `filas[i]`, asi sabemos que fila corregir.
    const excerptText = filas
      .map(
        (f, i) =>
          `--- Fuente ${i + 1}: ${f.title ?? ""} (${f.source_url}) [fecha: ${f.published_at ?? "desconocida"}] ---\n` +
          `${f.source_name ?? ""}\n${f.summary ?? ""}`
      )
      .join("\n\n")

    const userPrompt = `Empresa: "${empresa}"\n\nExcerpts de busqueda web:\n\n${excerptText}\n\nExtrae las noticias relevantes en JSON.`

    process.stdout.write(`[v0] ${empresa} (${filas.length} filas)... `)

    let devueltas: any[] = []
    let digest: string | null = null
    try {
      const parsed = await structureWithLLM<{ news?: any[]; digest?: string | null }>({
        systemPrompt: GEMINI_SYSTEM,
        userPrompt,
        maxOutputTokens: 4000,
        temperature: 0.2,
        context: "news",
      })
      devueltas = parsed.news ?? []
      digest = parsed.digest ?? null
    } catch (err: any) {
      console.log(`ERROR: ${err.message.slice(0, 80)}`)
      // Si el modelo falla, NO se toca ninguna fila de esta empresa: quedan
      // degradadas, que es exactamente el estado actual. Nunca empeorar.
      continue
    }

    // Se registra que devolvio el modelo ANTES del guardrail, para poder
    // distinguir las dos causas de descarte. No es un detalle cosmetico: si el
    // modelo omitio la fila, es basura de verdad; si la corto el guardrail de
    // nombre, puede ser un FALSO NEGATIVO por variante de razon social
    // (ej. "Antofagasta PLC" vs la cuenta "Grupo Antofagasta Minerals", o una
    // filial con nombre propio). Borrar esas seria perder noticias legitimas.
    const indicesDelModelo = new Set<number>()
    for (const item of devueltas) {
      const idx = Number(item.source_index)
      if (Number.isFinite(idx) && idx >= 1 && idx <= filas.length) indicesDelModelo.add(idx - 1)
    }

    // Mismo guardrail que produccion: descartar lo que no menciona la empresa.
    devueltas = filterRelevantToCompany(devueltas, empresa, ["title", "summary"])

    // Mapeo source_index -> fila original.
    const indicesDevueltos = new Set<number>()
    for (const item of devueltas) {
      const idx = Number(item.source_index)
      if (!Number.isFinite(idx) || idx < 1 || idx > filas.length) continue
      indicesDevueltos.add(idx - 1)
      aActualizar.push({ fila: filas[idx - 1], nuevo: item })
    }

    filas.forEach((f, i) => {
      if (indicesDevueltos.has(i)) return
      const soloGuardrail = indicesDelModelo.has(i)
      // Heuristica de falso descarte: si el titulo comparte un token distintivo
      // con el nombre de la cuenta, la fila probablemente SI habla de la empresa
      // y el modelo la omitio por la regla D del prompt (exige la razon social
      // literal). Caso real detectado: la cuenta es "Grupo Antofagasta Minerals"
      // y el titulo "2025 Full Year Results | Antofagasta PLC" -> son resultados
      // anuales legitimos de la matriz, no basura.
      const tokensEmpresa = empresa
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 5 && !["grupo", "banco", "empresas", "bodega", "parque"].includes(t))
      const textoFila = `${f.title ?? ""} ${f.summary ?? ""}`.toLowerCase()
      const compartaNombre = tokensEmpresa.some((t) => textoFila.includes(t))

      aDescartar.push({
        fila: f,
        motivo: soloGuardrail
          ? "cortada por el guardrail de nombre"
          : compartaNombre
            ? "el modelo la omitio PERO el titulo nombra la empresa"
            : "el modelo la omitio",
        revisarAMano: soloGuardrail || compartaNombre,
      })
    })

    digestPorEmpresa.set(clave, digest)
    console.log(`${indicesDevueltos.size} a limpiar, ${filas.length - indicesDevueltos.size} a descartar`)
  }

  // ── Reporte del diff ──
  console.log(`\n${"=".repeat(78)}\nCORRECCIONES (${aActualizar.length})\n${"=".repeat(78)}`)
  for (const { fila, nuevo } of aActualizar.slice(0, 12)) {
    console.log(`\n[${fila.empresa}]`)
    console.log(`  titulo  ANTES: ${recorta(fila.title, 88)}`)
    console.log(`          AHORA: ${recorta(nuevo.title, 88)}`)
    console.log(`  resumen ANTES: ${recorta(fila.summary, 88)}`)
    console.log(`          AHORA: ${recorta(nuevo.summary, 88)}`)
    console.log(`  categoria: ${fila.category ?? "null"} -> ${nuevo.category ?? "null"}`)
  }
  if (aActualizar.length > 12) console.log(`\n  ... y ${aActualizar.length - 12} mas`)

  console.log(`\n${"=".repeat(78)}\nNO RECONOCIDAS COMO NOTICIA (${aDescartar.length}) — decision humana\n${"=".repeat(78)}`)
  console.log(`  El modelo no las devolvio. Revisar a ojo: hay basura obvia (homepages, PDFs`)
  console.log(`  ilegibles) mezclada con noticia legitima que se cayo por variante de razon social.`)
  console.log(`  Para borrar las que decidas:  --commit --delete-ids <id>,<id>\n`)
  for (const { fila, motivo } of aDescartar) {
    console.log(`  ${fila.id}`)
    console.log(`    [${fila.empresa}] "${recorta(fila.title, 62)}"`)
    console.log(`    ${motivo}`)
    console.log(`    ${fila.source_url}`)
  }

  // ── Escritura ──
  if (!commit) {
    console.log(`\n[v0] DRY RUN: nada se escribio.`)
    console.log(`[v0] Para aplicar las ${aActualizar.length} correcciones:  --commit`)
    console.log(`[v0] Para borrar ademas los ${borrables.length} descartes seguros: --commit --delete-irrelevant`)
    if (dudosas.length > 0) {
      console.log(`[v0] Las ${dudosas.length} de "revisar a mano" NUNCA se borran automaticamente.`)
    }
    await c.end()
    return
  }

  await c.query("BEGIN")
  try {
    let actualizadas = 0
    const digestUsado = new Set<string>()

    for (const { fila, nuevo } of aActualizar) {
      const clave = `${fila.company_id}::${fila.empresa}`
      // El digest se guarda en UNA sola fila del lote, igual que el endpoint.
      const digest = !digestUsado.has(clave) ? (digestPorEmpresa.get(clave) ?? null) : null
      if (digest) digestUsado.add(clave)

      await c.query(
        `UPDATE public.company_news
            SET title = $1, summary = $2, category = $3,
                ai_provider = $4,
                digest = COALESCE($5, digest),
                digest_generated_at = CASE WHEN $5 IS NOT NULL THEN now() ELSE digest_generated_at END
          WHERE id = $6`,
        [nuevo.title, nuevo.summary, nuevo.category, STRUCTURER_DEFAULT_MODEL, digest, fila.id]
      )
      actualizadas++
    }

    let borradas = 0
    if (idsABorrar.length > 0) {
      // Guardia: solo se permite borrar filas que esten efectivamente marcadas
      // como degradadas, para que un id mal pegado no elimine una noticia sana.
      const validos = await c.query(
        `SELECT id FROM public.company_news WHERE id = ANY($1::uuid[]) AND ai_provider = $2`,
        [idsABorrar, MARCA]
      )
      const ids = validos.rows.map((r) => r.id)
      const rechazados = idsABorrar.length - ids.length
      if (rechazados > 0) {
        console.log(`[v0] ${rechazados} id(s) ignorado(s): no existen o no son filas degradadas.`)
      }
      if (ids.length > 0) {
        // Primero las referencias, si no la FK lo impide.
        await c.query(`DELETE FROM public.user_news_interactions WHERE news_id = ANY($1::uuid[])`, [ids])
        const r = await c.query(`DELETE FROM public.company_news WHERE id = ANY($1::uuid[])`, [ids])
        borradas = r.rowCount ?? 0
      }
    }

    await c.query("COMMIT")
    console.log(`\n[v0] COMMIT: ${actualizadas} corregidas, ${borradas} borradas.`)
    if (!deleteIrrelevant && borrables.length > 0) {
      console.log(`[v0] Los ${borrables.length} descartes siguen en la base (falta --delete-irrelevant).`)
    }
    if (dudosas.length > 0) {
      console.log(`[v0] Las ${dudosas.length} de "revisar a mano" quedaron intactas, por diseño.`)
    }
  } catch (err) {
    await c.query("ROLLBACK")
    console.error("[v0] ROLLBACK por error:", err)
    process.exitCode = 1
  }

  await c.end()
}

main().catch((e) => {
  console.error("[v0] Fallo:", e)
  process.exit(1)
})
