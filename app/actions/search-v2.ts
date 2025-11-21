"use server"

import { createClient } from "@/lib/supabase/server"

export type ProcessSearchResult = {
  company_id: string
  company_name: string
  company_logo_url: string | null
  company_website: string | null
  company_linkedin_url: string | null
  company_country: string | null
  signal_count: number
  sample_signals: any[]
}

export type TechnologySearchResult = {
  company_id: string
  company_name: string
  company_logo_url: string | null
  company_website: string | null
  company_linkedin_url: string | null
  company_country: string | null
  total_count: number
  current_count: number
  alumni_count: number
}

export type CompanySignalSummary = {
  total_signals: number
  current_employees_with_signals: number
  alumni_with_tech_signals: number
  top_processes: { process_name: string; count: number }[]
  top_technologies: { product_name: string; count: number }[]
}

export async function searchByProcess(processIds: string[], countries: string[]): Promise<ProcessSearchResult[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("search_companies_by_process", {
    p_process_ids: processIds,
    p_countries: countries.length > 0 ? countries : null,
  })

  if (error) {
    console.error("Error searching by process:", error)
    throw new Error("Failed to search companies by process")
  }

  return data || []
}

export async function searchByTechnology(productId: string, countries: string[]): Promise<TechnologySearchResult[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("search_companies_by_technology", {
    p_product_id: productId,
    p_countries: countries.length > 0 ? countries : null,
  })

  if (error) {
    console.error("Error searching by technology:", error)
    throw new Error("Failed to search companies by technology")
  }

  return data || []
}

export async function getCompanySignalSummary(companyId: string): Promise<CompanySignalSummary | null> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("get_company_signal_summary", {
    p_company_id: companyId,
  })

  if (error) {
    console.error("Error getting company summary:", error)
    return null
  }

  return data && data.length > 0 ? data[0] : null
}

export async function searchCompaniesByName(query: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("companies")
    .select("id, name, logo_url, country, industry")
    .ilike("name", `%${query}%`)
    .limit(10)

  if (error) {
    console.error("Error searching companies:", error)
    return []
  }

  return data
}
