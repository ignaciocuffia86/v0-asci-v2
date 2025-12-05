"use server"

import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"

// UUID especial para identificar noticias generadas automáticamente por el sistema
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000"

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

const resend = new Resend(process.env.RESEND_API_KEY)

interface DigestItem {
  companyId: string
  companyName: string
  news: Array<{
    id: string
    title: string
    content: string
    source_url: string | null
    source_name: string | null
    published_at: string | null
    type: "news" | "implementation"
  }>
}

interface DigestResult {
  items: DigestItem[]
  html: string
  itemCount: number
}

// Genera el HTML del email digest
function generateDigestHtml(items: DigestItem[], userName: string): string {
  const companySections = items
    .map(
      (item) => `
      <div style="margin-bottom: 24px; padding: 16px; background: #f9fafb; border-radius: 8px;">
        <h2 style="margin: 0 0 12px 0; color: #111827; font-size: 18px;">${item.companyName}</h2>
        ${item.news
          .map(
            (n) => `
          <div style="margin-bottom: 12px; padding-left: 12px; border-left: 3px solid ${n.type === "news" ? "#3b82f6" : "#10b981"};">
            <p style="margin: 0 0 4px 0; font-weight: 600; color: #374151;">
              ${n.source_url ? `<a href="${n.source_url}" style="color: #3b82f6; text-decoration: none;">${n.title}</a>` : n.title}
            </p>
            <p style="margin: 0; color: #6b7280; font-size: 14px;">${n.content}</p>
            ${n.published_at ? `<p style="margin: 4px 0 0 0; color: #9ca3af; font-size: 12px;">Publicado: ${new Date(n.published_at).toLocaleDateString("es-AR")}</p>` : ""}
          </div>
        `,
          )
          .join("")}
      </div>
    `,
    )
    .join("")

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Noticias ASCI</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #ffffff;">
      <div style="max-width: 600px; margin: 0 auto; padding: 24px;">
        <h1 style="color: #111827; font-size: 24px; margin-bottom: 8px;">Noticias ASCI</h1>
        <p style="color: #6b7280; margin-bottom: 24px;">Hola ${userName}, estas son las novedades de las cuentas que seguís:</p>
        
        ${companySections}
        
        <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
          <p style="color: #9ca3af; font-size: 12px; margin: 0;">
            Este es un email automático generado por ASCI. 
            <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://asci.vercel.app"}" style="color: #3b82f6;">Ver en la app</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `
}

// Preview del digest sin enviarlo
export async function previewDigest(userId: string): Promise<DigestResult> {
  const twoMonthsAgo = new Date()
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2)

  // Obtener bookmarks del usuario
  const { data: bookmarks } = await supabase
    .from("bookmarks")
    .select("company_id, companies(id, name)")
    .eq("user_id", userId)

  if (!bookmarks || bookmarks.length === 0) {
    return { items: [], html: "", itemCount: 0 }
  }

  const companyIds = bookmarks.map((b) => b.company_id)

  // Obtener noticias que NO fueron buscadas por el usuario
  const { data: news } = await supabase
    .from("company_news")
    .select("*")
    .in("company_id", companyIds)
    .gte("published_at", twoMonthsAgo.toISOString())
    .neq("requested_by", userId)
    .order("published_at", { ascending: false })

  // Obtener implementaciones que NO fueron buscadas por el usuario
  const { data: implementations } = await supabase
    .from("company_implementations")
    .select("*")
    .in("company_id", companyIds)
    .gte("published_at", twoMonthsAgo.toISOString())
    .neq("requested_by", userId)
    .order("published_at", { ascending: false })

  // Obtener items ya enviados
  const { data: sentItems } = await supabase
    .from("user_digest_sent_items")
    .select("item_id, item_type")
    .eq("user_id", userId)

  const sentNewsIds = new Set(sentItems?.filter((s) => s.item_type === "news").map((s) => s.item_id) || [])
  const sentImplIds = new Set(sentItems?.filter((s) => s.item_type === "implementation").map((s) => s.item_id) || [])

  // Filtrar items ya enviados
  const filteredNews = (news || []).filter((n) => !sentNewsIds.has(n.id))
  const filteredImpl = (implementations || []).filter((i) => !sentImplIds.has(i.id))

  // Agrupar por empresa
  const itemsByCompany = new Map<string, DigestItem>()

  for (const bookmark of bookmarks) {
    const company = bookmark.companies as any
    if (!company) continue

    const companyNews = filteredNews.filter((n) => n.company_id === company.id)
    const companyImpl = filteredImpl.filter((i) => i.company_id === company.id)

    if (companyNews.length > 0 || companyImpl.length > 0) {
      itemsByCompany.set(company.id, {
        companyId: company.id,
        companyName: company.name,
        news: [
          ...companyNews.map((n) => ({
            id: n.id,
            title: n.title,
            content: n.summary || n.content || "",
            source_url: n.source_url,
            source_name: n.source_name,
            published_at: n.published_at,
            type: "news" as const,
          })),
          ...companyImpl.map((i) => ({
            id: i.id,
            title: i.title,
            content: i.summary || i.content || "",
            source_url: i.source_url,
            source_name: i.source_name,
            published_at: i.published_at,
            type: "implementation" as const,
          })),
        ],
      })
    }
  }

  const items = Array.from(itemsByCompany.values())
  const itemCount = items.reduce((acc, i) => acc + i.news.length, 0)

  // Obtener nombre del usuario
  const { data: profile } = await supabase.from("profiles").select("full_name, email").eq("id", userId).single()

  const userName = profile?.full_name || profile?.email || "Usuario"
  const html = generateDigestHtml(items, userName)

  return { items, html, itemCount }
}

// Ejecuta el digest mensual para todos los usuarios elegibles
export async function runMonthlyDigest(): Promise<{
  processed: number
  sent: number
  skipped: number
  failed: number
  details: any[]
}> {
  const results = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    details: [] as any[],
  }

  // Obtener usuarios con digest habilitado
  const { data: users } = await supabase
    .from("user_notification_preferences")
    .select("user_id, profiles(email, full_name)")
    .eq("digest_enabled", true)

  // Si no hay preferencias, obtener todos los usuarios con bookmarks
  let usersToProcess = users || []

  if (usersToProcess.length === 0) {
    const { data: usersWithBookmarks } = await supabase
      .from("bookmarks")
      .select("user_id, profiles(email, full_name)")
      .limit(100)

    // Deduplicar por user_id
    const uniqueUsers = new Map()
    for (const u of usersWithBookmarks || []) {
      if (!uniqueUsers.has(u.user_id)) {
        uniqueUsers.set(u.user_id, u)
      }
    }
    usersToProcess = Array.from(uniqueUsers.values())
  }

  for (const userPref of usersToProcess) {
    results.processed++
    const userId = userPref.user_id
    const profile = userPref.profiles as any

    if (!profile?.email) {
      results.skipped++
      results.details.push({ userId, status: "skipped", reason: "No email" })
      continue
    }

    try {
      const digest = await previewDigest(userId)

      if (digest.itemCount === 0) {
        results.skipped++
        results.details.push({ userId, status: "skipped", reason: "No items" })
        continue
      }

      // Enviar email
      await resend.emails.send({
        from: "ASCI <noticias@asci.app>",
        to: profile.email,
        subject: `Noticias ASCI - ${digest.itemCount} novedades de tus cuentas`,
        html: digest.html,
      })

      // Registrar items enviados
      const itemsToInsert = digest.items.flatMap((item) =>
        item.news.map((n) => ({
          user_id: userId,
          item_type: n.type,
          item_id: n.id,
          sent_at: new Date().toISOString(),
        })),
      )

      if (itemsToInsert.length > 0) {
        await supabase.from("user_digest_sent_items").insert(itemsToInsert)
      }

      // Actualizar último envío
      await supabase.from("user_notification_preferences").upsert({
        user_id: userId,
        last_digest_sent_at: new Date().toISOString(),
        digest_enabled: true,
      })

      // Registrar en log
      await supabase.from("digest_log").insert({
        user_id: userId,
        items_count: digest.itemCount,
        status: "sent",
      })

      results.sent++
      results.details.push({
        userId,
        email: profile.email,
        status: "sent",
        itemCount: digest.itemCount,
      })
    } catch (error: any) {
      results.failed++
      results.details.push({
        userId,
        status: "failed",
        error: error.message,
      })

      // Registrar error en log
      await supabase.from("digest_log").insert({
        user_id: userId,
        items_count: 0,
        status: "failed",
        error_message: error.message,
      })
    }
  }

  return results
}
