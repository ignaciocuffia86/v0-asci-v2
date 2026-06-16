"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import {
  getWorkspaceForUser,
  getWorkspaceMembers,
  updateMemberRole,
  workspaceHasDocuments,
  getAuthUserByEmail,
  type Workspace,
  type WorkspaceMemberWithIdentity,
  type WorkspaceRole,
  type WorkspaceWithMember,
} from "@/lib/v3/workspace"
import {
  createInvitation,
  revokeInvitation,
  acceptInvitation,
  getPendingInvitations,
  type InvitationWithInviter,
} from "@/lib/v3/invitations"
import {
  sendWorkspaceInviteEmail,
  buildInviteUrl,
} from "@/lib/v3/email"

// ═══════════════════════════════════════════════════════════
// AUTH HELPERS
// ═══════════════════════════════════════════════════════════

async function getCurrentUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/auth/login")
  }

  return user
}

/** Devuelve el workspace del usuario validando que sea admin. */
async function requireAdminWorkspace(): Promise<
  { workspace: WorkspaceWithMember } | { error: string }
> {
  const user = await getCurrentUser()
  const workspace = await getWorkspaceForUser(user.id)
  if (!workspace) {
    return { error: "No tienes workspace activo" }
  }
  if (workspace.member.role !== "admin") {
    return { error: "Solo los administradores pueden realizar esta acción" }
  }
  return { workspace }
}

// ═══════════════════════════════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════════════════════════════

export type OnboardingStatus =
  | { status: "no_workspace" }
  | { status: "active_member"; workspace: WorkspaceWithMember; hasDocuments: boolean }

/**
 * Determina el estado de onboarding del usuario actual.
 * Con el modelo de invitación pura: o sos miembro activo, o no tenés acceso.
 */
export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const user = await getCurrentUser()

  const activeWorkspace = await getWorkspaceForUser(user.id)

  if (activeWorkspace) {
    const hasDocuments = await workspaceHasDocuments(activeWorkspace.id)
    return {
      status: "active_member",
      workspace: activeWorkspace,
      hasDocuments,
    }
  }

  return { status: "no_workspace" }
}

// ═══════════════════════════════════════════════════════════
// MEMBER MANAGEMENT (Admin only)
// ═══════════════════════════════════════════════════════════

export async function getMyWorkspaceMembers(): Promise<{
  members: WorkspaceMemberWithIdentity[]
  error?: string
}> {
  const user = await getCurrentUser()
  const workspace = await getWorkspaceForUser(user.id)

  if (!workspace) {
    return { members: [], error: "No tienes workspace activo" }
  }

  const members = await getWorkspaceMembers(workspace.id)
  return { members }
}

export async function getMyPendingInvitations(): Promise<{
  invitations: InvitationWithInviter[]
  error?: string
}> {
  const result = await requireAdminWorkspace()
  if ("error" in result) {
    return { invitations: [], error: result.error }
  }
  const invitations = await getPendingInvitations(result.workspace.id)
  return { invitations }
}

/**
 * Invita a una persona por email. Crea la invitación y envía el email (o
 * devuelve el link si no hay servicio de email configurado).
 */
export async function inviteMember(
  email: string,
  role: WorkspaceRole
): Promise<{
  success: boolean
  error?: string
  inviteUrl?: string
  emailSent?: boolean
}> {
  const result = await requireAdminWorkspace()
  if ("error" in result) {
    return { success: false, error: result.error }
  }
  const { workspace } = result
  const user = await getCurrentUser()

  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return { success: false, error: "Email inválido" }
  }
  if (role !== "admin" && role !== "member") {
    return { success: false, error: "Rol inválido" }
  }

  // Si el email ya pertenece a un miembro activo, evitar duplicado
  const existingUser = await getAuthUserByEmail(normalizedEmail)
  if (existingUser) {
    const admin = createAdminClient()
    const { data: member } = await admin
      .schema("v3")
      .from("workspace_members")
      .select("id, status")
      .eq("workspace_id", workspace.id)
      .eq("user_id", existingUser.id)
      .eq("status", "active")
      .maybeSingle()
    if (member) {
      return { success: false, error: "Esa persona ya es miembro del workspace" }
    }
  }

  const { invitation, error } = await createInvitation({
    workspaceId: workspace.id,
    email: normalizedEmail,
    role,
    invitedBy: user.id,
  })

  if (error || !invitation) {
    return { success: false, error: error || "Error al crear la invitación" }
  }

  const inviteUrl = buildInviteUrl(invitation.token)
  const inviterName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    user.email ||
    null

  const emailResult = await sendWorkspaceInviteEmail({
    to: normalizedEmail,
    inviteUrl,
    workspaceName: workspace.name,
    inviterName,
    role,
  })

  revalidatePath("/v3/settings/workspace")

  // Si no se envió por falta de servicio, devolvemos el link para mostrar in-app
  if (!emailResult.sent) {
    return {
      success: true,
      emailSent: false,
      inviteUrl,
      error: emailResult.error,
    }
  }

  return { success: true, emailSent: true }
}

export async function revokeMemberInvitation(invitationId: string): Promise<{
  success: boolean
  error?: string
}> {
  const result = await requireAdminWorkspace()
  if ("error" in result) {
    return { success: false, error: result.error }
  }
  const res = await revokeInvitation(invitationId, result.workspace.id)
  if (res.success) revalidatePath("/v3/settings/workspace")
  return res
}

/**
 * Cambia el rol de un miembro (admin/member). Protege al último admin.
 */
export async function changeMemberRole(
  memberId: string,
  newRole: WorkspaceRole
): Promise<{ success: boolean; error?: string }> {
  const result = await requireAdminWorkspace()
  if ("error" in result) {
    return { success: false, error: result.error }
  }
  const { workspace } = result

  if (newRole !== "admin" && newRole !== "member") {
    return { success: false, error: "Rol inválido" }
  }

  // No permitir degradar al último admin (incluido uno mismo)
  if (newRole !== "admin") {
    const members = await getWorkspaceMembers(workspace.id)
    const target = members.find((m) => m.id === memberId)
    if (target?.role === "admin") {
      const adminCount = members.filter((m) => m.role === "admin").length
      if (adminCount <= 1) {
        return { success: false, error: "Debe haber al menos un administrador" }
      }
    }
  }

  const res = await updateMemberRole(memberId, newRole)
  if (res.success) revalidatePath("/v3/settings/workspace")
  return res
}

/**
 * Quita a un miembro del workspace (revoca su acceso). Protege al último admin.
 */
export async function removeMember(memberId: string): Promise<{
  success: boolean
  error?: string
}> {
  const result = await requireAdminWorkspace()
  if ("error" in result) {
    return { success: false, error: result.error }
  }
  const { workspace } = result

  const members = await getWorkspaceMembers(workspace.id)
  const target = members.find((m) => m.id === memberId)
  if (!target) {
    return { success: false, error: "Miembro no encontrado" }
  }
  if (target.role === "admin") {
    const adminCount = members.filter((m) => m.role === "admin").length
    if (adminCount <= 1) {
      return { success: false, error: "Debe haber al menos un administrador" }
    }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .schema("v3")
    .from("workspace_members")
    .update({ status: "revoked" })
    .eq("id", memberId)
    .eq("workspace_id", workspace.id)

  if (error) {
    return { success: false, error: "Error al quitar el miembro" }
  }

  revalidatePath("/v3/settings/workspace")
  return { success: true }
}

// ═══════════════════════════════════════════════════════════
// INVITATION ACCEPTANCE (landing /v3/invite/[token])
// ═══════════════════════════════════════════════════════════

/**
 * Acepta una invitación con el usuario autenticado actual.
 */
export async function acceptWorkspaceInvitation(token: string): Promise<{
  success: boolean
  error?: string
  workspaceId?: string
}> {
  const user = await getCurrentUser()
  if (!user.email) {
    return { success: false, error: "Tu cuenta no tiene email" }
  }

  return acceptInvitation({ token, userId: user.id, userEmail: user.email })
}

// ═══════════════════════════════════════════════════════════
// WORKSPACE SETTINGS
// ═══════════════════════════════════════════════════════════

export async function updateWorkspaceName(name: string): Promise<{
  success: boolean
  error?: string
}> {
  const result = await requireAdminWorkspace()
  if ("error" in result) {
    return { success: false, error: result.error }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .schema("v3")
    .from("workspaces")
    .update({ name })
    .eq("id", result.workspace.id)

  if (error) {
    return { success: false, error: "Error al actualizar el nombre" }
  }

  revalidatePath("/v3/settings/workspace")
  return { success: true }
}

export async function getMyWorkspace(): Promise<WorkspaceWithMember | null> {
  const user = await getCurrentUser()
  return getWorkspaceForUser(user.id)
}

export type { Workspace }
