import { Client } from "pg"

/**
 * Conexion directa a Postgres, sin pasar por PostgREST.
 *
 * POR QUE EXISTE
 * --------------
 * PostgREST corta cualquier consulta a los 8s. El limite lo impone el rol de
 * login (`authenticator`), y `SET ROLE` no re-aplica settings, asi que
 * `service_role` NO lo esquiva: lo verifiqué contra el REST real y muere igual a
 * los 8.3s aunque su `rolconfig` sea null. Tampoco sirve `SET LOCAL
 * statement_timeout` adentro de una funcion.
 *
 * Algunos merges de empresas no entran en 8s por razones fisicas, no de SQL:
 * mover ~1.000 contactos ensucia ~400 MB porque `public.contacts` tiene ~900 MB
 * de indices GIN de trigramas y el UPDATE cambia una columna indexada
 * (`current_company_id`), asi que no puede ser HOT y hay que reinsertar en todos
 * los indices. Medido con EXPLAIN (ANALYZE, BUFFERS): 242k buffers para 982
 * filas.
 *
 * Por esta via el `statement_timeout` es el global de 2 minutos.
 *
 * CUANDO USARLA
 * -------------
 * Solo para operaciones pesadas y puntuales de admin (merges de duplicados). El
 * resto de la app sigue por Supabase/PostgREST, que da RLS y no necesita esto.
 *
 * OJO CON RLS: esta conexion entra como el rol dueño de la URL, que es superuser
 * y NO esta sujeto a Row Level Security. Nunca la uses para datos del usuario
 * final ni con parametros que vengan del cliente sin validar. Todo llamador debe
 * chequear permisos ANTES (en dedupe.ts eso lo hace `requireAdmin()`).
 */

/**
 * `pg` interpreta `sslmode` de la query string como verify-full e IGNORA el
 * objeto `ssl`, lo que rompe la conexion contra el pooler de Supabase. Hay que
 * sacarlo de la URL y pasar la config de SSL por separado. Es el mismo patron
 * que ya usa scripts/run-sql.mjs.
 */
function limpiarSslmode(url: string): string {
  try {
    const u = new URL(url)
    u.searchParams.delete("sslmode")
    return u.toString()
  } catch {
    return url.replace(/[?&]sslmode=[^&]*/g, "")
  }
}

/** Timeout propio, bien debajo del limite de la plataforma. */
const TIMEOUT_MS = 60_000

export interface EjecutarOpciones {
  /** Milisegundos antes de abortar. Default 60s. */
  timeoutMs?: number
}

/**
 * Corre una funcion con una conexion directa dedicada y la cierra siempre.
 *
 * Abre una conexion nueva por llamada (no un pool) porque estas operaciones son
 * esporadicas y de admin: un pool global en serverless deja conexiones colgadas
 * entre invocaciones para algo que se usa de a una vez.
 */
export async function conConexionDirecta<T>(
  fn: (client: Client) => Promise<T>,
  opciones: EjecutarOpciones = {},
): Promise<T> {
  const url = process.env.POSTGRES_URL_NON_POOLING
  if (!url) {
    throw new Error(
      "Falta POSTGRES_URL_NON_POOLING: es necesaria para las operaciones de merge, " +
        "que no entran en el limite de 8s de PostgREST.",
    )
  }

  const client = new Client({
    connectionString: limpiarSslmode(url),
    ssl: { rejectUnauthorized: false },
    statement_timeout: opciones.timeoutMs ?? TIMEOUT_MS,
    application_name: "asci-admin-dedupe",
  })

  await client.connect()
  try {
    return await fn(client)
  } finally {
    // end() no debe tapar el error original de fn()
    await client.end().catch(() => {})
  }
}

/**
 * Llama a una funcion de Postgres por conexion directa y devuelve su resultado.
 *
 * Usa parametros NOMBRADOS (`p_limit => $1`), igual que PostgREST, por dos
 * razones:
 *  - Un parametro que no se pasa toma el DEFAULT de la funcion. Con parametros
 *    posicionales habria que mandar NULL, que NO es lo mismo: `p_budget_ms`
 *    tiene DEFAULT 2000 y pasarle NULL rompe la logica de presupuesto.
 *  - No se rompe si mañana alguien reordena los argumentos.
 *
 * Los valores van siempre como placeholders, nunca interpolados. Los nombres de
 * funcion y de parametro no pueden parametrizarse, asi que se validan con un
 * formato estricto.
 */
export async function rpcDirecto<T = unknown>(
  nombreFuncion: string,
  parametros: Record<string, unknown> = {},
  opciones: EjecutarOpciones = {},
): Promise<T> {
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i.test(nombreFuncion)) {
    throw new Error(`Nombre de funcion invalido: ${nombreFuncion}`)
  }

  // undefined = "no lo mandes, usa el default de la funcion".
  // null si se manda, porque a veces NULL es un valor con significado propio.
  const entradas = Object.entries(parametros).filter(([, v]) => v !== undefined)

  for (const [nombre] of entradas) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(nombre)) {
      throw new Error(`Nombre de parametro invalido: ${nombre}`)
    }
  }

  const argumentos = entradas.map(([nombre], i) => `${nombre} => $${i + 1}`).join(", ")
  const valores = entradas.map(([, valor]) => valor)

  return conConexionDirecta(async (client) => {
    const res = await client.query<{ resultado: T }>(
      `SELECT ${nombreFuncion}(${argumentos}) AS resultado`,
      valores,
    )
    return res.rows[0]?.resultado as T
  }, opciones)
}

/**
 * True si el error es un timeout de statement de Postgres (57014).
 * Sirve para distinguir "tarda demasiado" de "los datos estan mal".
 */
export function esTimeout(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  return (
    e?.code === "57014" ||
    (typeof e?.message === "string" && /statement timeout|canceling statement/i.test(e.message))
  )
}
