import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// ═══════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════

export type WorkspaceRole = "admin" | "member"
export type MemberStatus = "active" | "revoked"

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
  role: WorkspaceRole
  status: MemberStatus
  invited_by: string | null
  invited_at: string
  joined_at: string | null
}

/** Miembro enriquecido con identidad resuelta desde auth.users */
export interface WorkspaceMemberWithIdentity extends WorkspaceMember {
  email: string | null
  full_name: string | null
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
// RESOLUCIÓN DE IDENTIDAD (auth.users vía service role)
// ═══════════════════════════════════════════════════════════

/**
 * Resuelve email y nombre de una lista de user_ids desde auth.users.
 * Usa el admin client (service role); seguro porque corre en backend.
 */
export async function resolveUserIdentities(
  userIds: string[]
): Promise<Map<string, { email: string | null; full_name: string | null }>> {
  const admin = createAdminClient()
  const result = new Map<string, { email: string | null; full_name: string | null }>()

  // getUserById es la vía soportada y no requiere paginar toda la base.
  await Promise.all(
    Array.from(new Set(userIds)).map(async (id) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(id)
        if (error || !data?.user) {
          result.set(id, { email: null, full_name: null })
          return
        }
        const u = data.user
        const fullName =
          (u.user_metadata?.full_name as string | undefined) ||
          (u.user_metadata?.name as string | undefined) ||
          null
        result.set(id, { email: u.email ?? null, full_name: fullName })
      } catch {
        result.set(id, { email: null, full_name: null })
      }
    })
  )

  return result
}

/**
 * Busca un usuario por email en auth.users. Retorna null si no existe.
 */
export async function getAuthUserByEmail(
  email: string
): Promise<{ id: string; email: string } | null> {
  const admin = createAdminClient()
  const normalized = email.trim().toLowerCase()

  // listUsers no permite filtrar por email directamente en todas las versiones,
  // pero paginamos buscando coincidencia exacta.
  let page = 1
  const perPage = 200
  // Límite defensivo de páginas para no iterar infinito.
  for (let i = 0; i < 25; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error || !data?.users?.length) break
    const match = data.users.find((u) => u.email?.toLowerCase() === normalized)
    if (match) return { id: match.id, email: match.email! }
    if (data.users.length < perPage) break
    page++
  }
  return null
}

// ═══════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════

/**
 * Obtiene el workspace activo del usuario actual
 * Retorna null si el usuario no tiene workspace o no esta activo
 *
 * IMPORTANTE: no usar .single() aca. El unico indice unico de workspace_members
 * es (workspace_id, user_id), que impide repetir al usuario en el MISMO
 * workspace pero PERMITE que pertenezca a varios. Con 2+ membresias activas
 * .single() devuelve el error PGRST116 ("Cannot coerce the result to a single
 * JSON object") y esta funcion retornaba null, o sea el usuario quedaba afuera
 * de /v3 con un cartel de "no tenes workspace" aunque tuviera sus datos
 * intactos. Paso de verdad: un workspace de test dejo una membresia extra.
 *
 * Elegimos la membresia mas antigua por joined_at para que la eleccion sea
 * estable entre requests: sin ORDER BY explicito Postgres no garantiza el
 * orden y el usuario podria caer en un workspace distinto en cada carga.
 */
export async function getWorkspaceForUser(userId: string): Promise<WorkspaceWithMember | null> {
  // Usamos admin client para bypasear RLS - es seguro porque el userId viene de auth validado
  const admin = createAdminClient()

  const { data: rows, error } = await admin
    .schema("v3")
    .from("workspace_members")
    .select(`
      *,
      workspace:workspaces(*)
    `)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("joined_at", { ascending: true, nullsFirst: false })

  if (error || !rows?.length) {
    return null
  }

  if (rows.length > 1) {
    console.log(
      `[v0] getWorkspaceForUser: el usuario ${userId} tiene ${rows.length} membresias activas ` +
        `(${rows.map((r) => r.workspace_id).join(", ")}). Se usa la mas antigua por joined_at. ` +
        `La UI todavia no tiene selector de workspace, asi que esto suele ser dato residual.`,
    )
  }

  const data = rows[0]

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
    },
  }
}

/** Obtiene un workspace por id. */
export async function getWorkspaceById(workspaceId: string): Promise<Workspace | null> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .schema("v3")
    .from("workspaces")
    .select("*")
    .eq("id", workspaceId)
    .maybeSingle()

  if (error || !data) return null
  return data as Workspace
}

/**
 * Obtiene todos los miembros activos de un workspace, enriquecidos con
 * email y nombre resueltos desde auth.users.
 */
export async function getWorkspaceMembers(
  workspaceId: string
): Promise<WorkspaceMemberWithIdentity[]> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .schema("v3")
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("joined_at", { ascending: true })

  if (error || !data) {
    return []
  }

  const identities = await resolveUserIdentities(data.map((m) => m.user_id))

  return data.map((m) => {
    const identity = identities.get(m.user_id)
    return {
      ...(m as WorkspaceMember),
      email: identity?.email ?? null,
      full_name: identity?.full_name ?? null,
    }
  })
}

// ═══════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════

/**
 * Crea un nuevo workspace y asigna a un usuario existente como admin.
 * Pensado para el panel super-admin (bootstrapping de tenants).
 */
export async function createWorkspaceWithAdmin(params: {
  name: string
  domain: string
  websiteUrl?: string
  adminUserId: string
  createdBy: string
}): Promise<{ workspace?: Workspace; error?: string }> {
  const admin = createAdminClient()
  const normalizedDomain = normalizeDomain(params.domain)

  const { data: existing } = await admin
    .schema("v3")
    .from("workspaces")
    .select("id")
    .eq("domain", normalizedDomain)
    .maybeSingle()

  if (existing) {
    return { error: "Ya existe un workspace para este dominio" }
  }

  const { data: workspace, error: wsError } = await admin
    .schema("v3")
    .from("workspaces")
    .insert({
      domain: normalizedDomain,
      name: params.name,
      website_url: params.websiteUrl || `https://${normalizedDomain}`,
      created_by: params.createdBy,
    })
    .select()
    .single()

  if (wsError || !workspace) {
    console.error("[v3] Error creating workspace:", wsError)
    return { error: "Error al crear el workspace" }
  }

  const { error: memberError } = await admin
    .schema("v3")
    .from("workspace_members")
    .insert({
      workspace_id: workspace.id,
      user_id: params.adminUserId,
      role: "admin",
      status: "active",
      invited_by: params.createdBy,
      joined_at: new Date().toISOString(),
    })

  if (memberError) {
    console.error("[v3] Error adding admin member:", memberError)
    await admin.schema("v3").from("workspaces").delete().eq("id", workspace.id)
    return { error: "Error al configurar el administrador" }
  }

  return { workspace: workspace as Workspace }
}

/**
 * Actualiza el rol de un miembro (solo admin)
 */
export async function updateMemberRole(
  memberId: string,
  role: WorkspaceRole
): Promise<{ success: boolean; error?: string }> {
  const admin = createAdminClient()

  const { error } = await admin
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
  allowedRoles: WorkspaceRole[]
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
  const admin = createAdminClient()

  const { count, error } = await admin
    .schema("v3")
    .from("workspace_documents")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "ready")

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
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    uid = user.id
  }

  return getWorkspaceForUser(uid)
}

/**
 * Requiere que el usuario sea un miembro activo del workspace.
 * Con el modelo de 2 roles, cualquier miembro (admin o member) puede
 * crear/editar campañas y documentos.
 */
export async function requireWorkspaceMember(userId?: string): Promise<WorkspaceWithMember> {
  const supabase = await createClient()
  let uid = userId
  if (!uid) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error("NOT_AUTHENTICATED")
    uid = user.id
  }
  return requireWorkspaceRole(uid, ["admin", "member"])
}

/**
 * @deprecated Usar requireWorkspaceMember. Se mantiene como alias para
 * compatibilidad con callers existentes (campaigns, documents).
 */
export async function requireWorkspaceEditor(userId?: string): Promise<WorkspaceWithMember> {
  return requireWorkspaceMember(userId)
}

/**
 * Requiere que el usuario sea admin del workspace
 */
export async function requireWorkspaceAdmin(userId?: string): Promise<WorkspaceWithMember> {
  const supabase = await createClient()
  let uid = userId
  if (!uid) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error("NOT_AUTHENTICATED")
    uid = user.id
  }
  return requireWorkspaceRole(uid, ["admin"])
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
    const {
      data: { user },
    } = await supabase.auth.getUser()
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
