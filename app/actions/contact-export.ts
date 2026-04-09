"use server"

import { createClient } from "@/lib/supabase/server"

export interface ContactExportFilters {
  processIds?: string[]
  techIds?: string[]
  country?: string | null
  industry?: string | null
  searchText?: string | null
  onlyWithEmail?: boolean
  onlyWithPhone?: boolean
  limit: number
}

// NEW: Filters for signal-based export (by signal name, not ID)
export interface SignalExportFilters {
  signalType: "process" | "technology" // 'process' or 'technology'
  signalName: string // Nombre exacto del proceso o tecnología
  countries: string[] // Array de países: ["Chile", "Argentina", "Colombia"]
  onlyCorporateEmail: boolean // Filter out personal email domains
  limit?: number
}

export interface ContactExportRow {
  first_name: string | null
  last_name: string | null
  full_name: string | null
  current_position_title: string | null
  headline: string | null
  linkedin_url: string | null
  email1: string | null
  email1_type: string | null
  email1_status: string | null
  email2: string | null
  phone1: string | null
  phone1_type: string | null
  phone2: string | null
  country: string | null
  company_name: string | null
  company_industry: string | null
  company_website: string | null
  company_linkedin: string | null
  company_country: string | null
  process_signals: string | null
  technology_signals: string | null
}

export interface DictionaryEntry {
  id: string
  name: string
}

// Get dictionary processes for filter dropdown
export async function getDictionaryProcesses(): Promise<DictionaryEntry[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("dictionary_processes")
    .select("id, name")
    .order("name")

  if (error) {
    console.error("Error getting dictionary processes:", error)
    return []
  }

  return data || []
}

// Get dictionary products/technologies for filter dropdown
export async function getDictionaryTechnologies(): Promise<DictionaryEntry[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("dictionary_products")
    .select("id, name")
    .order("name")

  if (error) {
    console.error("Error getting dictionary products:", error)
    return []
  }

  return data || []
}

// Get distinct countries from contacts for filter dropdown
export async function getContactCountries(): Promise<string[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("contacts")
    .select("country")
    .not("country", "is", null)
    .neq("country", "")

  if (error) {
    console.error("Error getting contact countries:", error)
    return []
  }

  const countryMap = new Map<string, number>()
  data.forEach((row) => {
    const country = row.country?.trim()
    if (country) {
      countryMap.set(country, (countryMap.get(country) || 0) + 1)
    }
  })

  return Array.from(countryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([country]) => country)
}

// Get distinct industries from companies for filter dropdown
export async function getContactIndustries(): Promise<string[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("companies")
    .select("industry")
    .not("industry", "is", null)
    .neq("industry", "")

  if (error) {
    console.error("Error getting industries:", error)
    return []
  }

  const industryMap = new Map<string, number>()
  data.forEach((row) => {
    const industry = row.industry?.trim()
    if (industry) {
      industryMap.set(industry, (industryMap.get(industry) || 0) + 1)
    }
  })

  return Array.from(industryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([industry]) => industry)
}

// Preview contacts (returns only 15 rows for preview table)
export async function previewContactExport(
  filters: ContactExportFilters
): Promise<{ data: ContactExportRow[]; total: number }> {
  const supabase = await createClient()

  // Preview: only fetch 15 rows for the table
  const { data, error } = await supabase.rpc("export_contacts", {
    p_process_ids: filters.processIds?.length ? filters.processIds : null,
    p_tech_ids: filters.techIds?.length ? filters.techIds : null,
    p_country: filters.country || null,
    p_industry: filters.industry || null,
    p_search_text: filters.searchText || null,
    p_only_with_email: filters.onlyWithEmail || false,
    p_only_with_phone: filters.onlyWithPhone || false,
    p_limit_count: 15,
  })

  if (error) {
    console.error("Error previewing contacts:", error)
    return { data: [], total: 0 }
  }

  return {
    data: data || [],
    total: data?.length || 0,
  }
}

// NEW: Preview contacts with signals (returns 15 rows)
export async function previewSignalExport(
  filters: SignalExportFilters
): Promise<{ data: any[]; total: number }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("export_contacts", {
    p_signal_type: filters.signalType,
    p_signal_name: filters.signalName,
    p_countries: JSON.stringify(filters.countries),
    p_only_corporate_email: filters.onlyCorporateEmail,
  })

  if (error) {
    console.error("[v0] Error previewing signal export:", error)
    return { data: [], total: 0 }
  }

  // Return only first 15 for preview
  return {
    data: (data || []).slice(0, 15),
    total: data?.length || 0,
  }
}

// NEW: Full export contacts with signals to CSV
export async function exportSignalContactsToCSV(
  filters: SignalExportFilters
): Promise<any[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("export_contacts", {
    p_signal_type: filters.signalType,
    p_signal_name: filters.signalName,
    p_countries: JSON.stringify(filters.countries),
    p_only_corporate_email: filters.onlyCorporateEmail,
  })

  if (error) {
    console.error("[v0] Error exporting signal contacts:", error)
    return []
  }

  // Limit to 5000 rows for CSV
  return (data || []).slice(0, Math.min(filters.limit || 5000, 5000))
}
