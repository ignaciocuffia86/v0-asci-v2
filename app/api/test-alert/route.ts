import { NextResponse } from "next/server"
import { runHealthCheck, sendAlertEmail } from "@/lib/monitoring"

export async function GET(request: Request) {
  try {
    // Run health check
    const healthCheck = await runHealthCheck()

    // Force send email regardless of status (for testing)
    const emailSent = await sendAlertEmail(healthCheck)

    console.log(`[Test Alert] Email sent: ${emailSent}`)

    return NextResponse.json({
      success: true,
      emailSent,
      healthCheck,
    })
  } catch (error) {
    console.error("[Test Alert] Failed:", error)
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}
