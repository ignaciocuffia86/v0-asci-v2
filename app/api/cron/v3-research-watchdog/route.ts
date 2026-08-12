import { NextResponse } from "next/server"
import { assertCron } from "@/lib/cron-auth"
import { recoverResearchJobs } from "@/lib/v3/services/research-watchdog"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: Request) {
  const denied = assertCron(request)
  if (denied) return denied

  try {
    const result = await recoverResearchJobs()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[v3-watchdog] Error recuperando research jobs:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
