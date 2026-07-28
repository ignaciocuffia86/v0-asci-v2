"use server"

import { createClient } from "@/lib/supabase/server"

/**
 * Filtros de exportación de jobpostings.
 *
 * Notas de diseño:
 * - El país NO existe en job_postings (solo `location` en texto libre, con valores
 *   como "Greater Buenos Aires" que no incluyen el país). Se resuelve vía
 *   companies.country_normalized, que cubre ~93% de los jobs.
 * - Las señales aplican con lógica OR (cualquiera de las seleccionadas) y se
 *   devuelve UNA fila por jobposting, con las señales agregadas en columnas.
 */
export interface JobExportFilters {
  signalType: "process" | "technology" | null // null = ambos
  signalNames: string[]
  countries: string[]
  industries: string[]
  dateFrom: string | null // YYYY-MM-DD, compara contra posted_at
  dateTo: string | null // YYYY-MM-DD, inclusive
  locationQuery: string | null // busca dentro del texto libre de location
  titleQuery: string | null
  onlyWithSignals: boolean
  includeDescription: boolean
}

export interface JobExportRow {
  job_id: string
  title: string | null
  company_name: string | null
  country: string | null
  industry: string | null
  location: string | null
  posted_at: string | null
  is_active: boolean | null
  job_url: string | null
  apply_url: string | null
  signal_count: number
  signals_process: string | null
  signals_technology: string | null
  description: string | null
}

export interface DictionaryEntry {
  id: string
  name: string
}

export interface JobExportStats {
  total_jobs: number
  active_jobs: number
  with_signals: number
  with_country: number
  companies: number
  date_min: string | null
  date_max: string | null
}

const PREVIEW_ROWS = 15

/** Convierte los filtros de la UI a los parámetros del RPC. */
function toRpcParams(filters: JobExportFilters) {
  const trim = (v: string | null) => {
    const t = v?.trim()
    return t ? t : null
  }

  return {
    p_signal_type: filters.signalType,
    p_signal_names: filters.signalNames.length > 0 ? filters.signalNames : null,
    p_countries: filters.countries.length > 0 ? filters.countries : null,
    p_industries: filters.industries.length > 0 ? filters.industries : null,
    p_date_from: trim(filters.dateFrom),
    p_date_to: trim(filters.dateTo),
    p_location_query: trim(filters.locationQuery),
    p_title_query: trim(filters.titleQuery),
    p_only_with_signals: filters.onlyWithSignals,
  }
}

export async function getJobDictionaryProcesses(): Promise<DictionaryEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("dictionary_processes").select("id, name").order("name")

  if (error) {
    console.error("[v0] Error getting dictionary processes:", error.message)
    return []
  }
  return data || []
}

export async function getJobDictionaryTechnologies(): Promise<DictionaryEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("dictionary_products").select("id, name").order("name")

  if (error) {
    console.error("[v0] Error getting dictionary technologies:", error.message)
    return []
  }
  return data || []
}

/** Países disponibles (vía empresa del jobposting), con su conteo de jobs. */
export async function getJobCountries(): Promise<{ country: string; job_count: number }[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("export_job_postings_countries")

  if (error) {
    console.error("[v0] Error getting job countries:", error.message)
    return []
  }
  return data || []
}

/** Industrias disponibles (vía empresa del jobposting), con su conteo de jobs. */
export async function getJobIndustries(): Promise<{ industry: string; job_count: number }[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("export_job_postings_industries")

  if (error) {
    console.error("[v0] Error getting job industries:", error.message)
    return []
  }
  return data || []
}

/** Totales globales para mostrar el panorama y acotar el rango de fechas. */
export async function getJobExportStats(): Promise<JobExportStats | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("export_job_postings_stats")

  if (error) {
    console.error("[v0] Error getting job export stats:", error.message)
    return null
  }
  return (data as JobExportStats) || null
}

/**
 * Preview: trae las primeras filas y el total real que matchea los filtros.
 * El total se calcula con un COUNT en la DB (no con el largo del preview),
 * así el botón de export puede anticipar el volumen exacto.
 */
export async function previewJobExport(
  filters: JobExportFilters,
): Promise<{ data: JobExportRow[]; total: number; error: string | null }> {
  const supabase = await createClient()
  const params = toRpcParams(filters)

  const [rowsResult, countResult] = await Promise.all([
    supabase.rpc("export_job_postings", {
      ...params,
      p_include_description: false, // el preview nunca necesita la descripción
      p_limit: PREVIEW_ROWS,
      p_offset: 0,
    }),
    supabase.rpc("export_job_postings_count", params),
  ])

  if (rowsResult.error) {
    console.error("[v0] Error previewing job export:", rowsResult.error.message)
    return { data: [], total: 0, error: rowsResult.error.message }
  }
  if (countResult.error) {
    console.error("[v0] Error counting job export:", countResult.error.message)
    return { data: rowsResult.data || [], total: 0, error: countResult.error.message }
  }

  return {
    data: rowsResult.data || [],
    total: Number(countResult.data) || 0,
    error: null,
  }
}
