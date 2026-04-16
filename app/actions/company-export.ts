"use server"

import { createClient } from "@/lib/supabase/server"

export type ExportSortBy = "signals" | "signals_asc" | "contacts" | "job_postings" | "no_linkedin"

export interface CompanyExportRow {
  name: string
  country: string | null
  linkedin_url: string | null
  website: string | null
  signal_count_process: number
  signal_count_technology: number
  job_posting_count: number
}

// Nuevo interface para compañías con señales detalladas
export interface CompanyWithSignalsFilters {
  signalType: "process" | "technology" | null // null = both
  signalNames: string[] // Nombres específicos de señales
  countries: string[]
  industries: string[]
  limit: number
}

export interface CompanyWithSignalsRow {
  company_id: string
  company_name: string
  website: string | null
  linkedin_url: string | null
  country: string | null
  industry: string | null
  total_signals: number
  process_signals: number
  technology_signals: number
  top_signals: string // JSON array como string
}

export async function getAvailableCountries() {
  const supabase = await createClient()

  // Use RPC to avoid 1000 row limit from direct queries
  const { data, error } = await supabase.rpc("get_available_countries_for_export")

  if (error) {
    console.error("Error getting countries:", error)
    return []
  }

  return (data || []).map((row: { country_normalized: string; company_count: number }) => ({
    country: row.country_normalized,
    count: row.company_count,
  }))
}

export async function getCompaniesForExport(filters: CompanyExportFilters): Promise<{
  data: CompanyExportRow[]
  total: number
}> {
  const supabase = await createClient()

  // Build the query using RPC for complex aggregations
  const { data, error } = await supabase.rpc("get_companies_for_export", {
    p_country: filters.country || null,
    p_sort_by: filters.sortBy,
    p_limit: filters.limit,
    p_only_without_linkedin: filters.onlyWithoutLinkedIn || false,
    p_only_without_industry: filters.onlyWithoutIndustry || false,
    p_min_signals: filters.minSignals || 0,
  })

  if (error) {
    console.error("Error getting companies for export:", error)
    return { data: [], total: 0 }
  }

  return {
    data: data || [],
    total: data?.length || 0,
  }
}

export async function getExportStats() {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("get_export_stats")

  if (error) {
    console.error("Error getting export stats:", error)
    return null
  }

  return data
}

// Nuevas funciones para export de compañías con señales

export async function getCompaniesWithSignals(filters: CompanyWithSignalsFilters): Promise<{
  data: CompanyWithSignalsRow[]
  total: number
}> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("export_companies_with_signals", {
    p_signal_type: filters.signalType,
    p_signal_names: filters.signalNames.length > 0 ? filters.signalNames : null,
    p_countries: filters.countries.length > 0 ? filters.countries : null,
    p_industries: filters.industries.length > 0 ? filters.industries : null,
    p_limit: Math.min(filters.limit, 10000),
  })

  if (error) {
    console.error("Error getting companies with signals:", error)
    return { data: [], total: 0 }
  }

  return {
    data: data || [],
    total: data?.length || 0,
  }
}

export async function getSignalNamesForExport(signalType: "process" | "technology" | null): Promise<string[]> {
  const supabase = await createClient()

  if (signalType === "process") {
    const { data, error } = await supabase.from("dictionary_processes").select("name").order("name")
    if (error) return []
    return (data || []).map((row) => row.name)
  } else if (signalType === "technology") {
    const { data, error } = await supabase.from("dictionary_products").select("name").order("name")
    if (error) return []
    return (data || []).map((row) => row.name)
  }

  // Si es null, no retornar nada específico
  return []
}

export async function getCompanyIndustries(): Promise<string[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("companies")
    .select("industry")
    .not("industry", "is", null)
    .neq("industry", "")

  if (error) return []

  const industries = new Set<string>()
  data?.forEach((row) => {
    if (row.industry?.trim()) {
      industries.add(row.industry.trim())
    }
  })

  return Array.from(industries).sort((a, b) => a.localeCompare(b, "es"))
}
