import { createAdminClient } from "@/lib/supabase/admin"
import { randomBytes } from "crypto"
import type { WorkspaceRole } from "@/lib/v3/workspace"

// ═══════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired"

export interface WorkspaceInvitation {
  id: string
  workspace_id: string
  email: string
  role: WorkspaceRole
  token: string
  status: InvitationStatus
  invited_by: string
  accepted_by: string | null
  expires_at: string
  created_at: string
  accepted_at: string | null
}

export interface InvitationWithInviter extends WorkspaceInvitation {
  inviter_email: string | null
  inviter_name: string | null
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function generateToken(): string {
  return randomBytes(32).toString("hex")
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

// ═══════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════

/** Lista las invitaciones pendientes de un workspace, con datos del invitador. */
export async function getPendingInvitations(
  workspaceId: string
): Promise<InvitationWithInviter[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .schema("v3")
    .from("workspace_invitations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })

  if (error || !data) {
    return []
  }

  // Resolver identidad del invitador
  const inviterIds = Array.from(new Set(data.map((i) => i.invited_by)))
  const inviterMap = new Map<string, { email: string | null; name: string | null }>()
  await Promise.all(
    inviterIds.map(async (id) => {
      try {
        const { data: u } = await admin.auth.admin.getUserById(id)
        inviterMap.set(id, {
          email: u?.user?.email ?? null,
          name:
            (u?.user?.user_metadata?.full_name as string | undefined) ||
            (u?.user?.user_metadata?.name as string | undefined) ||
            null,
        })
      } catch {
        inviterMap.set(id, { email: null, name: null })
      }
    })
  )

  return data.map((i) => ({
    ...(i as WorkspaceInvitation),
    inviter_email: inviterMap.get(i.invited_by)?.email ?? null,
    inviter_name: inviterMap.get(i.invited_by)?.name ?? null,
  }))
}

/** Obtiene una invitación por token (para la landing de aceptación). */
export async function getInvitationByToken(
  token: string
): Promise<WorkspaceInvitation | null> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .schema("v3")
    .from("workspace_invitations")
    .select("*")
    .eq("token", token)
    .maybeSingle()

  if (error || !data) return null
  return data as WorkspaceInvitation
}

// ═══════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════

/**
 * Crea una invitación pendiente. Reactiva/actualiza si ya existía una pendiente
 * para el mismo (workspace, email).
 */
export async function createInvitation(params: {
  workspaceId: string
  email: string
  role: WorkspaceRole
  invitedBy: string
}): Promise<{ invitation?: WorkspaceInvitation; error?: string }> {
  const admin = createAdminClient()
  const email = normalizeEmail(params.email)
  const token = generateToken()

  // Revocar cualquier invitación pendiente previa para ese email en este workspace
  await admin
    .schema("v3")
    .from("workspace_invitations")
    .update({ status: "revoked" })
    .eq("workspace_id", params.workspaceId)
    .eq("status", "pending")
    .ilike("email", email)

  const { data, error } = await admin
    .schema("v3")
    .from("workspace_invitations")
    .insert({
      workspace_id: params.workspaceId,
      email,
      role: params.role,
      token,
      status: "pending",
      invited_by: params.invitedBy,
    })
    .select()
    .single()

  if (error || !data) {
    console.error("[v3] Error creating invitation:", error)
    return { error: "Error al crear la invitación" }
  }

  return { invitation: data as WorkspaceInvitation }
}

/** Revoca una invitación pendiente. */
export async function revokeInvitation(
  invitationId: string,
  workspaceId: string
): Promise<{ success: boolean; error?: string }> {
  const admin = createAdminClient()

  const { error } = await admin
    .schema("v3")
    .from("workspace_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")

  if (error) {
    return { success: false, error: "Error al revocar la invitación" }
  }
  return { success: true }
}

/**
 * Reclama una invitación para un usuario autenticado.
 * Valida estado, expiración y coincidencia de email; crea el member activo.
 */
export async function acceptInvitation(params: {
  token: string
  userId: string
  userEmail: string
}): Promise<{ success: boolean; workspaceId?: string; error?: string }> {
  const admin = createAdminClient()

  const invitation = await getInvitationByToken(params.token)
  if (!invitation) {
    return { success: false, error: "Invitación no encontrada" }
  }

  if (invitation.status === "accepted") {
    return { success: false, error: "Esta invitación ya fue aceptada" }
  }
  if (invitation.status === "revoked") {
    return { success: false, error: "Esta invitación fue revocada" }
  }
  if (new Date(invitation.expires_at) < new Date()) {
    await admin
      .schema("v3")
      .from("workspace_invitations")
      .update({ status: "expired" })
      .eq("id", invitation.id)
    return { success: false, error: "Esta invitación expiró" }
  }

  // El email autenticado debe coincidir con el invitado
  if (normalizeEmail(params.userEmail) !== normalizeEmail(invitation.email)) {
    return {
      success: false,
      error: `Esta invitación es para ${invitation.email}. Iniciá sesión con ese email.`,
    }
  }

  // ¿Ya es miembro? (reactivar si estaba revocado)
  const { data: existing } = await admin
    .schema("v3")
    .from("workspace_members")
    .select("id, status")
    .eq("workspace_id", invitation.workspace_id)
    .eq("user_id", params.userId)
    .maybeSingle()

  if (existing) {
    await admin
      .schema("v3")
      .from("workspace_members")
      .update({
        status: "active",
        role: invitation.role,
        joined_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
  } else {
    const { error: memberError } = await admin
      .schema("v3")
      .from("workspace_members")
      .insert({
        workspace_id: invitation.workspace_id,
        user_id: params.userId,
        role: invitation.role,
        status: "active",
        invited_by: invitation.invited_by,
        joined_at: new Date().toISOString(),
      })

    if (memberError) {
      console.error("[v3] Error creating member from invitation:", memberError)
      return { success: false, error: "Error al unirte al workspace" }
    }
  }

  // Marcar invitación como aceptada
  await admin
    .schema("v3")
    .from("workspace_invitations")
    .update({
      status: "accepted",
      accepted_by: params.userId,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", invitation.id)

  return { success: true, workspaceId: invitation.workspace_id }
}

/**
 * Reclama automáticamente cualquier invitación pendiente que coincida con el
 * email del usuario (se llama tras login/registro). Reclama la más reciente.
 */
export async function claimPendingInvitationsForEmail(
  userId: string,
  email: string
): Promise<{ claimed: boolean; workspaceId?: string }> {
  const admin = createAdminClient()
  const normalized = normalizeEmail(email)

  const { data } = await admin
    .schema("v3")
    .from("workspace_invitations")
    .select("token")
    .ilike("email", normalized)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.token) {
    return { claimed: false }
  }

  const result = await acceptInvitation({ token: data.token, userId, userEmail: email })
  if (result.success) {
    return { claimed: true, workspaceId: result.workspaceId }
  }
  return { claimed: false }
}
