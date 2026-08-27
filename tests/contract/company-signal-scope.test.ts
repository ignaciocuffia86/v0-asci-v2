/**
 * Contract test del ALCANCE del panorama de señales, contra el CATÁLOGO REAL.
 *
 * Está acá y no en los unitarios por la misma lección que CLAUDE.md deja escrita:
 * los dos defectos que este test fija son invisibles con datos sintéticos. Los
 * dos dependen de cuántas filas reales matchea un `ilike` y de que dos columnas
 * reales digan cosas distintas — con un fixture de 20 empresas, el OR con límite
 * 100 nunca recorta y el nombre de diccionario suele coincidir con la keyword.
 *
 * Los casos son los que rompieron en la corrida real sobre Santander Chile
 * (865 señales), donde el panorama no era estable entre lecturas y tres de las
 * cuatro tecnologías reportadas volvían sin evidencia al pedir la cita.
 *
 * Pega a la base real, por eso está gateado. Para correrlo:
 *
 *   RUN_SCREEN_CONTRACT_TESTS=1 npx vitest run tests/contract/company-signal-scope.test.ts
 */

import { describe, expect, it } from "vitest"
import { conConexionDirecta } from "@/lib/db/direct"

const RUN = process.env.RUN_SCREEN_CONTRACT_TESTS === "1"
const hasEnv = !!process.env.POSTGRES_URL_NON_POOLING
const runIf = RUN && hasEnv ? describe : describe.skip

const SANTANDER_CHILE = "a77f7edf-5b98-4de4-9b9c-cc7dff2c65c2"

async function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return conConexionDirecta(async (client) => (await client.query(sql, params)).rows as T[])
}

runIf("el pool de candidatas no puede ser una muestra", () => {
  it("un token de localidad inunda el OR: por eso el filtro es AND", async () => {
    // `identityTokens("Santander Chile")` da ["santander", "chile"]. El OR de los
    // dos matchea 7.503 empresas y la tool leía 100 SIN order by: ni una sola de
    // las entidades Santander caía adentro, y cuáles caían cambiaba entre
    // llamadas. Ésa era la inestabilidad, y no estaba en las señales sino acá.
    const [row] = await query<{ or_total: string; and_total: string; reales_en_la_muestra_or: string }>(`
      select
        (select count(*) from companies where name ilike '%santander%' or name ilike '%chile%') as or_total,
        (select count(*) from companies where name ilike '%santander%' and name ilike '%chile%') as and_total,
        (select count(*) from (
           select name from companies where name ilike '%santander%' or name ilike '%chile%' limit 100
         ) muestra where name ilike '%santander%' and name ilike '%chile%') as reales_en_la_muestra_or
    `)

    expect(Number(row.or_total)).toBeGreaterThan(1000)
    // El AND tiene que ser chico: si dejara de serlo, volveríamos a leer una
    // muestra sin darnos cuenta.
    expect(Number(row.and_total)).toBeLessThanOrEqual(200)
    expect(Number(row.and_total)).toBeGreaterThan(0)
    // La regresión, escrita como número: leer 100 del OR no alcanzaba para ver
    // ninguna de las entidades que importaban.
    expect(Number(row.reales_en_la_muestra_or)).toBeLessThan(Number(row.and_total))
  })

  it("la entidad pedida siempre está en su propio pool", async () => {
    // Suena obvio y es la garantía que hace seguro angostar el filtro: el AND de
    // los tokens del nombre siempre matchea el nombre del que salieron.
    const rows = await query<{ id: string }>(
      `select id from companies where id = $1 and name ilike '%santander%' and name ilike '%chile%'`,
      [SANTANDER_CHILE],
    )
    expect(rows).toHaveLength(1)
  })
})

runIf("la etiqueta que se muestra tiene que ser la que se puede buscar", () => {
  it("nombre de diccionario y keyword literal NO son la misma columna", async () => {
    // El panorama rotula con `dictionary_products.name` y `evidence` filtraba por
    // `signals.keyword_matched`. Cuando difieren, pedir la cita del término que la
    // propia tool acaba de mostrar devuelve cero.
    const rows = await query<{ etiqueta: string; keyword: string; filas: string }>(`
      select dp.name as etiqueta, s.keyword_matched as keyword, count(*)::text as filas
      from signals s
      join dictionary_products dp on dp.id = s.signal_id and s.signal_type = 'technology'
      where s.company_id = $1 and dp.name is distinct from s.keyword_matched
      group by 1, 2 order by count(*) desc limit 5
    `, [SANTANDER_CHILE])

    expect(rows.length).toBeGreaterThan(0)

    for (const row of rows) {
      // Lo que hacía la versión vieja: buscar la etiqueta dentro de la keyword.
      const [porKeyword] = await query<{ n: string }>(
        `select count(*)::text as n from signals where company_id = $1 and keyword_matched ilike $2`,
        [SANTANDER_CHILE, `%${row.etiqueta}%`],
      )
      // Lo que hace la nueva: resolver la etiqueta contra el diccionario primero.
      const [porDiccionario] = await query<{ n: string }>(
        `select count(*)::text as n from signals s
           join dictionary_products dp on dp.id = s.signal_id
          where s.company_id = $1 and dp.name ilike $2`,
        [SANTANDER_CHILE, `%${row.etiqueta}%`],
      )

      expect(Number(porDiccionario.n), `"${row.etiqueta}" se muestra pero no se encuentra`).toBeGreaterThan(0)
      expect(Number(porDiccionario.n)).toBeGreaterThanOrEqual(Number(porKeyword.n))
    }
  })

  it("el panorama de esta cuenta NO entra en 100 filas", async () => {
    // El supuesto que sostenía el tope de 100: que 100 señales son la cuenta. Para
    // las cuentas grandes —las que más se investigan— es falso, y el número tiene
    // que estar a la vista en el payload.
    const [row] = await query<{ n: string }>(`select count(*)::text as n from signals where company_id = $1`, [SANTANDER_CHILE])
    expect(Number(row.n)).toBeGreaterThan(100)
  })
})
