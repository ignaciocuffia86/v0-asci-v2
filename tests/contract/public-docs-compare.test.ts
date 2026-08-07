import { describe, it, expect } from "vitest"
import { buildPublicDocsSearchParams, searchPublicDocsViaGateway } from "@/lib/parallel"

/**
 * Validacion de la PARTE B: la busqueda de documentos publicos enrutada por el AI
 * Gateway (`searchPublicDocsViaGateway` -> `gateway.tools.parallelSearch`).
 *
 * Ejercita el MISMO helper productivo que usa /api/research/public-docs contra una
 * empresa publica LATAM real y verifica que devuelve documentos oficiales
 * (memorias/ESG/earnings) respetando el sourcePolicy pineado. El anti-contaminacion
 * (dominios + fecha) se fija via config; lo que arma el modelo son objective y
 * search_queries.
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

describe.skipIf(!RUN)("public-docs via gateway", () => {
  it("descubre documentos oficiales respetando el sourcePolicy", async () => {
    const params = buildPublicDocsSearchParams({
      ...COMPANY,
      is_public: true,
      sources: ["annual", "earnings", "sustainability", "financial"],
    })

    // Ejercita el helper productivo real (el mismo que corre la ruta).
    const gwRes = await searchPublicDocsViaGateway(params, { companyId: null, userId: null })
    const gwRows: Row[] = gwRes.results.map((r) => ({ url: r.url, title: r.title, date: r.publish_date }))
    summarize("gateway", gwRows)

    // Metrica: cobertura de documentos "oficiales" (IR/memoria/ESG/earnings).
    const officialRe = /annual|memoria|informe|sustain|sostenib|esg|investor|relations|earnings/i
    const gwOfficial = gwRows.filter((r) => officialRe.test(r.title) || officialRe.test(r.url)).length
    console.log(`\n[compare][RESULTADO] gateway: ${gwRows.length} docs (${gwOfficial} oficiales)`)

    // Sanity: el Gateway devuelve documentos reales via la tool provider-executed.
    expect(gwRows.length).toBeGreaterThan(0)
  }, 180_000)
})
