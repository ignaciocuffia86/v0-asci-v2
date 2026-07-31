/**
 * Mide la consulta de busqueda de empresas rankeada por evidencia ANTES de
 * convertirla en RPC. El limite real de PostgREST es 8s (rol authenticator), asi
 * que si algun caso se pasa hay que cambiar de estrategia, no rezar.
 *
 * Uso: node scripts/probe-company-search.mjs
 */
import { conConexionDirecta } from "../lib/db/direct.ts"

// Pool acotado por tiers de exactitud de nombre. Es determinista (ORDER BY
// completo) y garantiza que el match exacto y los de prefijo entren al pool
// aunque haya cientos de homonimos.
const SQL = `
WITH matches AS (
  SELECT c.id, c.name, c.website,
    CASE WHEN lower(c.name) = lower($1) THEN 0
         WHEN c.name ILIKE $1 || '%' THEN 1
         WHEN c.name ILIKE '%' || $1 || '%' THEN 2
         ELSE 3 END AS tier
  FROM public.companies c
  WHERE c.name ILIKE '%' || $1 || '%' OR c.website ILIKE '%' || $1 || '%'
),
pool AS (SELECT * FROM matches ORDER BY tier, name LIMIT $2)
SELECT p.name, p.tier,
  (SELECT count(*) FROM public.signals s WHERE s.company_id = p.id) AS signals,
  (SELECT count(*) FROM public.job_postings j WHERE j.company_id = p.id) AS jobs
FROM pool p
ORDER BY (p.tier <= 2) DESC, signals DESC, jobs DESC, p.name
LIMIT 5
`

const COUNT_SQL = `
SELECT count(*)::int AS total FROM public.companies c
WHERE c.name ILIKE '%' || $1 || '%' OR c.website ILIKE '%' || $1 || '%'
`

// Casos elegidos a proposito: los dos que fallaron en los tests, uno con muchos
// homonimos, y dos degenerados que podrian barrer la tabla entera.
const CASOS = ["Falabella", "Techint", "Arcor", "Grupo", "a"]
const POOL = 200

await conConexionDirecta(async (c) => {
  for (const caso of CASOS) {
    const t0 = Date.now()
    const total = await c.query(COUNT_SQL, [caso])
    const tCount = Date.now() - t0
    const t1 = Date.now()
    const r = await c.query(SQL, [caso, POOL])
    const tRank = Date.now() - t1

    const lento = tCount + tRank > 8000 ? "  <-- PASA 8s, NO SIRVE" : ""
    console.log(`\n"${caso}" · total=${total.rows[0].total} · count ${tCount}ms + rank ${tRank}ms = ${tCount + tRank}ms${lento}`)
    for (const f of r.rows) {
      console.log(`   tier${f.tier} ${f.name} · señales=${f.signals} vacantes=${f.jobs}`)
    }
  }
})
