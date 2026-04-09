"use server"

import { createClient } from "@/lib/supabase/server"

// Unified export filters - one search mode
export interface ExportFilters {
  signalType: "process" | "technology" | null // null = both
  signalName: string | null // nombre exacto del proceso o tecnología, null = all
  countries: string[] // Array de países (del campo companies.country)
  onlyCorporateEmail: boolean
  limit: number
}

export interface ExportRow {
  contact_id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  position: string | null
  company_name: string | null
  company_country: string | null
  linkedin_url: string | null
  email: string | null
  signal_type: string | null
  signal_name: string | null
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

// Get distinct countries from companies for filter dropdown (sorted alphabetically)
export async function getContactCountries(): Promise<string[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("companies")
    .select("country")
    .not("country", "is", null)
    .neq("country", "")

  if (error) {
    console.error("Error getting contact countries:", error)
    return []
  }

  const countries = new Set<string>()
  data.forEach((row) => {
    const country = row.country?.trim()
    if (country) {
      countries.add(country)
    }
  })

  // Sort alphabetically
  return Array.from(countries).sort((a, b) => a.localeCompare(b, "es"))
}

// Preview contacts (returns only 15 rows for preview table)
export async function previewExport(
  filters: ExportFilters
): Promise<{ data: ExportRow[]; total: number }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("export_contacts", {
    p_signal_type: filters.signalType,
    p_signal_name: filters.signalName,
    p_countries: filters.countries.length > 0 ? filters.countries : null,
    p_only_corporate_email: filters.onlyCorporateEmail,
    p_limit: 10000,
  })

  if (error) {
    console.error("[v0] Error previewing export:", error)
    return { data: [], total: 0 }
  }

  // Return only first 15 for preview, but total count of all
  return {
    data: (data || []).slice(0, 15),
    total: data?.length || 0,
  }
}

// Full export to CSV
export async function exportToCSV(
  filters: ExportFilters
): Promise<ExportRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("export_contacts", {
    p_signal_type: filters.signalType,
    p_signal_name: filters.signalName,
    p_countries: filters.countries.length > 0 ? filters.countries : null,
    p_only_corporate_email: filters.onlyCorporateEmail,
    p_limit: Math.min(filters.limit, 10000),
  })

  if (error) {
    console.error("[v0] Error exporting to CSV:", error)
    return []
  }

  return data || []
}
