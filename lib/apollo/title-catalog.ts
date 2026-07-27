// Helper para alimentar y consultar el catálogo de títulos (apollo_title_catalog).
// Escritura: cada vez que Apollo devuelve resultados, observamos los títulos.
// Lectura: autocomplete y sugerencias de expansión en UI.

import { createAdminClient } from "@/lib/supabase/admin"

export type TitleObservation = {
  title: string
  seniority?: string | null
  departments?: string[] | null
}

/**
 * Registra los títulos devueltos por Apollo en el catálogo.
 * Incrementa usage_count y actualiza last_seen_at.
 * No bloquea el flujo: errores se loggean y se ignoran.
 */
export async function recordTitleObservations(observations: TitleObservation[]): Promise<void> {
  if (observations.length === 0) return

  try {
    const supabase = createAdminClient()
    // Usamos la función SQL definida en la migración 103
    for (const obs of observations) {
      if (!obs.title || obs.title.trim().length < 2) continue
      await supabase.rpc("apollo_observe_title", {
        p_title: obs.title,
        p_seniority: obs.seniority ?? null,
        p_department: obs.departments?.[0] ?? null,
      })
    }
  } catch (err) {
    console.error("[apollo] recordTitleObservations failed:", err)
  }
}

/**
 * Incrementa success_count para los títulos que el usuario envió en la query
 * cuando la búsqueda devolvió resultados.
 */
export async function recordTitleSuccess(titles: string[], totalEntries: number): Promise<void> {
  if (totalEntries === 0 || titles.length === 0) return

  try {
    const supabase = createAdminClient()
    // CORRECCION (auditoria Fase 3): el RPC real tiene la firma
    // (p_title text, p_entries integer). Antes se llamaba solo con p_title, asi
    // que Postgres no encontraba la funcion y el error quedaba atrapado por el
    // catch de abajo. Esa es la razon por la que apollo_title_catalog esta vacio
    // y el ordenamiento por tasa de exito de Fase 2 nunca se activo.
    const results = await Promise.allSettled(
      titles
        .filter((t) => t && t.trim().length >= 2)
        .map((title) =>
          supabase.rpc("apollo_record_title_success", { p_title: title, p_entries: totalEntries })
        )
    )
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.error) {
        console.error("[apollo] recordTitleSuccess rpc error:", r.value.error.message)
      }
    }
  } catch (err) {
    console.error("[apollo] recordTitleSuccess failed:", err)
  }
}

/**
 * Busca títulos en el catálogo por prefijo/fuzzy match.
 * Devuelve hasta `limit` resultados ordenados por success_count desc.
 */
export async function searchTitleCatalog(
  query: string,
  filters: { seniority?: string; department?: string; minSuccess?: number } = {},
  limit = 20,
): Promise<
  Array<{
    displayTitle: string
    normalizedTitle: string
    seniority: string | null
    department: string | null
    usageCount: number
    successCount: number
  }>
> {
  const supabase = createAdminClient()
  const q = query.trim().toLowerCase()

  let builder = supabase
    .from("apollo_title_catalog")
    .select("display_title, normalized_title, seniority, department, usage_count, success_count")
    .order("success_count", { ascending: false })
    .limit(limit)

  if (q.length >= 2) {
    builder = builder.ilike("normalized_title", `%${q}%`)
  }
  if (filters.seniority) builder = builder.eq("seniority", filters.seniority)
  if (filters.department) builder = builder.eq("department", filters.department)
  if (filters.minSuccess != null) builder = builder.gte("success_count", filters.minSuccess)

  const { data, error } = await builder
  if (error || !data) {
    console.error("[apollo] searchTitleCatalog failed:", error)
    return []
  }

  return data.map((row) => ({
    displayTitle: row.display_title,
    normalizedTitle: row.normalized_title,
    seniority: row.seniority,
    department: row.department,
    usageCount: row.usage_count,
    successCount: row.success_count,
  }))
}
