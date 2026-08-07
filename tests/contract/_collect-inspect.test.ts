import { describe, it } from "vitest"

const RUN = process.env.RUN_TECH_RADAR_CONTRACT_TESTS === "1"
const runIf = RUN ? describe : describe.skip

runIf("inspect collect output", () => {
  it("imprime text + sources de un bundle", async () => {
    const { collect } = await import("@/lib/research/engine")
    const res = await collect({
      prompt:
        'Investiga la empresa "Empresas La Polar S.A." (Chile) y su stack tecnologico en estas areas: ' +
        "plataformas cloud, datos/analitica, ERP, e-commerce. Busca EVIDENCIA TECNICA concreta: vendors/productos " +
        "especificos, implementaciones, migraciones, contratos, licitaciones. Para CADA hallazgo cita la fuente y la fecha.",
      companyName: "Empresas La Polar S.A.",
      countryISO: null,
      maxSearches: 5,
      context: "inspect",
    })
    console.log("\n===== TEXT (", res.text.length, "chars) =====\n")
    console.log(res.text)
    console.log("\n===== SOURCES (", res.sources.length, ") =====")
    res.sources.forEach((s, i) => console.log(`${i + 1}. ${s.title ?? "(sin titulo)"} | ${s.url}`))
  }, 180_000)
})
