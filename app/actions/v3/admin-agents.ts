"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import {
  listMicroAgents,
  createMicroAgent,
  updateMicroAgent,
  deleteMicroAgent,
  type MicroAgent,
  type MicroAgentInput,
} from "@/lib/v3/services/radar-agents"
import { loadDictionary } from "@/lib/v3/services/dictionary"

// ═══════════════════════════════════════════════════════════
// Server actions del panel de micro-agentes (/v3/admin/agents).
// Solo super-admins. CRUD sobre v3.radar_micro_agents.
// ═══════════════════════════════════════════════════════════

async function requireSuperAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/auth/login?next=/v3/admin/agents")
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()

  if (profile?.role !== "superadmin") {
    return { error: "No tenés permisos de super administrador" }
  }

  return { userId: user.id }
}

export interface DictionaryOption {
  id: string
  name: string
}

export interface AgentsData {
  agents: MicroAgent[]
  products: DictionaryOption[]
  processes: DictionaryOption[]
  error?: string
}

export async function getAgentsData(): Promise<AgentsData> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) return { agents: [], products: [], processes: [], error: guard.error }

  const [agents, dictionary] = await Promise.all([listMicroAgents(), loadDictionary()])
  return {
    agents,
    products: dictionary.products.map((p) => ({ id: p.id, name: p.name })),
    processes: dictionary.processes.map((p) => ({ id: p.id, name: p.name })),
  }
}

function validate(input: MicroAgentInput): string | null {
  if (!input.label?.trim()) return "El nombre es obligatorio"
  if (!input.focusPrompt?.trim()) return "El foco de investigación es obligatorio"
  if (input.focusPrompt.trim().length > 5000) return "El foco supera el máximo de 5.000 caracteres"
  if (input.radarType !== "tech" && input.radarType !== "news") return "Tipo de radar inválido"
  return null
}

export async function saveAgent(
  id: string | null,
  input: MicroAgentInput,
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) return { success: false, error: guard.error }

  const err = validate(input)
  if (err) return { success: false, error: err }

  try {
    if (id) {
      await updateMicroAgent(id, input)
    } else {
      const key = input.key?.trim()
      if (!key || !/^[a-z0-9_]+$/.test(key)) {
        return { success: false, error: "La clave debe ser minúsculas, números y guión bajo (ej: erp_cloud)" }
      }
      await createMicroAgent(input)
    }
    revalidatePath("/v3/admin/agents")
    return { success: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al guardar el micro-agente"
    // Violación de unicidad de key
    if (message.includes("duplicate") || message.includes("unique")) {
      return { success: false, error: "Ya existe un micro-agente con esa clave" }
    }
    return { success: false, error: message }
  }
}

export async function toggleAgent(id: string, enabled: boolean): Promise<{ success: boolean; error?: string }> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) return { success: false, error: guard.error }
  try {
    await updateMicroAgent(id, { enabled })
    revalidatePath("/v3/admin/agents")
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error al actualizar" }
  }
}

export async function removeAgent(id: string): Promise<{ success: boolean; error?: string }> {
  const guard = await requireSuperAdmin()
  if ("error" in guard) return { success: false, error: guard.error }
  try {
    await deleteMicroAgent(id)
    revalidatePath("/v3/admin/agents")
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error al eliminar" }
  }
}
