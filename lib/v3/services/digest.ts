import { Resend } from "resend"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAppBaseUrl } from "@/lib/v3/email"

// ═══════════════════════════════════════════════════════════
// Digest mensual por cuenta seguida:
//  - Compara el scorecard nuevo vs. el anterior
//  - Junta los hallazgos del radar detectados desde el último refresh
//  - Envía email a los suscriptores de la cuenta
//  - Registra el envío en v3.digest_log
// ═══════════════════════════════════════════════════════════

interface DigestData {
  followedAccountId: string
  workspaceId: string
  companyId: string
  companyName: string
  scoreBefore: number | null
  scoreAfter: number | null
  newFindings: Array<{
    radar_type: string
    category: string
    title: string
    summary: string | null
    url: string | null
    source_name: string | null
  }>
}

/** Junta la data del digest de una cuenta tras un refresh. */
export async function buildDigestData(params: {
  followedAccountId: string
  workspaceId: string
  companyId: string
  since: string | null
}): Promise<DigestData | null> {
  const admin = createAdminClient()

  const [companyRes, scoresRes, findingsQuery] = await Promise.all([
    admin.from("companies").select("id, name").eq("id", params.companyId).maybeSingle(),
    admin
      .schema("v3")
      .from("account_scorecards")
      .select("score, created_at")
      .eq("workspace_id", params.workspaceId)
      .eq("company_id", params.companyId)
      .order("created_at", { ascending: false })
      .limit(2),
    params.since
      ? admin
          .from("radar_findings")
          .select("radar_type, category, title, summary, url, source_name")
          .eq("company_id", params.companyId)
          .gte("detected_at", params.since)
          .order("detected_at", { ascending: false })
          .limit(20)
      : admin
          .from("radar_findings")
          .select("radar_type, category, title, summary, url, source_name")
          .eq("company_id", params.companyId)
          .order("detected_at", { ascending: false })
          .limit(20),
  ])

  if (!companyRes.data) return null

  const scores = scoresRes.data ?? []

  return {
    followedAccountId: params.followedAccountId,
    workspaceId: params.workspaceId,
    companyId: params.companyId,
    companyName: companyRes.data.name,
    scoreAfter: scores[0]?.score ?? null,
    scoreBefore: scores[1]?.score ?? null,
    newFindings: findingsQuery.data ?? [],
  }
}

/** Emails de los usuarios suscriptos al digest de la cuenta. */
export async function getSubscriberEmails(
  followedAccountId: string
): Promise<Array<{ userId: string; email: string }>> {
  const admin = createAdminClient()

  const { data: subs } = await admin
    .schema("v3")
    .from("followed_account_subscribers")
    .select("user_id")
    .eq("followed_account_id", followedAccountId)
    .eq("subscribed", true)

  if (!subs || subs.length === 0) return []

  const results: Array<{ userId: string; email: string }> = []
  for (const sub of subs) {
    const { data } = await admin.auth.admin.getUserById(sub.user_id)
    if (data?.user?.email) {
      results.push({ userId: sub.user_id, email: data.user.email })
    }
  }
  return results
}

const RADAR_LABELS: Record<string, string> = {
  tech: "Tecnología",
  news: "Noticias",
  "jobs-interpretation": "Vacantes",
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function renderDigestHtml(data: DigestData): string {
  const accountUrl = `${getAppBaseUrl()}/v3/accounts/${data.companyId}`
  const delta =
    data.scoreBefore !== null && data.scoreAfter !== null
      ? data.scoreAfter - data.scoreBefore
      : null

  const scoreLine =
    data.scoreAfter !== null
      ? `<p style="font-size:15px;color:#0f172a;margin:8px 0;">
          Score actual: <strong>${data.scoreAfter}/100</strong>
          ${
            delta !== null && delta !== 0
              ? ` <span style="color:${delta > 0 ? "#16a34a" : "#dc2626"};">(${delta > 0 ? "+" : ""}${delta} vs. mes anterior)</span>`
              : ""
          }
        </p>`
      : ""

  const findingsHtml =
    data.newFindings.length === 0
      ? `<p style="color:#64748b;">Sin novedades relevantes este mes.</p>`
      : data.newFindings
          .slice(0, 10)
          .map(
            (f) => `
        <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:8px;">
          <p style="margin:0 0 4px;font-size:12px;color:#64748b;">${escapeHtml(RADAR_LABELS[f.radar_type] ?? f.radar_type)} · ${escapeHtml(f.category)}</p>
          <p style="margin:0 0 4px;font-weight:600;font-size:14px;color:#0f172a;">${escapeHtml(f.title)}</p>
          ${f.summary ? `<p style="margin:0;font-size:13px;color:#475569;line-height:1.5;">${escapeHtml(f.summary)}</p>` : ""}
          ${f.url ? `<p style="margin:6px 0 0;"><a href="${escapeHtml(f.url)}" style="font-size:12px;color:#2563eb;">Ver fuente</a></p>` : ""}
        </div>`
          )
          .join("")

  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <p style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 4px;">Digest mensual · ASCI</p>
      <h1 style="font-size:20px;margin:0 0 8px;color:#0f172a;">${escapeHtml(data.companyName)}</h1>
      ${scoreLine}
      <h2 style="font-size:15px;margin:20px 0 8px;color:#0f172a;">Novedades del mes</h2>
      ${findingsHtml}
      <p style="margin:24px 0;">
        <a href="${accountUrl}"
           style="background:#0f172a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-size:14px;">
          Ver cuenta completa
        </a>
      </p>
      <p style="color:#94a3b8;font-size:12px;line-height:1.6;">
        Recibís este correo porque seguís esta cuenta en ASCI.
        Podés desuscribirte desde la vista de la cuenta.
      </p>
    </div>
  `
}

/** Envía el digest a los suscriptores y lo registra. Degrada sin API key. */
export async function sendAccountDigest(data: DigestData): Promise<{
  sent: boolean
  recipientCount: number
}> {
  const admin = createAdminClient()
  const recipients = await getSubscriberEmails(data.followedAccountId)

  if (recipients.length === 0) {
    return { sent: false, recipientCount: 0 }
  }

  const apiKey = process.env.RESEND_API_KEY
  let sent = false

  if (apiKey) {
    const from = process.env.RESEND_FROM_EMAIL || "ASCI <onboarding@resend.dev>"
    const resend = new Resend(apiKey)
    const delta =
      data.scoreBefore !== null && data.scoreAfter !== null
        ? data.scoreAfter - data.scoreBefore
        : null
    const subject =
      delta !== null && delta > 5
        ? `${data.companyName} subió a ${data.scoreAfter}/100 — novedades del mes`
        : `Novedades de ${data.companyName} — digest mensual ASCI`

    try {
      const { error } = await resend.emails.send({
        from,
        to: recipients.map((r) => r.email),
        subject,
        html: renderDigestHtml(data),
      })
      sent = !error
      if (error) console.error("[v3] Error enviando digest:", error.message)
    } catch (err) {
      console.error("[v3] Excepción enviando digest:", err)
    }
  } else {
    console.log("[v3] RESEND_API_KEY no configurada; digest no enviado (solo log)")
  }

  await admin.schema("v3").from("digest_log").insert({
    workspace_id: data.workspaceId,
    followed_account_id: data.followedAccountId,
    recipients: recipients.map((r) => ({ userId: r.userId, email: r.email })),
    novelty_summary: {
      findingCount: data.newFindings.length,
      titles: data.newFindings.slice(0, 10).map((f) => f.title),
    },
    score_before: data.scoreBefore,
    score_after: data.scoreAfter,
  })

  return { sent, recipientCount: recipients.length }
}
