"use server"

import { createClient } from "@/lib/supabase/server"

// Unified export filters - multi-señal support
export interface ExportFilters {
  signalType: "process" | "technology" | null // null = both
  signalNames: string[] // Array de nombres de señales (multi-select)
  countries: string[] // Array de países normalizados
  industries: string[] // Array de industrias
  onlyCorporateEmail: boolean
  limit: number
}

export interface ExportRow {
  contact_id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  job_title: string | null // matches RPC column name
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

// Get distinct industries from companies that have signals with contacts
export async function getContactIndustries(): Promise<string[]> {
  const supabase = await createClient()

  // Get industries from companies that actually have signals with contacts
  const { data, error } = await supabase
    .from("signals")
    .select(`
      companies!inner(industry)
    `)
    .not("contact_id", "is", null)

  if (error) {
    console.error("Error getting industries:", error)
    return []
  }

  const industries = new Set<string>()
  data.forEach((row: any) => {
    const industry = row.companies?.industry?.trim()
    if (industry) {
      industries.add(industry)
    }
  })

  return Array.from(industries).sort((a, b) => a.localeCompare(b, "es"))
}

// Get distinct countries from companies that have signals with contacts
export async function getContactCountries(): Promise<string[]> {
  const supabase = await createClient()

  // Get countries directly from companies table, using country field
  // Filter to only get real country names (exclude job titles, etc.)
  const { data, error } = await supabase
    .from("companies")
    .select("country")
    .not("country", "is", null)
    .neq("country", "")

  if (error) {
    console.error("Error getting contact countries:", error)
    return []
  }

  // List of known valid countries to filter against
  const validCountryPatterns = [
    "Argentina", "Chile", "Mexico", "México", "Colombia", "Peru", "Perú", 
    "Brazil", "Brasil", "Ecuador", "Uruguay", "Paraguay", "Bolivia", "Venezuela",
    "Spain", "España", "United States", "USA", "US", "Canada", "Canadá",
    "United Kingdom", "UK", "Germany", "France", "Italy", "Portugal",
    "Australia", "Japan", "China", "India", "South Korea", "Singapore",
    "Netherlands", "Belgium", "Switzerland", "Austria", "Sweden", "Norway",
    "Denmark", "Finland", "Ireland", "Poland", "Czech Republic", "Romania",
    "Hungary", "Greece", "Turkey", "Israel", "UAE", "Saudi Arabia",
    "South Africa", "Nigeria", "Kenya", "Egypt", "Morocco",
    "New Zealand", "Philippines", "Thailand", "Vietnam", "Indonesia", "Malaysia",
    "Taiwan", "Hong Kong", "Russia", "Ukraine", "Costa Rica", "Panama",
    "Guatemala", "Honduras", "El Salvador", "Nicaragua", "Puerto Rico",
    "Dominican Republic", "Cuba", "Jamaica", "Trinidad", "Afghanistan", "Albania",
    "Algeria", "Andorra", "Angola", "Antigua", "Armenia", "Azerbaijan", "Bahamas",
    "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belize", "Benin", "Bhutan",
    "Bosnia", "Botswana", "Brunei", "Bulgaria", "Burkina", "Burundi", "Cambodia",
    "Cameroon", "Cape Verde", "Central African", "Chad", "Comoros", "Congo",
    "Croatia", "Cyprus", "Djibouti", "Dominica", "East Timor", "Eritrea",
    "Estonia", "Ethiopia", "Fiji", "Gabon", "Gambia", "Georgia", "Ghana",
    "Grenada", "Guinea", "Guyana", "Haiti", "Iceland", "Iraq", "Ivory Coast",
    "Jordan", "Kazakhstan", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon",
    "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg",
    "Madagascar", "Malawi", "Maldives", "Mali", "Malta", "Mauritania", "Mauritius",
    "Moldova", "Monaco", "Mongolia", "Montenegro", "Mozambique", "Myanmar",
    "Namibia", "Nepal", "Niger", "North Korea", "North Macedonia", "Oman",
    "Pakistan", "Palestine", "Papua New Guinea", "Qatar", "Rwanda", "Samoa",
    "San Marino", "Senegal", "Serbia", "Sierra Leone", "Slovakia", "Slovenia",
    "Solomon Islands", "Somalia", "Sri Lanka", "Sudan", "Suriname", "Swaziland",
    "Syria", "Tajikistan", "Tanzania", "Togo", "Tonga", "Tunisia", "Turkmenistan",
    "Uganda", "Uzbekistan", "Vanuatu", "Vatican", "Yemen", "Zambia", "Zimbabwe"
  ]

  const countries = new Set<string>()
  data.forEach((row) => {
    const country = row.country?.trim()
    if (country) {
      // Check if it looks like a real country (starts with a known country name)
      const isValidCountry = validCountryPatterns.some(pattern => 
        country.toLowerCase().includes(pattern.toLowerCase()) ||
        pattern.toLowerCase().includes(country.toLowerCase())
      )
      if (isValidCountry) {
        countries.add(country)
      }
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
    p_signal_names: filters.signalNames.length > 0 ? filters.signalNames : null,
    p_countries: filters.countries.length > 0 ? filters.countries : null,
    p_industries: filters.industries.length > 0 ? filters.industries : null,
    p_only_corporate_email: filters.onlyCorporateEmail,
    p_limit: 10000,
  })

  if (error) {
    console.error("Error previewing export:", error)
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
    p_signal_names: filters.signalNames.length > 0 ? filters.signalNames : null,
    p_countries: filters.countries.length > 0 ? filters.countries : null,
    p_industries: filters.industries.length > 0 ? filters.industries : null,
    p_only_corporate_email: filters.onlyCorporateEmail,
    p_limit: Math.min(filters.limit, 10000),
  })

  if (error) {
    console.error("Error exporting to CSV:", error)
    return []
  }

  return data || []
}
