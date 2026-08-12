import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

// GET: List all users with profiles
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Check if superadmin
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const adminClient = createAdminClient()
  
  // Get all users from auth.users
  const { data: authUsers, error: authError } = await adminClient.auth.admin.listUsers({
    perPage: 1000,
  })

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 })
  }

  // Get all profiles
  const { data: profiles } = await adminClient
    .from("profiles")
    .select("*")

  // Merge auth users with profiles
  const users = authUsers.users.map(authUser => {
    const profile = profiles?.find(p => p.id === authUser.id)
    return {
      id: authUser.id,
      email: authUser.email,
      email_confirmed_at: authUser.email_confirmed_at,
      created_at: authUser.created_at,
      last_sign_in_at: authUser.last_sign_in_at,
      banned_until: (authUser as { banned_until?: string | null }).banned_until,
      // Profile data
      full_name: profile?.full_name,
      company: profile?.company,
      role: profile?.role || "user",
      onboarding_status: profile?.onboarding_status,
      avatar_url: profile?.avatar_url,
      scheduled_deletion_at: profile?.scheduled_deletion_at,
    }
  })

  return NextResponse.json({ users })
}

// POST: Create a new user
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
  const { email, password, full_name, role, auto_confirm } = body

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 })
  }

  const adminClient = createAdminClient()

  // Generate password if not provided
  const userPassword = password || generatePassword()

  // Create user in auth.users
  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: userPassword,
    email_confirm: auto_confirm !== false, // Default to auto-confirm
    user_metadata: {
      full_name: full_name || "",
    },
  })

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 400 })
  }

  // Update profile with role if specified
  if (newUser.user && role) {
    await adminClient
      .from("profiles")
      .update({ role, full_name })
      .eq("id", newUser.user.id)
  }

  // Audit log
  await adminClient.from("admin_audit_log").insert({
    admin_id: user.id,
    action: "create_user",
    target_user_id: newUser.user?.id,
    target_email: email,
    details: { role, auto_confirm, has_custom_password: !!password },
  })

  return NextResponse.json({ 
    user: newUser.user,
    generated_password: !password ? userPassword : undefined,
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
