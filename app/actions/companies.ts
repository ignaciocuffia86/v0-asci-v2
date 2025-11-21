"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

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

export async function getPotentialDuplicates(): Promise<CompanyDuplicateGroup[]> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc("get_duplicate_candidates")

  if (error) {
    console.error("Error fetching duplicates:", error)
    return []
  }

  return data as CompanyDuplicateGroup[]
}

export async function mergeCompanies(masterId: string, duplicateId: string) {
  const supabase = await createClient()

  const { error } = await supabase.rpc("merge_companies", {
    p_master_company_id: masterId,
    p_duplicate_company_id: duplicateId,
  })

  if (error) throw error

  revalidatePath("/admin/companies/duplicates")
}
