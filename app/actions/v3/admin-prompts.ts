"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { PROMPT_DEFINITIONS, PROMPT_DEFAULTS } from "@/lib/v3/prompt-defaults"
import { invalidatePromptCache } from "@/lib/v3/prompts"

// ═══════════════════════════════════════════════════════════
// Server actions del panel de prompts (/v3/admin/prompts).
// Solo super-admins. Los prompts editados se guardan en
// v3.ai_prompts (override) con historial en v3.ai_prompt_versions.
// ═══════════════════════════════════════════════════════════

async function requireSuperAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login?next=/v3/admin/prompts")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()

  if (profile?.role !== "superadmin") {
    return { error: "No tenés permisos de super administrador" }
  }

  return { userId: user.id }
}

export interface PromptWithState {
  key: string
  name: string
  description: string
  placeholders: { name: string; description: string }[]
  requiredPlaceholders: string[]
  defaultContent: string
  /** Contenido vigente (override o default) */
  content: string
  /** true si hay override en DB (difiere del default) */
  isCustomized: boolean
  updatedAt: string | null
  versionsCount: number
}

export async function listPrompts(): Promise<{ prompts: PromptWithState[]; error?: string }> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) return { prompts: [], error: guard.error }

  const admin = createAdminClient()
  const [overridesRes, versionsRes] = await Promise.all([
    admin.schema("v3").from("ai_prompts").select("key, content, updated_at"),
    admin.schema("v3").from("ai_prompt_versions").select("prompt_key"),
  ])

  const overrides = new Map(
    (overridesRes.data ?? []).map((r) => [r.key as string, { content: r.content as string, updatedAt: r.updated_at as string }])
  )
  const versionCounts = new Map<string, number>()
  for (const v of versionsRes.data ?? []) {
    const k = v.prompt_key as string
    versionCounts.set(k, (versionCounts.get(k) ?? 0) + 1)
  }

  const prompts = PROMPT_DEFINITIONS.map((def) => {
    const override = overrides.get(def.key)
    return {
      key: def.key,
      name: def.name,
      description: def.description,
      placeholders: def.placeholders,
      requiredPlaceholders: def.requiredPlaceholders,
      defaultContent: def.content,
      content: override?.content ?? def.content,
      isCustomized: Boolean(override),
      updatedAt: override?.updatedAt ?? null,
      versionsCount: versionCounts.get(def.key) ?? 0,
    }
  })

  return { prompts }
}

export async function savePrompt(
  key: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) return { success: false, error: guard.error }

  const def = PROMPT_DEFAULTS[key]
  if (!def) return { success: false, error: `Prompt desconocido: ${key}` }

  const trimmed = content.trim()
  if (!trimmed) return { success: false, error: "El prompt no puede estar vacío" }
  if (trimmed.length > 20000) return { success: false, error: "El prompt supera el máximo de 20.000 caracteres" }

  // Validar placeholders requeridos
  const missing = def.requiredPlaceholders.filter((p) => !trimmed.includes(`{{${p}}}`))
  if (missing.length > 0) {
    return {
      success: false,
      error: `Faltan placeholders obligatorios: ${missing.map((m) => `{{${m}}}`).join(", ")}. Sin ellos el flujo no recibe los datos.`,
    }
  }

  const admin = createAdminClient()

  // Guardar versión histórica del contenido vigente ANTES de pisarlo
  const { data: current } = await admin
    .schema("v3")
    .from("ai_prompts")
    .select("content")
    .eq("key", key)
    .maybeSingle()

  const previousContent = current?.content ?? def.content
  if (previousContent.trim() !== trimmed) {
    await admin.schema("v3").from("ai_prompt_versions").insert({
      prompt_key: key,
      content: previousContent,
      created_by: guard.userId,
    })
  }

  const { error } = await admin
    .schema("v3")
    .from("ai_prompts")
    .upsert(
      { key, content: trimmed, updated_by: guard.userId, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    )

  if (error) return { success: false, error: error.message }

  invalidatePromptCache()
  revalidatePath("/v3/admin/prompts")
  return { success: true }
}

export async function resetPromptToDefault(key: string): Promise<{ success: boolean; error?: string }> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) return { success: false, error: guard.error }

  const def = PROMPT_DEFAULTS[key]
  if (!def) return { success: false, error: `Prompt desconocido: ${key}` }

  const admin = createAdminClient()

  // Preservar el override actual en el historial antes de borrarlo
  const { data: current } = await admin
    .schema("v3")
    .from("ai_prompts")
    .select("content")
    .eq("key", key)
    .maybeSingle()

  if (current?.content) {
    await admin.schema("v3").from("ai_prompt_versions").insert({
      prompt_key: key,
      content: current.content,
      created_by: guard.userId,
    })
  }

  const { error } = await admin.schema("v3").from("ai_prompts").delete().eq("key", key)
  if (error) return { success: false, error: error.message }

  invalidatePromptCache()
  revalidatePath("/v3/admin/prompts")
  return { success: true }
}

export interface PromptVersion {
  id: string
  content: string
  createdAt: string
  createdByEmail: string | null
}

export async function listPromptVersions(
  key: string
): Promise<{ versions: PromptVersion[]; error?: string }> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) return { versions: [], error: guard.error }

  const admin = createAdminClient()
  const { data, error } = await admin
    .schema("v3")
    .from("ai_prompt_versions")
    .select("id, content, created_at, created_by")
    .eq("prompt_key", key)
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) return { versions: [], error: error.message }

  // Resolver emails de los autores
  const userIds = [...new Set((data ?? []).map((v) => v.created_by).filter(Boolean))] as string[]
  const emailById = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email")
      .in("id", userIds)
    for (const p of profiles ?? []) emailById.set(p.id as string, p.email as string)
  }

  return {
    versions: (data ?? []).map((v) => ({
      id: v.id as string,
      content: v.content as string,
      createdAt: v.created_at as string,
      createdByEmail: v.created_by ? (emailById.get(v.created_by as string) ?? null) : null,
    })),
  }
}

export async function restorePromptVersion(
  key: string,
  versionId: string
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) return { success: false, error: guard.error }

  const admin = createAdminClient()
  const { data: version } = await admin
    .schema("v3")
    .from("ai_prompt_versions")
    .select("content")
    .eq("id", versionId)
    .eq("prompt_key", key)
    .maybeSingle()

  if (!version?.content) return { success: false, error: "Versión no encontrada" }

  return savePrompt(key, version.content)
}
