"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { classifyAmbiguousDuplicates } from "@/lib/v3/dedupe-ai"
import { rpcDirecto, esTimeout } from "@/lib/db/direct"

/**
 * Server actions de la gestion de duplicados.
 *
 * Todo merge pasa por v3.apply_dup_candidate -> public.merge_companies, que
 * mueve las 25 tablas hijas y deja el registro reversible en v3.company_merges.
 *
 * POR QUE LOS MERGES NO VAN POR SUPABASE
 * --------------------------------------
 * Las lecturas van por PostgREST, pero los MERGES van por conexion directa
 * (`rpcDirecto`). PostgREST corta a los 8s y hay grupos que no entran: mover
 * ~1.000 contactos ensucia ~400 MB de indices GIN, y el merge de un grupo
 * chico (3 empresas) medido tardaba ~19s. El limite lo impone el rol de login,
 * asi que `service_role` NO lo esquiva (verificado contra el REST real).
 */

const RUTA = "/admin/companies/duplicates"

/**
 * Traduce errores de Postgres a algo que el admin pueda entender y accionar.
 * Antes el timeout llegaba crudo como "canceling statement due to statement
 * timeout", que no le dice nada a quien esta usando la pantalla.
 */
function mensajeDeError(error: unknown, accion: string): string {
  if (esTimeout(error)) {
    return (
      `El grupo es demasiado pesado y se corto por tiempo al ${accion}. ` +
      `No se aplico ningun cambio: la operacion es atomica. ` +
      `Proba de nuevo; si vuelve a pasar, avisale al equipo tecnico para revisarlo.`
    )
  }
  const mensaje = error instanceof Error ? error.message : String(error)
  return `No se pudo ${accion}: ${mensaje}`
}

export interface DupCandidateRow {
  id: string
  group_key: string
  method: string
  classification: "seguro" | "ambiguo"
  status: string
  master_id: string
  company_ids: string[]
  companies: {
    id: string
    name: string
    country: string | null
    industry: string | null
    linkedin: string | null
    website: string | null
    jobs: number
    contacts: number
    news: number
  }[]
  ai_confidence: number | null
  ai_reasoning: string | null
}

export interface DupSummary {
  seguros_pendientes: number
  ambiguos_pendientes: number
  ia_misma: number
  ia_distinta: number
  ia_dudosa: number
  mergeados: number
  fallidos: number
  reversibles: number
  costo_ia_usd: number
}

/**
 * Solo superadmin puede tocar esto: es el mismo rol que exige /admin/layout.tsx.
 * Devuelve el user id para dejar auditoria de quien decidio cada merge.
 */
async function requireAdmin(): Promise<string> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error("No autenticado")

  const admin = createAdminClient()
  const { data: perfil } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if ((perfil as { role?: string } | null)?.role !== "superadmin") {
    throw new Error("Requiere permisos de superadmin")
  }

  return user.id
}

export async function getDupSummary(): Promise<DupSummary> {
  await requireAdmin()
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("get_dup_candidates_summary")
  if (error) throw new Error(error.message)
  return data as DupSummary
}

export async function getDupCandidates(options?: {
  limit?: number
  classification?: "seguro" | "ambiguo" | null
  status?: string | null
}): Promise<DupCandidateRow[]> {
  await requireAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("get_duplicate_candidates_v2", {
    p_limit: options?.limit ?? 100,
    p_classification: options?.classification ?? null,
    p_status: options?.status === undefined ? "pending" : options.status,
  })

  if (error) throw new Error(error.message)
  return (data ?? []) as DupCandidateRow[]
}

/**
 * Trae el siguiente lote de grupos a la cola de revision. Gratis: no usa IA.
 *
 * Lee de v3.company_dup_groups, que ya viene precalculada. No agrupa las 485k
 * empresas en el clic: eso costaba 16s con cache frio y hacia fallar el boton
 * con "canceling statement due to statement timeout" (el limite real es 8s,
 * heredado del rol `authenticated`).
 *
 * El lote es chico a proposito. Son 21.508 grupos en total y la cola se revisa
 * a mano: traerlos todos de una no aporta nada y solo agrega riesgo de timeout.
 */
export async function refreshDupCandidates(options?: {
  limit?: number
  includeTrgm?: boolean
}) {
  await requireAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin.schema("v3").rpc("refresh_company_dup_candidates", {
    p_limit: options?.limit ?? 100,
    p_include_trgm: options?.includeTrgm ?? false,
  })

  if (error) throw new Error(error.message)
  revalidatePath(RUTA)
  return data as {
    indexadas: number
    grupos_totales: number
    grupos_restantes: number
    nuevos_grupos: number
    pendientes: number
    seguros: number
    ambiguos: number
  }
}

/**
 * Resincroniza el indice de nombres contra public.companies.
 *
 * NO se llama desde la UI a proposito: tarda ~56s medidos y una llamada por RPC
 * muere a los 8s (limite del rol de PostgREST). Corre por pg_cron todas las
 * noches a las 07:10 UTC, agendada en `scripts/410_v3_name_index.sql`.
 *
 * Queda expuesta para forzar una resincronizacion a mano. Si el RPC da timeout,
 * usar `node scripts/run-sql.mjs` (conexion directa, sin tope de tiempo).
 */
export async function syncNameIndex(limit = 50000) {
  await requireAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin.schema("v3").rpc("sync_company_name_index", {
    p_limit: limit,
  })

  if (error) throw new Error(error.message)
  revalidatePath(RUTA)
  return data as {
    altas: number
    renombres: number
    bajas: number
    grupos_detectados: number
    total_indexadas: number
    quedan_pendientes: number
  }
}

/**
 * Simula un merge sin escribir nada. Es lo que alimenta el aviso previo:
 * cuantas filas se moverian y cuantas se perderian por conflicto de unicidad.
 */
export async function previewDupCandidate(candidateId: string) {
  const userId = await requireAdmin()

  try {
    // Por conexion directa: hasta el dry-run de un grupo pesado pasa los 8s de
    // PostgREST, porque simula el merge completo dentro de una transaccion.
    const bruto = await rpcDirecto<{
      rows_moved: number
      rows_deleted: number
      master_id: string
    }>("v3.apply_dup_candidate", {
      p_candidate_id: candidateId,
      p_dry_run: true,
      p_decided_by: userId,
    })

    // Proyeccion explicita: el JSON que devuelve la funcion incluye `detail`
    // con el ID de CADA fila que se moveria (~6.000 uuids en un grupo pesado).
    // Un `as` de TypeScript no recorta nada en runtime, asi que sin esto el
    // server action le manda ~1 MB al browser para mostrar dos numeros.
    return {
      rows_moved: bruto.rows_moved,
      rows_deleted: bruto.rows_deleted,
      master_id: bruto.master_id,
    }
  } catch (error) {
    throw new Error(mensajeDeError(error, "calcular el detalle del grupo"))
  }
}

export async function applyDupCandidate(candidateId: string) {
  const userId = await requireAdmin()

  let bruto: { rows_moved: number; rows_deleted: number; merges: string[] }
  try {
    bruto = await rpcDirecto<{ rows_moved: number; rows_deleted: number; merges: string[] }>(
      "v3.apply_dup_candidate",
      { p_candidate_id: candidateId, p_dry_run: false, p_decided_by: userId },
    )
  } catch (error) {
    throw new Error(mensajeDeError(error, "unificar el grupo"))
  }

  revalidatePath(RUTA)
  // Igual que en el preview: se proyecta a mano para no mandarle al browser el
  // `detail` con miles de uuids. `merges` si va, son pocos ids y sirven para
  // revertir.
  return {
    rows_moved: bruto.rows_moved,
    rows_deleted: bruto.rows_deleted,
    merges: bruto.merges ?? [],
  }
}

/** Aprobacion en bloque: aplica varios candidatos de una. */
export async function applyDupCandidates(candidateIds: string[]) {
  const userId = await requireAdmin()

  let aplicados = 0
  let movidas = 0
  const errores: string[] = []

  // Cada merge es su propia transaccion, asi que uno que falle no arrastra a los
  // demas: los ya aplicados quedan commiteados.
  for (const id of candidateIds) {
    try {
      const data = await rpcDirecto<{ rows_moved?: number }>("v3.apply_dup_candidate", {
        p_candidate_id: id,
        p_dry_run: false,
        p_decided_by: userId,
      })
      aplicados++
      movidas += data?.rows_moved ?? 0
    } catch (error) {
      errores.push(mensajeDeError(error, "unificar un grupo"))
    }
  }

  revalidatePath(RUTA)
  return { aplicados, movidas, errores }
}

/**
 * Auto-merge de los grupos seguros. No usa IA.
 *
 * El corte lo maneja la funcion por TIEMPO, no por cantidad: el costo por merge
 * varia mucho (medido sobre 198: promedio 27ms, p95 44ms, un outlier de ~5s), y
 * un lote fijo de 100 se pasaba de los 8s de la conexion y tiraba
 * "canceling statement due to statement timeout".
 *
 * `p_budget_ms` NO se manda a proposito: el default vive en la funcion, donde
 * esta la cuenta de por que vale 2000 (presupuesto + peor merge < 8s). Fijarlo
 * de este lado ya causo el bug de que la funcion se arreglara y la UI siguiera
 * pidiendo el valor viejo.
 *
 * Lo mergeado en cada pasada queda commiteado, asi que si corta por presupuesto
 * el siguiente clic sigue donde quedo.
 *
 * Ahora va por conexion directa, asi que el techo real es de 60s y no de 8s. El
 * presupuesto de la funcion sigue calibrado para 8s (conservador): corta antes de
 * lo necesario, pero es seguro y reanudable. Subirlo requiere medir de nuevo, no
 * se toca de este lado.
 */
export async function autoMergeSafe(options?: { limit?: number; dryRun?: boolean; budgetMs?: number }) {
  const userId = await requireAdmin()

  let data: {
    groups: number
    rows_moved: number
    rows_deleted: number
    errors: unknown[]
    trabados: number
    corto_por_tiempo: boolean
    ms: number
    restantes: number
  }

  try {
    data = await rpcDirecto("v3.auto_merge_safe_candidates", {
      p_limit: options?.limit ?? 500,
      p_dry_run: options?.dryRun ?? false,
      p_decided_by: userId,
      // undefined => no se manda => usa el DEFAULT 2000 de la funcion.
      // Mandar null en su lugar romperia la logica de presupuesto.
      p_budget_ms: options?.budgetMs,
    })
  } catch (error) {
    throw new Error(mensajeDeError(error, "unificar los grupos seguros"))
  }

  revalidatePath(RUTA)
  return data as {
    groups: number
    rows_moved: number
    rows_deleted: number
    errors: unknown[]
    /** Salteados por lock. Siguen 'pending', se reintentan solos. */
    trabados: number
    corto_por_tiempo: boolean
    ms: number
    restantes: number
  }
}

export async function dismissDupCandidate(candidateId: string) {
  await requireAdmin()
  const admin = createAdminClient()

  const { error } = await admin.schema("v3").rpc("dismiss_dup_candidate", {
    p_candidate_id: candidateId,
  })

  if (error) throw new Error(error.message)
  revalidatePath(RUTA)
}

/**
 * Saca una empresa de un grupo sin descartar el grupo entero.
 * Para el caso homonimo: "Grupo Arcor" (golosinas, AR) venia agrupado con una
 * telco alemana llamada "Arcor". Sin esto habia que elegir entre descartar los
 * 4 duplicados verdaderos o corromper los datos mergeando el intruso.
 */
export async function excludeFromDupCandidate(candidateId: string, companyId: string) {
  await requireAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin.schema("v3").rpc("exclude_from_dup_candidate", {
    p_candidate_id: candidateId,
    p_company_id: companyId,
  })

  if (error) throw new Error(error.message)
  revalidatePath(RUTA)
  return data as { candidate_id: string; remaining: number; dismissed: boolean }
}

/** Manda un lote de grupos ambiguos a la IA. Unico paso que cuesta plata. */
export async function classifyAmbiguous(batchSize?: number) {
  const userId = await requireAdmin()
  const res = await classifyAmbiguousDuplicates({ batchSize, userId })
  revalidatePath(RUTA)
  return res
}

export async function getRecentMerges(limit = 50) {
  await requireAdmin()
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("get_recent_company_merges", { p_limit: limit })
  if (error) throw new Error(error.message)

  return (data ?? []) as {
    id: string
    master_id: string
    master_name: string | null
    duplicate_name: string | null
    method: string
    confidence: number | null
    reasoning: string | null
    rows_moved: number
    created_at: string
  }[]
}

/** Deshace un merge: reconstruye la empresa y devuelve sus filas. */
export async function revertMerge(mergeId: string) {
  await requireAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin.rpc("revert_company_merge", { p_merge_id: mergeId })
  if (error) throw new Error(error.message)

  revalidatePath(RUTA)
  return data as { restored_name: string; rows_restored: number }
}
