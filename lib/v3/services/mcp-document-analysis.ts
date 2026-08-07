import { z } from 'zod/v3';
import { createAdminClient } from "@/lib/supabase/admin"
import type { McpPrincipal } from "@/lib/v3/mcp-usage"

const evidenceSchema = z.object({ quote: z.string().min(3).max(1000), confidence: z.number().min(0).max(1) })
const tagSchema = z.object({ value: z.string().min(1).max(160), mappedValue: z.string().max(160).optional(), confidence: z.number().min(0).max(1), evidence: z.array(evidenceSchema).min(1).max(10) })
export const documentAnalysisSchema = z.object({
  summary: z.string().min(20).max(5000),
  valueProposition: z.string().min(10).max(5000),
  keyResults: z.array(z.string().max(500)).max(30).default([]),
  insights: z.array(z.string().max(500)).max(30).default([]),
  industries: z.array(tagSchema).max(50),
  technologies: z.array(tagSchema).max(100),
  processes: z.array(tagSchema).max(100),
  freeTerms: z.array(tagSchema).max(100).default([]),
  personas: z.array(z.object({ name: z.string().max(160), type: z.enum(["buyer", "user", "influencer"]).default("buyer"), jobTitles: z.array(z.string().max(160)).max(30), pains: z.array(z.string().max(500)).max(30), goals: z.array(z.string().max(500)).max(30), evidence: z.array(evidenceSchema).min(1).max(10) })).max(20),
  useCases: z.array(z.object({ name: z.string().max(200), description: z.string().max(1000), evidence: z.array(evidenceSchema).min(1).max(10) })).max(30),
})
export type DocumentAnalysis = z.infer<typeof documentAnalysisSchema>

export async function getDocumentDictionaries() {
  const admin = createAdminClient()
  const [{ data: products }, { data: processes }, { data: industries }] = await Promise.all([
    admin.from("products").select("id,name,category").limit(2000),
    admin.from("processes").select("id,name").limit(2000),
    admin.from("companies").select("industry").not("industry", "is", null).limit(5000),
  ])
  return {
    technologies: (products || []).map((row) => ({ id: row.id, value: row.name, category: row.category })),
    processes: (processes || []).map((row) => ({ id: row.id, value: row.name })),
    industries: [...new Set((industries || []).map((row) => row.industry).filter(Boolean))].sort(),
    mappingRule: "Usa mappedValue cuando exista una equivalencia clara. Conserva conceptos no mapeados en freeTerms; nunca inventes IDs ni agregues términos al diccionario global.",
    requiredSchemaDescription: "summary, valueProposition, keyResults[], insights[], industries[], technologies[], processes[], freeTerms[], personas[] y useCases[]; cada tag/persona/caso requiere evidence[] con quote literal y confidence entre 0 y 1.",
  }
}

function verifyEvidence(text: string, analysis: DocumentAnalysis) {
  const normalized = text.toLocaleLowerCase("es")
  const quotes = [
    ...analysis.industries.flatMap((item) => item.evidence), ...analysis.technologies.flatMap((item) => item.evidence),
    ...analysis.processes.flatMap((item) => item.evidence), ...analysis.freeTerms.flatMap((item) => item.evidence),
    ...analysis.personas.flatMap((item) => item.evidence), ...analysis.useCases.flatMap((item) => item.evidence),
  ]
  const missing = quotes.filter((item) => !normalized.includes(item.quote.trim().toLocaleLowerCase("es")))
  if (missing.length) throw new Error(`EVIDENCE_NOT_FOUND:${missing.slice(0, 3).map((item) => item.quote).join(" | ")}`)
}

export async function confirmDocumentAnalysis(principal: McpPrincipal, draftId: string, rawAnalysis: unknown) {
  const admin = createAdminClient()
  const analysis = documentAnalysisSchema.parse(rawAnalysis)
  const { data: draft } = await admin.schema("v3").from("mcp_document_drafts").select("*").eq("id", draftId).eq("workspace_id", principal.workspaceId).maybeSingle()
  if (!draft || draft.created_by !== principal.userId) throw new Error("DRAFT_NOT_FOUND_OR_NOT_OWNER")
  if (draft.status === "confirmed") return { documentId: draft.confirmed_document_id, alreadyConfirmed: true }
  if (draft.status !== "ready_for_analysis") throw new Error("DRAFT_NOT_READY")
  verifyEvidence(draft.extracted_text || "", analysis)

  const persona = analysis.personas[0] ? { name: analysis.personas[0].name, type: analysis.personas[0].type, pains: analysis.personas[0].pains, goals: analysis.personas[0].goals } : null
  const { data: document, error } = await admin.schema("v3").from("workspace_documents").insert({
    workspace_id: principal.workspaceId, uploaded_by: principal.userId, title: draft.title,
    file_name: draft.title, file_url: draft.storage_path || draft.source_url, file_type: draft.mime_type || "text/plain", file_size: draft.file_size,
    status: "ready", processing_progress: 100, ai_summary: JSON.stringify({ summary: analysis.summary, value_proposition: analysis.valueProposition, key_results: analysis.keyResults, insights: analysis.insights, use_cases: analysis.useCases }),
    inferred_persona: persona, recommended_job_titles: [...new Set(analysis.personas.flatMap((item) => item.jobTitles))], version: 1,
  }).select("id").single()
  if (error) throw error

  const rows = [
    ...analysis.industries.map((tag) => ({ type: "industry", tag })),
    ...analysis.technologies.map((tag) => ({ type: "technology", tag })),
    ...analysis.processes.map((tag) => ({ type: "process", tag })),
    ...analysis.freeTerms.map((tag) => ({ type: "free_term", tag })),
  ].map(({ type, tag }) => ({ document_id: document.id, workspace_id: principal.workspaceId, tag_type: type, tag_value: tag.mappedValue || tag.value, confidence: tag.confidence }))
  if (rows.length) {
    const { error: tagsError } = await admin.schema("v3").from("workspace_document_tags").insert(rows)
    if (tagsError) throw tagsError
  }
  await recomputeWorkspaceProfile(principal.workspaceId)
  await admin.schema("v3").from("mcp_document_drafts").update({ status: "confirmed", analysis, confirmed_document_id: document.id, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", draftId)
  return { documentId: document.id, confirmed: true, sharedWithWorkspace: true, nextStep: "Pregunta al usuario qué países le interesan antes de llamar recommend_accounts_for_value_proposition." }
}

async function recomputeWorkspaceProfile(workspaceId: string) {
  const admin = createAdminClient()
  const { data: tags } = await admin.schema("v3").from("workspace_document_tags").select("tag_type,tag_value,confidence,document_id").eq("workspace_id", workspaceId)
  const aggregate = (type: string) => [...new Set((tags || []).filter((tag) => tag.tag_type === type).sort((a, b) => b.confidence - a.confidence).map((tag) => tag.tag_value))]
  await admin.schema("v3").from("workspace_value_profiles").upsert({ workspace_id: workspaceId, target_industries: aggregate("industry"), target_technologies: aggregate("technology"), target_processes: aggregate("process"), generated_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "workspace_id" })
}
