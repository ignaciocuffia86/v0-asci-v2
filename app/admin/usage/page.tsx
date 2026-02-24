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

  // Parallel data fetching
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
    adminClient.auth.admin.listUsers(),
    adminClient.from("bookmarks").select("id, user_id, priority, status, created_at"),
    adminClient.from("user_company_contacts").select("id, user_id, created_at"),
    adminClient.from("company_news").select("id, user_id, requested_by, created_at"),
    adminClient.from("company_implementations").select("id, user_id, requested_by, created_at"),
    adminClient.from("user_company_strategies").select("id, user_id, created_at"),
    adminClient.from("user_icebreakers").select("id, user_id, created_at"),
    adminClient.from("bookmark_summaries").select("id, bookmark_id, created_at, user_email"),
    adminClient.from("user_documents").select("id, user_id, created_at, status"),
    adminClient.from("user_onboarding").select("user_id, status, progress_percentage, current_track, completed_tracks"),
    adminClient.from("profiles").select("id, role"),
  ])

  const users = authUsers || []
  const adminUserIds = new Set((profiles || []).filter((p) => p.role === "superadmin").map((p) => p.id))

  // Build per-user rows
  const userRows: UserRow[] = users.map((u) => {
    const uid = u.id
    const email = u.email || "Sin email"
    const isAdmin = adminUserIds.has(uid)

    const userBookmarks = (bookmarks || []).filter((b) => b.user_id === uid)
    const userContacts = (contacts || []).filter((c) => c.user_id === uid).length
    const userNews = (news || []).filter((n) => n.requested_by === uid || n.user_id === uid).length
    const userImpl = (implementations || []).filter((i) => i.requested_by === uid || i.user_id === uid).length
    const userStrategies = (strategies || []).filter((s) => s.user_id === uid).length
    const userIcebreakers = (icebreakers || []).filter((i) => i.user_id === uid).length
    const userBriefs = (briefs || []).filter((b) => {
      if (b.user_email === email) return true
      const bk = userBookmarks.find((bm) => bm.id === b.bookmark_id)
      return !!bk
    }).length
    const userDocs = (documents || []).filter((d) => d.user_id === uid).length

    // Last activity date
    const allDates: number[] = []
    for (const b of userBookmarks) if (b.created_at) allDates.push(new Date(b.created_at).getTime())
    for (const c of contacts || []) if (c.user_id === uid && c.created_at) allDates.push(new Date(c.created_at).getTime())
    for (const i of icebreakers || []) if (i.user_id === uid && i.created_at) allDates.push(new Date(i.created_at).getTime())
    for (const s of strategies || []) if (s.user_id === uid && s.created_at) allDates.push(new Date(s.created_at).getTime())
    for (const n of news || []) if ((n.requested_by === uid || n.user_id === uid) && n.created_at) allDates.push(new Date(n.created_at).getTime())
    for (const im of implementations || []) if ((im.requested_by === uid || im.user_id === uid) && im.created_at) allDates.push(new Date(im.created_at).getTime())

    const lastActivity = allDates.length > 0
      ? new Date(Math.max(...allDates)).toLocaleDateString("es-AR")
      : "-"

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
      lastActivity,
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

  // Weekly activity (last 8 weeks)
  const now = new Date()
  const eightWeeksAgo = new Date(now)
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56)

  const weekBuckets = new Map<string, { bookmarks: number; contacts: number; icebreakers: number; briefs: number; documents: number }>()
  for (let i = 0; i < 8; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i * 7)
    const key = getWeekStart(d)
    weekBuckets.set(key, { bookmarks: 0, contacts: 0, icebreakers: 0, briefs: 0, documents: 0 })
  }

  const bucketItem = (
    items: Array<{ created_at: string }> | null,
    field: "bookmarks" | "contacts" | "icebreakers" | "briefs" | "documents"
  ) => {
    for (const item of items || []) {
      const created = new Date(item.created_at)
      if (created < eightWeeksAgo) continue
      const key = getWeekStart(created)
      const bucket = weekBuckets.get(key)
      if (bucket) bucket[field]++
    }
  }

  bucketItem(bookmarks, "bookmarks")
  bucketItem(contacts, "contacts")
  bucketItem(icebreakers, "icebreakers")
  bucketItem(briefs, "briefs")
  bucketItem(documents, "documents")

  const weeklyData: WeeklyActivityData[] = Array.from(weekBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, counts]) => ({
      week: getWeekLabel(new Date(weekStart)),
      ...counts,
    }))

  return (
    <UsageDashboardClient
      userRows={userRows}
      onboardingRows={onboardingRows}
      weeklyData={weeklyData}
    />
  )
}
