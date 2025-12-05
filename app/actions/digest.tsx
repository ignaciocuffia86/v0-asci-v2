"use server"

import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"

// UUID del sistema para noticias automáticas (generadas por cron jobs)
// Esto permite distinguirlas de búsquedas manuales de usuarios
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000"

const resend = new Resend(process.env.RESEND_API_KEY)

// Crear cliente con service role para operaciones del sistema
const getServiceClient = () => {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

interface DigestItem {
  id: string
  title: string
  content: string
  source_url: string | null
  source_name: string | null
  published_at: string | null
  company_name: string
  company_id: string
  type: "news" | "implementation"
}

interface UserDigest {
  user_id: string
  email: string
  items: DigestItem[]
}

// Obtener usuarios elegibles para el digest
async function getEligibleUsers(): Promise<{ user_id: string; email: string }[]> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from("user_notification_preferences")
    .select("user_id, users!inner(email)")
    .eq("digest_enabled", true)
    .or(
      "last_digest_sent_at.is.null,last_digest_sent_at.lt." +
        new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
    )

  if (error) {
    console.error("Error fetching eligible users:", error)
    return []
  }

  // Si no hay preferencias, obtener todos los usuarios con bookmarks
  if (!data || data.length === 0) {
    const { data: usersWithBookmarks } = await supabase
      .from("user_company_bookmarks")
      .select("user_id, users!inner(email)")
      .not("user_id", "is", null)

    if (!usersWithBookmarks) return []

    const uniqueUsers = new Map()
    usersWithBookmarks.forEach((item: any) => {
      if (item.users?.email) {
        uniqueUsers.set(item.user_id, { user_id: item.user_id, email: item.users.email })
      }
    })
    return Array.from(uniqueUsers.values())
  }

  return data
    .map((item: any) => ({
      user_id: item.user_id,
      email: item.users?.email,
    }))
    .filter((u) => u.email)
}

// Obtener noticias e implementaciones para un usuario
async function getDigestItemsForUser(userId: string): Promise<DigestItem[]> {
  const supabase = getServiceClient()
  const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  // Obtener company_ids de los bookmarks del usuario
  const { data: bookmarks } = await supabase
    .from("user_company_bookmarks")
    .select("company_id, companies(name)")
    .eq("user_id", userId)

  if (!bookmarks || bookmarks.length === 0) return []

  const companyIds = bookmarks.map((b) => b.company_id)
  const companyNames = new Map(bookmarks.map((b: any) => [b.company_id, b.companies?.name || "Empresa"]))

  // Obtener items ya enviados
  const { data: sentItems } = await supabase
    .from("user_digest_sent_items")
    .select("item_id, item_type")
    .eq("user_id", userId)

  const sentNewsIds = new Set(sentItems?.filter((i) => i.item_type === "news").map((i) => i.item_id) || [])
  const sentImplIds = new Set(sentItems?.filter((i) => i.item_type === "implementation").map((i) => i.item_id) || [])

  // Obtener noticias (excluyendo las buscadas por el mismo usuario)
  const { data: news } = await supabase
    .from("company_news")
    .select("*")
    .in("company_id", companyIds)
    .gte("created_at", twoMonthsAgo)
    .neq("requested_by", userId)
    .order("created_at", { ascending: false })

  // Obtener implementaciones (excluyendo las buscadas por el mismo usuario)
  const { data: implementations } = await supabase
    .from("company_implementations")
    .select("*")
    .in("company_id", companyIds)
    .gte("created_at", twoMonthsAgo)
    .neq("requested_by", userId)
    .order("created_at", { ascending: false })

  const items: DigestItem[] = []

  // Agregar noticias no enviadas
  news?.forEach((n) => {
    if (!sentNewsIds.has(n.id)) {
      items.push({
        id: n.id,
        title: n.title,
        content: n.content,
        source_url: n.source_url,
        source_name: n.source_name,
        published_at: n.published_at,
        company_name: companyNames.get(n.company_id) || "Empresa",
        company_id: n.company_id,
        type: "news",
      })
    }
  })

  // Agregar implementaciones no enviadas
  implementations?.forEach((i) => {
    if (!sentImplIds.has(i.id)) {
      items.push({
        id: i.id,
        title: i.title,
        content: i.content,
        source_url: i.source_url,
        source_name: i.source_name,
        published_at: i.published_at,
        company_name: companyNames.get(i.company_id) || "Empresa",
        company_id: i.company_id,
        type: "implementation",
      })
    }
  })

  return items
}

// Generar HTML del email
function generateEmailHtml(items: DigestItem[]): string {
  // Agrupar por compañía
  const byCompany = new Map<string, DigestItem[]>()
  items.forEach((item) => {
    const existing = byCompany.get(item.company_name) || []
    existing.push(item)
    byCompany.set(item.company_name, existing)
  })

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Noticias ASCI</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
      <div style="background-color: white; border-radius: 8px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
        <h1 style="color: #111; font-size: 24px; margin-bottom: 8px;">Noticias ASCI</h1>
        <p style="color: #666; margin-bottom: 24px;">Estas son las novedades de las cuentas que seguís:</p>
  `

  byCompany.forEach((companyItems, companyName) => {
    html += `
      <div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #eee;">
        <h2 style="color: #111; font-size: 18px; margin-bottom: 16px;">${companyName}</h2>
    `

    companyItems.forEach((item) => {
      const typeLabel = item.type === "news" ? "📰" : "🔧"
      const link = item.source_url
        ? `<a href="${item.source_url}" style="color: #0066cc; text-decoration: none;">(ver fuente)</a>`
        : ""

      html += `
        <div style="margin-bottom: 16px;">
          <p style="margin: 0 0 4px 0; font-weight: 500; color: #333;">
            ${typeLabel} ${item.title} ${link}
          </p>
          <p style="margin: 0; color: #666; font-size: 14px; line-height: 1.5;">
            ${item.content}
          </p>
        </div>
      `
    })

    html += `</div>`
  })

  html += `
        <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; text-align: center;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://asci.vercel.app"}/bookmarks" 
             style="display: inline-block; background-color: #111; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
            Ver en ASCI
          </a>
        </div>
      </div>
      <p style="color: #999; font-size: 12px; text-align: center; margin-top: 16px;">
        Recibís este email porque tenés cuentas guardadas en ASCI.
      </p>
    </body>
    </html>
  `

  return html
}

// Registrar items enviados
async function markItemsAsSent(userId: string, items: DigestItem[]) {
  const supabase = getServiceClient()

  const records = items.map((item) => ({
    user_id: userId,
    item_type: item.type,
    item_id: item.id,
    sent_at: new Date().toISOString(),
  }))

  if (records.length > 0) {
    await supabase.from("user_digest_sent_items").insert(records)
  }

  // Actualizar última fecha de envío
  await supabase.from("user_notification_preferences").upsert(
    {
      user_id: userId,
      last_digest_sent_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  )
}

// Preview del digest para un usuario (sin enviar)
export async function previewDigest(userId: string): Promise<{
  items: DigestItem[]
  html: string
  itemCount: number
}> {
  const items = await getDigestItemsForUser(userId)
  const html = items.length > 0 ? generateEmailHtml(items) : ""

  return {
    items,
    html,
    itemCount: items.length,
  }
}

// Ejecutar el digest mensual
export async function runMonthlyDigest(): Promise<{
  success: boolean
  usersProcessed: number
  emailsSent: number
  errors: string[]
}> {
  const supabase = getServiceClient()
  const errors: string[] = []
  let emailsSent = 0

  const users = await getEligibleUsers()

  for (const user of users) {
    try {
      const items = await getDigestItemsForUser(user.user_id)

      if (items.length === 0) {
        continue
      }

      const html = generateEmailHtml(items)

      // Enviar email
      const { error: sendError } = await resend.emails.send({
        from: "ASCI <noreply@asci.app>",
        to: user.email,
        subject: `Noticias ASCI - ${items.length} novedades de tus cuentas`,
        html,
      })

      if (sendError) {
        errors.push(`Error sending to ${user.email}: ${sendError.message}`)
        continue
      }

      // Registrar items enviados
      await markItemsAsSent(user.user_id, items)

      // Registrar en log
      await supabase.from("digest_log").insert({
        user_id: user.user_id,
        items_count: items.length,
        sent_at: new Date().toISOString(),
      })

      emailsSent++
    } catch (err) {
      errors.push(`Error processing ${user.email}: ${err}`)
    }
  }

  return {
    success: errors.length === 0,
    usersProcessed: users.length,
    emailsSent,
    errors,
  }
}
