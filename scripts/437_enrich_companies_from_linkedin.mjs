#!/usr/bin/env node
/**
 * 437. ENRICHMENT DE public.companies VIA LINKEDIN (Apify)
 * =========================================================================
 * Actor: harvestapi/linkedin-company
 *   input : { companies: [<linkedin urls>] }
 *   output: { universalName, linkedinUrl, name, website, description,
 *             employeeCount, industries[{name}], locations[{headquarter, parsed{countryCode,countryFull}}] }
 *
 * REGLAS DE ESCRITURA
 *   - Solo llena columnas VACIAS. Nunca sobrescribe un valor existente.
 *   - `country` se escribe con el nombre completo (ej "Costa Rica"). El trigger
 *     trg_normalize_country deriva country_normalized y asi se respeta el
 *     contrato de v2. NUNCA se escribe country_normalized a mano.
 *   - `industry` se escribe con industries[0].name (taxonomia LinkedIn, igual
 *     que los valores existentes). El trigger trg_normalize_company_industry
 *     lo normaliza.
 *   - `hq_country_iso` (columna de v3) recibe el ISO alpha-2.
 *   - No se tocan las columnas apollo_* (semantica de otra fuente).
 *
 * CHECKPOINT
 *   Cada empresa procesada queda en v3.linkedin_company_enrichment, con el
 *   payload crudo. Al reanudar se saltean las ya procesadas y no se vuelve a
 *   pagar por ellas.
 *
 * USO
 *   node --env-file-if-exists=/vercel/share/.env.project \
 *     scripts/437_enrich_companies_from_linkedin.mjs [--limit N] [--batch N] [--commit] [--retry-errors]
 *
 *   Sin --commit es DRY RUN: consulta el actor pero NO escribe en la base.
 */

import pg from "pg"

const ACTOR = "harvestapi~linkedin-company"
const APIFY_TOKEN = process.env.APIFY_TOKEN

const args = process.argv.slice(2)
const getArg = (name, def) => {
  const i = args.indexOf(name)
  return i !== -1 && args[i + 1] ? Number(args[i + 1]) : def
}
const LIMIT = getArg("--limit", 500)
const BATCH = getArg("--batch", 50)
const COMMIT = args.includes("--commit")
const RETRY_ERRORS = args.includes("--retry-errors")

// ---------------------------------------------------------------- utilidades

/** Elige la ubicacion del HQ. Devuelve { iso, country, source } o null. */
function pickHq(locations) {
  const locs = (locations || []).filter((l) => l?.parsed?.countryCode)
  if (locs.length === 0) return null

  const flagged = locs.find((l) => l.headquarter === true)
  if (flagged) {
    return {
      iso: flagged.parsed.countryCode,
      country: flagged.parsed.countryFull || flagged.parsed.country,
      source: "headquarter_flag",
    }
  }

  if (locs.length === 1) {
    return {
      iso: locs[0].parsed.countryCode,
      country: locs[0].parsed.countryFull || locs[0].parsed.country,
      source: "single_location",
    }
  }

  // Sin flag de HQ pero todas las sedes en el mismo pais: es inequivoco.
  const isos = new Set(locs.map((l) => l.parsed.countryCode))
  if (isos.size === 1) {
    return {
      iso: locs[0].parsed.countryCode,
      country: locs[0].parsed.countryFull || locs[0].parsed.country,
      source: "unanimous_country",
    }
  }

  return null
}

/** El slug es el segmento final de /company/<slug>. Sirve de clave de matcheo. */
function slugFromUrl(url) {
  const m = String(url || "").match(/\/company\/([^/?#]+)/i)
  return m ? decodeURIComponent(m[1]).toLowerCase() : null
}

/** La convencion dominante en la tabla (96%) es website con protocolo. */
function normalizeWebsite(w) {
  if (!w || typeof w !== "string") return null
  const t = w.trim()
  if (!t) return null
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

async function runActor(urls) {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companies: urls }),
    },
  )
  if (!res.ok) {
    throw new Error(`Apify HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

// -------------------------------------------------------------------- main

async function main() {
  if (!APIFY_TOKEN) throw new Error("Falta APIFY_TOKEN")

  const url = (process.env.POSTGRES_URL_NON_POOLING || "").replace(/[?&]sslmode=[^&]*/g, "")
  const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await db.connect()

  console.log(`[437] modo=${COMMIT ? "COMMIT (escribe)" : "DRY RUN (no escribe)"} limit=${LIMIT} batch=${BATCH}`)

  // Candidatas: tienen LinkedIn, les falta el pais del HQ y no fueron procesadas.
  const { rows: candidates } = await db.query(
    `SELECT c.id, c.name, c.linkedin_url
       FROM public.companies c
       LEFT JOIN v3.linkedin_company_enrichment e ON e.company_id = c.id
      WHERE c.linkedin_url ~ 'linkedin\\.com/company/'
        AND c.hq_country_iso IS NULL
        AND (e.company_id IS NULL ${RETRY_ERRORS ? "OR e.status = 'error'" : ""})
      ORDER BY c.id
      LIMIT $1`,
    [LIMIT],
  )

  console.log(`[437] candidatas: ${candidates.length}`)
  if (candidates.length === 0) {
    await db.end()
    return
  }

  const stats = { ok: 0, no_result: 0, no_hq: 0, error: 0, filled: {} }
  const bump = (col) => (stats.filled[col] = (stats.filled[col] || 0) + 1)

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH)
    const n = Math.floor(i / BATCH) + 1
    const total = Math.ceil(candidates.length / BATCH)
    console.log(`\n[437] lote ${n}/${total} (${batch.length} empresas)...`)

    let items = []
    try {
      items = await runActor(batch.map((c) => c.linkedin_url))
      console.log(`[437]   actor devolvio ${items.length} items`)
    } catch (err) {
      console.error(`[437]   ERROR del actor: ${err.message}`)
      if (COMMIT) {
        for (const c of batch) {
          await db.query(
            `INSERT INTO v3.linkedin_company_enrichment
               (company_id, requested_url, status, error_message)
             VALUES ($1,$2,'error',$3)
             ON CONFLICT (company_id) DO UPDATE
               SET status='error', error_message=EXCLUDED.error_message, processed_at=now()`,
            [c.id, c.linkedin_url, err.message.slice(0, 500)],
          )
        }
      }
      stats.error += batch.length
      continue
    }

    // Matcheo por slug: el actor puede devolver en otro orden o saltear items.
    const bySlug = new Map()
    for (const it of items) {
      const s = slugFromUrl(it.linkedinUrl) || (it.universalName || "").toLowerCase()
      if (s) bySlug.set(s, it)
    }

    for (const c of batch) {
      const item = bySlug.get(slugFromUrl(c.linkedin_url))

      if (!item) {
        stats.no_result++
        if (COMMIT) {
          await db.query(
            `INSERT INTO v3.linkedin_company_enrichment (company_id, requested_url, status)
             VALUES ($1,$2,'no_result')
             ON CONFLICT (company_id) DO UPDATE SET status='no_result', processed_at=now()`,
            [c.id, c.linkedin_url],
          )
        }
        continue
      }

      const hq = pickHq(item.locations)
      const filled = []

      if (COMMIT) {
        // Un UPDATE por columna, cada uno condicionado a que este vacia.
        // Asi nunca se sobrescribe y el trigger correspondiente se dispara.
        const setIfEmpty = async (col, value) => {
          if (value === null || value === undefined || value === "") return
          const { rowCount } = await db.query(
            `UPDATE public.companies
                SET ${col} = $1
              WHERE id = $2
                AND (${col} IS NULL OR btrim(${col}::text) = '')`,
            [value, c.id],
          )
          if (rowCount > 0) {
            filled.push(col)
            bump(col)
          }
        }

        if (hq) {
          // country primero: su trigger deriva country_normalized (contrato v2).
          await setIfEmpty("country", hq.country)
          await setIfEmpty("hq_country_iso", hq.iso)
        }
        await setIfEmpty("website", normalizeWebsite(item.website))
        await setIfEmpty("industry", item.industries?.[0]?.name ?? null)
        await setIfEmpty("description", item.description)
        await setIfEmpty("linkedin_slug", item.universalName)
      } else if (hq) {
        filled.push("(dry-run)")
      }

      const status = hq ? "ok" : "no_hq"
      if (hq) stats.ok++
      else stats.no_hq++

      if (COMMIT) {
        await db.query(
          `INSERT INTO v3.linkedin_company_enrichment
             (company_id, requested_url, status, hq_iso, hq_country, hq_source, payload, filled_columns)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (company_id) DO UPDATE
             SET status=EXCLUDED.status, hq_iso=EXCLUDED.hq_iso, hq_country=EXCLUDED.hq_country,
                 hq_source=EXCLUDED.hq_source, payload=EXCLUDED.payload,
                 filled_columns=EXCLUDED.filled_columns, error_message=NULL, processed_at=now()`,
          [c.id, c.linkedin_url, status, hq?.iso ?? null, hq?.country ?? null, hq?.source ?? null, item, filled],
        )
      }
    }

    console.log(`[437]   acumulado: ok=${stats.ok} no_hq=${stats.no_hq} no_result=${stats.no_result} error=${stats.error}`)
  }

  const procesadas = stats.ok + stats.no_hq + stats.no_result + stats.error
  const hit = procesadas ? ((stats.ok / procesadas) * 100).toFixed(1) : "0.0"

  console.log(`\n[437] ===== RESUMEN =====`)
  console.log(`[437] procesadas : ${procesadas}`)
  console.log(`[437] con HQ (ok): ${stats.ok}  -> hit rate ${hit}%`)
  console.log(`[437] sin HQ     : ${stats.no_hq}`)
  console.log(`[437] sin result : ${stats.no_result}`)
  console.log(`[437] error      : ${stats.error}`)
  console.log(`[437] columnas llenadas:`, JSON.stringify(stats.filled))
  if (!COMMIT) console.log(`[437] DRY RUN: no se escribio nada. Agrega --commit para persistir.`)

  await db.end()
}

main().catch((e) => {
  console.error("[437] FATAL:", e.message)
  process.exit(1)
})
