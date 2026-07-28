#!/usr/bin/env node
/**
 * Ejecuta un archivo .sql contra la base usando la conexion DIRECTA
 * (POSTGRES_URL_NON_POOLING), no el pooler.
 *
 * Por que existe:
 *   El acceso via PostgREST/pgbouncer hereda un statement_timeout de 8s
 *   (rol authenticated) y no permite comandos de mantenimiento como VACUUM.
 *   El trabajo pesado y por unica vez (backfill del indice de nombres,
 *   ANALYZE, migraciones grandes) necesita una conexion sin esa restriccion.
 *
 * Uso:
 *   set -a && source /vercel/share/.env.project && set +a
 *   node scripts/run-sql.mjs scripts/410_v3_name_index.sql
 *   node scripts/run-sql.mjs --stmt "ANALYZE v3.company_name_index;"
 *
 * Nota: NO usa pooler a proposito. VACUUM y ANALYZE fallan a traves de
 * pgbouncer en modo transaction.
 */
import { readFile } from "node:fs/promises"
import pg from "pg"

// Se prueba la conexion directa primero y se cae al pooler si no responde.
// En este proyecto la directa devolvio EAUTHQUERY ("auth_query secret check
// timed out") mientras el pooler funcionaba, asi que el fallback no es opcional.
const candidatas = [
  ["directa", process.env.POSTGRES_URL_NON_POOLING],
  ["pooler", process.env.POSTGRES_URL],
].filter(([, v]) => Boolean(v))

const cadena = candidatas[0]?.[1]

if (!cadena) {
  console.error("[v0] Falta POSTGRES_URL_NON_POOLING (o POSTGRES_URL) en el entorno.")
  console.error("[v0] Corre: set -a && source /vercel/share/.env.project && set +a")
  process.exit(1)
}

const args = process.argv.slice(2)
const idxStmt = args.indexOf("--stmt")

let sql
let origen

if (idxStmt !== -1) {
  sql = args[idxStmt + 1]
  origen = "--stmt"
  if (!sql) {
    console.error("[v0] --stmt requiere una sentencia SQL entre comillas.")
    process.exit(1)
  }
} else {
  const ruta = args[0]
  if (!ruta) {
    console.error("[v0] Uso: node scripts/run-sql.mjs <archivo.sql> | --stmt \"SQL\"")
    process.exit(1)
  }
  sql = await readFile(ruta, "utf8")
  origen = ruta
}

// La conexion directa de Supabase presenta un certificado auto-firmado en la
// cadena. Hay que sacar el `sslmode` de la URL: pg lo interpreta como
// 'verify-full' y termina ignorando el objeto `ssl` de abajo.
function sinSslMode(url) {
  try {
    const u = new URL(url)
    u.searchParams.delete("sslmode")
    return u.toString()
  } catch {
    return url.replace(/[?&]sslmode=[^&]*/g, "")
  }
}

function nuevoCliente(url) {
  return new pg.Client({
    connectionString: sinSslMode(url),
    ssl: { rejectUnauthorized: false },
    // Sin limite: este runner existe justamente para el trabajo pesado.
    statement_timeout: 0,
    query_timeout: 0,
    connectionTimeoutMillis: 15000,
  })
}

async function ejecutar(etiqueta, url) {
  const cliente = nuevoCliente(url)

  // Los RAISE NOTICE del SQL se ven en vivo: sirve para seguir el progreso de
  // los backfills largos.
  cliente.on("notice", (n) => {
    if (n.message) console.log(`[sql] ${n.message}`)
  })

  const t0 = Date.now()
  try {
    await cliente.connect()
    console.log(`[v0] Conectado (${etiqueta}). Ejecutando: ${origen}`)

    const resultado = await cliente.query(sql)
    const bloques = Array.isArray(resultado) ? resultado : [resultado]

    for (const r of bloques) {
      if (r?.rows?.length) {
        console.log(`[v0] ${r.command ?? "resultado"}:`)
        console.table(r.rows)
      } else if (r?.rowCount != null) {
        console.log(`[v0] ${r.command ?? "sentencia"}: ${r.rowCount} filas afectadas`)
      }
    }

    console.log(`[v0] Listo en ${((Date.now() - t0) / 1000).toFixed(1)}s (${etiqueta})`)
    return { ok: true }
  } catch (e) {
    // Fallos de conexion/credenciales: vale reintentar por otra via.
    const esDeConexion =
      e.code === "EAUTHQUERY" ||
      e.code === "ECONNREFUSED" ||
      e.code === "ETIMEDOUT" ||
      e.code === "ENOTFOUND" ||
      /timed out|terminated unexpectedly|self-signed/i.test(e.message ?? "")

    console.error(`[v0] Fallo por ${etiqueta} tras ${((Date.now() - t0) / 1000).toFixed(1)}s: ${e.message}`)
    if (e.hint) console.error(`[v0] hint: ${e.hint}`)
    if (e.where) console.error(`[v0] where: ${e.where}`)
    return { ok: false, reintentable: esDeConexion }
  } finally {
    await cliente.end().catch(() => {})
  }
}

let exito = false
for (const [etiqueta, url] of candidatas) {
  const r = await ejecutar(etiqueta, url)
  if (r.ok) {
    exito = true
    break
  }
  // Si el SQL es el que falla (error de sintaxis, constraint), no tiene
  // sentido reintentar por otra conexion: seria ejecutarlo dos veces.
  if (!r.reintentable) break
  console.log(`[v0] Reintentando por otra conexion...`)
}

if (!exito) process.exitCode = 1
