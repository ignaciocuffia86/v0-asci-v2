#!/usr/bin/env node
/**
 * 439. BACKFILL DE LOGOS DESDE LOS PAYLOADS YA PAGADOS
 * =========================================================================
 * No consume cuota de Apify: reusa el JSONB que ya quedo guardado en
 * v3.linkedin_company_enrichment durante la tanda del 437.
 *
 * POR QUE CORRE APARTE Y POR QUE URGE
 * -----------------------------------------------------------------
 * El actor devuelve `logo` y `logos[]`, pero el 437 nunca los escribia (yo
 * habia concluido mal que el campo no existia). Estan en 858 de 1.050 payloads.
 *
 * Las URLs de media.licdn.com vienen FIRMADAS y con expiracion:
 *   ?e=<epoch>&v=beta&t=<firma>
 * En estos payloads el epoch es 1787184000 = 2026-08-20. Despues de esa fecha
 * devuelven 403 y el dato ya pagado se pierde. Hay que bajarlos ANTES.
 *
 * Por eso el logo no se guarda como URL de LinkedIn sino que se descarga y se
 * sube a Vercel Blob, que da una URL permanente.
 *
 * QUE CUENTA COMO "SIN LOGO"
 * -----------------------------------------------------------------
 * public.companies.logo_url tiene ~59k placeholders roto heredados de SalesQL
 * que terminan en "/None" (https://salesql.s3...:443/None). Para esta columna
 * "vacio" incluye ese caso; si no, esas filas quedan con imagen quebrada para
 * siempre. Un logo real existente NO se toca.
 *
 * USO
 *   node --env-file-if-exists=/vercel/share/.env.project \
 *     scripts/439_backfill_logos_from_payloads.mjs [--limit N] [--commit]
 *
 *   Sin --commit es DRY RUN: no descarga ni escribe, solo reporta.
 */

import pg from "pg"
import { put } from "@vercel/blob"

const args = process.argv.slice(2)
const getArg = (n, d) => {
  const i = args.indexOf(n)
  return i !== -1 && args[i + 1] ? Number(args[i + 1]) : d
}
const LIMIT = getArg("--limit", 2000)
const COMMIT = args.includes("--commit")

const PLACEHOLDER = "/None"

/** Se prefiere la variante mas grande; `logo` es el fallback. */
function pickLogoUrl(item) {
  const variants = Array.isArray(item?.logos) ? item.logos : []
  const best = variants
    .filter((l) => typeof l?.url === "string" && l.url)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]
  if (best?.url) return best.url
  return typeof item?.logo === "string" && item.logo ? item.logo : null
}

async function storeLogo(logoUrl, companyId) {
  const res = await fetch(logoUrl, { cache: "no-store" })
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }

  const contentType = res.headers.get("content-type") || "image/jpeg"
  if (!contentType.startsWith("image/")) return { ok: false, reason: `tipo ${contentType}` }

  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.byteLength === 0) return { ok: false, reason: "vacio" }

  const ext = contentType.includes("png") ? "png" : contentType.includes("svg") ? "svg" : "jpg"
  const blob = await put(`v3/company-logos/${companyId}.${ext}`, buffer, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  })
  return { ok: true, url: blob.url, bytes: buffer.byteLength }
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Falta BLOB_READ_WRITE_TOKEN")

  const url = (process.env.POSTGRES_URL_NON_POOLING || "").replace(/[?&]sslmode=[^&]*/g, "")
  const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await db.connect()

  console.log(`[439] modo=${COMMIT ? "COMMIT (escribe)" : "DRY RUN"} limit=${LIMIT}`)

  const { rows } = await db.query(
    `SELECT e.company_id, c.name, e.payload
       FROM v3.linkedin_company_enrichment e
       JOIN public.companies c ON c.id = e.company_id
      WHERE e.payload IS NOT NULL
        AND (c.logo_url IS NULL OR btrim(c.logo_url) = '' OR c.logo_url LIKE $2)
      ORDER BY e.processed_at
      LIMIT $1`,
    [LIMIT, `%${PLACEHOLDER}`],
  )

  console.log(`[439] filas sin logo real y con payload: ${rows.length}`)

  const stats = { con_logo_en_payload: 0, subidos: 0, fallados: 0, sin_logo: 0, bytes: 0 }
  const fallos = {}

  for (const r of rows) {
    const src = pickLogoUrl(r.payload)
    if (!src) {
      stats.sin_logo++
      continue
    }
    stats.con_logo_en_payload++

    if (!COMMIT) continue

    try {
      const out = await storeLogo(src, r.company_id)
      if (!out.ok) {
        stats.fallados++
        fallos[out.reason] = (fallos[out.reason] || 0) + 1
        continue
      }

      // Se pisa el placeholder "/None" a proposito: es basura, no un dato.
      const { rowCount } = await db.query(
        `UPDATE public.companies SET logo_url = $1
          WHERE id = $2
            AND (logo_url IS NULL OR btrim(logo_url) = '' OR logo_url LIKE $3)`,
        [out.url, r.company_id, `%${PLACEHOLDER}`],
      )
      if (rowCount > 0) {
        stats.subidos++
        stats.bytes += out.bytes
      }

      // Deja rastro de que esta fila aporto el logo.
      await db.query(
        `UPDATE v3.linkedin_company_enrichment
            SET filled_columns = (
                  SELECT ARRAY(SELECT DISTINCT unnest(filled_columns || ARRAY['logo_url']))
                )
          WHERE company_id = $1`,
        [r.company_id],
      )
    } catch (err) {
      stats.fallados++
      const reason = (err?.message || "error").slice(0, 60)
      fallos[reason] = (fallos[reason] || 0) + 1
    }
  }

  console.log(`\n[439] ===== RESUMEN =====`)
  console.log(`[439] con logo en el payload : ${stats.con_logo_en_payload}`)
  console.log(`[439] sin logo en el payload : ${stats.sin_logo}`)
  if (COMMIT) {
    console.log(`[439] subidos a Blob        : ${stats.subidos}`)
    console.log(`[439] fallados              : ${stats.fallados}`)
    console.log(`[439] total descargado      : ${(stats.bytes / 1024).toFixed(0)} KB`)
    if (Object.keys(fallos).length) console.log(`[439] motivos:`, JSON.stringify(fallos))
  } else {
    console.log(`[439] DRY RUN: no se descargo ni escribio nada. Agrega --commit.`)
  }

  await db.end()
}

main().catch((e) => {
  console.error("[439] FATAL:", e.message)
  process.exit(1)
})
