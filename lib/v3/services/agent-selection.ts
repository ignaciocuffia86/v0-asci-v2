import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { listEnabledMicroAgents, type MicroAgent } from "./radar-agents"
import type { ResolvedMicroAgent } from "./radar"

// ═══════════════════════════════════════════════════════════
// Selección dinámica de micro-agentes por workspace.
//
// Prioriza los micro-agentes cuyas keywords / IDs de diccionario
// matchean con los intereses del workspace:
//   - propuesta de valor (workspace_value_profiles: target_*)
//   - tags detectados en los documentos subidos (workspace_document_tags)
//
// Se corren los top N. Los micro-agentes de tipo "news" siempre
// entran (contexto de negocio) con un piso garantizado, para no
// perder señales de timing/expansión aunque el foco sea técnico.
// ═══════════════════════════════════════════════════════════

/** Cantidad máxima de micro-agentes a correr por cuenta. */
const DEFAULT_TOP_N = 6
/** Piso de micro-agentes de negocio/noticias garantizados. */
const MIN_NEWS_AGENTS = 1

interface WorkspaceInterests {
  terms: string[]
  productIds: Set<string>
  processIds: Set<string>
}

async function loadWorkspaceInterests(workspaceId: string): Promise<WorkspaceInterests> {
  const admin = createAdminClient()
  const [profileRes, tagsRes] = await Promise.all([
    admin
      .schema("v3")
      .from("workspace_value_profiles")
      .select("target_technologies, target_processes")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    admin
      .schema("v3")
      .from("workspace_document_tags")
      .select("tag_value, tag_reference_id, tag_type")
      .eq("workspace_id", workspaceId),
  ])

  const profile = profileRes.data as
    | { target_technologies?: unknown; target_processes?: unknown }
    | null
  const terms: string[] = []
  if (Array.isArray(profile?.target_technologies)) terms.push(...(profile!.target_technologies as string[]))
  if (Array.isArray(profile?.target_processes)) terms.push(...(profile!.target_processes as string[]))

  const productIds = new Set<string>()
  const processIds = new Set<string>()
  const tags = (tagsRes.data as
    | { tag_value: string | null; tag_reference_id: string | null; tag_type: string | null }[]
    | null) ?? []
  for (const t of tags) {
    if (t.tag_value && t.tag_value.trim().length >= 3) terms.push(t.tag_value)
    if (t.tag_reference_id) {
      if (t.tag_type === "process") processIds.add(t.tag_reference_id)
      else productIds.add(t.tag_reference_id)
    }
  }

  const cleaned = terms
    .filter((t) => typeof t === "string" && t.trim().length >= 3)
    .map((t) => t.toLowerCase().trim())

  return { terms: [...new Set(cleaned)], productIds, processIds }
}

/** Puntaje de afinidad entre un micro-agente y los intereses del workspace. */
function scoreAgent(agent: MicroAgent, interests: WorkspaceInterests): number {
  let score = 0

  // Coincidencia de IDs de diccionario (señal fuerte: viene de los docs)
  for (const pid of agent.dictionaryProductIds) if (interests.productIds.has(pid)) score += 5
  for (const pid of agent.dictionaryProcessIds) if (interests.processIds.has(pid)) score += 5

  // Coincidencia por keywords (bidireccional, substring)
  for (const kw of agent.keywords) {
    const k = kw.toLowerCase().trim()
    if (k.length < 3) continue
    for (const term of interests.terms) {
      if (term.includes(k) || k.includes(term)) {
        score += 2
        break
      }
    }
  }

  return score
}

function toResolved(a: MicroAgent): ResolvedMicroAgent {
  return { key: a.key, label: a.label, radarType: a.radarType, focus: a.focusPrompt }
}

export interface AgentSelection {
  agents: ResolvedMicroAgent[]
  /** true si se seleccionaron por afinidad; false si es fallback por prioridad. */
  personalized: boolean
}

/**
 * Selecciona los micro-agentes a correr para una cuenta según los intereses
 * del workspace. Si el workspace no tiene intereses cargados (sin propuesta de
 * valor ni tags), cae a los N de mayor prioridad del catálogo.
 */
export async function selectMicroAgentsForWorkspace(
  workspaceId: string,
  topN: number = DEFAULT_TOP_N
): Promise<AgentSelection> {
  const [agents, interests] = await Promise.all([
    listEnabledMicroAgents(),
    loadWorkspaceInterests(workspaceId),
  ])

  if (agents.length === 0) return { agents: [], personalized: false }

  const hasInterests = interests.terms.length > 0 || interests.productIds.size > 0 || interests.processIds.size > 0

  // Sin intereses → top N por prioridad del catálogo.
  if (!hasInterests) {
    return { agents: agents.slice(0, topN).map(toResolved), personalized: false }
  }

  // Con intereses → ranking por afinidad (desempate por prioridad).
  const scored = agents
    .map((a) => ({ a, score: scoreAgent(a, interests) }))
    .sort((x, y) => y.score - x.score || y.a.priority - x.a.priority)

  const picked: MicroAgent[] = []
  const pickedKeys = new Set<string>()

  // 1) Los de mayor afinidad (score > 0) hasta topN.
  for (const { a, score } of scored) {
    if (picked.length >= topN) break
    if (score <= 0) break
    picked.push(a)
    pickedKeys.add(a.key)
  }

  // 2) Garantizar un piso de agentes de negocio/noticias.
  const newsCount = picked.filter((a) => a.radarType === "news").length
  if (newsCount < MIN_NEWS_AGENTS) {
    for (const { a } of scored) {
      if (picked.length >= topN) break
      if (a.radarType !== "news" || pickedKeys.has(a.key)) continue
      picked.push(a)
      pickedKeys.add(a.key)
      if (picked.filter((x) => x.radarType === "news").length >= MIN_NEWS_AGENTS) break
    }
  }

  // 3) Si quedó corto (pocos matches), completar por prioridad.
  if (picked.length < Math.min(topN, agents.length)) {
    for (const { a } of scored) {
      if (picked.length >= topN) break
      if (pickedKeys.has(a.key)) continue
      picked.push(a)
      pickedKeys.add(a.key)
    }
  }

  return { agents: picked.map(toResolved), personalized: true }
}
