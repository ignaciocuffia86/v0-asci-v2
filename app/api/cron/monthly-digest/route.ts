import { NextResponse } from "next/server"
import { runMonthlyDigest } from "@/app/actions/digest"

export const maxDuration = 300 // 5 minutes max for processing all users

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const results = await runMonthlyDigest()

    return NextResponse.json({
      success: true,
      ...results,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[Monthly Digest] Failed:", error)
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}
