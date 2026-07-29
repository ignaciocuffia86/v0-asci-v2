// Volca la definicion de una funcion de Postgres a un archivo, sin el formato de
// tabla que trunca la salida. Uso:
//   node --env-file-if-exists=/vercel/share/.env.project \
//     scripts/dump-funcdef.mjs <nombre_funcion> [archivo_salida]
import { Client } from "pg"
import { writeFileSync } from "node:fs"

const nombre = process.argv[2]
const salida = process.argv[3] ?? `/tmp/${nombre}.sql`

if (!nombre) {
  console.error("Falta el nombre de la funcion")
  process.exit(1)
}

// `pg` interpreta sslmode de la query string como verify-full e ignora el objeto
// ssl. Hay que sacarlo con URL, no con regex: la URL trae otros parametros
// (supa=base-pooler.x) que un replace mal hecho rompe.
function limpiar(raw) {
  const u = new URL(raw)
  u.searchParams.delete("sslmode")
  return u.toString()
}

const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL

const client = new Client({
  connectionString: limpiar(url),
  ssl: { rejectUnauthorized: false },
})

await client.connect()

const { rows } = await client.query(
  `SELECT n.nspname AS esquema, pg_get_functiondef(p.oid) AS def
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = $1
    ORDER BY n.nspname`,
  [nombre],
)

await client.end()

if (rows.length === 0) {
  console.error(`No existe ninguna funcion llamada ${nombre}`)
  process.exit(1)
}

const texto = rows.map((r) => `-- esquema: ${r.esquema}\n${r.def}`).join("\n\n")
writeFileSync(salida, texto)
console.log(`${rows.length} definicion(es) -> ${salida} (${texto.split("\n").length} lineas)`)
