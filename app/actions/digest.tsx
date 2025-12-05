"use server"

import { createClient } from "@/lib/supabase/server"
import { Resend } from "resend"

const resend = new Resend(process.env.RESEND_API_KEY)

// UUID de sistema para noticias automáticas (cron jobs)
export const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000"

interface NewsItem {
  id: string
  title: string
  summary: string
  content?: string
  source_url: string
  source_name: string
  published_at: string
  signal_type?: string
}

interface CompanyDigest {
  companyId: string
  companyName: string
  news: NewsItem[]
  implementations: NewsItem[]
}

interface UserDigest {
  userId: string
  email: string
  firstName?: string
  companies: CompanyDigest[]
}

/**
 * Obtiene usuarios elegibles para el digest mensual
 */
export async function getEligibleUsersForDigest(): Promise<{ id: string; email: string; first_name?: string }[]> {
  const supabase = await createClient()

  // Usuarios con preferencia de digest habilitada (o sin preferencia = habilitado por defecto)
  const { data: users, error } = await supabase
    .from("profiles")
    .select(`
      id,
      email,
      first_name,
      user_notification_preferences (
        digest_enabled
      )
    `)
    .not("email", "is", null)

  if (error) {
    console.error("Error fetching users for digest:", error)
    return []
  }

  // Filtrar usuarios con digest habilitado
  return (users || [])
    .filter((u) => {
      const prefs = u.user_notification_preferences as any
      // Si no tiene preferencias, está habilitado por defecto
      if (!prefs || prefs.length === 0) return true
      return prefs[0]?.digest_enabled !== false
    })
    .map((u) => ({
      id: u.id,
      email: u.email!,
      first_name: u.first_name,
    }))
}

/**
 * Genera el contenido del digest para un usuario específico
 */
export async function generateUserDigest(userId: string): Promise<UserDigest | null> {
  const supabase = await createClient()

  // Obtener info del usuario
  const { data: user } = await supabase.from("profiles").select("id, email, first_name").eq("id", userId).single()

  if (!user || !user.email) return null

  // Obtener bookmarks del usuario
  const { data: bookmarks } = await supabase
    .from("bookmarks")
    .select(`
      id,
      company_id,
      companies (
        id,
        name
      )
    `)
    .eq("user_id", userId)

  if (!bookmarks || bookmarks.length === 0) return null

  const companyIds = bookmarks.map((b) => b.company_id).filter(Boolean)
  const twoMonthsAgo = new Date()
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2)

  // Obtener items ya enviados a este usuario
  const { data: sentItems } = await supabase
    .from("user_digest_sent_items")
    .select("item_id, item_type")
    .eq("user_id", userId)

  const sentNewsIds = new Set((sentItems || []).filter((i) => i.item_type === "news").map((i) => i.item_id))
  const sentImplIds = new Set((sentItems || []).filter((i) => i.item_type === "implementation").map((i) => i.item_id))

  // Obtener noticias (excluyendo las buscadas por el mismo usuario y las ya enviadas)
  const { data: allNews } = await supabase
    .from("company_news")
    .select("*")
    .in("company_id", companyIds)
    .gte("published_at", twoMonthsAgo.toISOString())
    .or(`requested_by.is.null,requested_by.neq.${userId}`)
    .order("published_at", { ascending: false })

  // Obtener implementaciones (mismo filtro)
  const { data: allImplementations } = await supabase
    .from("company_implementations")
    .select("*")
    .in("company_id", companyIds)
    .gte("published_at", twoMonthsAgo.toISOString())
    .or(`requested_by.is.null,requested_by.neq.${userId}`)
    .order("published_at", { ascending: false })

  // Filtrar items ya enviados
  const news = (allNews || []).filter((n) => !sentNewsIds.has(n.id))
  const implementations = (allImplementations || []).filter((i) => !sentImplIds.has(i.id))

  // Si no hay novedades, no generar digest
  if (news.length === 0 && implementations.length === 0) return null

  // Agrupar por compañía
  const companiesMap = new Map<string, CompanyDigest>()

  for (const bookmark of bookmarks) {
    const company = bookmark.companies as any
    if (!company?.id) continue

    const companyNews = news.filter((n) => n.company_id === company.id)
    const companyImpls = implementations.filter((i) => i.company_id === company.id)

    if (companyNews.length > 0 || companyImpls.length > 0) {
      companiesMap.set(company.id, {
        companyId: company.id,
        companyName: company.name,
        news: companyNews.map((n) => ({
          id: n.id,
          title: n.title,
          summary: n.summary,
          content: n.content,
          source_url: n.source_url || "",
          source_name: n.source_name || "",
          published_at: n.published_at,
        })),
        implementations: companyImpls.map((i) => ({
          id: i.id,
          title: i.title,
          summary: i.summary,
          content: i.content,
          source_url: i.source_url || "",
          source_name: i.source_name || "",
          published_at: i.published_at,
          signal_type: "success_story",
        })),
      })
    }
  }

  if (companiesMap.size === 0) return null

  return {
    userId: user.id,
    email: user.email,
    firstName: user.first_name,
    companies: Array.from(companiesMap.values()),
  }
}

/**
 * Genera el HTML del email digest
 */
export function generateDigestEmailHTML(digest: UserDigest): string {
  const greeting = digest.firstName ? `Hola ${digest.firstName},` : "Hola,"

  let companiesHTML = ""
  for (const company of digest.companies) {
    let newsHTML = ""
    for (const news of company.news) {
      const linkHTML = news.source_url
        ? `<a href="${news.source_url}" style="color: #3b82f6; text-decoration: none;">[Ver fuente]</a>`
        : ""
      newsHTML += `
        <div style="margin-bottom: 16px; padding: 12px; background-color: #f8fafc; border-radius: 8px;">
          <div style="font-weight: 600; color: #1e293b; margin-bottom: 4px;">
            ${news.title} ${linkHTML}
          </div>
          <div style="color: #64748b; font-size: 14px; line-height: 1.5;">
            ${news.summary || news.content || ""}
          </div>
          ${news.source_name ? `<div style="color: #94a3b8; font-size: 12px; margin-top: 4px;">Fuente: ${news.source_name}</div>` : ""}
        </div>
      `
    }

    let implsHTML = ""
    for (const impl of company.implementations) {
      const linkHTML = impl.source_url
        ? `<a href="${impl.source_url}" style="color: #3b82f6; text-decoration: none;">[Ver fuente]</a>`
        : ""
      implsHTML += `
        <div style="margin-bottom: 16px; padding: 12px; background-color: #f0fdf4; border-radius: 8px;">
          <div style="font-weight: 600; color: #166534; margin-bottom: 4px;">
            ${impl.title} ${linkHTML}
          </div>
          <div style="color: #64748b; font-size: 14px; line-height: 1.5;">
            ${impl.summary || impl.content || ""}
          </div>
          ${impl.source_name ? `<div style="color: #94a3b8; font-size: 12px; margin-top: 4px;">Fuente: ${impl.source_name}</div>` : ""}
        </div>
      `
    }

    companiesHTML += `
      <div style="margin-bottom: 32px;">
        <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0;">
          ${company.companyName}
        </h2>
        ${company.news.length > 0 ? `<h3 style="font-size: 16px; color: #475569; margin-bottom: 12px;">Noticias</h3>${newsHTML}` : ""}
        ${company.implementations.length > 0 ? `<h3 style="font-size: 16px; color: #475569; margin-bottom: 12px;">Implementaciones</h3>${implsHTML}` : ""}
      </div>
    `
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f1f5f9; margin: 0; padding: 0;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background-color: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 28px; font-weight: 800; color: #0f172a; margin: 0;">
              Noticias ASCI
            </h1>
            <p style="color: #64748b; margin-top: 8px;">
              Tu resumen mensual de novedades
            </p>
          </div>

          <p style="font-size: 16px; color: #334155; margin-bottom: 24px;">
            ${greeting}
          </p>
          
          <p style="font-size: 16px; color: #334155; margin-bottom: 32px;">
            Estas son las novedades de las cuentas que seguís:
          </p>

          ${companiesHTML}

          <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e2e8f0; text-align: center;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://asci.lat"}/bookmarks" 
               style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              Ver en ASCI
            </a>
          </div>

          <div style="margin-top: 32px; text-align: center; color: #94a3b8; font-size: 12px;">
            <p>
              Recibís este email porque tenés cuentas guardadas en ASCI.<br>
              <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://asci.lat"}/settings/notifications" style="color: #64748b;">
                Configurar preferencias de notificación
              </a>
            </p>
          </div>

        </div>
      </div>
    </body>
    </html>
  `
}

/**
 * Envía el digest a un usuario y registra los items enviados
 */
export async function sendDigestToUser(digest: UserDigest): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()

  try {
    // Enviar email
    const { error: emailError } = await resend.emails.send({
      from: "ASCI <noticias@asci.lat>",
      to: digest.email,
      subject: "Noticias ASCI - Novedades de tus cuentas",
      html: generateDigestEmailHTML(digest),
    })

    if (emailError) {
      console.error("Error sending digest email:", emailError)
      return { success: false, error: emailError.message }
    }

    // Registrar items enviados
    const itemsToInsert: { user_id: string; item_type: string; item_id: string }[] = []

    for (const company of digest.companies) {
      for (const news of company.news) {
        itemsToInsert.push({
          user_id: digest.userId,
          item_type: "news",
          item_id: news.id,
        })
      }
      for (const impl of company.implementations) {
        itemsToInsert.push({
          user_id: digest.userId,
          item_type: "implementation",
          item_id: impl.id,
        })
      }
    }

    if (itemsToInsert.length > 0) {
      await supabase.from("user_digest_sent_items").insert(itemsToInsert)
    }

    // Actualizar último envío
    await supabase.from("user_notification_preferences").upsert({
      user_id: digest.userId,
      last_digest_sent_at: new Date().toISOString(),
    })

    // Log del digest
    await supabase.from("digest_log").insert({
      user_id: digest.userId,
      items_count: itemsToInsert.length,
      companies_count: digest.companies.length,
    })

    return { success: true }
  } catch (error: any) {
    console.error("Error in sendDigestToUser:", error)
    return { success: false, error: error.message }
  }
}

/**
 * Ejecuta el digest mensual para todos los usuarios elegibles
 */
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

  const users = await getEligibleUsersForDigest()

  for (const user of users) {
    results.processed++

    const digest = await generateUserDigest(user.id)

    if (!digest) {
      results.skipped++
      results.details.push({
        userId: user.id,
        email: user.email,
        status: "skipped",
        reason: "No news to send",
      })
      continue
    }

    const { success, error } = await sendDigestToUser(digest)

    if (success) {
      results.sent++
      results.details.push({
        userId: user.id,
        email: user.email,
        status: "sent",
        companiesCount: digest.companies.length,
      })
    } else {
      results.failed++
      results.details.push({
        userId: user.id,
        email: user.email,
        status: "failed",
        error,
      })
    }
  }

  return results
}

/**
 * Preview del digest para un usuario (sin enviar)
 */
export async function previewDigest(userId: string): Promise<{
  html: string | null
  digest: UserDigest | null
  error?: string
}> {
  try {
    const digest = await generateUserDigest(userId)

    if (!digest) {
      return {
        html: null,
        digest: null,
        error: "No hay novedades para mostrar",
      }
    }

    return {
      html: generateDigestEmailHTML(digest),
      digest,
    }
  } catch (error: any) {
    return {
      html: null,
      digest: null,
      error: error.message,
    }
  }
}
