"use server"

import { createClient } from "@/lib/supabase/server"
import { normalizeCountriesForSearch } from "@/lib/normalize-utils"

export type ProcessSearchResult = {
  company_id: string
  company_name: string
  company_logo_url: string | null
  company_website: string | null
  company_linkedin_url: string | null
  company_country: string | null
  company_industry: string | null
  master_industry_id: string | null
  master_industry_name: string | null
  signal_count: number
  current_count: number
  alumni_count: number
  job_postings_count: number
  relevance_score: number
  current_score: number
  alumni_score: number
  job_postings_score: number
}

export type TechnologySearchResult = {
  company_id: string
  company_name: string
  company_logo_url: string | null
  company_website: string | null
  company_linkedin_url: string | null
  company_country: string | null
  company_industry: string | null
  master_industry_id: string | null
  master_industry_name: string | null
  total_count: number
  current_count: number
  alumni_count: number
  job_postings_count: number
  relevance_score: number
  current_score: number
  alumni_score: number
  job_postings_score: number
}

export type SortOption = "relevance" | "current" | "alumni" | "job_postings"

export type CompanySignalSummary = {
  total_signals: number
  current_employees_with_signals: number
  alumni_with_tech_signals: number
  job_postings_count: number
  top_processes: { process_name: string; count: number }[]
  top_technologies: { product_name: string; count: number }[]
}

export async function searchByProcess(
  processIds: string[],
  countries: string[],
  excludeProviders = false,
  masterIndustryIds: string[] = [],
): Promise<ProcessSearchResult[]> {
  const supabase = await createClient()

  // Normalizar países para incluir variantes sin acentos
  const normalizedCountries = countries.length > 0 
    ? normalizeCountriesForSearch(countries) 
    : null

  const { data, error } = await supabase.rpc("search_companies_by_process_v2", {
    p_process_ids: processIds,
    p_countries: normalizedCountries,
    p_exclude_providers: excludeProviders,
    p_master_industry_ids: masterIndustryIds.length > 0 ? masterIndustryIds : null,
  })

  if (error) {
    console.error("Error searching by process:", error)
    // Fallback a la versión anterior si la nueva RPC no existe
    const { data: fallbackData, error: fallbackError } = await supabase.rpc("search_companies_by_process", {
      p_process_ids: processIds,
      p_countries: countries.length > 0 ? countries : null,
    })
    if (fallbackError) {
      throw new Error("Failed to search companies by process")
    }
    // Agregar campos de score con valores por defecto
    return (fallbackData || []).map((r: any) => ({
      ...r,
      company_industry: null,
      master_industry_id: null,
      master_industry_name: null,
      current_count: r.signal_count || 0,
      alumni_count: 0,
      relevance_score: 0,
      current_score: 0,
      alumni_score: 0,
      job_postings_score: 0,
    }))
  }

  // Map RPC response to expected format
  const rawProcess = (data || []).map((r: any) => ({
    company_id:           r.company_id,
    company_name:         r.company_name,
    company_logo_url:     r.company_logo_url || null,
    company_website:      r.company_website,
    company_linkedin_url: null,
    company_country:      r.company_country,
    company_industry:     r.company_industry,
    master_industry_id:   r.master_industry_id,
    master_industry_name: r.master_industry_name,
    signal_count:         r.signal_count  || 0,
    current_count:        r.current_count || 0,
    alumni_count:         r.alumni_count  || 0,
    job_postings_count:   r.job_count     || 0,
    relevance_score:      r.signal_count  || 0,
    current_score:        r.current_count || 0,
    alumni_score:         r.alumni_count  || 0,
    job_postings_score:   r.job_count     || 0,
  }))

  // Normalizar scores a 0-100 relativos al máximo del conjunto
  if (rawProcess.length === 0) return rawProcess
  const maxSig  = Math.max(...rawProcess.map((r) => r.signal_count))        || 1
  const maxCur  = Math.max(...rawProcess.map((r) => r.current_count))       || 1
  const maxAlum = Math.max(...rawProcess.map((r) => r.alumni_count))        || 1
  const maxJobs = Math.max(...rawProcess.map((r) => r.job_postings_count))  || 1
  return rawProcess.map((r) => ({
    ...r,
    relevance_score:    Math.round((r.signal_count        / maxSig)  * 100),
    current_score:      Math.round((r.current_count       / maxCur)  * 100),
    alumni_score:       Math.round((r.alumni_count        / maxAlum) * 100),
    job_postings_score: Math.round((r.job_postings_count  / maxJobs) * 100),
  }))
}

export async function searchByTechnology(
  productIds: string | string[],
  countries: string[],
  excludeProviders = false,
  masterIndustryIds: string[] = [],
  matchMode: "cualquiera" | "todas" = "cualquiera",
): Promise<TechnologySearchResult[]> {
  const supabase = await createClient()

  const idsArray = Array.isArray(productIds) ? productIds : [productIds]
  if (idsArray.length === 0) return []

  const normalizedCountries = countries.length > 0
    ? normalizeCountriesForSearch(countries)
    : null

  // Normaliza los scores de 0-100 relativos al máximo del conjunto.
  // Esto evita que conteos brutos de señales (ej: 90) se muestren como scores inflados.
  // El resultado con más señales recibe 100; el resto es proporcional.
  function normalizeToScores(results: TechnologySearchResult[]): TechnologySearchResult[] {
    if (results.length === 0) return results
    const maxSignal  = Math.max(...results.map((r) => r.total_count))        || 1
    const maxCurrent = Math.max(...results.map((r) => r.current_count))      || 1
    const maxAlumni  = Math.max(...results.map((r) => r.alumni_count))       || 1
    const maxJobs    = Math.max(...results.map((r) => r.job_postings_count)) || 1
    return results.map((r) => ({
      ...r,
      relevance_score:    Math.round((r.total_count        / maxSignal)  * 100),
      current_score:      Math.round((r.current_count      / maxCurrent) * 100),
      alumni_score:       Math.round((r.alumni_count       / maxAlumni)  * 100),
      job_postings_score: Math.round((r.job_postings_count / maxJobs)    * 100),
    }))
  }

  if (idsArray.length > 1) {
    const allResults = await Promise.all(
      idsArray.map((productId) =>
        supabase.rpc("search_companies_by_technology_v2", {
          p_product_id: productId,
          p_countries: normalizedCountries,
          p_exclude_providers: excludeProviders,
          p_master_industry_ids: masterIndustryIds.length > 0 ? masterIndustryIds : null,
        })
      )
    )

    // Consolida por empresa tomando MAX de contadores (personas únicas, sin duplicar
    // contactos que aparecen en señales de múltiples tecnologías).
    const companyMap = new Map<string, TechnologySearchResult & { _foundIds: Set<string> }>()

    idsArray.forEach((productId, idx) => {
      const { data, error } = allResults[idx]
      if (error) return
      for (const r of data || []) {
        const signalCount  = r.signal_count  || 0
        const currentCount = r.current_count || 0
        const alumniCount  = r.alumni_count  || 0
        const jobCount     = r.job_count     || 0

        const existing = companyMap.get(r.company_id)
        if (existing) {
          existing._foundIds.add(productId)
          existing.total_count        = Math.max(existing.total_count,        signalCount)
          existing.current_count      = Math.max(existing.current_count,      currentCount)
          existing.alumni_count       = Math.max(existing.alumni_count,       alumniCount)
          existing.job_postings_count = Math.max(existing.job_postings_count, jobCount)
        } else {
          companyMap.set(r.company_id, {
            company_id:           r.company_id,
            company_name:         r.company_name,
            company_logo_url:     r.company_logo_url || null,
            company_website:      r.company_website,
            company_linkedin_url: null,
            company_country:      r.company_country,
            company_industry:     r.company_industry,
            master_industry_id:   r.master_industry_id,
            master_industry_name: r.master_industry_name,
            total_count:          signalCount,
            current_count:        currentCount,
            alumni_count:         alumniCount,
            job_postings_count:   jobCount,
            // scores se calculan después de normalizar
            relevance_score:      signalCount,
            current_score:        currentCount,
            alumni_score:         alumniCount,
            job_postings_score:   jobCount,
            _foundIds: new Set([productId]),
          })
        }
      }
    })

    const entries = Array.from(companyMap.values())

    const filtered = matchMode === "todas"
      ? entries.filter((e) => e._foundIds.size === idsArray.length)
      : entries

    const raw = filtered.map(({ _foundIds, ...rest }) => rest)
    return normalizeToScores(raw)
  }

  // Single product ID
  const productId = idsArray[0]
  const { data, error } = await supabase.rpc("search_companies_by_technology_v2", {
    p_product_id: productId,
    p_countries: normalizedCountries,
    p_exclude_providers: excludeProviders,
    p_master_industry_ids: masterIndustryIds.length > 0 ? masterIndustryIds : null,
  })

  if (error) {
    console.error("Error searching by technology:", error)
    const { data: fallbackData, error: fallbackError } = await supabase.rpc("search_companies_by_technology", {
      p_product_id: productId,
      p_countries: countries.length > 0 ? countries : null,
    })
    if (fallbackError) {
      throw new Error("Failed to search companies by technology")
    }
    return (fallbackData || []).map((r: any) => ({
      ...r,
      company_industry: null,
      master_industry_id: null,
      master_industry_name: null,
      relevance_score: 0,
      current_score: 0,
      alumni_score: 0,
      job_postings_score: 0,
    }))
  }

  const raw = (data || []).map((r: any) => ({
    company_id:           r.company_id,
    company_name:         r.company_name,
    company_logo_url:     r.company_logo_url || null,
    company_website:      r.company_website,
    company_linkedin_url: null,
    company_country:      r.company_country,
    company_industry:     r.company_industry,
    master_industry_id:   r.master_industry_id,
    master_industry_name: r.master_industry_name,
    total_count:          r.signal_count  || 0,
    current_count:        r.current_count || 0,
    alumni_count:         r.alumni_count  || 0,
    job_postings_count:   r.job_count     || 0,
    relevance_score:      r.signal_count  || 0,
    current_score:        r.current_count || 0,
    alumni_score:         r.alumni_count  || 0,
    job_postings_score:   r.job_count     || 0,
  }))

  return normalizeToScores(raw)
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

  const { data, error } = await supabase.rpc("search_companies_by_name_filtered", {
    p_query_text: query,
    p_limit: 50,
  })

  if (error) {
    // Fallback to simpler query if RPC fails or doesn't exist yet (during migration)
    console.error("Error using RPC search, falling back to basic search:", error)
    const { data: fallbackData, error: fallbackError } = await supabase
      .from("companies")
      .select("id, name, logo_url, country, industry, linkedin_url")
      .ilike("name", `%${query}%`)
      .not("linkedin_url", "is", null)
      .limit(50)

    if (fallbackError) {
      console.error("Error searching companies (fallback):", fallbackError)
      return []
    }
    return fallbackData
  }

  return data
}
