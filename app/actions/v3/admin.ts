"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import {
  createWorkspaceWithAdmin,
  getAuthUserByEmail,
  normalizeDomain,
  type Workspace,
} from "@/lib/v3/workspace"
import { createInvitation } from "@/lib/v3/invitations"
import { sendWorkspaceInviteEmail, buildInviteUrl } from "@/lib/v3/email"

// ═══════════════════════════════════════════════════════════
// GUARD
// ═══════════════════════════════════════════════════════════

/** Verifica que el usuario actual sea superadmin (public.profiles.role). */
async function requireSuperAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login?next=/v3/admin/workspaces")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "superadmin") {
    return { error: "No tenés permisos de super administrador" }
  }

  return { userId: user.id }
}

export async function isSuperAdmin(): Promise<boolean> {
  const result = await requireSuperAdmin().catch(() => ({ error: "x" }))
  return !("error" in result)
}

// ═══════════════════════════════════════════════════════════
// LISTADO DE WORKSPACES
// ═══════════════════════════════════════════════════════════

export interface WorkspaceSummary extends Workspace {
  member_count: number
  admin_emails: string[]
}

export async function listAllWorkspaces(): Promise<{
  workspaces: WorkspaceSummary[]
  error?: string
}> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) {
    return { workspaces: [], error: guard.error }
  }

  const admin = createAdminClient()
  const { data: workspaces, error } = await admin
    .schema("v3")
    .from("workspaces")
    .select("*")
    .order("created_at", { ascending: false })

  if (error || !workspaces) {
    return { workspaces: [], error: "Error al cargar los workspaces" }
  }

  // Conteo de miembros activos + emails de admins por workspace
  const summaries = await Promise.all(
    workspaces.map(async (ws) => {
      const { data: members } = await admin
        .schema("v3")
        .from("workspace_members")
        .select("user_id, role")
        .eq("workspace_id", ws.id)
        .eq("status", "active")

      const memberCount = members?.length ?? 0
      const adminIds = (members ?? []).filter((m) => m.role === "admin").map((m) => m.user_id)

      const adminEmails: string[] = []
      await Promise.all(
        adminIds.map(async (id) => {
          try {
            const { data } = await admin.auth.admin.getUserById(id)
            if (data?.user?.email) adminEmails.push(data.user.email)
          } catch {
            // ignorar
          }
        })
      )

      return {
        ...(ws as Workspace),
        member_count: memberCount,
        admin_emails: adminEmails,
      }
    })
  )

  return { workspaces: summaries }
}

// ═══════════════════════════════════════════════════════════
// CREAR WORKSPACE + PRIMER ADMIN (bootstrapping)
// ═══════════════════════════════════════════════════════════

export async function createWorkspaceAsSuperAdmin(input: {
  name: string
  domain: string
  websiteUrl?: string
  adminEmail: string
}): Promise<{
  success: boolean
  error?: string
  workspace?: Workspace
  /** True si se invitó al admin (no tenía cuenta todavía). */
  invited?: boolean
  inviteUrl?: string
  emailSent?: boolean
}> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) {
    return { success: false, error: guard.error }
  }

  const name = input.name.trim()
  const domain = normalizeDomain(input.domain.trim())
  const adminEmail = input.adminEmail.trim().toLowerCase()

  if (!name) return { success: false, error: "El nombre es obligatorio" }
  if (!domain || !domain.includes(".")) {
    return { success: false, error: "Dominio inválido" }
  }
  if (!adminEmail.includes("@")) {
    return { success: false, error: "Email del admin inválido" }
  }

  // ¿El admin ya tiene cuenta?
  const existingUser = await getAuthUserByEmail(adminEmail)

  if (existingUser) {
    // Crear workspace y asignarlo como admin activo directamente
    const result = await createWorkspaceWithAdmin({
      name,
      domain,
      websiteUrl: input.websiteUrl,
      adminUserId: existingUser.id,
      createdBy: guard.userId,
    })
    if (result.error || !result.workspace) {
      return { success: false, error: result.error || "Error al crear el workspace" }
    }
    revalidatePath("/v3/admin/workspaces")
    return { success: true, workspace: result.workspace, invited: false }
  }

  // El admin no tiene cuenta: crear el workspace (created_by = superadmin)
  // y dejar una invitación pendiente con rol admin.
  const admin = createAdminClient()

  const { data: existingWs } = await admin
    .schema("v3")
    .from("workspaces")
    .select("id")
    .eq("domain", domain)
    .maybeSingle()

  if (existingWs) {
    return { success: false, error: "Ya existe un workspace para este dominio" }
  }

  const { data: workspace, error: wsError } = await admin
    .schema("v3")
    .from("workspaces")
    .insert({
      domain,
      name,
      website_url: input.websiteUrl || `https://${domain}`,
      created_by: guard.userId,
    })
    .select()
    .single()

  if (wsError || !workspace) {
    console.error("[v3] superadmin create workspace error:", wsError)
    return { success: false, error: "Error al crear el workspace" }
  }

  const { invitation, error: invError } = await createInvitation({
    workspaceId: workspace.id,
    email: adminEmail,
    role: "admin",
    invitedBy: guard.userId,
  })

  if (invError || !invitation) {
    // Rollback del workspace para no dejar uno huérfano sin admin
    await admin.schema("v3").from("workspaces").delete().eq("id", workspace.id)
    return { success: false, error: invError || "Error al invitar al admin" }
  }

  const inviteUrl = buildInviteUrl(invitation.token)
  const emailResult = await sendWorkspaceInviteEmail({
    to: adminEmail,
    inviteUrl,
    workspaceName: name,
    inviterName: null,
    role: "admin",
  })

  revalidatePath("/v3/admin/workspaces")

  return {
    success: true,
    workspace: workspace as Workspace,
    invited: true,
    inviteUrl: emailResult.sent ? undefined : inviteUrl,
    emailSent: emailResult.sent,
  }
}
