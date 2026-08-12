import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { assertCron } from "@/lib/cron-auth"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const denied = assertCron(request)
  if (denied) return denied

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  try {
    const { data, error } = await supabase.rpc("cleanup_old_import_data", {
      p_processed_retention_days: 30,
      p_failed_retention_days: 90,
    })

    if (error) {
      console.error("[Cleanup Cron] Error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log("[Cleanup Cron] Result:", data)
    return NextResponse.json({ success: true, result: data })
  } catch (err: any) {
    console.error("[Cleanup Cron] Unexpected error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
