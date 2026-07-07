"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"

// ═══════════════════════════════════════════════════════════
// Gestión de usuarios para super-admins: listado global de
// miembros de workspaces v3 con acciones de activar/desactivar.
// ═══════════════════════════════════════════════════════════

async function requireSuperAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "No autenticado" }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (profile?.role !== "superadmin") return { error: "No tenés permisos de super administrador" }
  return { userId: user.id }
}

export interface AdminUserRow {
  userId: string
  email: string
  workspaceId: string
  workspaceName: string
  role: string
  status: string
  joinedAt: string
  isSuperAdmin: boolean
}

export async function listAllUsers(): Promise<{ users: AdminUserRow[]; error?: string }> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) return { users: [], error: guard.error }

  const admin = createAdminClient()

  const [membersRes, workspacesRes, profilesRes] = await Promise.all([
    admin
      .schema("v3")
      .from("workspace_members")
      .select("user_id, workspace_id, role, status, created_at")
      .order("created_at", { ascending: false }),
    admin.schema("v3").from("workspaces").select("id, name"),
    admin.from("profiles").select("id, role"),
  ])

  const members = membersRes.data ?? []
  const wsNameById = new Map((workspacesRes.data ?? []).map((w) => [w.id, w.name]))
  const superAdminIds = new Set(
    (profilesRes.data ?? []).filter((p) => p.role === "superadmin").map((p) => p.id),
  )

  // Resolver emails en lote (tolerante a fallos)
  const uniqueIds = [...new Set(members.map((m) => m.user_id))]
  const emails = new Map<string, string>()
  await Promise.all(
    uniqueIds.slice(0, 200).map(async (id) => {
      try {
        const { data } = await admin.auth.admin.getUserById(id)
        if (data?.user?.email) emails.set(id, data.user.email)
      } catch {
        // ignorar
      }
    }),
  )

  const users: AdminUserRow[] = members.map((m) => ({
    userId: m.user_id,
    email: emails.get(m.user_id) ?? `${m.user_id.slice(0, 8)}…`,
    workspaceId: m.workspace_id,
    workspaceName: wsNameById.get(m.workspace_id) ?? "—",
    role: m.role,
    status: m.status,
    joinedAt: String(m.created_at),
    isSuperAdmin: superAdminIds.has(m.user_id),
  }))

  return { users }
}

/** Activa o desactiva la membresía de un usuario en un workspace. */
export async function setMemberStatus(input: {
  userId: string
  workspaceId: string
  status: "active" | "disabled"
}): Promise<{ success: boolean; error?: string }> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) return { success: false, error: guard.error }

  // Un superadmin no puede desactivarse a sí mismo
  if (input.userId === guard.userId && input.status === "disabled") {
    return { success: false, error: "No podés desactivar tu propia cuenta" }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .schema("v3")
    .from("workspace_members")
    .update({ status: input.status })
    .eq("user_id", input.userId)
    .eq("workspace_id", input.workspaceId)

  if (error) {
    console.error("[v3] Error actualizando estado de miembro:", error.message)
    return { success: false, error: "Error al actualizar el estado" }
  }

  revalidatePath("/v3/admin/users")
  return { success: true }
}
