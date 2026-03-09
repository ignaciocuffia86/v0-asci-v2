import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

// POST: Bulk create users
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await request.json()
  const { emails, default_password, auto_confirm, default_role } = body

  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    return NextResponse.json({ error: "Emails array is required" }, { status: 400 })
  }

  if (emails.length > 100) {
    return NextResponse.json({ error: "Maximum 100 users per bulk import" }, { status: 400 })
  }

  const adminClient = createAdminClient()
  const results: { email: string; success: boolean; error?: string; user_id?: string }[] = []
  const password = default_password || generatePassword()

  for (const email of emails) {
    const trimmedEmail = email.trim().toLowerCase()
    
    if (!isValidEmail(trimmedEmail)) {
      results.push({ email: trimmedEmail, success: false, error: "Invalid email format" })
      continue
    }

    try {
      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: trimmedEmail,
        password,
        email_confirm: auto_confirm !== false,
      })

      if (createError) {
        results.push({ email: trimmedEmail, success: false, error: createError.message })
        continue
      }

      // Update profile role if specified
      if (newUser.user && default_role && default_role !== "user") {
        await adminClient
          .from("profiles")
          .update({ role: default_role })
          .eq("id", newUser.user.id)
      }

      results.push({ email: trimmedEmail, success: true, user_id: newUser.user?.id })
    } catch (err) {
      results.push({ email: trimmedEmail, success: false, error: "Unexpected error" })
    }
  }

  // Audit log
  const successCount = results.filter(r => r.success).length
  const failCount = results.filter(r => !r.success).length

  await adminClient.from("admin_audit_log").insert({
    admin_id: user.id,
    action: "bulk_import",
    details: { 
      total: emails.length,
      success: successCount,
      failed: failCount,
      auto_confirm,
      default_role,
    },
  })

  return NextResponse.json({ 
    results,
    summary: { total: emails.length, success: successCount, failed: failCount },
    generated_password: !default_password ? password : undefined,
  })
}

function generatePassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%"
  let password = ""
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
