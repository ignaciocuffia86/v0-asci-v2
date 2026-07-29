"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { classifyAmbiguousDuplicates } from "@/lib/v3/dedupe-ai"

/**
 * Server actions de la gestion de duplicados.
 *
 * Todo merge pasa por v3.apply_dup_candidate -> public.merge_companies, que
 * mueve las 25 tablas hijas y deja el registro reversible en v3.company_merges.
 */

const RUTA = "/admin/companies/duplicates"

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
  const admin = createAdminClient()

  const { data, error } = await admin.schema("v3").rpc("apply_dup_candidate", {
    p_candidate_id: candidateId,
    p_dry_run: true,
    p_decided_by: userId,
  })

  if (error) throw new Error(error.message)
  return data as { rows_moved: number; rows_deleted: number; master_id: string }
}

export async function applyDupCandidate(candidateId: string) {
  const userId = await requireAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin.schema("v3").rpc("apply_dup_candidate", {
    p_candidate_id: candidateId,
    p_dry_run: false,
    p_decided_by: userId,
  })

  if (error) throw new Error(error.message)
  revalidatePath(RUTA)
  return data as { rows_moved: number; rows_deleted: number; merges: string[] }
}

/** Aprobacion en bloque: aplica varios candidatos de una. */
export async function applyDupCandidates(candidateIds: string[]) {
  const userId = await requireAdmin()
  const admin = createAdminClient()

  let aplicados = 0
  let movidas = 0
  const errores: string[] = []

  for (const id of candidateIds) {
    const { data, error } = await admin.schema("v3").rpc("apply_dup_candidate", {
      p_candidate_id: id,
      p_dry_run: false,
      p_decided_by: userId,
    })
    if (error) {
      errores.push(error.message)
      continue
    }
    aplicados++
    movidas += (data as { rows_moved?: number })?.rows_moved ?? 0
  }

  revalidatePath(RUTA)
  return { aplicados, movidas, errores }
}

/**
 * Auto-merge de los grupos seguros. No usa IA.
 *
 * El corte lo maneja la funcion por TIEMPO, no por cantidad: cada merge cuesta
 * entre 26 y 243ms medidos (depende de cuantas filas hijas tiene el grupo), asi
 * que un lote fijo de 100 se pasaba de los 8s de la conexion y tiraba
 * "canceling statement due to statement timeout".
 *
 * Lo mergeado en cada pasada queda commiteado, asi que si corta por presupuesto
 * el siguiente clic sigue donde quedo. `corto_por_tiempo` y `restantes` estan
 * para que la UI lo pueda decir.
 */
export async function autoMergeSafe(options?: { limit?: number; dryRun?: boolean; budgetMs?: number }) {
  const userId = await requireAdmin()
  const admin = createAdminClient()

  const { data, error } = await admin.schema("v3").rpc("auto_merge_safe_candidates", {
    p_limit: options?.limit ?? 500,
    p_dry_run: options?.dryRun ?? false,
    p_decided_by: userId,
    p_budget_ms: options?.budgetMs ?? 3500,
  })

  if (error) throw new Error(error.message)
  revalidatePath(RUTA)
  return data as {
    groups: number
    rows_moved: number
    rows_deleted: number
    errors: unknown[]
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
