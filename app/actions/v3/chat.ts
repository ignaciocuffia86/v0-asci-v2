"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireWorkspace } from "@/lib/v3/workspace"
import { revalidatePath } from "next/cache"

export interface ConversationSummary {
  id: string
  title: string | null
  created_at: string
  updated_at: string
}

async function requireAuth() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("No autenticado")
  const workspace = await requireWorkspace(user.id)
  return { user, workspace }
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const { user, workspace } = await requireAuth()
  const admin = createAdminClient()
  const { data } = await admin
    .schema("v3")
    .from("chat_conversations")
    .select("id, title, created_at, updated_at")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(50)
  return data ?? []
}

export async function createConversation(title?: string): Promise<{ id: string } | { error: string }> {
  try {
    const { user, workspace } = await requireAuth()
    const admin = createAdminClient()
    const { data, error } = await admin
      .schema("v3")
      .from("chat_conversations")
      .insert({
        workspace_id: workspace.id,
        user_id: user.id,
        title: title ?? null,
      })
      .select("id")
      .single()
    if (error || !data) return { error: "No se pudo crear la conversación" }
    revalidatePath("/v3/chat")
    return { id: data.id }
  } catch {
    return { error: "No autenticado" }
  }
}

export async function renameConversation(id: string, title: string): Promise<{ success: boolean }> {
  const { user, workspace } = await requireAuth()
  const admin = createAdminClient()
  await admin
    .schema("v3")
    .from("chat_conversations")
    .update({ title: title.slice(0, 120) })
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
  revalidatePath("/v3/chat")
  return { success: true }
}

export async function deleteConversation(id: string): Promise<{ success: boolean }> {
  const { user, workspace } = await requireAuth()
  const admin = createAdminClient()
  await admin
    .schema("v3")
    .from("chat_conversations")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
  revalidatePath("/v3/chat")
  return { success: true }
}

export async function getConversationMessages(
  conversationId: string
): Promise<{ id: string; role: string; parts: unknown[] }[]> {
  const { user, workspace } = await requireAuth()
  const admin = createAdminClient()

  // Verificar propiedad
  const { data: conv } = await admin
    .schema("v3")
    .from("chat_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!conv) return []

  const { data } = await admin
    .schema("v3")
    .from("chat_messages")
    .select("id, role, parts")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })

  return (data ?? []).map((m) => ({
    id: m.id,
    role: m.role,
    parts: Array.isArray(m.parts) ? m.parts : [],
  }))
}
