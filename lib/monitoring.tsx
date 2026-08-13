import { createClient } from "@/lib/supabase/server"
import { Resend } from "resend"
import { getAppUrl } from "@/lib/site-url"

export interface HealthCheckResult {
  status: "healthy" | "warning" | "critical"
  alerts: Alert[]
  metrics: {
    pendingJobs: number
    processingJobs: number
    failedJobs: number
    completedLast24h: number
    stuckJobs: number
    pendingBatches: number
    processingBatches: number
    failedBatches: number
    stuckBatches: number
  }
  timestamp: string
}

export interface Alert {
  type:
    | "stuck_jobs"
    | "failed_jobs"
    | "high_queue"
    | "system_stopped"
    | "critical_error"
    | "stuck_batches"
    | "failed_batches"
    | "high_batch_queue"
  severity: "warning" | "critical"
  message: string
  count?: number
}

export async function runHealthCheck(): Promise<HealthCheckResult> {
  const supabase = await createClient()
  const alerts: Alert[] = []

  const { data: jobStats } = await supabase.from("dictionary_jobs").select("status, started_at, error_message")

  const { data: batchStats } = await supabase
    .from("import_batches")
    .select("status, created_at, updated_at, total_rows, processed_rows, error_rows")

  const metrics = {
    pendingJobs: 0,
    processingJobs: 0,
    failedJobs: 0,
    completedLast24h: 0,
    stuckJobs: 0,
    pendingBatches: 0,
    processingBatches: 0,
    failedBatches: 0,
    stuckBatches: 0,
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

  if (batchStats) {
    for (const batch of batchStats) {
      switch (batch.status) {
        case "pending":
          metrics.pendingBatches++
          break
        case "processing":
          metrics.processingBatches++
          if (batch.created_at && new Date(batch.created_at) < thirtyMinutesAgo) {
            metrics.stuckBatches++
          }
          break
        case "failed":
          metrics.failedBatches++
          break
      }
    }
  }

  // Check for stuck dictionary jobs
  if (metrics.stuckJobs > 0) {
    alerts.push({
      type: "stuck_jobs",
      severity: "critical",
      message: `${metrics.stuckJobs} job(s) de diccionario estancados por más de 30 minutos`,
      count: metrics.stuckJobs,
    })
  }

  // Check for failed dictionary jobs
  if (metrics.failedJobs > 0) {
    alerts.push({
      type: "failed_jobs",
      severity: metrics.failedJobs > 10 ? "critical" : "warning",
      message: `${metrics.failedJobs} job(s) de diccionario fallidos requieren atención`,
      count: metrics.failedJobs,
    })
  }

  if (metrics.stuckBatches > 0) {
    alerts.push({
      type: "stuck_batches",
      severity: "critical",
      message: `${metrics.stuckBatches} batch(es) de ingesta estancados por más de 30 minutos`,
      count: metrics.stuckBatches,
    })
  }

  if (metrics.failedBatches > 0) {
    alerts.push({
      type: "failed_batches",
      severity: metrics.failedBatches > 5 ? "critical" : "warning",
      message: `${metrics.failedBatches} batch(es) de ingesta fallidos requieren atención`,
      count: metrics.failedBatches,
    })
  }

  // Check for high queue
  if (metrics.pendingJobs > 500) {
    alerts.push({
      type: "high_queue",
      severity: "critical",
      message: `Cola de diccionario muy alta: ${metrics.pendingJobs} jobs pendientes`,
      count: metrics.pendingJobs,
    })
  } else if (metrics.pendingJobs > 100) {
    alerts.push({
      type: "high_queue",
      severity: "warning",
      message: `Cola de diccionario alta: ${metrics.pendingJobs} jobs pendientes`,
      count: metrics.pendingJobs,
    })
  }

  if (metrics.pendingBatches > 50) {
    alerts.push({
      type: "high_batch_queue",
      severity: "critical",
      message: `Cola de ingesta muy alta: ${metrics.pendingBatches} batches pendientes`,
      count: metrics.pendingBatches,
    })
  } else if (metrics.pendingBatches > 20) {
    alerts.push({
      type: "high_batch_queue",
      severity: "warning",
      message: `Cola de ingesta alta: ${metrics.pendingBatches} batches pendientes`,
      count: metrics.pendingBatches,
    })
  }

  // Check if system is stopped (no processing and has pending)
  if (metrics.processingJobs === 0 && metrics.pendingJobs > 0) {
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
          message: `Sistema de diccionario detenido: no hay procesamiento desde ${lastCompletedTime.toLocaleString()}`,
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
  const alertEmail = process.env.ALERT_EMAIL || "ignacio@bigua.lat"

  if (!resendApiKey) {
    console.error("[Monitor] Missing RESEND_API_KEY")
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
      <tr style="background: #f3f4f6;"><td colspan="2" style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">DICCIONARIO</td></tr>
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
      <tr style="background: #f3f4f6;"><td colspan="2" style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">INGESTA DE BATCHES</td></tr>
      <tr style="background: #f3f4f6;">
        <td style="padding: 8px; border: 1px solid #e5e7eb;">Pendientes</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">${healthCheck.metrics.pendingBatches}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">Procesando</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold;">${healthCheck.metrics.processingBatches}</td>
      </tr>
      <tr style="background: #f3f4f6;">
        <td style="padding: 8px; border: 1px solid #e5e7eb;">Fallidos</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold; color: ${healthCheck.metrics.failedBatches > 0 ? "#dc2626" : "inherit"};">${healthCheck.metrics.failedBatches}</td>
      </tr>
      <tr>
        <td style="padding: 8px; border: 1px solid #e5e7eb;">Estancados</td>
        <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold; color: ${healthCheck.metrics.stuckBatches > 0 ? "#dc2626" : "inherit"};">${healthCheck.metrics.stuckBatches}</td>
      </tr>
    </table>
  `

  try {
    await resend.emails.send({
      from: "Plataforma ASCI <asci@bigua.lat>",
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
            <a href="${getAppUrl()}/admin/processing">
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
