import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// ═══════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════

export interface Workspace {
  id: string
  domain: string
  name: string
  website_url: string | null
  created_by: string
  created_at: string
}

export interface WorkspaceMember {
  id: string
  workspace_id: string
  user_id: string
  role: 'admin' | 'editor' | 'viewer'
  status: 'pending' | 'active' | 'rejected'
  invited_by: string | null
  invited_at: string
  joined_at: string | null
}

export interface WorkspaceWithMember extends Workspace {
  member: WorkspaceMember
}

// ═══════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════

/**
 * Extrae el dominio de un email
 * @example extractDomain("user@bigua.lat") => "bigua.lat"
 */
export function extractDomain(email: string): string {
  const parts = email.split("@")
  if (parts.length !== 2) {
    throw new Error("Invalid email format")
  }
  return parts[1].toLowerCase()
}

/**
 * Normaliza un dominio para comparacion
 * Remueve www. y convierte a minusculas
 */
export function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, "")
}

/**
 * Genera un nombre de workspace desde el dominio
 * @example domainToWorkspaceName("bigua.lat") => "Bigua"
 */
export function domainToWorkspaceName(domain: string): string {
  const name = domain.split(".")[0]
  return name.charAt(0).toUpperCase() + name.slice(1)
}

// ═══════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════

/**
 * Obtiene el workspace activo del usuario actual
 * Retorna null si el usuario no tiene workspace o no esta activo
 */
export async function getWorkspaceForUser(userId: string): Promise<WorkspaceWithMember | null> {
  const supabase = await createClient()
  
  console.log("[v0] getWorkspaceForUser - userId:", userId)
  
  const { data, error } = await supabase
    .schema("v3")
    .from("workspace_members")
    .select(`
      *,
      workspace:workspaces(*)
    `)
    .eq("user_id", userId)
    .eq("status", "active")
    .single()
  
  console.log("[v0] getWorkspaceForUser - data:", data, "error:", error)
  
  if (error || !data) {
    return null
  }
  
  return {
    ...(data.workspace as Workspace),
    member: {
      id: data.id,
      workspace_id: data.workspace_id,
      user_id: data.user_id,
      role: data.role,
      status: data.status,
      invited_by: data.invited_by,
      invited_at: data.invited_at,
      joined_at: data.joined_at,
    }
  }
}

/**
 * Busca un workspace por dominio
 */
export async function getWorkspaceByDomain(domain: string): Promise<Workspace | null> {
  const supabase = await createClient()
  const normalizedDomain = normalizeDomain(domain)
  
  const { data, error } = await supabase
    .schema("v3")
    .from("workspaces")
    .select("*")
    .eq("domain", normalizedDomain)
    .single()
  
  if (error || !data) {
    return null
  }
  
  return data as Workspace
}

/**
 * Verifica si el usuario tiene una solicitud pendiente para un workspace
 */
export async function getPendingMembership(userId: string, workspaceId: string): Promise<WorkspaceMember | null> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .schema("v3")
    .from("workspace_members")
    .select("*")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .single()
  
  if (error || !data) {
    return null
  }
  
  return data as WorkspaceMember
}

/**
 * Obtiene todos los miembros de un workspace
 */
export async function getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .schema("v3")
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("joined_at", { ascending: true })
  
  if (error) {
    return []
  }
  
  return data as WorkspaceMember[]
}

// ═══════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════

/**
 * Crea un nuevo workspace y asigna al usuario como admin
 * Solo llamar si no existe workspace para el dominio
 */
export async function createWorkspace(
  userId: string,
  email: string,
  websiteUrl?: string
): Promise<{ workspace?: Workspace; error?: string }> {
  const supabaseAdmin = createAdminClient()
  
  const domain = extractDomain(email)
  const normalizedDomain = normalizeDomain(domain)
  const name = domainToWorkspaceName(domain)
  
  // Verificar que no exista ya un workspace para este dominio
  const { data: existing } = await supabaseAdmin
    .schema("v3")
    .from("workspaces")
    .select("id")
    .eq("domain", normalizedDomain)
    .single()
  
  if (existing) {
    return { error: "Ya existe un workspace para este dominio" }
  }
  
  // Crear workspace
  const { data: workspace, error: wsError } = await supabaseAdmin
    .schema("v3")
    .from("workspaces")
    .insert({
      domain: normalizedDomain,
      name,
      website_url: websiteUrl || `https://${normalizedDomain}`,
      created_by: userId,
    })
    .select()
    .single()
  
  if (wsError || !workspace) {
    console.error("[v3] Error creating workspace:", wsError)
    return { error: "Error al crear el workspace" }
  }
  
  // Agregar usuario como admin activo
  const { error: memberError } = await supabaseAdmin
    .schema("v3")
    .from("workspace_members")
    .insert({
      workspace_id: workspace.id,
      user_id: userId,
      role: "admin",
      status: "active",
      joined_at: new Date().toISOString(),
    })
  
  if (memberError) {
    console.error("[v3] Error adding admin member:", memberError)
    // Rollback: eliminar workspace creado
    await supabaseAdmin
      .schema("v3")
      .from("workspaces")
      .delete()
      .eq("id", workspace.id)
    return { error: "Error al configurar el administrador" }
  }
  
  return { workspace: workspace as Workspace }
}

/**
 * Solicita unirse a un workspace existente
 * El admin debe aprobar la solicitud
 */
export async function requestWorkspaceAccess(
  userId: string,
  workspaceId: string
): Promise<{ member?: WorkspaceMember; error?: string }> {
  const supabase = await createClient()
  
  // Verificar que no tenga ya una membresía
  const { data: existing } = await supabase
    .schema("v3")
    .from("workspace_members")
    .select("*")
    .eq("user_id", userId)
    .eq("workspace_id", workspaceId)
    .single()
  
  if (existing) {
    if (existing.status === "active") {
      return { error: "Ya eres miembro de este workspace" }
    }
    if (existing.status === "pending") {
      return { error: "Ya tienes una solicitud pendiente" }
    }
    if (existing.status === "rejected") {
      return { error: "Tu solicitud fue rechazada anteriormente" }
    }
  }
  
  // Crear solicitud pendiente
  const { data: member, error } = await supabase
    .schema("v3")
    .from("workspace_members")
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      role: "viewer", // Por defecto viewer, el admin puede cambiar
      status: "pending",
    })
    .select()
    .single()
  
  if (error) {
    console.error("[v3] Error requesting access:", error)
    return { error: "Error al enviar la solicitud" }
  }
  
  return { member: member as WorkspaceMember }
}

/**
 * Aprueba o rechaza una solicitud de acceso (solo admin)
 */
export async function respondToAccessRequest(
  memberId: string,
  action: "approve" | "reject",
  role?: 'admin' | 'editor' | 'viewer'
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  
  if (action === "approve") {
    const { error } = await supabase
      .schema("v3")
      .from("workspace_members")
      .update({
        status: "active",
        role: role || "viewer",
        joined_at: new Date().toISOString(),
      })
      .eq("id", memberId)
    
    if (error) {
      return { success: false, error: "Error al aprobar la solicitud" }
    }
  } else {
    const { error } = await supabase
      .schema("v3")
      .from("workspace_members")
      .update({ status: "rejected" })
      .eq("id", memberId)
    
    if (error) {
      return { success: false, error: "Error al rechazar la solicitud" }
    }
  }
  
  return { success: true }
}

/**
 * Actualiza el rol de un miembro (solo admin)
 */
export async function updateMemberRole(
  memberId: string,
  role: 'admin' | 'editor' | 'viewer'
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  
  const { error } = await supabase
    .schema("v3")
    .from("workspace_members")
    .update({ role })
    .eq("id", memberId)
  
  if (error) {
    return { success: false, error: "Error al actualizar el rol" }
  }
  
  return { success: true }
}

// ═══════════════════════════════════════════════════════════
// GUARDS / MIDDLEWARE HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Requiere que el usuario tenga un workspace activo
 * Si no tiene, lanza error (para usar en server actions)
 */
export async function requireWorkspace(userId: string): Promise<WorkspaceWithMember> {
  const workspace = await getWorkspaceForUser(userId)
  
  if (!workspace) {
    throw new Error("WORKSPACE_REQUIRED")
  }
  
  return workspace
}

/**
 * Requiere que el usuario tenga uno de los roles especificados
 */
export async function requireWorkspaceRole(
  userId: string,
  allowedRoles: ('admin' | 'editor' | 'viewer')[]
): Promise<WorkspaceWithMember> {
  const workspace = await requireWorkspace(userId)
  
  if (!allowedRoles.includes(workspace.member.role)) {
    throw new Error("INSUFFICIENT_PERMISSIONS")
  }
  
  return workspace
}

/**
 * Verifica si el workspace tiene documentos (blocker para usar la plataforma)
 */
export async function workspaceHasDocuments(workspaceId: string): Promise<boolean> {
  const supabase = await createClient()
  
  const { count, error } = await supabase
    .schema("v3")
    .from("workspace_documents")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "processed")
  
  if (error) {
    return false
  }
  
  return (count ?? 0) > 0
}

/**
 * Obtiene el workspace del usuario actual (usa auth session)
 * Convenience wrapper para usar en server components sin pasar userId
 */
export async function getCurrentWorkspace(userId?: string): Promise<WorkspaceWithMember | null> {
  const supabase = await createClient()
  
  let uid = userId
  if (!uid) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    uid = user.id
  }
  
  return getWorkspaceForUser(uid)
}

/**
 * Requiere que el usuario tenga rol de editor o admin
 * Shorthand para requireWorkspaceRole con roles de escritura
 */
export async function requireWorkspaceEditor(userId?: string): Promise<WorkspaceWithMember> {
  const supabase = await createClient()
  let uid = userId
  if (!uid) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("NOT_AUTHENTICATED")
    uid = user.id
  }
  return requireWorkspaceRole(uid, ['admin', 'editor'])
}

/**
 * Requiere que el usuario sea admin del workspace
 */
export async function requireWorkspaceAdmin(userId?: string): Promise<WorkspaceWithMember> {
  const supabase = await createClient()
  let uid = userId
  if (!uid) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("NOT_AUTHENTICATED")
    uid = user.id
  }
  return requireWorkspaceRole(uid, ['admin'])
}

/**
 * Obtiene el contexto completo del workspace para un usuario
 * Incluye workspace, member, y si tiene documentos
 */
export async function getWorkspaceContext(userId?: string): Promise<{
  workspace: WorkspaceWithMember | null
  hasDocuments: boolean
  isOnboarded: boolean
}> {
  const supabase = await createClient()
  let uid = userId
  if (!uid) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { workspace: null, hasDocuments: false, isOnboarded: false }
    uid = user.id
  }
  
  const workspace = await getWorkspaceForUser(uid)
  
  if (!workspace) {
    return { workspace: null, hasDocuments: false, isOnboarded: false }
  }
  
  const hasDocuments = await workspaceHasDocuments(workspace.id)
  
  return {
    workspace,
    hasDocuments,
    isOnboarded: hasDocuments,
  }
}
