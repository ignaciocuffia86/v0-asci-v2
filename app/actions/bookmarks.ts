"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export async function bookmarkCompany(userId: string, companyId: string, searchContext: any = {}) {
  const supabase = await createClient()

  try {
    const { error } = await supabase.from("bookmarks").insert({
      user_id: userId,
      company_id: companyId,
      search_context: searchContext,
    })

    if (error) throw error

    revalidatePath("/search")
    return { success: true }
  } catch (error) {
    console.error("Error bookmarking company:", error)
    return { success: false, error }
  }
}

export async function unbookmarkCompany(userId: string, companyId: string) {
  const supabase = await createClient()

  try {
    const { error } = await supabase.from("bookmarks").delete().eq("user_id", userId).eq("company_id", companyId)

    if (error) throw error

    revalidatePath("/search")
    return { success: true }
  } catch (error) {
    console.error("Error unbookmarking company:", error)
    return { success: false, error }
  }
}
