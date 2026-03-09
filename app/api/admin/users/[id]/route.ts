import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

async function checkSuperadmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: "Unauthorized", status: 401, user: null }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "superadmin") {
    return { error: "Forbidden", status: 403, user: null }
  }

  return { error: null, status: 200, user }
}

// GET: Get single user details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, status, user } = await checkSuperadmin()
  if (error) return NextResponse.json({ error }, { status })

  const { id } = await params
  const adminClient = createAdminClient()

  const { data: authUser, error: authError } = await adminClient.auth.admin.getUserById(id)
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 404 })
  }

  const { data: profile } = await adminClient
    .from("profiles")
    .select("*")
    .eq("id", id)
    .single()

  return NextResponse.json({
    user: {
      ...authUser.user,
      profile,
    },
  })
}

// PATCH: Update user
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, status, user: adminUser } = await checkSuperadmin()
  if (error) return NextResponse.json({ error }, { status })

  const { id } = await params
  const body = await request.json()
  const { email, full_name, role, ban_duration, unban } = body

  const adminClient = createAdminClient()
  const changes: Record<string, unknown> = {}

  // Update email
  if (email) {
    const { error: emailError } = await adminClient.auth.admin.updateUserById(id, {
      email,
      email_confirm: true, // Auto-confirm when admin changes it
    })
    if (emailError) {
      return NextResponse.json({ error: emailError.message }, { status: 400 })
    }
    changes.email = email
  }

  // Ban user
  if (ban_duration) {
    const banUntil = ban_duration === "permanent" 
      ? new Date("2099-12-31").toISOString()
      : new Date(Date.now() + parseDuration(ban_duration)).toISOString()
    
    const { error: banError } = await adminClient.auth.admin.updateUserById(id, {
      ban_duration: ban_duration === "permanent" ? "876000h" : ban_duration,
    })
    if (banError) {
      return NextResponse.json({ error: banError.message }, { status: 400 })
    }
    changes.banned_until = banUntil

    await adminClient.from("admin_audit_log").insert({
      admin_id: adminUser!.id,
      action: "ban_user",
      target_user_id: id,
      details: { ban_duration },
    })
  }

  // Unban user
  if (unban) {
    const { error: unbanError } = await adminClient.auth.admin.updateUserById(id, {
      ban_duration: "none",
    })
    if (unbanError) {
      return NextResponse.json({ error: unbanError.message }, { status: 400 })
    }
    changes.unbanned = true

    await adminClient.from("admin_audit_log").insert({
      admin_id: adminUser!.id,
      action: "unban_user",
      target_user_id: id,
    })
  }

  // Update profile fields
  if (full_name || role) {
    const updates: Record<string, string> = {}
    if (full_name) updates.full_name = full_name
    if (role) updates.role = role

    await adminClient.from("profiles").update(updates).eq("id", id)
    Object.assign(changes, updates)
  }

  // Audit log for updates (not ban/unban which have their own logs)
  if (email || full_name || role) {
    await adminClient.from("admin_audit_log").insert({
      admin_id: adminUser!.id,
      action: "update_user",
      target_user_id: id,
      details: { email, full_name, role },
    })
  }

  return NextResponse.json({ success: true, changes })
}

// DELETE: Soft delete user (30 day retention)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, status, user: adminUser } = await checkSuperadmin()
  if (error) return NextResponse.json({ error }, { status })

  const { id } = await params
  const adminClient = createAdminClient()

  // Get user email for audit log before deletion
  const { data: targetUser } = await adminClient.auth.admin.getUserById(id)

  // Soft delete with 30 day retention
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(id, { shouldSoftDelete: true })
  
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 400 })
  }

  // Audit log
  await adminClient.from("admin_audit_log").insert({
    admin_id: adminUser!.id,
    action: "delete_user",
    target_user_id: id,
    target_email: targetUser?.user?.email,
    details: { soft_delete: true, retention_days: 30 },
  })

  return NextResponse.json({ success: true })
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([hdwm])$/)
  if (!match) return 0
  const value = parseInt(match[1])
  const unit = match[2]
  const multipliers: Record<string, number> = {
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    m: 30 * 24 * 60 * 60 * 1000,
  }
  return value * (multipliers[unit] || 0)
}
