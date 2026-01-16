import { type NextRequest, NextResponse } from "next/server"
import { syncAllUsers } from "@/app/actions/resend"

export async function POST(request: NextRequest) {
  try {
    // Validar CRON_SECRET
    const secret = request.headers.get("x-cron-secret")
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const result = await syncAllUsers()

    if (!result.success) {
      return NextResponse.json(result, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `Sincronizados ${result.successCount} usuarios, ${result.failCount} fallaron`,
      data: result,
    })
  } catch (error) {
    console.error("[Sync Users API] Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
