import { NextResponse } from "next/server"
import { assertCron } from "@/lib/cron-auth"
import { runHealthCheck, sendAlertEmail } from "@/lib/monitoring"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

export const maxDuration = 30

export async function GET(request: Request) {
  const denied = assertCron(request)
  if (denied) return denied

  // Use service role for cron_executions
  const serviceSupabase = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Register cron execution start
  const { data: execution } = await serviceSupabase
    .from("cron_executions")
    .insert({
      cron_name: "monitor",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  const executionId = execution?.id

  try {
    const healthCheck = await runHealthCheck()

    // Log the result
    console.log(`[Monitor] Health check completed: ${healthCheck.status}`, {
      metrics: healthCheck.metrics,
      alertCount: healthCheck.alerts.length,
    })

    // Store health check result in database for history
    const supabase = await createClient()
    await supabase.from("system_health_logs").insert({
      status: healthCheck.status,
      alerts: healthCheck.alerts,
      metrics: healthCheck.metrics,
    })

    // Send email alerts if there are critical or warning issues
    if (healthCheck.alerts.length > 0) {
      // Check if we already sent an alert recently (avoid spam)
      const { data: recentAlerts } = await supabase
        .from("system_health_logs")
        .select("created_at")
        .neq("status", "healthy")
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString()) // Last 60 min
        .order("created_at", { ascending: false })
        .limit(2)

      // Only send if this is the first alert in 60 min
      if (!recentAlerts || recentAlerts.length <= 1) {
        const emailSent = await sendAlertEmail(healthCheck)
        console.log(`[Monitor] Alert email sent: ${emailSent}`)
      } else {
        console.log("[Monitor] Skipping email - already sent recently")
      }
    }

    // Register cron execution completion
    if (executionId) {
      await serviceSupabase
        .from("cron_executions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          details: { healthStatus: healthCheck.status, alertCount: healthCheck.alerts.length },
        })
        .eq("id", executionId)
    }

    return NextResponse.json({
      success: true,
      ...healthCheck,
    })
  } catch (error) {
    console.error("[Monitor] Health check failed:", error)

    // Register cron execution failure
    if (executionId) {
      await serviceSupabase
        .from("cron_executions")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: String(error),
        })
        .eq("id", executionId)
    }

    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}
