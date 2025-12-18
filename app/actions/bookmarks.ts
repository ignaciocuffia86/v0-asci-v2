"use server"

import { createClient } from "@/lib/supabase/server"

export async function bookmarkCompany(userId: string, companyId: string, searchContext: any = {}) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("bookmarks")
      .insert({
        user_id: userId,
        company_id: companyId,
        search_context: searchContext,
      })
      .select("id")
      .single()

    if (error) throw error

    // El drawer maneja su propio estado con optimistic updates
    return { success: true, bookmarkId: data.id }
  } catch (error) {
    console.error("Error bookmarking company:", error)
    return { success: false, error }
  }
}

export async function unbookmarkCompany(userId: string, companyId: string, bookmarkId?: string) {
  const supabase = await createClient()

  try {
    let query = supabase.from("bookmarks").delete().eq("user_id", userId).eq("company_id", companyId)

    // Si se pasa un bookmarkId específico, solo eliminar ese
    if (bookmarkId) {
      query = supabase.from("bookmarks").delete().eq("id", bookmarkId).eq("user_id", userId)
    }

    const { error } = await query

    if (error) throw error

    // El drawer maneja su propio estado con optimistic updates
    return { success: true }
  } catch (error) {
    console.error("Error unbookmarking company:", error)
    return { success: false, error }
  }
}

export async function getBookmarksForCompany(userId: string, companyId: string) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("bookmarks")
      .select("id, search_context, created_at")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })

    if (error) throw error

    return { success: true, bookmarks: data || [] }
  } catch (error) {
    console.error("Error fetching bookmarks:", error)
    return { success: false, bookmarks: [], error }
  }
}

export async function checkBookmarkWithContext(
  userId: string,
  companyId: string,
  filterSignalIds?: string[],
  filterType?: string,
): Promise<{
  hasExactMatch: boolean
  exactMatchId?: string
  otherBookmarks: Array<{ id: string; context: string; created_at: string }>
}> {
  const supabase = await createClient()

  try {
    const { data: bookmarks, error } = await supabase
      .from("bookmarks")
      .select("id, search_context, created_at")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })

    if (error) throw error
    if (!bookmarks || bookmarks.length === 0) {
      return { hasExactMatch: false, otherBookmarks: [] }
    }

    // Normalizar los filterSignalIds actuales para comparación
    const currentSignalIds = (filterSignalIds || []).sort().join(",")
    const currentFilterType = filterType || "generic"

    let exactMatchId: string | undefined
    const otherBookmarks: Array<{ id: string; context: string; created_at: string }> = []

    for (const bookmark of bookmarks) {
      const ctx = bookmark.search_context || {}
      const bookmarkSignalIds = (ctx.filterSignalIds || []).sort().join(",")
      const bookmarkFilterType = ctx.filterType || "generic"

      // Verificar si es el mismo contexto
      const isSameContext = bookmarkSignalIds === currentSignalIds && bookmarkFilterType === currentFilterType

      if (isSameContext) {
        exactMatchId = bookmark.id
      } else {
        // Generar descripción del contexto
        let contextDesc = "General"
        if (ctx.filtersUsed) {
          const techs = ctx.filtersUsed.technology || []
          const procs = ctx.filtersUsed.process || []
          if (techs.length > 0) contextDesc = techs.slice(0, 2).join(", ")
          else if (procs.length > 0) contextDesc = procs.slice(0, 2).join(", ")
        }

        otherBookmarks.push({
          id: bookmark.id,
          context: contextDesc,
          created_at: bookmark.created_at,
        })
      }
    }

    return {
      hasExactMatch: !!exactMatchId,
      exactMatchId,
      otherBookmarks,
    }
  } catch (error) {
    console.error("Error checking bookmark context:", error)
    return { hasExactMatch: false, otherBookmarks: [] }
  }
}
