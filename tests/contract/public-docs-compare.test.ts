import { describe, it, expect } from "vitest"
import { collect } from "@/lib/research/engine"
import { buildPublicDocsPrompt } from "@/lib/public-docs-prompt"

/**
 * Validacion de la busqueda de documentos publicos de /api/research/public-docs.
 *
 * Ejercita el MISMO camino productivo (buildPublicDocsPrompt -> collect) contra
 * una empresa publica LATAM real y verifica que devuelve documentos oficiales
 * (memorias / ESG / earnings) y no prensa ni case studies de vendors.
 *
 * ── Que cambio (21-ago-2026) ──
 * Antes esto probaba `searchPublicDocsViaGateway` -> `gateway.tools.parallelSearch`,
 * la ultima llamada viva a Parallel. Con Parallel retirado, el anti-contaminacion
 * dejo de ser un `sourcePolicy` pineado por config y paso a ser instrucciones del
 * prompt, asi que este test es justamente donde se ve si esa traduccion aguanta:
 * si empiezan a colarse reuters/bloomberg, el sospechoso es el prompt.
 *
 * Gated por RUN_PUBLIC_DOCS_COMPARE=1 (hace llamadas de red reales + gasta tokens).
 */
const RUN = process.env.RUN_PUBLIC_DOCS_COMPARE === "1"

// Empresa publica LATAM con memorias/ESG en ES+EN (ejercita el path bilingue).
const COMPANY = { companyName: "Arcos Dorados", ticker: "ARCO", country: "Argentina" }

/** Dominios que pertenecen a OTRAS pestañas: prensa y vendors. */
const CONTAMINACION = /reuters\.com|bloomberg\.com|cnbc\.com|forbes\.com|wsj\.com|ft\.com|aws\.amazon\.com|salesforce\.com|sap\.com|accenture\.com|deloitte\.com/i

describe.skipIf(!RUN)("public-docs via collect", () => {
  it("descubre documentos oficiales sin contaminarse con prensa ni vendors", async () => {
    const collected = await collect({
      prompt: buildPublicDocsPrompt({
        ...COMPANY,
        isPublic: true,
        sources: ["annual", "earnings", "sustainability", "financial"],
      }),
      companyName: COMPANY.companyName,
      maxSearches: 6,
      context: "public-docs-test",
    })

    const hosts = new Map<string, number>()
    for (const s of collected.sources) {
      try {
        const h = new URL(s.url).hostname.replace(/^www\./, "")
        hosts.set(h, (hosts.get(h) ?? 0) + 1)
      } catch {
        /* una URL rara no invalida la corrida */
      }
    }
    console.log(`\n[public-docs] ${collected.sources.length} fuentes citadas en ${collected.searchCount} busquedas`)
    console.log(
      "[public-docs] hosts:",
      [...hosts.entries()].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h}(${n})`).join(", "),
    )
    for (const s of collected.sources.slice(0, 12)) {
      console.log(`  - ${(s.title ?? "(sin titulo)").slice(0, 70)} | ${s.url}`)
    }

    const officialRe = /annual|memoria|informe|sustain|sostenib|esg|investor|relations|earnings/i
    const oficiales = collected.sources.filter(
      (s) => officialRe.test(s.title ?? "") || officialRe.test(s.url),
    ).length
    const contaminados = collected.sources.filter((s) => CONTAMINACION.test(s.url))
    console.log(`\n[public-docs][RESULTADO] ${collected.sources.length} docs (${oficiales} oficiales, ${contaminados.length} contaminados)`)

    expect(collected.sources.length).toBeGreaterThan(0)
    // El prompt tiene que sostener el anti-contaminacion que antes era config.
    expect(contaminados.map((s) => s.url)).toEqual([])
  }, 180_000)
})
