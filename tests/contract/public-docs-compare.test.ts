import { describe, it, expect } from "vitest"
import { parallelSearch, buildPublicDocsSearchParams, searchPublicDocsViaGateway } from "@/lib/parallel"

/**
 * Harness comparativo para la PARTE B: enrutar la busqueda de documentos publicos
 * por el AI Gateway (gateway.tools.parallelSearch) en vez de la llamada directa a
 * parallel-web.
 *
 * Compara, para una empresa publica real, la CALIDAD de descubrimiento de URLs:
 *   A) baseline: parallelSearch(buildPublicDocsSearchParams(...)) — queries afinadas
 *   B) gateway:  generateText(model, tools:{parallelSearch}) — el modelo arma queries
 *
 * El anti-contaminacion (dominios + fecha) se pinea igual en ambos via sourcePolicy.
 * Lo que NO se puede pinear en B son objective/search_queries (los arma el modelo),
 * asi que este test mide si eso degrada el resultado.
 *
 * Gated por RUN_PUBLIC_DOCS_COMPARE=1 (hace llamadas de red reales + gasta tokens).
 */
const RUN = process.env.RUN_PUBLIC_DOCS_COMPARE === "1"

// Empresa publica LATAM con memorias/ESG en ES+EN (ejercita el path bilingue).
const COMPANY = { company_name: "Arcos Dorados", ticker: "ARCO", country: "Argentina" }

type Row = { url: string; title: string; date: string | null }

function summarize(label: string, rows: Row[]) {
  const hosts = new Map<string, number>()
  for (const r of rows) {
    try {
      const h = new URL(r.url).hostname.replace(/^www\./, "")
      hosts.set(h, (hosts.get(h) ?? 0) + 1)
    } catch {}
  }
  console.log(`\n[compare][${label}] ${rows.length} resultados`)
  console.log(
    `[compare][${label}] hosts:`,
    [...hosts.entries()].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h}(${n})`).join(", "),
  )
  for (const r of rows.slice(0, 12)) {
    console.log(`  - ${r.date ?? "----------"} | ${r.title.slice(0, 70)} | ${r.url}`)
  }
}

describe.skipIf(!RUN)("public-docs: baseline vs gateway", () => {
  it("compara calidad de descubrimiento de documentos", async () => {
    const params = buildPublicDocsSearchParams({
      ...COMPANY,
      is_public: true,
      sources: ["annual", "earnings", "sustainability", "financial"],
    })

    // ── A) BASELINE: llamada directa a parallel-web ──────────────────────
    // Requiere PARALLEL_API_KEY real (NO inyectada en este sandbox: vive solo en
    // prod). Si falta, se omite y se valida solo el lado Gateway — que es
    // justamente lo que hace atractiva la migracion: NO necesita esa key en la app.
    const hasRealParallel = !!process.env.PARALLEL_API_KEY && process.env.PARALLEL_API_KEY !== "dummy"
    let baseRows: Row[] = []
    if (hasRealParallel) {
      const baseRes = await parallelSearch(params)
      baseRows = baseRes.results.map((r) => ({ url: r.url, title: r.title, date: r.publish_date }))
      summarize("baseline", baseRows)
    } else {
      console.log("\n[compare][baseline] OMITIDO: PARALLEL_API_KEY no disponible en el sandbox")
    }

    // ── B) GATEWAY: el helper productivo real (searchPublicDocsViaGateway) ─
    // Prueba el MISMO codigo que correra en la ruta, no una reimplementacion.
    const gwRes = await searchPublicDocsViaGateway(params, { companyId: null, userId: null })
    const gwRows: Row[] = gwRes.results.map((r) => ({ url: r.url, title: r.title, date: r.publish_date }))
    const gwSearches = gwRows.length > 0 ? 1 : 0
    summarize("gateway", gwRows)

    // ── Metrica: cobertura de documentos "oficiales" (IR/memoria/ESG) ────
    const officialRe = /annual|memoria|informe|sustain|sostenib|esg|investor|relations|earnings/i
    const baseOfficial = baseRows.filter((r) => officialRe.test(r.title) || officialRe.test(r.url)).length
    const gwOfficial = gwRows.filter((r) => officialRe.test(r.title) || officialRe.test(r.url)).length

    console.log(`\n[compare][RESULTADO] baseline: ${baseRows.length} docs (${baseOfficial} oficiales) | gateway: ${gwRows.length} docs (${gwOfficial} oficiales), ${gwSearches} tool-calls`)

    // El lado que importa validar aca (sin PARALLEL_API_KEY) es que el Gateway
    // devuelve documentos reales via la tool provider-executed. La comparacion
    // cualitativa baseline-vs-gateway la evaluo leyendo la salida.
    expect(gwRows.length).toBeGreaterThan(0)
  }, 180_000)
})
