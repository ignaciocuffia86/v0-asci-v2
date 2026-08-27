/**
 * Contract test del matching de `v3.screen_account_list`, contra el CATÁLOGO REAL.
 *
 * Está acá y no en los unitarios por la lección que CLAUDE.md deja escrita: una
 * RPC de matching de empresas pasó todas las pruebas locales sobre 300.000 filas
 * sintéticas y contra las 514.269 reales tenía cuatro defectos. Los nombres
 * sintéticos parecían el peor caso y producían MENOS trabajo que los reales.
 *
 * Los casos de abajo no son inventados: son los que fallaron en la primera
 * corrida real del perfil admin (75 cuentas de Chile, señal Power BI), donde 21
 * de 75 no llegaban al enrichment por matching y no por falta de datos.
 *
 * Pega a la base real, por eso está gateado. Para correrlo:
 *
 *   RUN_SCREEN_CONTRACT_TESTS=1 npx vitest run tests/contract/screen-account-list.test.ts
 */

import { describe, expect, it } from "vitest"
import { conConexionDirecta } from "@/lib/db/direct"

const RUN = process.env.RUN_SCREEN_CONTRACT_TESTS === "1"
const hasEnv = !!process.env.POSTGRES_URL_NON_POOLING
const runIf = RUN && hasEnv ? describe : describe.skip

type Row = {
  input: string
  status: string
  matchedName: string | null
  ambiguityReason: string | null
  candidateCount: number
  contenderCount: number
  localContacts: number
  filteredByCountry: number
}

async function screen(names: string[], countries: string[] | null = ["Chile"]): Promise<Map<string, Row>> {
  const rows = await conConexionDirecta(async (client) => {
    const res = await client.query(
      `select v3.screen_account_list($1::jsonb, null, null, $2::text[], 2, 5, 0.75) as payload`,
      [JSON.stringify(names.map((input) => ({ input }))), countries],
    )
    return (res.rows[0].payload.rows ?? []) as Row[]
  })
  return new Map(rows.map((r) => [r.input, r]))
}

runIf("company_screen_key consolida variantes de escritura", () => {
  it("dos paréntesis no convierten una empresa en dos entidades rivales", async () => {
    // `Antofagasta Minerals (AMSA)` vs `Antofagasta Minerals AMSA`. Con
    // normalized_name como clave, la brecha de confianza era 0.00 y el reporte
    // pedía elegir entre 19 candidatas.
    const r = (await screen(["AMSA - ANTOFAGASTA MINERALS"])).get("AMSA - ANTOFAGASTA MINERALS")!
    expect(r.status).not.toBe("no_match")
    expect(r.contenderCount).toBeLessThan(r.candidateCount)
  })

  it("UN espacio tampoco: `Cia. Pesquera` y `Cia.Pesquera` son la misma", async () => {
    const r = (await screen(["CIA PESQUERA CAMANCHACA S.A."])).get("CIA PESQUERA CAMANCHACA S.A.")!
    expect(r.matchedName?.toLowerCase()).toContain("camanchaca")
    expect(r.contenderCount).toBeLessThan(r.candidateCount)
  })

  it("contenderCount NUNCA es el pool: es lo que de verdad está en disputa", async () => {
    // El defecto de reporte: `candidateCount` es count(*) sobre la partición
    // entera. Pedir "elegí entre 20" cuando la disputa es entre 2 es lo que hace
    // que el usuario deje de leer los avisos.
    const r = (await screen(["LABORATORIO SAVAL S.A."])).get("LABORATORIO SAVAL S.A.")!
    expect(r.contenderCount).toBeLessThanOrEqual(r.candidateCount)
    expect(r.matchedName?.toLowerCase()).toContain("saval")
  })
})

runIf("la localidad se decide por SEÑAL, no por la ficha", () => {
  const MULTINACIONALES = ["MAPFRE", "SURA", "PRINCIPAL FINANCIAL GROUP", "EWOS S.A."]

  it("una multinacional con gente en Chile deja de perderse por tener el HQ afuera", async () => {
    // Antes: los 4 daban no_match con filteredByCountry=1, porque
    // companies.country es el país de la casa matriz (Spain, Colombia, US,
    // Norway). La cobertura decide: companies.country 12,6%,
    // contacts.country_normalized 94,4%.
    const found = await screen(MULTINACIONALES)
    for (const nombre of MULTINACIONALES) {
      const r = found.get(nombre)!
      expect(r.status, `${nombre} volvió a perderse`).not.toBe("no_match")
      expect(r.localContacts, `${nombre} sin evidencia local`).toBeGreaterThan(0)
    }
  })

  it("el rescate es ADITIVO: una cuenta que ya matcheaba sigue igual", async () => {
    // La garantía que hace seguro el cambio: solo puede AGREGAR candidatas.
    // Un filtro que empieza a sacar cosas es mucho más difícil de notar.
    const r = (await screen(["CLINICA LAS CONDES"])).get("CLINICA LAS CONDES")!
    expect(["matched", "matched_no_signal"]).toContain(r.status)
  })
})

runIf("no_match significa 'no está', nunca 'lo descartamos nosotros'", () => {
  it("si el filtro de país dejó cero candidatas, la fila NO dice no_match", async () => {
    // Es el error que hizo perder 6 empresas que sí estaban: reportar como
    // inexistente algo que excluyó nuestro propio filtro. La acción del usuario
    // es distinta —confirmar una identidad, no salir a scrapear— así que el
    // estado tiene que ser distinto.
    //
    // MAPFRE es el caso que de verdad ejercita la red: ficha en Spain, gente en
    // Chile. Antes daba no_match con filteredByCountry=1.
    const r = (await screen(["MAPFRE"])).get("MAPFRE")!
    expect(r.status).not.toBe("no_match")
    expect(r.localContacts).toBeGreaterThan(0)
  })

  it("Essbio NO lo pierde el país: lo pierde el piso de confianza", async () => {
    // Medido después de aplicar la migración, y va escrito para que no se lea el
    // caso como cubierto cuando no lo está. Essbio existe, es de Chile y tiene
    // 160 contactos chilenos: el filtro de país nunca lo toca. Se cae antes,
    // generando candidatas: el ruido del input ("S.A.  - ANSM") baja la
    // similitud contra la ficha "Essbio" a 0.467, y v_min_conf es 0.50.
    //
    // Es un tercer mecanismo, distinto de los dos que arregla esta migración, y
    // su arreglo —generación de candidatas para marcas cortas con sufijos— pide
    // su propia medición: bajar el piso deja entrar basura en TODO el screening.
    const r = (await screen(["ESSBIO S.A.  - ANSM"])).get("ESSBIO S.A.  - ANSM")!
    expect(r.status).toBe("no_match")
    expect(r.filteredByCountry, "si esto deja de ser 0, la causa cambió").toBe(0)
  })

  it("un nombre que de verdad no existe sigue dando no_match", async () => {
    // El control del test de arriba: si TODO pasara a ambiguo, la red de
    // seguridad estaría tapando el caso legítimo en vez de distinguirlo.
    const inventado = "Zzzqx Empresa Inexistente 9471"
    const r = (await screen([inventado])).get(inventado)!
    expect(r.status).toBe("no_match")
    expect(r.ambiguityReason).toBeNull()
  })
})
