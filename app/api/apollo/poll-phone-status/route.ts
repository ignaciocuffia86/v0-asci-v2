/**
 * GET /api/apollo/poll-phone-status?bookmarkId=...
 *
 * Endpoint para polleo ligero del estado de telefonos. Lo usamos en el tab de
 * prospectos en vez de una server action porque las server actions de Next.js
 * disparan router.refresh() implicitamente, lo que provoca un "refresh visible"
 * del tab cada vez que pollea.
 */

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const bookmarkId = searchParams.get("bookmarkId")

  if (!bookmarkId) {
    return NextResponse.json({ error: "Missing bookmarkId" }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: bookmark } = await supabase
    .from("bookmarks")
    .select("company_id")
    .eq("id", bookmarkId)
    .single()

  if (!bookmark) {
    return NextResponse.json({ statuses: [] })
  }

  const { data } = await supabase
    .from("user_company_contacts")
    .select("id, phone_status, mobile_phone, phone")
    .eq("company_id", bookmark.company_id)
    .eq("user_id", user.id)
    .eq("is_decision_maker", true)

  return NextResponse.json({ statuses: data || [] })
}
