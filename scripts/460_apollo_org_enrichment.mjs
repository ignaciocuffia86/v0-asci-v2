#!/usr/bin/env node
/**
 * 460. ENRICHMENT DE public.companies VIA APOLLO (organizations/bulk_enrich)
 * =========================================================================
 * OBJETIVO DEL PILOTO: medir el costo REAL antes de barrer 57.500 dominios.
 *
 * Nuestro codigo asume `creditsEstimated: 0` para organizations/enrich, pero
 * eso es una suposicion NUESTRA: la doc de API Pricing de Apollo lista el
 * enrichment de organizaciones entre los endpoints que consumen creditos. La
 * unica forma de saberlo es medir, y eso hace este script: lee la cuota de la
 * cuenta ANTES y DESPUES del lote y reporta el delta.
 *
 * REGLAS DE ESCRITURA (ver lib/apollo/company-writer.ts)
 *   - columnas apollo_*  -> se escriben siempre
 *   - columnas genericas -> solo si estan vacias (NULL o '')
 *   - is_public/ticker   -> NO se tocan (son de SEC EDGAR)
 *   - industry           -> NO se toca (taxonomia distinta; va a apollo_industry)
 *   - country_normalized / master_industry_id -> los derivan triggers, nunca a mano
 *
 * CHECKPOINT
 *   Cada empresa procesada queda en v3.apollo_company_enrichment con el payload
 *   crudo. Al reanudar se saltean las ya resueltas.
 *
 * USO
 *   node --env-file-if-exists=/vercel/share/.env.project \
 *     scripts/460_apollo_org_enrichment.mjs [--limit N] [--commit] [--retry-errors]
 *
 *   Sin --commit es DRY RUN: pega contra Apollo (para medir consumo) pero NO
 *   escribe en la base.
 */

import pg from "pg"

const APOLLO_API_KEY = process.env.APOLLO_API_KEY
const APOLLO_BASE = "https://api.apollo.io/api/v1"
const BULK_MAX = 10

const args = process.argv.slice(2)
const getArg = (name, def) => {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? Number(args[i + 1]) : def
}
const LIMIT = getArg("--limit", 100)
// Tope duro de gasto. Apollo cobra 1 credito POR CUENTA RESUELTA, asi que un
// barrido completo (57.485 dominios, 63% de hit rate medido) son ~36.000
// creditos. Sin un tope, un --limit mal tipeado se come el saldo del mes.
const MAX_CREDITS = getArg("--max-credits", 500)
// Pausa entre llamadas. MEDIDO en produccion el 26-ago-2026 sobre nuestra
// cuenta (headers de organizations/enrich):
//     x-rate-limit-minute : 1000
//     x-rate-limit-hourly : (vacio -> sin tope)
//     x-rate-limit-24-hour: (vacio -> sin tope)
// O sea ~16 req/s. El default de 150ms deja ~6.7 req/s: menos de la mitad de
// la cuota, con margen para que convivan otras llamadas de la app. El script
// igual frena solo si algun header de cuota se acerca a cero.
const SLEEP_MS = getArg("--sleep", 150)
const COMMIT = args.includes("--commit")
const RETRY_ERRORS = args.includes("--retry-errors")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ------------------------------------------------------------- dominio

const COMPOUND_TLDS = new Set([
  "com.ar", "com.br", "com.mx", "com.uy", "com.pe", "com.co", "com.ve",
  "com.ec", "com.bo", "com.py", "com.cl", "co.uk", "co.nz", "co.jp",
  "co.kr", "co.il", "co.za", "com.au",
])

/** Espejo de lib/apollo/domain.ts (los .mjs no pueden importar TS). */
function normalizeDomain(input) {
  if (!input) return null
  let raw = String(input).trim().toLowerCase()
  if (!raw) return null
  raw = raw.split(/\s+/)[0]
  if (!/^https?:\/\//.test(raw)) raw = `https://${raw}`
  let host
  try {
    host = new URL(raw).hostname
  } catch {
    return null
  }
  if (!host) return null
  host = host.replace(/\.$/, "")
  if (!/\./.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null
  const parts = host.split(".")
  if (parts.length < 2) return null
  const lastTwo = parts.slice(-2).join(".")
  if (parts.length >= 3 && COMPOUND_TLDS.has(lastTwo)) return parts.slice(-3).join(".")
  return lastTwo
}

// ------------------------------------------------------------- Apollo

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
      `[460] cuota ${label}: no disponible (HTTP ${r.status})` +
        (r.status === 403 ? " — la API key no es master key" : ""),
    )
    return null
  }
  console.log(`[460] cuota ${label}: capturada`)
  return r.data
}

/** Busca los contadores del endpoint de enrichment dentro del snapshot. */
function findEnrichCounters(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null
  for (const [path, byVerb] of Object.entries(snapshot)) {
    if (!path.includes("organizations") || !byVerb || typeof byVerb !== "object") continue
    for (const [verb, windows] of Object.entries(byVerb)) {
      if (!windows || typeof windows !== "object") continue
      if (!("day" in windows)) continue
      return { endpoint: `${verb.toUpperCase()} ${path}`, ...windows }
    }
  }
  return null
}

// --------------------------------------------------------- parsing

const MAX_KEYWORDS = 50
const num = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v)
  return null
}
const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)
const strArr = (v, cap) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, cap).map((x) => x.trim()) : []

function parseOrg(org) {
  if (!org || typeof org !== "object" || !org.id) return null
  const growth = {}
  for (const [k, apolloKey] of [
    ["six_month", "organization_headcount_six_month_growth"],
    ["twelve_month", "organization_headcount_twelve_month_growth"],
    ["twenty_four_month", "organization_headcount_twenty_four_month_growth"],
  ]) {
    const n = num(org[apolloKey])
    if (n !== null) growth[k] = n
  }
  const revenue = num(org.annual_revenue)
  return {
    id: org.id,
    linkedinUrl: str(org.linkedin_url),
    websiteUrl: str(org.website_url),
    country: str(org.country),
    logoUrl: str(org.logo_url),
    description: str(org.short_description),
    industry: str(org.industry),
    employeesCount: num(org.estimated_num_employees),
    foundedYear: num(org.founded_year),
    annualRevenue: revenue === null ? null : Math.round(revenue),
    technologies: strArr(org.technology_names, 500),
    keywords: strArr(org.keywords, MAX_KEYWORDS),
    publiclyTradedSymbol: str(org.publicly_traded_symbol),
    publiclyTradedExchange: str(org.publicly_traded_exchange),
    headcountGrowth: Object.keys(growth).length ? growth : null,
  }
}

const isEmpty = (v) => v === null || v === undefined || String(v).trim() === ""

// -------------------------------------------------------------- main

async function main() {
  if (!APOLLO_API_KEY) throw new Error("Falta APOLLO_API_KEY")

  const url = (process.env.POSTGRES_URL_NON_POOLING || "").replace(/[?&]sslmode=[^&]*/g, "")
  if (!url) throw new Error("Falta POSTGRES_URL_NON_POOLING")
  const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await db.connect()

  console.log(
    `[460] modo=${COMMIT ? "COMMIT (escribe)" : "DRY RUN (no escribe)"} limit=${LIMIT} sleep=${SLEEP_MS}ms`,
  )

  const before = await usageSnapshot("ANTES")

  // Candidatas: tienen website real y todavia no las resolvimos. Se ordenan por
  // actividad propia (contactos/vacantes) porque son las que se usan de verdad.
  const { rows: candidates } = await db.query(
    `SELECT c.id, c.name, c.website, c.linkedin_url, c.country, c.logo_url, c.description
       FROM public.companies c
       LEFT JOIN v3.apollo_company_enrichment e ON e.company_id = c.id
       LEFT JOIN v3.company_name_index i ON i.company_id = c.id
      WHERE nullif(btrim(c.website), '') IS NOT NULL
        AND coalesce(c.apollo_org_status, 'unknown') NOT IN ('found', 'not_found')
        AND (e.company_id IS NULL ${RETRY_ERRORS ? "OR e.status = 'error'" : ""})
      ORDER BY coalesce(i.weight, 0) DESC, c.id
      LIMIT $1`,
    [LIMIT],
  )

  console.log(`[460] candidatas: ${candidates.length}`)
  if (candidates.length === 0) {
    await db.end()
    return
  }

  const stats = {
    llamadas: 0,
    enviadas: 0,
    creditos: 0,
    found: 0,
    not_found: 0,
    skipped: 0,
    errores: 0,
    filled: {},
    tecnologias: 0,
    conTecnologias: 0,
  }
  const bump = (col) => (stats.filled[col] = (stats.filled[col] || 0) + 1)
  let ultimoRateLimit = {}

  const lotes = []
  for (let i = 0; i < candidates.length; i += BULK_MAX) lotes.push(candidates.slice(i, i + BULK_MAX))

  for (let n = 0; n < lotes.length; n++) {
    const lote = lotes[n]
    const enviables = []
    for (const c of lote) {
      const dom = normalizeDomain(c.website)
      if (!dom) {
        stats.skipped++
        continue
      }
      enviables.push({ company: c, domain: dom })
    }
    if (enviables.length === 0) continue

    if (stats.creditos >= MAX_CREDITS) {
      console.log(
        `\n[460] TOPE DE CREDITOS alcanzado (${stats.creditos}/${MAX_CREDITS}). ` +
          `Cortando con ${lotes.length - n} lotes sin procesar. ` +
          `El checkpoint permite reanudar: volver a correr con --max-credits mayor.`,
      )
      break
    }

    process.stdout.write(`[460] lote ${n + 1}/${lotes.length} (${enviables.length} dominios)... `)

    const r = await apolloFetch("/organizations/bulk_enrich", {
      body: { domains: enviables.map((e) => e.domain) },
    })
    stats.llamadas++
    stats.enviadas += enviables.length
    ultimoRateLimit = r.rateLimits

    // Freno preventivo: si la ventana de minuto se agota, esperar a que rote
    // en vez de comerse un 429.
    const quedan = Number(r.rateLimits["x-minute-requests-left"] ?? NaN)
    if (Number.isFinite(quedan) && quedan <= 20) {
      console.log(`\n[460]   cuota de minuto casi agotada (${quedan}), esperando 60s`)
      await sleep(60_000)
    }

    if (!r.ok) {
      stats.errores += enviables.length
      console.log(`ERROR HTTP ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`)
      if (r.status === 429) {
        const wait = Number(r.rateLimits["retry-after"] || 60) * 1000
        console.log(`[460]   rate limited, esperando ${wait / 1000}s`)
        await sleep(wait)
      }
      continue
    }

    const orgs = Array.isArray(r.data?.organizations) ? r.data.organizations : []
    let foundEnLote = 0

    for (let i = 0; i < enviables.length; i++) {
      const { company, domain } = enviables[i]
      const org = parseOrg(orgs[i])

      if (!org) {
        stats.not_found++
        if (COMMIT) {
          await db.query(
            `UPDATE public.companies
                SET apollo_org_status = 'not_found', apollo_org_synced_at = now()
              WHERE id = $1`,
            [company.id],
          )
          await db.query(
            `INSERT INTO v3.apollo_company_enrichment (company_id, requested_domain, status, processed_at)
             VALUES ($1, $2, 'not_found', now())
             ON CONFLICT (company_id) DO UPDATE
               SET status = 'not_found', requested_domain = EXCLUDED.requested_domain,
                   processed_at = now(), attempts = v3.apollo_company_enrichment.attempts + 1`,
            [company.id, domain],
          )
        }
        continue
      }

      stats.found++
      foundEnLote++
      // 1 credito por cuenta resuelta (no por dominio enviado)
      stats.creditos++
      if (org.technologies.length > 0) {
        stats.conTecnologias++
        stats.tecnologias += org.technologies.length
      }

      // Columnas genericas: SOLO si estan vacias.
      const filled = []
      const sets = []
      const vals = []
      const push = (col, val) => {
        vals.push(val)
        sets.push(`${col} = $${vals.length}`)
      }

      if (isEmpty(company.linkedin_url) && org.linkedinUrl) {
        push("linkedin_url", org.linkedinUrl)
        filled.push("linkedin_url")
      }
      if (isEmpty(company.country) && org.country) {
        push("country", org.country)
        filled.push("country")
      }
      if (isEmpty(company.logo_url) && org.logoUrl) {
        push("logo_url", org.logoUrl)
        filled.push("logo_url")
      }
      if (isEmpty(company.description) && org.description) {
        push("description", org.description)
        filled.push("description")
      }
      filled.forEach(bump)

      // Namespace de Apollo: siempre.
      push("apollo_organization_id", org.id)
      push("apollo_org_status", "found")
      push("apollo_employees_count", org.employeesCount)
      push("apollo_industry", org.industry)
      push("apollo_annual_revenue", org.annualRevenue)
      push("apollo_founded_year", org.foundedYear)
      push("apollo_technologies", org.technologies.length ? org.technologies : null)
      push("apollo_keywords", org.keywords.length ? org.keywords : null)
      push("apollo_headcount_growth", org.headcountGrowth ? JSON.stringify(org.headcountGrowth) : null)
      push("apollo_publicly_traded_symbol", org.publiclyTradedSymbol)
      push("apollo_publicly_traded_exchange", org.publiclyTradedExchange)

      if (COMMIT) {
        vals.push(company.id)
        await db.query(
          `UPDATE public.companies SET ${sets.join(", ")}, apollo_org_synced_at = now(), updated_at = now()
            WHERE id = $${vals.length}`,
          vals,
        )
        await db.query(
          `INSERT INTO v3.apollo_company_enrichment
             (company_id, requested_domain, status, apollo_organization_id, payload, filled_columns, processed_at)
           VALUES ($1, $2, 'found', $3, $4, $5, now())
           ON CONFLICT (company_id) DO UPDATE
             SET status = 'found', requested_domain = EXCLUDED.requested_domain,
                 apollo_organization_id = EXCLUDED.apollo_organization_id,
                 payload = EXCLUDED.payload, filled_columns = EXCLUDED.filled_columns,
                 processed_at = now(), attempts = v3.apollo_company_enrichment.attempts + 1`,
          // orgs[i] ya es el objeto pelado: bulk_enrich devuelve las
          // organizaciones sueltas. Misma forma que guarda el writer de TS
          // (ver unwrapOrganization en lib/apollo/company-writer.ts).
          [company.id, domain, org.id, JSON.stringify(orgs[i]), filled],
        )
      }
    }

    console.log(`${foundEnLote}/${enviables.length} encontradas`)
    if (n < lotes.length - 1) await sleep(SLEEP_MS)
  }

  const after = await usageSnapshot("DESPUES")

  // ------------------------------------------------------------- reporte
  console.log(`\n${"=".repeat(64)}`)
  console.log(`[460] RESULTADO (${COMMIT ? "COMMIT" : "DRY RUN"})`)
  console.log("=".repeat(64))
  console.log(`  llamadas a la API      : ${stats.llamadas}`)
  console.log(`  dominios enviados      : ${stats.enviadas}`)
  console.log(`  encontradas            : ${stats.found}`)
  console.log(`  no encontradas         : ${stats.not_found}`)
  console.log(`  sin dominio parseable  : ${stats.skipped}`)
  console.log(`  errores                : ${stats.errores}`)
  console.log(`  CREDITOS CONSUMIDOS    : ${stats.creditos} (1 por cuenta resuelta, tope ${MAX_CREDITS})`)
  const base = stats.found + stats.not_found
  if (base > 0) console.log(`  hit rate               : ${((stats.found / base) * 100).toFixed(1)}%`)
  if (stats.conTecnologias > 0) {
    console.log(
      `  tecnologias            : ${stats.tecnologias} en ${stats.conTecnologias} empresas ` +
        `(promedio ${(stats.tecnologias / stats.conTecnologias).toFixed(1)})`,
    )
  }
  console.log(`\n  columnas genericas completadas:`)
  const cols = Object.entries(stats.filled)
  if (cols.length === 0) console.log(`    (ninguna)`)
  for (const [col, n] of cols.sort((a, b) => b[1] - a[1])) console.log(`    ${col.padEnd(14)} ${n}`)

  console.log(`\n  cuota (headers de la ultima llamada):`)
  const rlKeys = Object.keys(ultimoRateLimit)
  if (rlKeys.length === 0) console.log(`    (Apollo no mando headers de cuota)`)
  for (const k of rlKeys.sort()) console.log(`    ${k.padEnd(28)} ${ultimoRateLimit[k]}`)

  const cb = findEnrichCounters(before)
  const ca = findEnrichCounters(after)
  console.log(`\n  CONSUMO MEDIDO:`)
  if (!cb || !ca) {
    console.log(`    no se pudo medir (usage_stats requiere master API key).`)
    console.log(`    Los headers de arriba son la mejor referencia disponible.`)
  } else {
    console.log(`    endpoint: ${ca.endpoint}`)
    for (const w of ["minute", "hour", "day"]) {
      const b = cb[w]?.consumed ?? null
      const a = ca[w]?.consumed ?? null
      const lim = ca[w]?.limit ?? null
      if (b === null || a === null) continue
      const delta = a - b
      const porLlamada = stats.llamadas > 0 ? (delta / stats.llamadas).toFixed(2) : "?"
      console.log(
        `    ${w.padEnd(6)}: ${b} -> ${a} (delta ${delta}, ${porLlamada}/llamada, limite ${lim ?? "?"})`,
      )
    }
  }

  if (!COMMIT) console.log(`\n  DRY RUN: no se escribio nada. Repetir con --commit para persistir.`)
  console.log("=".repeat(64))

  await db.end()
}

main().catch((err) => {
  console.error(`[460] FATAL: ${err.message}`)
  process.exit(1)
})
