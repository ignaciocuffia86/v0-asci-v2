"use server"

import { createClient } from "@/lib/supabase/server"
import { type BookmarkStatus } from "@/lib/bookmark-types"

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
          const techs: string[] = ctx.filtersUsed.technology || []
          const procs: string[] = ctx.filtersUsed.process || []
          if (techs.length > 0) {
            // Mostrar primeras 2 y "+N más" si hay más
            const shown = techs.slice(0, 2)
            const rest = techs.length - 2
            contextDesc = rest > 0 ? `${shown.join(", ")} +${rest} más` : shown.join(", ")
          } else if (procs.length > 0) {
            const shown = procs.slice(0, 2)
            const rest = procs.length - 2
            contextDesc = rest > 0 ? `${shown.join(", ")} +${rest} más` : shown.join(", ")
          }
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

export async function updateBookmarkScope(
  bookmarkId: string,
  userId: string,
  newScope: {
    filterSignalIds: string[]
    filterType: string | null
    filtersUsed: { technology?: string[]; process?: string[] }
  },
) {
  const supabase = await createClient()

  try {
    // Check for collision: does another bookmark for the same company already have this exact scope?
    const { data: current, error: fetchError } = await supabase
      .from("bookmarks")
      .select("id, company_id")
      .eq("id", bookmarkId)
      .eq("user_id", userId)
      .single()

    if (fetchError || !current) throw fetchError || new Error("Bookmark not found")

    const currentSignalIds = newScope.filterSignalIds.sort().join(",")
    const currentFilterType = newScope.filterType || "generic"

    const { data: siblings } = await supabase
      .from("bookmarks")
      .select("id, search_context")
      .eq("user_id", userId)
      .eq("company_id", current.company_id)
      .neq("id", bookmarkId)

    for (const sibling of siblings || []) {
      const ctx = sibling.search_context || {}
      const siblingIds = (ctx.filterSignalIds || []).sort().join(",")
      const siblingType = ctx.filterType || "generic"
      if (siblingIds === currentSignalIds && siblingType === currentFilterType) {
        return { success: false, collision: true, collidingId: sibling.id }
      }
    }

    const newSearchContext = {
      filterSignalIds: newScope.filterSignalIds,
      filterType: newScope.filterType,
      filtersUsed: newScope.filtersUsed,
      scope_modified_at: new Date().toISOString(),
      scope_modified_by_user: true,
    }

    const { error } = await supabase
      .from("bookmarks")
      .update({ search_context: newSearchContext, updated_at: new Date().toISOString() })
      .eq("id", bookmarkId)
      .eq("user_id", userId)

    if (error) throw error

    return { success: true, collision: false }
  } catch (error) {
    console.error("Error updating bookmark scope:", error)
    return { success: false, collision: false, error }
  }
}

export async function updateBookmarkStatus(bookmarkId: string, userId: string, status: BookmarkStatus) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("bookmarks")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", bookmarkId)
      .eq("user_id", userId)
      .select("id, status")
      .single()

    if (error) throw error

    return { success: true, bookmark: data }
  } catch (error) {
    console.error("Error updating bookmark status:", error)
    return { success: false, error }
  }
}

export async function getBookmarksWithFilters(
  userId: string,
  filters?: {
    status?: BookmarkStatus[]
    priority?: string[]
    search?: string
  }
) {
  const supabase = await createClient()

  try {
    let query = supabase
      .from("bookmarks")
      .select(`
        id,
        notes,
        priority,
        status,
        search_context,
        created_at,
        updated_at,
        company:companies (
          id,
          name,
          industry,
          country_normalized,
          website,
          linkedin_url,
          logo_url
        )
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    // Apply status filter
    if (filters?.status && filters.status.length > 0) {
      query = query.in("status", filters.status)
    }

    // Apply priority filter
    if (filters?.priority && filters.priority.length > 0) {
      query = query.in("priority", filters.priority)
    }

    const { data, error } = await query

    if (error) throw error

    // Apply search filter client-side (for company name)
    let filteredData = data || []
    if (filters?.search && filters.search.trim()) {
      const searchLower = filters.search.toLowerCase()
      filteredData = filteredData.filter((b: any) =>
        b.company?.name?.toLowerCase().includes(searchLower)
      )
    }

    return { success: true, bookmarks: filteredData }
  } catch (error) {
    console.error("Error fetching bookmarks with filters:", error)
    return { success: false, bookmarks: [], error }
  }
}

export async function getBookmarkStats(userId: string) {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase
      .from("bookmarks")
      .select("status, priority")
      .eq("user_id", userId)

    if (error) throw error

    const stats = {
      byStatus: {} as Record<BookmarkStatus, number>,
      byPriority: {} as Record<string, number>,
      total: data?.length || 0,
    }

    // Initialize counts
    for (const status of Object.keys(BOOKMARK_STATUS_CONFIG)) {
      stats.byStatus[status as BookmarkStatus] = 0
    }

    for (const bookmark of data || []) {
      if (bookmark.status) {
        stats.byStatus[bookmark.status as BookmarkStatus] = (stats.byStatus[bookmark.status as BookmarkStatus] || 0) + 1
      }
      if (bookmark.priority) {
        stats.byPriority[bookmark.priority] = (stats.byPriority[bookmark.priority] || 0) + 1
      }
    }

    return { success: true, stats }
  } catch (error) {
    console.error("Error fetching bookmark stats:", error)
    return { success: false, stats: null, error }
  }
}

export async function bookmarkCompanyBatch(userId: string, companyIds: string[], searchContext: any = {}) {
  const supabase = await createClient()

  if (!companyIds || companyIds.length === 0) {
    return {
      success: false,
      error: "No companies selected",
      results: [],
    }
  }

  try {
    const bookmarksData = companyIds.map((companyId) => ({
      user_id: userId,
      company_id: companyId,
      search_context: searchContext,
    }))

    const { data, error } = await supabase.from("bookmarks").insert(bookmarksData).select("id, company_id")

    if (error) throw error

    return {
      success: true,
      bookmarkIds: data?.map((b) => b.id) || [],
      companiesCount: companyIds.length,
      results: data || [],
    }
  } catch (error: any) {
    console.error("Error creating bookmarks batch:", error)
    return {
      success: false,
      error: error.message || "Failed to create bookmarks",
      results: [],
    }
  }
}
