import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import type { RadarType } from "./types"

// ═══════════════════════════════════════════════════════════
// Catálogo editable de micro-agentes de investigación.
// Tabla: v3.radar_micro_agents
// Cada micro-agente enfoca un área (ERP, cloud, noticias, etc.),
// se mapea al diccionario y se selecciona dinámicamente según la
// propuesta de valor y los tags del workspace (ver agent-selection).
// ═══════════════════════════════════════════════════════════

export interface MicroAgent {
  id: string
  key: string
  label: string
  description: string | null
  radarType: RadarType
  focusPrompt: string
  dictionaryProductIds: string[]
  dictionaryProcessIds: string[]
  keywords: string[]
  enabled: boolean
  priority: number
  createdAt: string
  updatedAt: string
}

export interface MicroAgentInput {
  key: string
  label: string
  description?: string | null
  radarType: RadarType
  focusPrompt: string
  dictionaryProductIds?: string[]
  dictionaryProcessIds?: string[]
  keywords?: string[]
  enabled?: boolean
  priority?: number
}

type Row = {
  id: string
  key: string
  label: string
  description: string | null
  radar_type: string
  focus_prompt: string
  dictionary_product_ids: string[] | null
  dictionary_process_ids: string[] | null
  keywords: string[] | null
  enabled: boolean
  priority: number
  created_at: string
  updated_at: string
}

function mapRow(r: Row): MicroAgent {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    description: r.description,
    radarType: (r.radar_type as RadarType) ?? "tech",
    focusPrompt: r.focus_prompt,
    dictionaryProductIds: r.dictionary_product_ids ?? [],
    dictionaryProcessIds: r.dictionary_process_ids ?? [],
    keywords: r.keywords ?? [],
    enabled: r.enabled,
    priority: r.priority,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

const COLS =
  "id, key, label, description, radar_type, focus_prompt, dictionary_product_ids, dictionary_process_ids, keywords, enabled, priority, created_at, updated_at"

/** Lista todos los micro-agentes (para el panel admin). */
export async function listMicroAgents(): Promise<MicroAgent[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .schema("v3")
    .from("radar_micro_agents")
    .select(COLS)
    .order("priority", { ascending: false })
    .order("label", { ascending: true })
  return (data as Row[] | null)?.map(mapRow) ?? []
}

/** Lista sólo los micro-agentes habilitados (para la selección dinámica). */
export async function listEnabledMicroAgents(): Promise<MicroAgent[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .schema("v3")
    .from("radar_micro_agents")
    .select(COLS)
    .eq("enabled", true)
    .order("priority", { ascending: false })
  return (data as Row[] | null)?.map(mapRow) ?? []
}

export async function createMicroAgent(input: MicroAgentInput): Promise<MicroAgent> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .schema("v3")
    .from("radar_micro_agents")
    .insert({
      key: input.key,
      label: input.label,
      description: input.description ?? null,
      radar_type: input.radarType,
      focus_prompt: input.focusPrompt,
      dictionary_product_ids: input.dictionaryProductIds ?? [],
      dictionary_process_ids: input.dictionaryProcessIds ?? [],
      keywords: input.keywords ?? [],
      enabled: input.enabled ?? true,
      priority: input.priority ?? 100,
    })
    .select(COLS)
    .single()
  if (error) throw new Error(error.message)
  return mapRow(data as Row)
}

export async function updateMicroAgent(id: string, patch: Partial<MicroAgentInput>): Promise<MicroAgent> {
  const admin = createAdminClient()
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.label !== undefined) update.label = patch.label
  if (patch.description !== undefined) update.description = patch.description
  if (patch.radarType !== undefined) update.radar_type = patch.radarType
  if (patch.focusPrompt !== undefined) update.focus_prompt = patch.focusPrompt
  if (patch.dictionaryProductIds !== undefined) update.dictionary_product_ids = patch.dictionaryProductIds
  if (patch.dictionaryProcessIds !== undefined) update.dictionary_process_ids = patch.dictionaryProcessIds
  if (patch.keywords !== undefined) update.keywords = patch.keywords
  if (patch.enabled !== undefined) update.enabled = patch.enabled
  if (patch.priority !== undefined) update.priority = patch.priority

  const { data, error } = await admin
    .schema("v3")
    .from("radar_micro_agents")
    .update(update)
    .eq("id", id)
    .select(COLS)
    .single()
  if (error) throw new Error(error.message)
  return mapRow(data as Row)
}

export async function deleteMicroAgent(id: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.schema("v3").from("radar_micro_agents").delete().eq("id", id)
  if (error) throw new Error(error.message)
}
