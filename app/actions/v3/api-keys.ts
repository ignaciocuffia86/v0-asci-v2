"use server"

import crypto from "crypto"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveApiKeyAccess, isGlobalSuperAdmin } from "@/lib/v3/api-key-access"
import { getWorkspaceMembers, resolveUserIdentities } from "@/lib/v3/workspace"
import { SCOPES_BY_TYPE, keyTypeFromScopes, type ApiKeyType } from "@/lib/v3/mcp-key-scopes"

export interface ApiKeyWorkspaceOption {
  id: string
  name: string
}

export interface ApiKeyOwnerOption {
  id: string
  email: string | null
  fullName: string | null
  role: "admin" | "member"
}

// El tipo y el set de scopes viven en lib/v3/mcp-key-scopes.ts: los comparte con
// la validación de cada request, que no puede importar un módulo "use server".
export type { ApiKeyType } from "@/lib/v3/mcp-key-scopes"

export interface ApiKeyListItem {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  request_count: number
  owner_user_id: string
  owner_email: string | null
  owner_name: string | null
  key_type: ApiKeyType
}

async function getAuthenticatedUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function getApiKeySettingsContext(): Promise<{
  success: boolean
  isSuperAdmin?: boolean
  workspaces?: ApiKeyWorkspaceOption[]
  defaultWorkspaceId?: string
  error?: string
}> {
  const userId = await getAuthenticatedUserId()
  if (!userId) return { success: false, error: "No autenticado" }

  const admin = createAdminClient()
  const isSuperAdmin = await isGlobalSuperAdmin(userId)
  let workspaceIds: string[] | null = null

  if (!isSuperAdmin) {
    const { data: memberships } = await admin
      .schema("v3")
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .eq("status", "active")
    workspaceIds = (memberships ?? []).map((item) => item.workspace_id)
    if (workspaceIds.length === 0) return { success: false, error: "No perteneces a un workspace" }
  }

  let query = admin.schema("v3").from("workspaces").select("id, name").order("name")
  if (workspaceIds) query = query.in("id", workspaceIds)
  const { data: workspaces, error } = await query
  if (error) return { success: false, error: "No se pudieron cargar los workspaces" }

  return {
    success: true,
    isSuperAdmin,
    workspaces: workspaces ?? [],
    defaultWorkspaceId: workspaces?.[0]?.id,
  }
}

export async function listApiKeyOwners(workspaceId: string): Promise<{
  success: boolean
  owners?: ApiKeyOwnerOption[]
  canManage?: boolean
  workspaceName?: string
  error?: string
}> {
  const userId = await getAuthenticatedUserId()
  if (!userId) return { success: false, error: "No autenticado" }
  const access = await resolveApiKeyAccess(userId, workspaceId)
  if (!access) return { success: false, error: "No tienes acceso a este workspace" }

  const members = await getWorkspaceMembers(workspaceId)
  const visibleMembers = access.canManage
    ? members
    : members.filter((member) => member.user_id === userId)
  return {
    success: true,
    canManage: access.canManage,
    workspaceName: access.workspaceName,
    owners: visibleMembers.map((member) => ({
      id: member.user_id,
      email: member.email,
      fullName: member.full_name,
      role: member.role,
    })),
  }
}

export async function generateApiKey(
  name: string,
  workspaceId: string,
  ownerUserId: string,
  keyType: ApiKeyType = "standard",
): Promise<{
  success: boolean
  key?: string
  keyId?: string
  error?: string
}> {
  const userId = await getAuthenticatedUserId()
  if (!userId) return { success: false, error: "No autenticado" }
  if (!name.trim()) return { success: false, error: "Ingresa un nombre para la API key" }
  if (keyType !== "standard" && keyType !== "explore" && keyType !== "profiles" && keyType !== "admin") {
    return { success: false, error: "Tipo de API key inválido" }
  }

  const access = await resolveApiKeyAccess(userId, workspaceId)
  if (!access?.canManage) return { success: false, error: "Solo admins pueden generar API keys" }

  // ── Dos llaves para emitir una credencial SIN TOPES ────────────────────────
  //
  // Una key `admin` apaga el cap de cuentas y el cupo de research. En un
  // workspace de cliente eso destruye el único freno de costo que ese workspace
  // tiene, así que las dos condiciones son independientes y ambas obligatorias:
  //
  //  1. Quien la emite es superadmin GLOBAL. El `canManage` de arriba NO alcanza:
  //     lo tiene cualquier admin de cualquier workspace, incluido el de un
  //     cliente.
  //  2. El workspace destino es el de ASCI, declarado por variable de entorno.
  //
  // Falla CERRADO: sin la variable configurada no se puede emitir ninguna. Es
  // preferible que un despliegue mal configurado no pueda crear la key a que
  // pueda crearla en cualquier lado.
  if (keyType === "admin") {
    if (!(await isGlobalSuperAdmin(userId))) {
      return { success: false, error: "Solo un superadmin global puede generar una API key admin" }
    }
    const asciWorkspaceId = process.env.ASCI_ADMIN_WORKSPACE_ID?.trim()
    if (!asciWorkspaceId) {
      return { success: false, error: "Falta configurar ASCI_ADMIN_WORKSPACE_ID para poder emitir keys admin" }
    }
    if (workspaceId !== asciWorkspaceId) {
      return { success: false, error: "Las API keys admin solo se emiten en el workspace de ASCI" }
    }
  }

  const { checkApiKeyAccess } = await import("@/lib/v3/plans")
  const planAccess = await checkApiKeyAccess(workspaceId)
  if (!planAccess.allowed) return { success: false, error: planAccess.reason ?? "El plan no incluye API keys" }

  const admin = createAdminClient()
  const { data: ownerMembership } = await admin
    .schema("v3")
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", ownerUserId)
    .eq("status", "active")
    .maybeSingle()
  if (!ownerMembership) return { success: false, error: "El propietario debe ser un miembro activo del workspace" }

  // Se permite una key activa por tipo (standard + explore + profiles) para poder
  // correr los tres MCP en paralelo. No hay constraint en DB: se valida acá.
  const { data: existingKeys } = await admin
    .schema("v3")
    .from("mcp_api_keys")
    .select("id, scopes")
    .eq("workspace_id", workspaceId)
    .eq("owner_user_id", ownerUserId)
    .is("revoked_at", null)
  const alreadyHasType = (existingKeys ?? []).some((key) => keyTypeFromScopes(key.scopes) === keyType)
  if (alreadyHasType) {
    return {
      success: false,
      error: keyType === "explore"
        ? "Ese usuario ya tiene una API key de exploración activa"
        : keyType === "profiles"
          ? "Ese usuario ya tiene una API key de perfiles activa"
          : keyType === "admin"
            ? "Ese usuario ya tiene una API key admin activa"
            : "Ese usuario ya tiene una API key activa",
    }
  }

  const rawKey = `asci_${crypto.randomBytes(32).toString("hex")}`
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex")
  const { scopes, allowedModes } = SCOPES_BY_TYPE[keyType]
  const { data: newKey, error } = await admin
    .schema("v3")
    .from("mcp_api_keys")
    .insert({
      workspace_id: workspaceId,
      name: name.trim(),
      key_hash: keyHash,
      key_prefix: rawKey.substring(0, 12),
      created_by: userId,
      owner_user_id: ownerUserId,
      scopes,
      allowed_modes: allowedModes,
    })
    .select("id")
    .single()

  if (error) return { success: false, error: "Error al crear la API key" }
  return { success: true, key: rawKey, keyId: newKey.id }
}

export async function listApiKeys(workspaceId: string): Promise<{
  success: boolean
  keys?: ApiKeyListItem[]
  canManage?: boolean
  error?: string
}> {
  const userId = await getAuthenticatedUserId()
  if (!userId) return { success: false, error: "No autenticado" }
  const access = await resolveApiKeyAccess(userId, workspaceId)
  if (!access) return { success: false, error: "No tienes acceso a este workspace" }

  const admin = createAdminClient()
  let query = admin
    .schema("v3")
    .from("mcp_api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, request_count, owner_user_id, scopes")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
  if (!access.canManage) query = query.eq("owner_user_id", userId)

  const { data: keys, error } = await query
  if (error) return { success: false, error: "Error al listar API keys" }
  const identities = await resolveUserIdentities((keys ?? []).map((key) => key.owner_user_id))

  return {
    success: true,
    canManage: access.canManage,
    keys: (keys ?? []).map(({ scopes, ...key }) => ({
      ...key,
      owner_email: identities.get(key.owner_user_id)?.email ?? null,
      owner_name: identities.get(key.owner_user_id)?.full_name ?? null,
      key_type: keyTypeFromScopes(scopes),
    })),
  }
}

export async function revokeApiKey(keyId: string, workspaceId: string): Promise<{ success: boolean; error?: string }> {
  const userId = await getAuthenticatedUserId()
  if (!userId) return { success: false, error: "No autenticado" }
  const access = await resolveApiKeyAccess(userId, workspaceId)
  if (!access?.canManage) return { success: false, error: "Solo admins pueden revocar API keys" }

  const admin = createAdminClient()
  const { data, error } = await admin
    .schema("v3")
    .from("mcp_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle()

  if (error) return { success: false, error: "Error al revocar la API key" }
  if (!data) return { success: false, error: "La API key no existe en este workspace" }
  return { success: true }
}
