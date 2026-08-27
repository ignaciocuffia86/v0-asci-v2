#!/usr/bin/env node
/**
 * 470. DOMINIO POR NOMBRE VIA APOLLO ORGANIZATION LOOKUP (gratis)
 * ==============================================================
 * PROBLEMA: 455.747 de las 517.790 filas de `public.companies` (88%) no tienen
 * `website`, y sin dominio no entran a NINGUN flujo de Apollo: `organizations/
 * enrich` y `bulk_enrich` reciben dominios, no nombres. Son cuentas ciegas.
 *
 * LO QUE HACE ESTE SCRIPT: resuelve nombre -> dominio con el endpoint de
 * *lookup* de organizaciones, que devuelve candidatos shallow (id, name,
 * domain, website_url) y —a diferencia de enrich y de mixed_companies/search—
 * NO cobra creditos. Eso lo vuelve viable sobre las 421.075 candidatas reales
 * (455.747 menos 34.672 placeholders "Unknown Company <uuid>", que no tienen
 * nombre buscable).
 *
 * DOS COSAS QUE ESTE SCRIPT NO DA POR SENTADAS
 *
 * 1) QUE SEA GRATIS. Es exactamente el error que ya cometimos: docs/analisis-
 *    inputs-companias-contactos-senales.md afirmaba que `organizations/enrich`
 *    costaba 0 creditos y cuesta 1 por match. Por eso el script mide la cuota
 *    ANTES y DESPUES (igual que 460) y aborta si detecta consumo. No confies en
 *    el default: corre `--limit 20` y leé el delta antes de largar el barrido.
 *
 * 2) CUAL ES EL PATH REST. El lookup gratuito lo expone el MCP oficial de
 *    Apollo (`apollo_organizations_lookup`, "CREDIT COST: Free"); el path REST
 *    equivalente NO esta confirmado contra la doc (docs.apollo.io no es
 *    alcanzable desde el entorno donde se escribio esto). El default de abajo
 *    es la hipotesis mas probable —el mismo recurso de busqueda con
 *    `display_mode: fuzzy_select_mode`, que es lo que el MCP declara como modo
 *    de lookup shallow—. `--probe` prueba los candidatos y reporta cual
 *    responde 200 y con que consumo, sin escribir nada.
 *
 * POR QUE UN SCRIPT Y NO EL MCP DE APOLLO
 * El MCP oficial expone el mismo lookup, pero su gateway corta a ~400 llamadas
 * POR HORA (medido el 27-ago-2026: el piloto se comio la cuota a las ~180
 * llamadas y devolvio rate_limit_exceeded en las 339 restantes). A ese ritmo
 * las 421.075 candidatas son ~44 dias corridos. La API REST, medida sobre
 * nuestra propia cuenta en el script 460, da x-rate-limit-minute: 1000: el
 * mismo barrido son ~7 horas. Por eso esto es un script con API key y no una
 * herramienta de agente.
 *
 * NO PISA `website`. El dominio resuelto por nombre es un CANDIDATO: el match
 * es difuso y puede traer una homonima de otro pais (lib/v3/services/
 * mcp-contact-enrichment.ts ya trata las resoluciones por nombre como
 * `method: "name_lookup"` + warning de confirmacion humana). El resultado va a
 * `v3.apollo_domain_lookup` con score y clasificacion; promover a `companies.
 * website` es un paso separado y deliberado.
 *
 * USO
 *   node --env-file-if-exists=/vercel/share/.env.project \
 *     scripts/470_apollo_domain_lookup.mjs [--limit N] [--commit] [--probe]
 *
 *   Sin --commit es DRY RUN: pega contra Apollo (para medir) y escribe el CSV,
 *   pero NO toca la base.
 *
 *   --limit N        candidatas a procesar (default 1000, el tamaño del piloto)
 *   --sleep MS       pausa entre llamadas (default 150ms ~ 6.7 req/s)
 *   --country-only   solo candidatas con hq_country_iso (acota la poblacion)
 *   --country-filter filtra por pais EN LA QUERY (apagado: recorta recall)
 *   --out FILE       CSV de salida (default scripts/out/470_lookup.csv)
 *   --seed S         semilla del muestreo determinista (default "pilot1")
 *   --probe          prueba los paths REST candidatos y sale
 *   --commit         ademas persiste en v3.apollo_domain_lookup
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import pg from "pg"

const APOLLO_API_KEY = process.env.APOLLO_API_KEY
const APOLLO_BASE = "https://api.apollo.io/api/v1"

/**
 * Candidatos de path para el lookup gratuito, en orden de preferencia.
 * `--probe` los recorre y reporta cual anda. Cuando quede confirmado, dejar
 * solo el bueno y borrar el resto (con el delta de creditos medido al lado).
 */
const LOOKUP_ENDPOINTS = [
  { path: "/mixed_companies/search", displayMode: "fuzzy_select_mode" },
  { path: "/organizations/search", displayMode: "fuzzy_select_mode" },
]

const args = process.argv.slice(2)
const getNum = (name, def) => {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? Number(args[i + 1]) : def
}
const getStr = (name, def) => {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}
const LIMIT = getNum("--limit", 1000)
const SLEEP_MS = getNum("--sleep", 150)
const SEED = getStr("--seed", "pilot1")
const OUT = getStr("--out", "scripts/out/470_lookup.csv")
const COUNTRY_ONLY = args.includes("--country-only")
/**
 * Filtrar por pais EN LA QUERY (no confundir con usar el pais al puntuar, que
 * se hace siempre). Esta apagado por default a proposito: en el piloto parcial
 * del 27-ago-2026 el brazo con filtro dio 88% sin_match (n=25) contra 55% sin
 * filtro (n=155). La muestra es chica y las dos poblaciones no son iguales
 * —solo 10.922 de las 421.075 candidatas tienen hq_country_iso—, asi que no es
 * concluyente; lo que si es claro es que el filtro RECORTA candidatos antes de
 * que los veamos, mientras que puntuar por pais los conserva y solo baja el
 * score. Ante la duda, la version que no pierde informacion.
 */
const COUNTRY_FILTER = args.includes("--country-filter")
const COMMIT = args.includes("--commit")
const PROBE = args.includes("--probe")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------- pais

/**
 * Apollo filtra por nombre de pais en texto, no por ISO. Cubrimos los paises
 * que aparecen en las candidatas sin website; un ISO fuera del mapa corre sin
 * filtro (mejor sin filtro que con un filtro que no matchea nada).
 */
const ISO_TO_COUNTRY = {
  CL: "Chile", AR: "Argentina", CO: "Colombia", PY: "Paraguay", MX: "Mexico",
  PA: "Panama", BO: "Bolivia", EC: "Ecuador", PE: "Peru", UY: "Uruguay",
  US: "United States", ES: "Spain", CA: "Canada", BR: "Brazil", FR: "France",
  SV: "El Salvador", BE: "Belgium", GB: "United Kingdom", IT: "Italy",
  HN: "Honduras", GT: "Guatemala", CR: "Costa Rica", ZA: "South Africa",
  DO: "Dominican Republic", CN: "China", LU: "Luxembourg", VE: "Venezuela",
  NI: "Nicaragua", PT: "Portugal", DE: "Germany", NL: "Netherlands",
}

// -------------------------------------------------------------- scoring

/**
 * Espejo en JS de public.company_core_name(). No alcanza con comparar strings
 * crudos: el nombre nuestro viene de LinkedIn ("Smurfit Kappa Argentina") y el
 * de Apollo es el legal ("Smurfit Kappa Argentina S.A."), asi que se comparan
 * los nucleos normalizados.
 */
const LEGAL_SUFFIX =
  /[\s,.]+\s*(s\.?a\.?i\.?c\.?f?\.?|s\.?a\.?c\.?i\.?|s\.?a\.?s\.?|s\.?a\.?u\.?|s\.?a\.?|s\.?r\.?l\.?|s\.?c\.?a\.?|s\.?l\.?|inc|llc|ltda?|corp|co|plc|gmbh|ag|nv|bv|spa|srl|pty|limited)\.?\s*$/

function coreName(value) {
  if (!value) return ""
  let r = String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/["'`]/g, "")
    .split("/")[0]
    .trim()
    .replace(/^(grupo|group|holding|the)\s+/, "")
  // Hasta 3 pasadas para combinaciones tipo "X SGPS S.A."
  for (let i = 0; i < 3; i++) {
    const before = r
    r = r.replace(LEGAL_SUFFIX, "").trim()
    if (r === before) break
  }
  return r.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

const tokensOf = (v) => new Set(coreName(v).split(" ").filter(Boolean))

function jaccard(a, b) {
  const ta = tokensOf(a)
  const tb = tokensOf(b)
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
}

/**
 * Cuanto del nombre mas corto esta contenido en el otro. Distingue el caso
 * "Cencosud" vs "Cencosud Retail S.A." (contencion 1, jaccard bajo) del caso
 * "Support Chile" vs "Support Argentina" (ambas bajas).
 */
function containment(a, b) {
  const ta = tokensOf(a)
  const tb = tokensOf(b)
  if (!ta.size || !tb.size) return 0
  let inA = 0
  for (const t of tb) if (ta.has(t)) inA++
  let inB = 0
  for (const t of ta) if (tb.has(t)) inB++
  return Math.max(inA / tb.size, inB / ta.size)
}

/**
 * Tokens geograficos. NO son ruido: en este catalogo el pais es parte de la
 * identidad de la fila ("Smurfit Kappa Argentina" es la filial, no la matriz),
 * y una ciudad de mas en el nombre del candidato suele significar OTRA empresa.
 * Medido: "joyeria vasari" contra "JOYERIA VASARI MADRID SL" da similitud 0.67
 * y contencion 1.00 — pasaria como match automatico sin esta guarda, y la de
 * Madrid puede no ser la nuestra.
 */
const GEO_TOKENS = new Set([
  "argentina", "argentino", "argentina", "chile", "chileno", "chilena",
  "colombia", "colombiano", "paraguay", "paraguayo", "mexico", "mexicano",
  "panama", "panameno", "bolivia", "boliviano", "ecuador", "ecuatoriano",
  "peru", "peruano", "uruguay", "uruguayo", "venezuela", "venezolano",
  "brasil", "brazil", "brasileno", "espana", "spain", "espanol",
  "guatemala", "honduras", "nicaragua", "salvador", "rica", "dominicana",
  "portugal", "francia", "france", "italia", "italy", "alemania", "germany",
  "usa", "eeuu", "americana", "latam", "latinoamerica", "sudamerica",
  "buenos", "aires", "santiago", "bogota", "lima", "quito", "caracas",
  "asuncion", "montevideo", "madrid", "barcelona", "miami", "york",
  "guadalajara", "monterrey", "medellin", "cali", "rosario", "cordoba",
  "valparaiso", "guayaquil", "sao", "paulo", "janeiro", "brasilia",
])

/** Tokens geograficos presentes en un nombre y no en el otro. */
function geoMismatch(a, b) {
  const ta = tokensOf(a)
  const tb = tokensOf(b)
  const diff = []
  for (const t of ta) if (GEO_TOKENS.has(t) && !tb.has(t)) diff.push(t)
  for (const t of tb) if (GEO_TOKENS.has(t) && !ta.has(t)) diff.push(t)
  return diff
}

/**
 * Umbrales deliberadamente conservadores: el costo de un dominio equivocado
 * (contactar a la empresa incorrecta) es mucho mayor que el de mandar una fila
 * a revision manual. `revisar` no se promueve solo.
 */
function classify({ match, core, sim, cont }) {
  if (!match) return "sin_match"
  if (!match.domain) return "match_sin_dominio"
  // Un pais o ciudad que aparece de un solo lado tumba el match automatico por
  // alto que sea el score: es la diferencia entre la filial y la matriz, o
  // entre dos empresas homonimas de paises distintos.
  const geoOnly = geoMismatch(core, match.name)
  if (!geoOnly.length && (sim >= 0.85 || (sim >= 0.6 && cont >= 0.99))) return "auto_ok"
  if (sim >= 0.4 || cont >= 0.75) return "revisar"
  return "descartado"
}

// -------------------------------------------------------------- Apollo

function rateLimitsFrom(headers) {
  const raw = {}
  headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (/^(x-)?(rate-?limit|minute|hourly|daily)/.test(k) || k === "retry-after") raw[k] = value
  })
  return raw
}

async function apolloFetch(path, { method = "POST", body = null } = {}) {
  const res = await fetch(`${APOLLO_BASE}${path}`, {
    method,
    headers: {
      "Cache-Control": "no-cache",
      "X-Api-Key": APOLLO_API_KEY,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text.slice(0, 500) }
  }
  return { ok: res.ok, status: res.status, data, rateLimits: rateLimitsFrom(res.headers) }
}

/** Snapshot de cuota. Requiere master key; con key comun devuelve 403. */
async function usageSnapshot(label) {
  const r = await apolloFetch("/usage_stats/api_usage_stats", { method: "GET" })
  if (!r.ok) {
    console.log(
      `[470] cuota ${label}: no disponible (HTTP ${r.status})` +
        (r.status === 403 ? " — la API key no es master key" : ""),
    )
    return null
  }
  console.log(`[470] cuota ${label}: capturada`)
  return r.data
}

/** Suma cruda de contadores diarios, para comparar antes/despues. */
function totalDailyCalls(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null
  let total = 0
  for (const byVerb of Object.values(snapshot)) {
    if (!byVerb || typeof byVerb !== "object") continue
    for (const windows of Object.values(byVerb)) {
      if (windows && typeof windows === "object" && typeof windows.day === "number") {
        total += windows.day
      }
    }
  }
  return total
}

function lookupBody(endpoint, { core, iso }) {
  const country = COUNTRY_FILTER && iso ? ISO_TO_COUNTRY[iso] : null
  return {
    q_organization_fuzzy_name: core,
    display_mode: endpoint.displayMode,
    per_page: 3,
    ...(country ? { organization_locations: [country] } : {}),
  }
}

/** Las dos formas en que Apollo devuelve organizaciones segun el bucket. */
function extractMatches(data) {
  const buckets = [...(data?.organizations ?? []), ...(data?.accounts ?? [])]
  return buckets
    .map((o) => ({
      name: o?.name ?? null,
      domain: o?.primary_domain ?? o?.domain ?? null,
      websiteUrl: o?.website_url ?? null,
      apolloId: o?.organization_id ?? o?.id ?? null,
    }))
    .filter((m) => m.name || m.domain)
}

async function probe() {
  console.log("[470] probe: buscando el path REST del lookup gratuito\n")
  for (const endpoint of LOOKUP_ENDPOINTS) {
    const before = totalDailyCalls(await usageSnapshot(`ANTES ${endpoint.path}`))
    const r = await apolloFetch(endpoint.path, {
      body: lookupBody(endpoint, { core: "apollo", iso: null }),
    })
    const after = totalDailyCalls(await usageSnapshot(`DESPUES ${endpoint.path}`))
    const matches = r.ok ? extractMatches(r.data) : []
    console.log(
      `[470]   ${endpoint.path} (${endpoint.displayMode}) -> HTTP ${r.status}, ` +
        `${matches.length} candidatos, ` +
        `${matches.filter((m) => m.domain).length} con dominio, ` +
        `delta cuota: ${before !== null && after !== null ? after - before : "n/d"}`,
    )
    if (!r.ok) console.log(`[470]     error: ${JSON.stringify(r.data).slice(0, 200)}`)
    await sleep(SLEEP_MS)
  }
  console.log(
    "\n[470] Un delta > 0 en un endpoint que decimos gratuito es motivo para " +
      "PARAR y revisar antes de barrer 421k filas.",
  )
}

// -------------------------------------------------------------- main

async function main() {
  if (!APOLLO_API_KEY) throw new Error("Falta APOLLO_API_KEY")

  if (PROBE) {
    await probe()
    return
  }

  const url = (process.env.POSTGRES_URL_NON_POOLING || "").replace(/[?&]sslmode=[^&]*/g, "")
  if (!url) throw new Error("Falta POSTGRES_URL_NON_POOLING")
  const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await db.connect()

  const endpoint = LOOKUP_ENDPOINTS[0]
  console.log(
    `[470] modo=${COMMIT ? "COMMIT (escribe)" : "DRY RUN (no escribe)"} ` +
      `limit=${LIMIT} sleep=${SLEEP_MS}ms endpoint=${endpoint.path} ` +
      `${COUNTRY_ONLY ? "solo-con-pais" : "con y sin pais"} ` +
      `filtro-pais-en-query=${COUNTRY_FILTER ? "SI" : "no (solo puntua)"}`,
  )

  const before = totalDailyCalls(await usageSnapshot("ANTES"))

  // Candidatas: sin website, con nombre buscable (company_core_name descarta
  // los placeholders "Unknown Company", las URLs y los slugs de LinkedIn) y
  // todavia sin resolver. El orden por md5(seed||id) hace el muestreo
  // determinista: dos corridas con la misma semilla toman las mismas filas.
  const { rows: candidates } = await db.query(
    `select c.id,
            c.name,
            public.company_core_name(c.name) as core,
            c.hq_country_iso as iso
       from public.companies c
       left join v3.apollo_domain_lookup l on l.company_id = c.id
      where (c.website is null or btrim(c.website) = '')
        and public.company_core_name(c.name) is not null
        and l.company_id is null
        ${COUNTRY_ONLY ? "and c.hq_country_iso is not null" : ""}
      order by md5($1 || c.id::text)
      limit $2`,
    [SEED, LIMIT],
  ).catch(async (err) => {
    // La tabla de checkpoint puede no existir todavia (la migracion se aplica
    // aparte). Sin ella el script igual corre: pierde el "no repetir", no la
    // medicion, que es para lo que existe el piloto.
    if (!/apollo_domain_lookup/.test(String(err?.message))) throw err
    console.log("[470] v3.apollo_domain_lookup no existe todavia: corriendo sin checkpoint")
    return db.query(
      `select c.id,
              c.name,
              public.company_core_name(c.name) as core,
              c.hq_country_iso as iso
         from public.companies c
        where (c.website is null or btrim(c.website) = '')
          and public.company_core_name(c.name) is not null
          ${COUNTRY_ONLY ? "and c.hq_country_iso is not null" : ""}
        order by md5($1 || c.id::text)
        limit $2`,
      [SEED, LIMIT],
    )
  })

  console.log(`[470] ${candidates.length} candidatas`)

  const results = []
  let errors = 0
  for (const [i, row] of candidates.entries()) {
    const r = await apolloFetch(endpoint.path, {
      body: lookupBody(endpoint, { core: row.core, iso: row.iso }),
    })

    if (!r.ok) {
      errors++
      results.push({ ...row, match: null, sim: 0, cont: 0, clase: "error", status: r.status })
      // 429 = cuota por minuto: esperamos lo que pida el header, o 60s.
      if (r.status === 429) {
        const wait = Number(r.rateLimits["retry-after"]) * 1000 || 60_000
        console.log(`[470] 429 en la fila ${i + 1}: esperando ${Math.round(wait / 1000)}s`)
        await sleep(wait)
      }
      continue
    }

    const matches = extractMatches(r.data)
    // Preferimos el primer candidato QUE TRAIGA DOMINIO: un match sin dominio
    // no sirve para lo unico que vinimos a buscar.
    const match = matches.find((m) => m.domain) ?? matches[0] ?? null
    const sim = match ? jaccard(row.core, match.name) : 0
    const cont = match ? containment(row.core, match.name) : 0
    results.push({
      ...row,
      match,
      sim,
      cont,
      clase: classify({ match, core: row.core, sim, cont }),
      status: 200,
    })

    if ((i + 1) % 100 === 0) console.log(`[470] ${i + 1}/${candidates.length}`)
    await sleep(SLEEP_MS)
  }

  const after = totalDailyCalls(await usageSnapshot("DESPUES"))

  // ---- metricas, cortadas por estrato: el filtro de pais es la variable que
  // ---- estamos evaluando, asi que un promedio unico no dice nada.
  const clases = ["auto_ok", "revisar", "descartado", "match_sin_dominio", "sin_match", "error"]
  const report = (label, subset) => {
    if (!subset.length) return
    const pct = (n) => `${((n / subset.length) * 100).toFixed(1)}%`
    console.log(`\n[470] ${label} (n=${subset.length})`)
    for (const c of clases) {
      const n = subset.filter((r) => r.clase === c).length
      if (n) console.log(`[470]   ${c.padEnd(18)} ${String(n).padStart(5)}  ${pct(n)}`)
    }
    const conDominio = subset.filter((r) => r.match?.domain).length
    console.log(`[470]   ${"con dominio".padEnd(18)} ${String(conDominio).padStart(5)}  ${pct(conDominio)}`)
  }
  report("TOTAL", results)
  report("con pais", results.filter((r) => r.iso))
  report("sin pais", results.filter((r) => !r.iso))

  if (before !== null && after !== null) {
    const delta = after - before
    console.log(`\n[470] llamadas contabilizadas por Apollo: ${delta} (hicimos ${results.length})`)
    console.log(
      delta > 0
        ? "[470] ATENCION: el endpoint registro consumo. Verificar que sean llamadas y NO creditos antes de barrer 421k."
        : "[470] sin consumo registrado.",
    )
  } else {
    console.log(
      "\n[470] no se pudo medir la cuota (hace falta master key). El costo del " +
        "endpoint queda SIN CONFIRMAR: no barrer 421k sobre esta base.",
    )
  }

  // ---- CSV
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`
  const cols = ["id", "name", "core", "iso", "candidato", "dominio", "apollo_id", "similitud", "contencion", "clase"]
  const csv = [
    cols.join(","),
    ...results.map((r) =>
      [
        r.id, r.name, r.core, r.iso ?? "",
        r.match?.name ?? "", r.match?.domain ?? "", r.match?.apolloId ?? "",
        r.sim.toFixed(3), r.cont.toFixed(3), r.clase,
      ].map(esc).join(","),
    ),
  ].join("\n")
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, csv)
  console.log(`\n[470] CSV -> ${OUT}`)

  if (!COMMIT) {
    console.log("[470] DRY RUN: nada escrito en la base. Con --commit persiste en v3.apollo_domain_lookup.")
    await db.end()
    return
  }

  let written = 0
  for (const r of results) {
    await db.query(
      `insert into v3.apollo_domain_lookup
         (company_id, queried_name, queried_country_iso, apollo_organization_id,
          matched_name, candidate_domain, similarity, containment, status, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (company_id) do update set
         queried_name = excluded.queried_name,
         queried_country_iso = excluded.queried_country_iso,
         apollo_organization_id = excluded.apollo_organization_id,
         matched_name = excluded.matched_name,
         candidate_domain = excluded.candidate_domain,
         similarity = excluded.similarity,
         containment = excluded.containment,
         status = excluded.status,
         payload = excluded.payload,
         checked_at = now()`,
      [
        r.id, r.core, r.iso ?? null, r.match?.apolloId ?? null,
        r.match?.name ?? null, r.match?.domain ?? null,
        r.sim, r.cont, r.clase, JSON.stringify(r.match ?? {}),
      ],
    )
    written++
  }
  console.log(`[470] ${written} filas en v3.apollo_domain_lookup (companies.website intacto)`)
  if (errors) console.log(`[470] ${errors} errores de API`)

  await db.end()
}

main().catch((err) => {
  console.error("[470] fallo:", err?.message ?? err)
  process.exit(1)
})
