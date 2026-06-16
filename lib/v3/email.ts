import { Resend } from "resend"

/**
 * Resuelve la URL base de la aplicación para construir links absolutos.
 * Prioriza una URL pública configurada; cae a VERCEL_URL en preview/prod.
 */
export function getAppBaseUrl(): string {
  const explicit =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, "")

  const vercel = process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`

  return "http://localhost:3000"
}

/** Construye el link de aceptación de invitación a partir del token. */
export function buildInviteUrl(token: string): string {
  return `${getAppBaseUrl()}/invite/${token}`
}

interface SendInviteEmailParams {
  to: string
  inviteUrl: string
  workspaceName: string
  inviterName?: string | null
  role: "admin" | "member"
}

export interface SendInviteResult {
  sent: boolean
  /** True cuando no hay API key y se debe usar el link manual (fallback). */
  fallback: boolean
  error?: string
}

/**
 * Envía el email de invitación vía Resend.
 *
 * Degrada con elegancia: si no hay RESEND_API_KEY configurada, NO falla;
 * retorna { sent: false, fallback: true } para que la UI muestre el link
 * copiable en su lugar.
 */
export async function sendWorkspaceInviteEmail(
  params: SendInviteEmailParams
): Promise<SendInviteResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { sent: false, fallback: true }
  }

  const from = process.env.RESEND_FROM_EMAIL || "ASCI <onboarding@resend.dev>"
  const roleLabel = params.role === "admin" ? "administrador" : "miembro"
  const inviter = params.inviterName ? `${params.inviterName} te` : "Te"

  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from,
      to: params.to,
      subject: `Invitación a ${params.workspaceName} en ASCI`,
      html: `
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h1 style="font-size: 20px; margin-bottom: 8px;">Te invitaron a ${escapeHtml(
            params.workspaceName
          )}</h1>
          <p style="color: #475569; line-height: 1.6;">
            ${escapeHtml(inviter)} invitó a unirte al workspace
            <strong>${escapeHtml(params.workspaceName)}</strong> en ASCI como
            <strong>${roleLabel}</strong>.
          </p>
          <p style="margin: 24px 0;">
            <a href="${params.inviteUrl}"
               style="background: #0f172a; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; display: inline-block;">
              Aceptar invitación
            </a>
          </p>
          <p style="color: #94a3b8; font-size: 13px; line-height: 1.6;">
            O copiá este link en tu navegador:<br />
            <a href="${params.inviteUrl}" style="color: #2563eb;">${params.inviteUrl}</a>
          </p>
          <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">
            Esta invitación expira en 7 días. Si no esperabas este correo, podés ignorarlo.
          </p>
        </div>
      `,
    })

    if (error) {
      console.error("[v3] Resend invite error:", error)
      return { sent: false, fallback: false, error: error.message }
    }

    return { sent: true, fallback: false }
  } catch (err) {
    console.error("[v3] Resend invite exception:", err)
    return {
      sent: false,
      fallback: false,
      error: err instanceof Error ? err.message : "Error al enviar el email",
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
