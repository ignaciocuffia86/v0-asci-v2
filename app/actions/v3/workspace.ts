"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import {
  getWorkspaceForUser,
  getWorkspaceByDomain,
  createWorkspace,
  requestWorkspaceAccess,
  respondToAccessRequest,
  updateMemberRole,
  getWorkspaceMembers,
  getPendingMembership,
  extractDomain,
  workspaceHasDocuments,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceWithMember,
} from "@/lib/v3/workspace"

// ═══════════════════════════════════════════════════════════
// AUTH HELPERS
// ═══════════════════════════════════════════════════════════

async function getCurrentUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  
  if (error || !user) {
    redirect("/auth/login")
  }
  
  return user
}

// ═══════════════════════════════════════════════════════════
// ONBOARDING ACTIONS
// ═══════════════════════════════════════════════════════════

export type OnboardingStatus = 
  | { status: "no_workspace"; domain: string }
  | { status: "workspace_exists"; workspace: Workspace; isPending: boolean }
  | { status: "active_member"; workspace: WorkspaceWithMember; hasDocuments: boolean }

/**
 * Determina el estado de onboarding del usuario actual
 */
export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const user = await getCurrentUser()
  
  if (!user.email) {
    throw new Error("El usuario no tiene email")
  }
  
  // 1. Verificar si ya tiene workspace activo
  const activeWorkspace = await getWorkspaceForUser(user.id)
  if (activeWorkspace) {
    const hasDocuments = await workspaceHasDocuments(activeWorkspace.id)
    return {
      status: "active_member",
      workspace: activeWorkspace,
      hasDocuments,
    }
  }
  
  // 2. Verificar si existe workspace para su dominio
  const domain = extractDomain(user.email)
  const existingWorkspace = await getWorkspaceByDomain(domain)
  
  if (existingWorkspace) {
    // Verificar si tiene solicitud pendiente
    const pendingMembership = await getPendingMembership(user.id, existingWorkspace.id)
    return {
      status: "workspace_exists",
      workspace: existingWorkspace,
      isPending: !!pendingMembership,
    }
  }
  
  // 3. No existe workspace - usuario debe crearlo
  return {
    status: "no_workspace",
    domain,
  }
}

/**
 * Crea un nuevo workspace para el usuario actual
 * Solo llamar si el usuario no tiene workspace y no existe uno para su dominio
 */
export async function createMyWorkspace(): Promise<{
  success: boolean
  workspace?: Workspace
  error?: string
}> {
  const user = await getCurrentUser()
  
  if (!user.email) {
    return { success: false, error: "El usuario no tiene email" }
  }
  
  // Verificar que no tenga ya workspace
  const existing = await getWorkspaceForUser(user.id)
  if (existing) {
    return { success: false, error: "Ya tienes un workspace activo" }
  }
  
  const result = await createWorkspace(user.id, user.email)
  
  if (result.error) {
    return { success: false, error: result.error }
  }
  
  return { success: true, workspace: result.workspace }
}

/**
 * Solicita acceso a un workspace existente
 */
export async function requestAccessToWorkspace(workspaceId: string): Promise<{
  success: boolean
  error?: string
}> {
  const user = await getCurrentUser()
  
  const result = await requestWorkspaceAccess(user.id, workspaceId)
  
  if (result.error) {
    return { success: false, error: result.error }
  }
  
  return { success: true }
}

// ═══════════════════════════════════════════════════════════
// MEMBER MANAGEMENT ACTIONS (Admin only)
// ═══════════════════════════════════════════════════════════

/**
 * Obtiene todos los miembros del workspace actual
 */
export async function getMyWorkspaceMembers(): Promise<{
  members: WorkspaceMember[]
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

/**
 * Aprueba una solicitud de acceso pendiente
 */
export async function approveAccessRequest(
  memberId: string,
  role?: 'admin' | 'editor' | 'viewer'
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser()
  const workspace = await getWorkspaceForUser(user.id)
  
  if (!workspace) {
    return { success: false, error: "No tienes workspace activo" }
  }
  
  if (workspace.member.role !== "admin") {
    return { success: false, error: "Solo los administradores pueden aprobar solicitudes" }
  }
  
  return respondToAccessRequest(memberId, "approve", role)
}

/**
 * Rechaza una solicitud de acceso pendiente
 */
export async function rejectAccessRequest(memberId: string): Promise<{
  success: boolean
  error?: string
}> {
  const user = await getCurrentUser()
  const workspace = await getWorkspaceForUser(user.id)
  
  if (!workspace) {
    return { success: false, error: "No tienes workspace activo" }
  }
  
  if (workspace.member.role !== "admin") {
    return { success: false, error: "Solo los administradores pueden rechazar solicitudes" }
  }
  
  return respondToAccessRequest(memberId, "reject")
}

/**
 * Actualiza el rol de un miembro
 */
export async function changeMemberRole(
  memberId: string,
  newRole: 'admin' | 'editor' | 'viewer'
): Promise<{ success: boolean; error?: string }> {
  const user = await getCurrentUser()
  const workspace = await getWorkspaceForUser(user.id)
  
  if (!workspace) {
    return { success: false, error: "No tienes workspace activo" }
  }
  
  if (workspace.member.role !== "admin") {
    return { success: false, error: "Solo los administradores pueden cambiar roles" }
  }
  
  // No permitir cambiar el propio rol si es el unico admin
  if (memberId === workspace.member.id && newRole !== "admin") {
    const members = await getWorkspaceMembers(workspace.id)
    const adminCount = members.filter(m => m.role === "admin" && m.status === "active").length
    if (adminCount <= 1) {
      return { success: false, error: "Debe haber al menos un administrador" }
    }
  }
  
  return updateMemberRole(memberId, newRole)
}

// ═══════════════════════════════════════════════════════════
// WORKSPACE SETTINGS ACTIONS
// ═══════════════════════════════════════════════════════════

/**
 * Actualiza el nombre del workspace
 */
export async function updateWorkspaceName(name: string): Promise<{
  success: boolean
  error?: string
}> {
  const user = await getCurrentUser()
  const workspace = await getWorkspaceForUser(user.id)
  
  if (!workspace) {
    return { success: false, error: "No tienes workspace activo" }
  }
  
  if (workspace.member.role !== "admin") {
    return { success: false, error: "Solo los administradores pueden editar el workspace" }
  }
  
  const supabase = await createClient()
  const { error } = await supabase
    .schema("v3")
    .from("workspaces")
    .update({ name })
    .eq("id", workspace.id)
  
  if (error) {
    return { success: false, error: "Error al actualizar el nombre" }
  }
  
  return { success: true }
}

/**
 * Obtiene el workspace actual del usuario para uso en componentes
 */
export async function getMyWorkspace(): Promise<WorkspaceWithMember | null> {
  const user = await getCurrentUser()
  return getWorkspaceForUser(user.id)
}
