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

// Preview contacts (returns first rows for preview table)
export async function previewContactExport(
  filters: ContactExportFilters
): Promise<{ data: ContactExportRow[]; total: number }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("export_contacts", {
    p_process_ids: filters.processIds?.length ? filters.processIds : null,
    p_tech_ids: filters.techIds?.length ? filters.techIds : null,
    p_country: filters.country || null,
    p_industry: filters.industry || null,
    p_search_text: filters.searchText || null,
    p_only_with_email: filters.onlyWithEmail || false,
    p_only_with_phone: filters.onlyWithPhone || false,
    p_limit_count: Math.min(filters.limit, 1000),
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

// Full export (same query, returns all for CSV generation)
export async function exportContactsToCSV(
  filters: ContactExportFilters
): Promise<ContactExportRow[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("export_contacts", {
    p_process_ids: filters.processIds?.length ? filters.processIds : null,
    p_tech_ids: filters.techIds?.length ? filters.techIds : null,
    p_country: filters.country || null,
    p_industry: filters.industry || null,
    p_search_text: filters.searchText || null,
    p_only_with_email: filters.onlyWithEmail || false,
    p_only_with_phone: filters.onlyWithPhone || false,
    p_limit_count: Math.min(filters.limit, 1000),
  })

  if (error) {
    console.error("Error exporting contacts:", error)
    return []
  }

  return data || []
}
