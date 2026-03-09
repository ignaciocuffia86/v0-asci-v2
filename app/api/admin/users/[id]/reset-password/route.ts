import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

// POST: Reset user password
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params
  const body = await request.json()
  const { new_password, send_email } = body

  const adminClient = createAdminClient()

  // Get user info
  const { data: targetUser, error: getUserError } = await adminClient.auth.admin.getUserById(id)
  if (getUserError || !targetUser.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  if (send_email) {
    // Send password reset email
    const { error: resetError } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: targetUser.user.email!,
    })

    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 400 })
    }

    await adminClient.from("admin_audit_log").insert({
      admin_id: user.id,
      action: "reset_password",
      target_user_id: id,
      target_email: targetUser.user.email,
      details: { method: "email" },
    })

    return NextResponse.json({ success: true, method: "email" })
  } else {
    // Set temporary password
    const tempPassword = new_password || generatePassword()
    
    const { error: updateError } = await adminClient.auth.admin.updateUserById(id, {
      password: tempPassword,
    })

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 })
    }

    await adminClient.from("admin_audit_log").insert({
      admin_id: user.id,
      action: "reset_password",
      target_user_id: id,
      target_email: targetUser.user.email,
      details: { method: "temporary", has_custom_password: !!new_password },
    })

    return NextResponse.json({ 
      success: true, 
      method: "temporary",
      temporary_password: !new_password ? tempPassword : undefined,
    })
  }
}

function generatePassword(length = 12): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%"
  let password = ""
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}
