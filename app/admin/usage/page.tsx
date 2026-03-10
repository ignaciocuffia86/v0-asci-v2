import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { redirect } from "next/navigation"
import { UsageDashboardClient, type UserRow } from "@/components/admin/usage-dashboard"
import type { WeeklyActivityData } from "@/components/admin/usage-charts"

// Helper to get ISO week label
function getWeekLabel(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `S${weekNum}`
}

function getWeekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().split("T")[0]
}

export default async function AdminUsagePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (profile?.role !== "superadmin") redirect("/")

  const adminClient = createAdminClient()

  // Parallel data fetching - usando perPage: 1000 para soportar hasta 200+ usuarios
  const [
    { data: { users: authUsers } },
    { data: bookmarks },
    { data: contacts },
    { data: news },
    { data: implementations },
    { data: strategies },
    { data: icebreakers },
    { data: briefs },
    { data: documents },
    { data: onboarding },
    { data: profiles },
  ] = await Promise.all([
    adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    adminClient.from("bookmarks").select("id, user_id, company_id, priority, status, created_at"),
    adminClient.from("user_company_contacts").select("id, user_id, created_at"),
    adminClient.from("company_news").select("id, company_id, requested_by, created_at"),
    adminClient.from("company_implementations").select("id, company_id, requested_by, created_at"),
    adminClient.from("user_company_strategies").select("id, user_id, created_at"),
    adminClient.from("user_icebreakers").select("id, user_id, created_at"),
    adminClient.from("bookmark_summaries").select("id, bookmark_id, created_at, user_email"),
    adminClient.from("user_documents").select("id, user_id, created_at, status"),
    adminClient.from("user_onboarding").select("user_id, status, progress_percentage, current_track, completed_tracks"),
    adminClient.from("profiles").select("id, role"),
  ])

  const users = authUsers || []
  const adminUserIds = new Set((profiles || []).filter((p) => p.role === "superadmin").map((p) => p.id))

  // Calculate week boundaries for WoW comparison
  const now = new Date()
  const thisWeekStart = new Date(now)
  thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay())
  thisWeekStart.setHours(0, 0, 0, 0)
  
  const lastWeekStart = new Date(thisWeekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)
  
  const lastWeekEnd = new Date(thisWeekStart)

  // Helper to check if date is in this week
  const isThisWeek = (dateStr: string | null) => {
    if (!dateStr) return false
    const date = new Date(dateStr)
    return date >= thisWeekStart
  }
  
  // Helper to check if date is in last week
  const isLastWeek = (dateStr: string | null) => {
    if (!dateStr) return false
    const date = new Date(dateStr)
    return date >= lastWeekStart && date < lastWeekEnd
  }

  // Build per-user rows
  const userRows: UserRow[] = users.map((u) => {
    const uid = u.id
    const email = u.email || "Sin email"
    const isAdmin = adminUserIds.has(uid)

    const userBookmarks = (bookmarks || []).filter((b) => b.user_id === uid)
    const userCompanyIds = new Set(userBookmarks.map((b) => b.company_id))
    const userContacts = (contacts || []).filter((c) => c.user_id === uid).length
    // News/implementations: count distinct items where the company is in the user's bookmarks OR they requested it
    const userNewsSet = new Set<string>()
    for (const n of news || []) {
      if (n.requested_by === uid || (n.company_id && userCompanyIds.has(n.company_id))) {
        userNewsSet.add(n.id)
      }
    }
    const userNews = userNewsSet.size
    const userImplSet = new Set<string>()
    for (const i of implementations || []) {
      if (i.requested_by === uid || (i.company_id && userCompanyIds.has(i.company_id))) {
        userImplSet.add(i.id)
      }
    }
    const userImpl = userImplSet.size
    const userStrategies = (strategies || []).filter((s) => s.user_id === uid).length
    const userIcebreakers = (icebreakers || []).filter((i) => i.user_id === uid).length
    const userBriefs = (briefs || []).filter((b) => {
      if (b.user_email === email) return true
      const bk = userBookmarks.find((bm) => bm.id === b.bookmark_id)
      return !!bk
    }).length
    const userDocs = (documents || []).filter((d) => d.user_id === uid).length

    // Last activity date and days since last activity
    const allDates: number[] = []
    const allDatesWithCreated: { date: string; type: string }[] = []
    
    for (const b of userBookmarks) {
      if (b.created_at) {
        allDates.push(new Date(b.created_at).getTime())
        allDatesWithCreated.push({ date: b.created_at, type: "bookmark" })
      }
    }
    for (const c of contacts || []) {
      if (c.user_id === uid && c.created_at) {
        allDates.push(new Date(c.created_at).getTime())
        allDatesWithCreated.push({ date: c.created_at, type: "contact" })
      }
    }
    for (const i of icebreakers || []) {
      if (i.user_id === uid && i.created_at) {
        allDates.push(new Date(i.created_at).getTime())
        allDatesWithCreated.push({ date: i.created_at, type: "icebreaker" })
      }
    }
    for (const s of strategies || []) {
      if (s.user_id === uid && s.created_at) {
        allDates.push(new Date(s.created_at).getTime())
        allDatesWithCreated.push({ date: s.created_at, type: "strategy" })
      }
    }
    for (const n of news || []) {
      if (n.requested_by === uid && n.created_at) {
        allDates.push(new Date(n.created_at).getTime())
        allDatesWithCreated.push({ date: n.created_at, type: "news" })
      }
    }
    for (const im of implementations || []) {
      if (im.requested_by === uid && im.created_at) {
        allDates.push(new Date(im.created_at).getTime())
        allDatesWithCreated.push({ date: im.created_at, type: "implementation" })
      }
    }

    const lastActivityTimestamp = allDates.length > 0 ? Math.max(...allDates) : null
    const lastActivity = lastActivityTimestamp
      ? new Date(lastActivityTimestamp).toLocaleDateString("es-AR")
      : "-"
    
    // Days since last activity
    const daysSinceLastActivity = lastActivityTimestamp
      ? Math.floor((now.getTime() - lastActivityTimestamp) / (1000 * 60 * 60 * 24))
      : -1 // -1 means never active
    
    // WoW calculation
    const thisWeekActions = allDatesWithCreated.filter(d => isThisWeek(d.date)).length
    const lastWeekActions = allDatesWithCreated.filter(d => isLastWeek(d.date)).length
    
    let weekOverWeekGrowth: number | null = null
    if (lastWeekActions > 0) {
      weekOverWeekGrowth = Math.round(((thisWeekActions - lastWeekActions) / lastWeekActions) * 100)
    } else if (thisWeekActions > 0) {
      weekOverWeekGrowth = 100 // New activity this week
    }
    
    // Last sign in from Supabase Auth
    const lastSignIn = u.last_sign_in_at || null

    const ob = (onboarding || []).find((o) => o.user_id === uid)

    return {
      email,
      isAdmin,
      bookmarks: userBookmarks.length,
      contacts: userContacts,
      news: userNews,
      implementations: userImpl,
      strategies: userStrategies,
      icebreakers: userIcebreakers,
      briefs: userBriefs,
      documents: userDocs,
      userId: uid,
      createdAt: u.created_at ? new Date(u.created_at).toLocaleDateString("es-AR") : "-",
      createdAtTimestamp: u.created_at ? new Date(u.created_at).getTime() : 0,
      lastActivity,
      lastSignIn,
      daysSinceLastActivity,
      weekOverWeekGrowth,
      thisWeekActions,
      lastWeekActions,
      onboardingStatus: ob?.status || "sin registro",
      onboardingProgress: ob?.progress_percentage || 0,
    }
  })

  // Onboarding rows for pie chart (need isAdmin flag)
  const onboardingRows = (onboarding || []).map((o) => ({
    status: o.status,
    userId: o.user_id,
    isAdmin: adminUserIds.has(o.user_id),
  }))

  // Weekly activity (last 8 weeks) - build for ALL and for NON-ADMIN
  const eightWeeksAgo = new Date(now)
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56)

  type WeekBucket = { bookmarks: number; contacts: number; icebreakers: number; briefs: number; documents: number }
  const makeWeekBuckets = () => {
    const m = new Map<string, WeekBucket>()
    for (let i = 0; i < 8; i++) {
      const d = new Date(now)
      d.setDate(d.getDate() - i * 7)
      m.set(getWeekStart(d), { bookmarks: 0, contacts: 0, icebreakers: 0, briefs: 0, documents: 0 })
    }
    return m
  }

  const weekBucketsAll = makeWeekBuckets()
  const weekBucketsFiltered = makeWeekBuckets()

  const bucketItemWithUser = (
    items: Array<{ created_at: string; user_id?: string | null }> | null,
    field: keyof WeekBucket,
  ) => {
    for (const item of items || []) {
      const created = new Date(item.created_at)
      if (created < eightWeeksAgo) continue
      const key = getWeekStart(created)
      const bucketAll = weekBucketsAll.get(key)
      if (bucketAll) bucketAll[field]++
      if (item.user_id && !adminUserIds.has(item.user_id)) {
        const bucketF = weekBucketsFiltered.get(key)
        if (bucketF) bucketF[field]++
      }
    }
  }

  bucketItemWithUser(bookmarks, "bookmarks")
  bucketItemWithUser(contacts, "contacts")
  bucketItemWithUser(icebreakers, "icebreakers")
  bucketItemWithUser(
    (briefs || []).map((b) => {
      const bk = (bookmarks || []).find((bm) => bm.id === b.bookmark_id)
      return { ...b, user_id: bk?.user_id ?? null }
    }),
    "briefs",
  )
  bucketItemWithUser(documents, "documents")

  const toWeeklyArr = (buckets: Map<string, WeekBucket>): WeeklyActivityData[] =>
    Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, counts]) => ({
        week: getWeekLabel(new Date(weekStart)),
        ...counts,
      }))

  const weeklyDataAll = toWeeklyArr(weekBucketsAll)
  const weeklyDataFiltered = toWeeklyArr(weekBucketsFiltered)

  return (
    <UsageDashboardClient
      userRows={userRows}
      onboardingRows={onboardingRows}
      weeklyDataAll={weeklyDataAll}
      weeklyDataFiltered={weeklyDataFiltered}
    />
  )
}
