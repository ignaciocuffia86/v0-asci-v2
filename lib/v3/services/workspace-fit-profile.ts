import "server-only"

import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"

export interface WorkspaceFitProfile {
  available: boolean
  version: string | null
  summary: string | null
  targetTechnologies: string[]
  targetProcesses: string[]
  targetIndustries: string[]
  recommendedJobTitles: string[]
}

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []

export async function getWorkspaceFitProfile(workspaceId: string): Promise<WorkspaceFitProfile> {
  const admin = createAdminClient()
  const [profileResult, documentResult, personaResult] = await Promise.all([
    admin.schema("v3").from("workspace_value_profiles").select("profile_summary, target_technologies, target_processes, target_industries, updated_at").eq("workspace_id", workspaceId).maybeSingle(),
    admin.schema("v3").from("workspace_documents").select("id, updated_at, recommended_job_titles").eq("workspace_id", workspaceId).eq("status", "ready"),
    admin.schema("v3").from("buyer_personas").select("recommended_job_titles").eq("workspace_id", workspaceId),
  ])

  const profile = profileResult.data
  const targetTechnologies = strings(profile?.target_technologies)
  const targetProcesses = strings(profile?.target_processes)
  const targetIndustries = strings(profile?.target_industries)
  const documents = documentResult.data ?? []
  const recommendedJobTitles = [
    ...(personaResult.data ?? []).flatMap((persona) => strings(persona.recommended_job_titles)),
    ...documents.flatMap((document) => strings(document.recommended_job_titles)),
  ]
  const available = Boolean(profile?.profile_summary?.trim()) || targetTechnologies.length > 0 || targetProcesses.length > 0 || targetIndustries.length > 0 || recommendedJobTitles.length > 0 || documents.length > 0

  const version = available
    ? createHash("sha256").update(JSON.stringify({ updatedAt: profile?.updated_at, documents, targetTechnologies, targetProcesses, targetIndustries, recommendedJobTitles })).digest("hex").slice(0, 20)
    : null

  return {
    available,
    version,
    summary: profile?.profile_summary?.trim() || null,
    targetTechnologies,
    targetProcesses,
    targetIndustries,
    recommendedJobTitles: [...new Set(recommendedJobTitles)],
  }
}
