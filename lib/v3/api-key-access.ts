import { createAdminClient } from "@/lib/supabase/admin"
import type { WorkspaceRole } from "@/lib/v3/workspace"

export interface ApiKeyAccessContext {
  userId: string
  workspaceId: string
  workspaceName: string
  isSuperAdmin: boolean
  membershipRole: WorkspaceRole | null
  canManage: boolean
}

export async function isGlobalSuperAdmin(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle()

  return data?.role === "superadmin"
}

export async function resolveApiKeyAccess(
  userId: string,
  requestedWorkspaceId?: string
): Promise<ApiKeyAccessContext | null> {
  const admin = createAdminClient()
  const isSuperAdmin = await isGlobalSuperAdmin(userId)

  let workspaceId = requestedWorkspaceId
  let membershipRole: WorkspaceRole | null = null

  if (workspaceId) {
    const { data: membership } = await admin
      .schema("v3")
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle()

    membershipRole = (membership?.role as WorkspaceRole | undefined) ?? null
    if (!isSuperAdmin && !membershipRole) return null
  } else {
    const { data: membership } = await admin
      .schema("v3")
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle()

    if (!membership) return null
    workspaceId = membership.workspace_id
    membershipRole = membership.role as WorkspaceRole
  }

  const { data: workspace } = await admin
    .schema("v3")
    .from("workspaces")
    .select("id, name")
    .eq("id", workspaceId)
    .maybeSingle()

  if (!workspace) return null

  return {
    userId,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    isSuperAdmin,
    membershipRole,
    canManage: isSuperAdmin || membershipRole === "admin",
  }
}
