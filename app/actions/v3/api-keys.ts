"use server"

import crypto from "crypto"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveApiKeyAccess, isGlobalSuperAdmin } from "@/lib/v3/api-key-access"
import { getWorkspaceMembers, resolveUserIdentities } from "@/lib/v3/workspace"

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

export type ApiKeyType = "standard" | "explore"

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

/**
 * Scopes por tipo de key.
 * - standard: el MCP actual (señales v2, research, icebreakers, contactos).
 * - explore: el MCP paralelo sobre la tabla cruda. Incluye explore:read y los
 *   scopes de las capas pagas del embudo (scrape de vacantes y Apollo).
 */
const SCOPES_BY_TYPE: Record<ApiKeyType, { scopes: string[]; allowedModes: string[] }> = {
  standard: {
    scopes: ["companies:read", "signals:read", "accounts:read", "research:run", "research:prepare", "research:submit", "icebreakers:generate", "icebreakers:prepare", "icebreakers:submit", "usage:read"],
    allowedModes: ["read", "server_managed", "client_assisted"],
  },
  explore: {
    scopes: ["explore:read", "research:run", "accounts:read", "accounts:write", "contacts:write", "usage:read"],
    allowedModes: ["read", "server_managed"],
  },
}

/** Deriva el tipo de una key a partir de sus scopes guardados. */
function keyTypeFromScopes(scopes: string[] | null): ApiKeyType {
  return (scopes ?? []).includes("explore:read") ? "explore" : "standard"
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

export async function generateApiKey(name: string, workspaceId: string, ownerUserId: string): Promise<{
  success: boolean
  key?: string
  keyId?: string
  error?: string
}> {
  const userId = await getAuthenticatedUserId()
  if (!userId) return { success: false, error: "No autenticado" }
  if (!name.trim()) return { success: false, error: "Ingresa un nombre para la API key" }

  const access = await resolveApiKeyAccess(userId, workspaceId)
  if (!access?.canManage) return { success: false, error: "Solo admins pueden generar API keys" }

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

  const { data: existingKey } = await admin
    .schema("v3")
    .from("mcp_api_keys")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("owner_user_id", ownerUserId)
    .is("revoked_at", null)
    .maybeSingle()
  if (existingKey) return { success: false, error: "Ese usuario ya tiene una API key activa" }

  const rawKey = `asci_${crypto.randomBytes(32).toString("hex")}`
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex")
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
      scopes: ["companies:read", "signals:read", "accounts:read", "research:run", "research:prepare", "research:submit", "icebreakers:generate", "icebreakers:prepare", "icebreakers:submit", "usage:read"],
      allowed_modes: ["read", "server_managed", "client_assisted"],
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
    .select("id, name, key_prefix, created_at, last_used_at, request_count, owner_user_id")
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
    keys: (keys ?? []).map((key) => ({
      ...key,
      owner_email: identities.get(key.owner_user_id)?.email ?? null,
      owner_name: identities.get(key.owner_user_id)?.full_name ?? null,
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
