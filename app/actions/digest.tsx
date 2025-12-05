"use server"

import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"

// UUID de sistema para noticias automáticas (no se excluyen del digest de ningún usuario)
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000"

// Cliente Supabase con service role para operaciones de sistema
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
  item_type: "news" | "implementation"
}

interface CompanyDigest {
  company_id: string
  company_name: string
  items: DigestItem[]
}

interface UserDigest {
  user_id: string
  user_email: string
  companies: CompanyDigest[]
}

// Obtener usuarios elegibles para digest
async function getEligibleUsers(): Promise<{ id: string; email: string }[]> {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from("user_notification_preferences")
    .select("user_id, users!inner(email)")
    .eq("digest_enabled", true)

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

    // Deduplicar usuarios
    const uniqueUsers = new Map<string, string>()
    usersWithBookmarks.forEach((b: any) => {
      if (b.user_id && b.users?.email) {
        uniqueUsers.set(b.user_id, b.users.email)
      }
    })

    return Array.from(uniqueUsers.entries()).map(([id, email]) => ({ id, email }))
  }

  return data
    .map((d: any) => ({
      id: d.user_id,
      email: d.users?.email || "",
    }))
    .filter((u) => u.email)
}

// Obtener contenido del digest para un usuario
async function getDigestContent(userId: string): Promise<CompanyDigest[]> {
  const supabase = getServiceClient()

  // Obtener bookmarks del usuario
  const { data: bookmarks } = await supabase
    .from("user_company_bookmarks")
    .select("company_id, companies(name)")
    .eq("user_id", userId)

  if (!bookmarks || bookmarks.length === 0) return []

  const companyIds = bookmarks.map((b: any) => b.company_id)
  const companyNames = new Map(bookmarks.map((b: any) => [b.company_id, b.companies?.name || "Empresa"]))

  // Fecha límite: 2 meses atrás
  const twoMonthsAgo = new Date()
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2)

  // Obtener items ya enviados a este usuario
  const { data: sentItems } = await supabase
    .from("user_digest_sent_items")
    .select("item_id, item_type")
    .eq("user_id", userId)

  const sentNewsIds = new Set(sentItems?.filter((i: any) => i.item_type === "news").map((i: any) => i.item_id) || [])
  const sentImplIds = new Set(
    sentItems?.filter((i: any) => i.item_type === "implementation").map((i: any) => i.item_id) || [],
  )

  // Obtener noticias
  const { data: news } = await supabase
    .from("company_news")
    .select("id, company_id, title, content, source_url, source_name, published_at, requested_by")
    .in("company_id", companyIds)
    .gte("published_at", twoMonthsAgo.toISOString())
    .neq("requested_by", userId) // Excluir las que el usuario buscó
    .order("published_at", { ascending: false })

  // Obtener implementaciones
  const { data: implementations } = await supabase
    .from("company_implementations")
    .select("id, company_id, title, content, source_url, source_name, published_at, requested_by")
    .in("company_id", companyIds)
    .gte("published_at", twoMonthsAgo.toISOString())
    .neq("requested_by", userId)
    .order("published_at", { ascending: false })

  // Agrupar por compañía
  const companiesMap = new Map<string, CompanyDigest>()

  companyIds.forEach((companyId: string) => {
    companiesMap.set(companyId, {
      company_id: companyId,
      company_name: companyNames.get(companyId) || "Empresa",
      items: [],
    })
  })

  // Agregar noticias no enviadas
  news?.forEach((item: any) => {
    if (!sentNewsIds.has(item.id)) {
      const company = companiesMap.get(item.company_id)
      if (company) {
        company.items.push({
          id: item.id,
          title: item.title,
          content: item.content,
          source_url: item.source_url,
          source_name: item.source_name,
          published_at: item.published_at,
          item_type: "news",
        })
      }
    }
  })

  // Agregar implementaciones no enviadas
  implementations?.forEach((item: any) => {
    if (!sentImplIds.has(item.id)) {
      const company = companiesMap.get(item.company_id)
      if (company) {
        company.items.push({
          id: item.id,
          title: item.title,
          content: item.content,
          source_url: item.source_url,
          source_name: item.source_name,
          published_at: item.published_at,
          item_type: "implementation",
        })
      }
    }
  })

  // Filtrar compañías sin items
  return Array.from(companiesMap.values()).filter((c) => c.items.length > 0)
}

// Generar HTML del email
function generateEmailHtml(companies: CompanyDigest[]): string {
  const companyBlocks = companies
    .map(
      (company) => `
      <div style="margin-bottom: 24px; padding: 16px; background-color: #f9fafb; border-radius: 8px;">
        <h2 style="margin: 0 0 12px 0; color: #111827; font-size: 18px;">${company.company_name}</h2>
        ${company.items
          .map(
            (item) => `
          <div style="margin-bottom: 12px; padding-left: 12px; border-left: 3px solid ${item.item_type === "news" ? "#3b82f6" : "#10b981"};">
            <p style="margin: 0 0 4px 0;">
              <a href="${item.source_url || "#"}" style="color: #1d4ed8; text-decoration: none; font-weight: 500;">
                ${item.title}
              </a>
              <span style="color: #6b7280; font-size: 12px; margin-left: 8px;">
                ${item.item_type === "news" ? "📰 Noticia" : "🔧 Implementación"}
              </span>
            </p>
            <p style="margin: 0; color: #4b5563; font-size: 14px;">${item.content}</p>
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
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #111827;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="margin: 0; color: #111827;">Noticias ASCI</h1>
        <p style="margin: 8px 0 0 0; color: #6b7280;">Estas son las novedades de las cuentas que seguís</p>
      </div>
      
      ${companyBlocks}
      
      <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; text-align: center; color: #9ca3af; font-size: 12px;">
        <p>Recibís este email porque tenés bookmarks activos en ASCI.</p>
        <p>© ${new Date().getFullYear()} ASCI. Todos los derechos reservados.</p>
      </div>
    </body>
    </html>
  `
}

// Enviar digest a un usuario
async function sendDigestEmail(userEmail: string, companies: CompanyDigest[]): Promise<boolean> {
  const resend = new Resend(process.env.RESEND_API_KEY)

  try {
    const { error } = await resend.emails.send({
      from: "ASCI <noreply@asci.com>",
      to: userEmail,
      subject: `Noticias ASCI - ${companies.length} empresa${companies.length > 1 ? "s" : ""} con novedades`,
      html: generateEmailHtml(companies),
    })

    if (error) {
      console.error("Error sending digest email:", error)
      return false
    }

    return true
  } catch (error) {
    console.error("Error sending digest email:", error)
    return false
  }
}

// Marcar items como enviados
async function markItemsAsSent(userId: string, companies: CompanyDigest[]) {
  const supabase = getServiceClient()

  const items = companies.flatMap((company) =>
    company.items.map((item) => ({
      user_id: userId,
      item_type: item.item_type,
      item_id: item.id,
      sent_at: new Date().toISOString(),
    })),
  )

  if (items.length > 0) {
    await supabase.from("user_digest_sent_items").insert(items)
  }
}

// Ejecutar el digest mensual
export async function runMonthlyDigest(): Promise<{
  totalUsers: number
  usersWithContent: number
  emailsSent: number
  emailsFailed: number
}> {
  const supabase = getServiceClient()
  const users = await getEligibleUsers()

  let usersWithContent = 0
  let emailsSent = 0
  let emailsFailed = 0

  for (const user of users) {
    const companies = await getDigestContent(user.id)

    if (companies.length > 0) {
      usersWithContent++

      const success = await sendDigestEmail(user.email, companies)

      if (success) {
        emailsSent++
        await markItemsAsSent(user.id, companies)

        // Actualizar last_digest_sent_at
        await supabase.from("user_notification_preferences").upsert({
          user_id: user.id,
          last_digest_sent_at: new Date().toISOString(),
        })

        // Log del digest enviado
        await supabase.from("digest_log").insert({
          user_id: user.id,
          items_count: companies.flatMap((c) => c.items).length,
          companies_count: companies.length,
          sent_at: new Date().toISOString(),
        })
      } else {
        emailsFailed++
      }
    }
  }

  return {
    totalUsers: users.length,
    usersWithContent,
    emailsSent,
    emailsFailed,
  }
}

// Preview del digest para un usuario (sin enviar)
export async function previewDigest(userId: string): Promise<{
  companies: CompanyDigest[]
  html: string
  totalItems: number
}> {
  const companies = await getDigestContent(userId)
  const html = generateEmailHtml(companies)
  const totalItems = companies.reduce((acc, c) => acc + c.items.length, 0)

  return { companies, html, totalItems }
}
