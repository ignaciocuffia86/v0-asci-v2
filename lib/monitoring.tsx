import { createClient } from "@/lib/supabase/server"
import { Resend } from "resend"

export interface HealthCheckResult {
  status: "healthy" | "warning" | "critical"
  alerts: Alert[]
  metrics: {
    pendingJobs: number
    processingJobs: number
    failedJobs: number
    completedLast24h: number
    stuckJobs: number
  }
  timestamp: string
}

export interface Alert {
  type: "stuck_jobs" | "failed_jobs" | "high_queue" | "system_stopped" | "critical_error"
  severity: "warning" | "critical"
  message: string
  count?: number
}

export async function runHealthCheck(): Promise<HealthCheckResult> {
  const supabase = await createClient()
  const alerts: Alert[] = []

  // Get job metrics
  const { data: jobStats } = await supabase.from("dictionary_jobs").select("status, started_at, error_message")

  const metrics = {
    pendingJobs: 0,
    processingJobs: 0,
    failedJobs: 0,
    completedLast24h: 0,
    stuckJobs: 0,
  }

  const now = new Date()
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000)

  if (jobStats) {
    for (const job of jobStats) {
      switch (job.status) {
        case "pending":
          metrics.pendingJobs++
          break
        case "processing":
          metrics.processingJobs++
          // Check if stuck (processing for more than 30 minutes)
          if (job.started_at && new Date(job.started_at) < thirtyMinutesAgo) {
            metrics.stuckJobs++
          }
          break
        case "failed":
          metrics.failedJobs++
          break
        case "completed":
          metrics.completedLast24h++
          break
      }
    }
  }

  // Check for stuck jobs
  if (metrics.stuckJobs > 0) {
    alerts.push({
      type: "stuck_jobs",
      severity: "critical",
      message: `${metrics.stuckJobs} job(s) estancados por más de 30 minutos`,
      count: metrics.stuckJobs,
    })
  }

  // Check for failed jobs
  if (metrics.failedJobs > 0) {
    alerts.push({
      type: "failed_jobs",
      severity: metrics.failedJobs > 10 ? "critical" : "warning",
      message: `${metrics.failedJobs} job(s) fallidos requieren atención`,
      count: metrics.failedJobs,
    })
  }

  // Check for high queue
  if (metrics.pendingJobs > 500) {
    alerts.push({
      type: "high_queue",
      severity: "critical",
      message: `Cola muy alta: ${metrics.pendingJobs} jobs pendientes`,
      count: metrics.pendingJobs,
    })
  } else if (metrics.pendingJobs > 100) {
    alerts.push({
      type: "high_queue",
      severity: "warning",
      message: `Cola alta: ${metrics.pendingJobs} jobs pendientes`,
      count: metrics.pendingJobs,
    })
  }

  // Check if system is stopped (no processing and has pending)
  if (metrics.processingJobs === 0 && metrics.pendingJobs > 0) {
    // Check if last completed job was more than 1 hour ago
    const { data: lastCompleted } = await supabase
      .from("dictionary_jobs")
      .select("completed_at")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single()

    if (lastCompleted?.completed_at) {
      const lastCompletedTime = new Date(lastCompleted.completed_at)
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

      if (lastCompletedTime < oneHourAgo) {
        alerts.push({
          type: "system_stopped",
          severity: "critical",
          message: `Sistema detenido: no hay procesamiento desde ${lastCompletedTime.toLocaleString()}`,
        })
      }
    }
  }

  // Determine overall status
  let status: "healthy" | "warning" | "critical" = "healthy"
  if (alerts.some((a) => a.severity === "critical")) {
    status = "critical"
  } else if (alerts.length > 0) {
    status = "warning"
  }

  return {
    status,
    alerts,
    metrics,
    timestamp: now.toISOString(),
  }
}

export async function sendAlertEmail(healthCheck: HealthCheckResult): Promise<boolean> {
  const resendApiKey = process.env.RESEND_API_KEY
  const alertEmail = process.env.ALERT_EMAIL

  if (!resendApiKey || !alertEmail) {
    console.error("[Monitor] Missing RESEND_API_KEY or ALERT_EMAIL")
    return false
  }

  const resend = new Resend(resendApiKey)

  const alertsHtml = healthCheck.alerts
    .map(
      (alert) => `
      <div style="padding: 12px; margin: 8px 0; border-radius: 8px; background: ${
        alert.severity === "critical" ? "#fee2e2" : "#fef3c7"
      }; border-left: 4px solid ${alert.severity === "critical" ? "#dc2626" : "#f59e0b"};">
        <strong>${alert.severity.toUpperCase()}:</strong> ${alert.message}
      </div>
    `,
    )
    .join("")

  const metricsHtml = `
    <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
      <tr style="background: #f3f4f6;">
        <td style="padding: 8px; border: 1px solid #e5e7eb;">Pendientes</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">${healthCheck.metrics.pendingJobs}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">Procesando</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">${healthCheck.metrics.processingJobs}</td>
      </tr>
      <tr style="background: #f3f4f6;">
        <td style="padding: 8px; border: 1px solid #e5e7eb;">Fallidos</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold; color: ${healthCheck.metrics.failedJobs > 0 ? "#dc2626" : "inherit"};">${healthCheck.metrics.failedJobs}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">Estancados</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold; color: ${healthCheck.metrics.stuckJobs > 0 ? "#dc2626" : "inherit"};">${healthCheck.metrics.stuckJobs}</td>
      </tr>
    </table>
  `

  try {
    await resend.emails.send({
      from: "ASCI Monitor <onboarding@resend.dev>",
      to: alertEmail,
      subject: `[ASCI ${healthCheck.status.toUpperCase()}] ${healthCheck.alerts.length} alerta(s) detectada(s)`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: ${healthCheck.status === "critical" ? "#dc2626" : "#f59e0b"};">
            Estado del Sistema: ${healthCheck.status.toUpperCase()}
          </h1>
          <p style="color: #6b7280;">Timestamp: ${new Date(healthCheck.timestamp).toLocaleString()}</p>
          
          <h2>Alertas</h2>
          ${alertsHtml}
          
          <h2>Métricas</h2>
          ${metricsHtml}
          
          <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://asci.vercel.app"}/admin/processing">
              Ver Dashboard de Procesamiento →
            </a>
          </p>
        </div>
      `,
    })
    return true
  } catch (error) {
    console.error("[Monitor] Error sending email:", error)
    return false
  }
}
