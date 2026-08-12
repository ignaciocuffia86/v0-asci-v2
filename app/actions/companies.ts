"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { assertSuperadmin, requireSuperadmin } from "@/lib/auth/require-superadmin"

export interface CompanyDuplicateGroup {
  normalized_name: string
  count: number
  companies: {
    id: string
    name: string
    linkedin_url: string | null
    created_at: string
  }[]
}

export async function getPotentialDuplicates(limit = 100): Promise<CompanyDuplicateGroup[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("get_duplicate_candidates", {
    p_limit: limit,
  })

  if (error) {
    console.error("Error fetching duplicates:", error)
    throw new Error(error.message)
  }

  return data as CompanyDuplicateGroup[]
}

export async function mergeCompanies(masterId: string, duplicateId: string) {
  await assertSuperadmin()
  const supabase = await createClient()

  const { error } = await supabase.rpc("merge_companies", {
    p_master_company_id: masterId,
    p_duplicate_company_id: duplicateId,
  })

  if (error) throw error

  revalidatePath("/admin/companies/duplicates")
}

export async function autoMergeSafeDuplicates() {
  const auth = await requireSuperadmin()
  if ("error" in auth) return { success: false, merged: 0, error: auth.error }

  const supabase = await createClient()

  try {
    const { data, error } = await supabase.rpc("auto_merge_safe_duplicates")

    if (error) throw error

    revalidatePath("/admin/companies/duplicates")
    return { success: true, merged: data }
  } catch (error) {
    console.error("Error auto-merging duplicates:", error)
    return { success: false, merged: 0, error: "Failed to auto-merge duplicates" }
  }
}

export const autoMergeDuplicates = autoMergeSafeDuplicates

// ── Company Management Actions ────────────────────────────────────────

export async function searchCompanies(query: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("companies")
    .select("id, name, country, industry, website, description, linkedin_url, logo_url, normalized_name")
    .or(`name.ilike.%${query}%,website.ilike.%${query}%,normalized_name.ilike.%${query}%`)
    .order("name")
    .limit(20)

  if (error) throw error
  return data
}

export async function getCompanyById(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("id", id)
    .single()

  if (error) throw error
  return data
}

export async function updateCompany(
  id: string,
  data: {
    name?: string
    country?: string | null
    industry?: string | null
    website?: string | null
    description?: string | null
  }
) {
  await assertSuperadmin()
  const supabase = await createClient()

  const { error } = await supabase
    .from("companies")
    .update({
      ...data,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) throw error

  revalidatePath("/admin/companies")
  return { success: true }
}

export async function findDuplicates(companyId: string) {
  const supabase = await createClient()

  // Get the company we're checking
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("normalized_name, linkedin_url, website")
    .eq("id", companyId)
    .single()

  if (companyError) throw companyError

  // Build search conditions
  const conditions: string[] = []

  if (company.normalized_name) {
    conditions.push(`normalized_name.ilike.%${company.normalized_name}%`)
  }

  if (company.linkedin_url) {
    conditions.push(`linkedin_url.eq.${company.linkedin_url}`)
  }

  if (company.website) {
    // Extract domain from website
    const domain = company.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]
    conditions.push(`website.ilike.%${domain}%`)
  }

  if (conditions.length === 0) {
    return []
  }

  const { data, error } = await supabase
    .from("companies")
    .select("id, name, country, industry, website, linkedin_url, logo_url, normalized_name")
    .or(conditions.join(","))
    .neq("id", companyId)
    .limit(10)

  if (error) throw error
  return data
}

export async function getCountriesList() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("companies")
    .select("country")
    .not("country", "is", null)
    .neq("country", "")

  if (error) throw error

  // Count and deduplicate
  const countryMap = new Map<string, number>()
  data.forEach((row) => {
    const country = row.country?.trim()
    if (country) {
      countryMap.set(country, (countryMap.get(country) || 0) + 1)
    }
  })

  // Sort by frequency and return top 50
  return Array.from(countryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([country]) => country)
}

export async function getIndustriesList() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("companies")
    .select("industry")
    .not("industry", "is", null)
    .neq("industry", "")

  if (error) throw error

  // Count and deduplicate
  const industryMap = new Map<string, number>()
  data.forEach((row) => {
    const industry = row.industry?.trim()
    if (industry) {
      industryMap.set(industry, (industryMap.get(industry) || 0) + 1)
    }
  })

  // Sort by frequency and return top 50
  return Array.from(industryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([industry]) => industry)
}
