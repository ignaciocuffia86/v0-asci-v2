import { NextResponse } from "next/server"
import { recoverResearchJobs } from "@/lib/v3/services/research-watchdog"

export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: Request) {
  const authorization = request.headers.get("authorization")
  if (process.env.NODE_ENV === "production" && authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await recoverResearchJobs()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[v3-watchdog] Error recuperando research jobs:", message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
