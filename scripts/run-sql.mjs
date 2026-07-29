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
 * SEGURIDAD: por defecto NO escribe. Todo corre dentro de una transaccion que
 * termina en ROLLBACK. Para persistir hay que pasar --commit explicitamente.
 *
 * Existe porque ya paso: una consulta de MEDICION a la que se le olvido el
 * `RAISE EXCEPTION 'ROLLBACK INTENCIONAL'` aplico 950 merges reales en
 * produccion. Con este default, olvidarse el rollback no puede escribir nada.
 *
 * Uso:
 *   set -a && source /vercel/share/.env.project && set +a
 *   node scripts/run-sql.mjs scripts/410_v3_name_index.sql --commit
 *   node scripts/run-sql.mjs --stmt "SELECT count(*) FROM foo;"
 *   node scripts/run-sql.mjs --stmt "UPDATE ..." --commit
 *
 * Nota: NO usa pooler a proposito. VACUUM y ANALYZE fallan a traves de
 * pgbouncer en modo transaction.
 *
 * Ojo: VACUUM, CREATE INDEX CONCURRENTLY y ALTER TYPE ... ADD VALUE no pueden
 * correr dentro de una transaccion. Para esos hace falta --sin-transaccion,
 * que implica escritura directa y por eso pide --commit tambien.
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
const commit = args.includes("--commit")
const sinTransaccion = args.includes("--sin-transaccion")

if (sinTransaccion && !commit) {
  console.error("[v0] --sin-transaccion escribe directo, sin red de seguridad.")
  console.error("[v0] Si es lo que queres, agrega tambien --commit.")
  process.exit(1)
}

/**
 * Parte el SQL en sentencias sueltas, respetando comillas, comentarios y bloques
 * dollar-quoted ($$ ... $$ / $tag$ ... $tag$), donde los ';' no separan nada.
 *
 * Hace falta solo para --sin-transaccion: node-pg manda el archivo entero en un
 * simple query, y Postgres trata un multi-statement como UNA transaccion
 * implicita. Ahi `CREATE INDEX CONCURRENTLY` falla con "cannot run inside a
 * transaction block" aunque no haya ningun BEGIN escrito.
 */
function partirSentencias(texto) {
  const out = []
  let buf = ""
  let i = 0
  let comilla = null // "'" | '"' | tag dollar-quoted

  while (i < texto.length) {
    const dos = texto.slice(i, i + 2)

    if (!comilla) {
      // Comentario de linea
      if (dos === "--") {
        const fin = texto.indexOf("\n", i)
        const corte = fin === -1 ? texto.length : fin
        buf += texto.slice(i, corte)
        i = corte
        continue
      }
      // Comentario de bloque
      if (dos === "/*") {
        const fin = texto.indexOf("*/", i + 2)
        const corte = fin === -1 ? texto.length : fin + 2
        buf += texto.slice(i, corte)
        i = corte
        continue
      }
      // Apertura dollar-quoted
      const dollar = /^\$[A-Za-z_]*\$/.exec(texto.slice(i))
      if (dollar) {
        comilla = dollar[0]
        buf += comilla
        i += comilla.length
        continue
      }
      if (texto[i] === "'" || texto[i] === '"') {
        comilla = texto[i]
        buf += texto[i]
        i += 1
        continue
      }
      if (texto[i] === ";") {
        if (buf.trim()) out.push(buf.trim())
        buf = ""
        i += 1
        continue
      }
    } else if (comilla.startsWith("$")) {
      if (texto.startsWith(comilla, i)) {
        buf += comilla
        i += comilla.length
        comilla = null
        continue
      }
    } else {
      // '' y "" escapan la comilla dentro del literal
      if (texto[i] === comilla && texto[i + 1] === comilla) {
        buf += texto[i] + texto[i + 1]
        i += 2
        continue
      }
      if (texto[i] === comilla) {
        buf += texto[i]
        i += 1
        comilla = null
        continue
      }
    }

    buf += texto[i]
    i += 1
  }

  if (buf.trim()) out.push(buf.trim())
  return out
}

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
  const ruta = args.find((a) => !a.startsWith("--"))
  if (!ruta) {
    console.error('[v0] Uso: node scripts/run-sql.mjs <archivo.sql> | --stmt "SQL" [--commit]')
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
  const enTransaccion = !sinTransaccion
  let abierta = false

  try {
    await cliente.connect()
    const modo = sinTransaccion ? "SIN TRANSACCION, escribe" : commit ? "COMMIT, escribe" : "DRY RUN, revierte al final"
    console.log(`[v0] Conectado (${etiqueta}) [${modo}]. Ejecutando: ${origen}`)

    if (enTransaccion) {
      await cliente.query("BEGIN")
      abierta = true
    }

    // Sin transaccion se manda UNA sentencia por vez: ver partirSentencias().
    // Con transaccion se manda todo junto, que es mas rapido y ya es atomico.
    const sentencias = sinTransaccion ? partirSentencias(sql) : [sql]
    const bloques = []

    for (const s of sentencias) {
      if (sinTransaccion && sentencias.length > 1) {
        console.log(`[v0] (${bloques.length + 1}/${sentencias.length}) ${s.split("\n")[0].slice(0, 90)}`)
      }
      const r = await cliente.query(s)
      bloques.push(...(Array.isArray(r) ? r : [r]))
    }

    for (const r of bloques) {
      if (r?.rows?.length) {
        console.log(`[v0] ${r.command ?? "resultado"}:`)
        console.table(r.rows)
      } else if (r?.rowCount != null) {
        console.log(`[v0] ${r.command ?? "sentencia"}: ${r.rowCount} filas afectadas`)
      }
    }

    // El cierre va ANTES del log de exito: si el COMMIT falla (por un constraint
    // diferido, por ejemplo) no se puede haber dicho "Listo".
    if (enTransaccion) {
      await cliente.query(commit ? "COMMIT" : "ROLLBACK")
      abierta = false
    }

    console.log(`[v0] Listo en ${((Date.now() - t0) / 1000).toFixed(1)}s (${etiqueta})`)
    if (!commit) {
      console.log("[v0] DRY RUN: nada quedo guardado. Agrega --commit para persistir.")
    }
    return { ok: true }
  } catch (e) {
    if (abierta) {
      await cliente.query("ROLLBACK").catch(() => {})
    }
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
