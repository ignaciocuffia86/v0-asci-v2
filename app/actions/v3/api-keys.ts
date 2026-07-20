"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import crypto from "crypto"

// ═══════════════════════════════════════════════════════════
// API KEY MANAGEMENT
// ═══════════════════════════════════════════════════════════

/**
 * Genera una nueva API key para el workspace del usuario
 * Retorna la key completa SOLO UNA VEZ - luego solo se puede ver el prefix
 */
export async function generateApiKey(name: string, ownerUserId?: string): Promise<{
  success: boolean
  key?: string
  keyId?: string
  error?: string
}> {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: "No autenticado" }
  }
  
  // Get user's workspace and verify they're admin
  const { data: membership } = await supabase
    .schema("v3")
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .single()
    
  if (!membership) {
    return { success: false, error: "No perteneces a un workspace" }
  }
  
  if (membership.role !== "admin") {
    return { success: false, error: "Solo admins pueden generar API keys" }
  }

  // API keys / MCP solo en plan Platinum
  const { checkApiKeyAccess } = await import("@/lib/v3/plans")
  const access = await checkApiKeyAccess(membership.workspace_id)
  if (!access.allowed) {
    return { success: false, error: access.reason ?? "Tu plan no incluye API keys" }
  }

  const admin = createAdminClient()
  const keyOwnerId = ownerUserId ?? user.id
  const { data: ownerMembership } = await admin
    .schema("v3")
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", membership.workspace_id)
    .eq("user_id", keyOwnerId)
    .eq("status", "active")
    .maybeSingle()
  if (!ownerMembership) return { success: false, error: "El propietario debe ser un miembro activo del workspace" }

  const { data: existingKey } = await admin
    .schema("v3")
    .from("mcp_api_keys")
    .select("id")
    .eq("workspace_id", membership.workspace_id)
    .eq("owner_user_id", keyOwnerId)
    .is("revoked_at", null)
    .maybeSingle()
  if (existingKey) return { success: false, error: "Ese usuario ya tiene una API key activa" }
  
  // Generate new key
  const rawKey = `asci_${crypto.randomBytes(32).toString("hex")}`
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex")
  const keyPrefix = rawKey.substring(0, 12) // "asci_" + 7 chars
  
  const { data: newKey, error } = await admin
    .schema("v3")
    .from("mcp_api_keys")
    .insert({
      workspace_id: membership.workspace_id,
      name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      created_by: user.id,
      owner_user_id: keyOwnerId,
      scopes: ["companies:read", "signals:read", "accounts:read", "research:run", "research:prepare", "research:submit", "icebreakers:generate", "icebreakers:prepare", "icebreakers:submit", "usage:read"],
      allowed_modes: ["read", "server_managed", "client_assisted"]
    })
    .select("id")
    .single()
    
  if (error) {
    console.error("Error creating API key:", error)
    return { success: false, error: "Error al crear API key" }
  }
  
  return {
    success: true,
    key: rawKey, // Solo se muestra una vez
    keyId: newKey.id
  }
}

/**
 * Lista las API keys del workspace (sin mostrar la key completa)
 */
export async function listApiKeys(): Promise<{
  success: boolean
  keys?: Array<{
    id: string
    name: string
    key_prefix: string
    created_at: string
    last_used_at: string | null
    request_count: number
  }>
  error?: string
}> {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: "No autenticado" }
  }
  
  // Get user's workspace
  const { data: membership } = await supabase
    .schema("v3")
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .single()
    
  if (!membership) {
    return { success: false, error: "No perteneces a un workspace" }
  }
  
  const { data: keys, error } = await supabase
    .schema("v3")
    .from("mcp_api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, request_count")
    .eq("workspace_id", membership.workspace_id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    
  if (error) {
    console.error("Error listing API keys:", error)
    return { success: false, error: "Error al listar API keys" }
  }
  
  return { success: true, keys: keys || [] }
}

/**
 * Revoca una API key
 */
export async function revokeApiKey(keyId: string): Promise<{
  success: boolean
  error?: string
}> {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { success: false, error: "No autenticado" }
  }
  
  // Get user's workspace and verify admin
  const { data: membership } = await supabase
    .schema("v3")
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .eq("status", "active")
    .single()
    
  if (!membership || membership.role !== "admin") {
    return { success: false, error: "Solo admins pueden revocar API keys" }
  }
  
  const admin = createAdminClient()
  const { error } = await admin
    .schema("v3")
    .from("mcp_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("workspace_id", membership.workspace_id)
    
  if (error) {
    console.error("Error revoking API key:", error)
    return { success: false, error: "Error al revocar API key" }
  }
  
  return { success: true }
}
