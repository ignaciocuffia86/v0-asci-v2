"use server"

import { createClient } from "@/lib/supabase/server"

// Filtros para el export de compañías por señales del diccionario.
export interface CompanyExportFilters {
  signalType: "process" | "technology" | null // null = ambos
  signalNames: string[] // nombres de señales (multi-select)
  countries: string[] // países normalizados
  industries: string[] // industrias
  limit: number
}

export interface CompanyExportRow {
  company_id: string
  company_name: string | null
  industry: string | null
  country: string | null
  linkedin_url: string | null
  website: string | null
  total_signals: number
}

export interface DictionaryEntry {
  id: string
  name: string
}

// Procesos del diccionario para el dropdown.
export async function getDictionaryProcesses(): Promise<DictionaryEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("dictionary_processes").select("id, name").order("name")
  if (error) {
    console.error("[v0] Error getting dictionary processes:", error)
    return []
  }
  return data || []
}

// Tecnologías/productos del diccionario para el dropdown.
export async function getDictionaryTechnologies(): Promise<DictionaryEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("dictionary_products").select("id, name").order("name")
  if (error) {
    console.error("[v0] Error getting dictionary technologies:", error)
    return []
  }
  return data || []
}

// Países disponibles (empresas).
export async function getCompanyCountries(): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("export_companies_countries")
  if (error) {
    console.error("[v0] Error getting company countries:", error)
    return []
  }
  return (data as string[]) || []
}

// Industrias disponibles (empresas).
export async function getCompanyIndustries(): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("export_companies_industries")
  if (error) {
    console.error("[v0] Error getting company industries:", error)
    return []
  }
  return (data as string[]) || []
}

function rpcParams(filters: CompanyExportFilters, limit: number) {
  return {
    p_signal_type: filters.signalType,
    p_signal_names: filters.signalNames.length > 0 ? filters.signalNames : null,
    p_countries: filters.countries.length > 0 ? filters.countries : null,
    p_industries: filters.industries.length > 0 ? filters.industries : null,
    p_limit: limit,
  }
}

// Preview: trae hasta 10.000 filas y devuelve las primeras 15 + total.
export async function previewCompanyExport(
  filters: CompanyExportFilters,
): Promise<{ data: CompanyExportRow[]; total: number }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("export_companies", rpcParams(filters, 10000))
  if (error) {
    console.error("[v0] Error previewing company export:", error)
    throw new Error(error.message)
  }
  const rows = (data as CompanyExportRow[]) || []
  return { data: rows.slice(0, 15), total: rows.length }
}

// Export completo para CSV.
export async function exportCompaniesToCSV(filters: CompanyExportFilters): Promise<CompanyExportRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("export_companies", rpcParams(filters, Math.min(filters.limit, 10000)))
  if (error) {
    console.error("[v0] Error exporting companies to CSV:", error)
    throw new Error(error.message)
  }
  return (data as CompanyExportRow[]) || []
}
