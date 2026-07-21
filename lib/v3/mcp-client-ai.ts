import "server-only"

import crypto from "crypto"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveCompany } from "./services/company-resolver"
import { buildInternalAccountSnapshot } from "./services/internal-account-snapshot"
import { reserveMcpUsage, setReservationStatus, type McpPrincipal } from "./mcp-usage"

const PROMPT_VERSION = "mcp-client-research-v1"
const STAGES = ["internal_analysis", "signal_classification", "fit_scoring", "account_brief"] as const
type Stage = (typeof STAGES)[number]

const schemas = {
  internal_analysis: z.object({ summary: z.string().min(20).max(3000), technologies: z.array(z.string()).max(50), processes: z.array(z.string()).max(50), evidenceIds: z.array(z.string()).max(100) }),
  signal_classification: z.object({ signals: z.array(z.object({ evidenceId: z.string(), category: z.string().max(100), relevance: z.number().min(0).max(1), rationale: z.string().max(500) })).max(100) }),
  fit_scoring: z.object({ score: z.number().int().min(0).max(100), fitScore: z.number().int().min(0).max(100), buyingSignalsScore: z.number().int().min(0).max(100), accessibilityScore: z.number().int().min(0).max(100), timingScore: z.number().int().min(0).max(100), rationale: z.string().min(20).max(3000), evidenceIds: z.array(z.string()).max(100) }),
  account_brief: z.object({ headline: z.string().min(10).max(300), whyNow: z.string().max(3000), fitSummary: z.string().max(3000), nextActions: z.array(z.string().max(500)).max(10), evidenceIds: z.array(z.string()).max(100) }),
  icebreaker: z.object({ content: z.string().min(20).max(1200), evidenceIds: z.array(z.string()).min(1).max(10) }),
}

function hash(value: unknown) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex") }
function jsonSchemaFor(stage: Stage | "icebreaker") {
  const descriptions: Record<string, unknown> = {
    internal_analysis: { summary: "string", technologies: ["string"], processes: ["string"], evidenceIds: ["string"] },
    signal_classification: { signals: [{ evidenceId: "string", category: "string", relevance: "number 0..1", rationale: "string" }] },
    fit_scoring: { score: "integer 0..100", fitScore: "integer 0..100", buyingSignalsScore: "integer 0..100", accessibilityScore: "integer 0..100", timingScore: "integer 0..100", rationale: "string", evidenceIds: ["string"] },
    account_brief: { headline: "string", whyNow: "string", fitSummary: "string", nextActions: ["string"], evidenceIds: ["string"] },
    icebreaker: { content: "string", evidenceIds: ["string"] },
  }
  return descriptions[stage]
}

function packageFor(stage: Stage | "icebreaker", evidence: unknown, previous: unknown[] = []) {
  const payload = {
    promptVersion: PROMPT_VERSION,
    stage,
    systemPrompt: "Sos un analista B2B de ASCI. Usá exclusivamente la evidencia provista. No inventes hechos, IDs ni fuentes. Respondé solo JSON válido conforme al schema.",
    userPrompt: stage === "icebreaker" ? "Generá un icebreaker breve, específico y regionalizado, anclado en evidencia." : `Completá la etapa ${stage} del research de cuenta.`,
    responseSchema: jsonSchemaFor(stage),
    evidence,
    previousStages: previous,
  }
  return { ...payload, packageHash: hash(payload), expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() }
}

export async function prepareAccountResearch(principal: McpPrincipal, inputs: string[], idempotencyKey: string) {
  const resolved = await Promise.all(inputs.map((input) => resolveCompany(input, principal.workspaceId)))
  if (resolved.some((item) => !item.companyId || item.candidates.length)) throw new Error("COMPANY_RESOLUTION_REQUIRED")
  const unique = [...new Map(resolved.map((item) => [item.companyId!, item])).values()]
  const reservation = await reserveMcpUsage({ principal, pool: "research_client", units: unique.length, idempotencyKey, metadata: { companies: unique.map((item) => item.companyId) } })
  if (!reservation.allowed || !reservation.reservationId) return reservation
  const admin = createAdminClient()
  if (reservation.idempotent && reservation.status === "committed") {
    const { data } = await admin.schema("v3").from("client_ai_executions").select("id,company_id,current_stage,package_payload").eq("reservation_id", reservation.reservationId).order("created_at")
    return { allowed: true, idempotent: true, executions: (data ?? []).map((item) => ({ executionId: item.id, company: { id: item.company_id }, stage: item.current_stage, promptPackage: item.package_payload })) }
  }
  const executions = []
  try {
    for (const company of unique) {
      const snapshot = await buildInternalAccountSnapshot({ workspaceId: principal.workspaceId, company: { id: company.companyId!, name: company.name ?? "", domain: company.domain, country: company.country, industry: company.industry }, researchJobId: null })
      const promptPackage = packageFor("internal_analysis", snapshot)
      const { data, error } = await admin.schema("v3").from("client_ai_executions").insert({ workspace_id: principal.workspaceId, user_id: principal.userId, api_key_id: principal.keyId, reservation_id: reservation.reservationId, feature: "account_research", company_id: company.companyId, current_stage: "internal_analysis", prompt_version: PROMPT_VERSION, package_hash: promptPackage.packageHash, package_payload: promptPackage, expires_at: promptPackage.expiresAt }).select("id").single()
      if (error) throw new Error(`CLIENT_EXECUTION_CREATE_FAILED:${error.message}`)
      executions.push({ executionId: data.id, company: { id: company.companyId, name: company.name }, stage: "internal_analysis", promptPackage })
    }
    await setReservationStatus(reservation.reservationId, "committed")
    return { allowed: true, executions }
  } catch (error) {
    await setReservationStatus(reservation.reservationId, "released")
    throw error
  }
}

export async function submitResearchStage(principal: McpPrincipal, params: { executionId: string; stage: Stage; packageHash: string; result: unknown; clientModel?: string; idempotencyKey: string }) {
  const admin = createAdminClient()
  const { data: execution } = await admin.schema("v3").from("client_ai_executions").select("*").eq("id", params.executionId).eq("workspace_id", principal.workspaceId).eq("user_id", principal.userId).maybeSingle()
  if (!execution) throw new Error("CLIENT_EXECUTION_NOT_FOUND")
  const { data: replay } = await admin.schema("v3").from("client_ai_stage_submissions").select("result,status").eq("execution_id", params.executionId).eq("stage", params.stage).eq("idempotency_key", params.idempotencyKey).maybeSingle()
  if (replay) {
    if (hash(replay.result) !== hash(params.result)) throw new Error("IDEMPOTENCY_KEY_REUSED")
    return { accepted: replay.status === "accepted", idempotent: true, completed: execution.status === "completed", currentStage: execution.current_stage }
  }
  if (execution.status === "completed") throw new Error("CLIENT_EXECUTION_COMPLETED")
  if (new Date(execution.expires_at).getTime() < Date.now()) throw new Error("CLIENT_PACKAGE_EXPIRED")
  if (execution.current_stage !== params.stage || execution.package_hash !== params.packageHash) throw new Error("CLIENT_PACKAGE_MISMATCH")
  const parsed = schemas[params.stage].safeParse(params.result)
  if (!parsed.success) throw new Error(`CLIENT_RESULT_INVALID:${parsed.error.issues.map((i) => i.message).join(", ")}`)
  const allowedEvidence = new Set<string>()
  const collect = (value: unknown) => { if (!value || typeof value !== "object") return; if (Array.isArray(value)) return value.forEach(collect); for (const [key, item] of Object.entries(value as Record<string, unknown>)) { if (key === "id" && typeof item === "string") allowedEvidence.add(item); collect(item) } }
  collect(execution.package_payload.evidence)
  const evidenceIds: string[] = "evidenceIds" in parsed.data ? parsed.data.evidenceIds : "signals" in parsed.data ? parsed.data.signals.map((s) => s.evidenceId) : []
  if (evidenceIds.some((id) => !allowedEvidence.has(id))) throw new Error("UNAUTHORIZED_EVIDENCE")
  const { data: prior } = await admin.schema("v3").from("client_ai_stage_submissions").select("result").eq("execution_id", execution.id).eq("status", "accepted").order("created_at")
  await admin.schema("v3").from("client_ai_stage_submissions").insert({ execution_id: execution.id, workspace_id: principal.workspaceId, stage: params.stage, package_hash: params.packageHash, idempotency_key: params.idempotencyKey, result: parsed.data, validation_report: { valid: true, evidenceIds }, client_model: params.clientModel, status: "accepted" })
  if (params.stage === "fit_scoring") {
    const value = parsed.data as z.infer<typeof schemas.fit_scoring>
    await admin.schema("v3").from("account_scorecards").insert({ workspace_id: principal.workspaceId, company_id: execution.company_id, score: value.score, fit_score: value.fitScore, buying_signals_score: value.buyingSignalsScore, accessibility_score: value.accessibilityScore, timing_score: value.timingScore, rationale: value.rationale, generation_mode: "client_model", client_execution_id: execution.id, prompt_version: PROMPT_VERSION })
  }
  if (params.stage === "account_brief") {
    const value = parsed.data as z.infer<typeof schemas.account_brief>
    await admin.schema("v3").from("account_briefs").insert({ workspace_id: principal.workspaceId, company_id: execution.company_id, stage: "final", headline: value.headline, why_now: value.whyNow, fit_summary: value.fitSummary, next_actions: value.nextActions, evidence: value.evidenceIds, input_hash: hash(value), prompt_version: PROMPT_VERSION, model: params.clientModel ?? "client-model", generation_mode: "client_model", client_execution_id: execution.id })
  }
  const index = STAGES.indexOf(params.stage)
  if (index === STAGES.length - 1) {
    await admin.schema("v3").from("client_ai_executions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", execution.id)
    return { accepted: true, completed: true }
  }
  const nextStage = STAGES[index + 1]
  const nextPackage = packageFor(nextStage, execution.package_payload.evidence, [...(prior ?? []).map((row) => row.result), parsed.data])
  await admin.schema("v3").from("client_ai_executions").update({ status: "in_progress", current_stage: nextStage, package_hash: nextPackage.packageHash, package_payload: nextPackage, expires_at: nextPackage.expiresAt }).eq("id", execution.id)
  return { accepted: true, completed: false, nextStage, promptPackage: nextPackage }
}

export async function getClientResearchStatus(principal: McpPrincipal, executionId: string) {
  const admin = createAdminClient()
  const { data } = await admin.schema("v3").from("client_ai_executions").select("id,feature,company_id,current_stage,status,prompt_version,package_payload,expires_at,created_at,completed_at").eq("id", executionId).eq("workspace_id", principal.workspaceId).eq("user_id", principal.userId).maybeSingle()
  if (!data) throw new Error("CLIENT_EXECUTION_NOT_FOUND")
  return data
}

export async function prepareAccountIcebreaker(principal: McpPrincipal, params: { companyId: string; contactName: string; contactTitle?: string; contactCountry?: string; idempotencyKey: string }) {
  const admin = createAdminClient()
  const { count } = await admin.schema("v3").from("research_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", principal.workspaceId).eq("company_id", params.companyId)
  if (!count) throw new Error("ACCOUNT_NOT_AVAILABLE_IN_WORKSPACE")
  const reservation = await reserveMcpUsage({ principal, pool: "icebreaker_client", units: 1, idempotencyKey: params.idempotencyKey, metadata: { companyId: params.companyId } })
  if (!reservation.allowed || !reservation.reservationId) return reservation
  if (reservation.idempotent && reservation.status === "committed") {
    const { data } = await admin.schema("v3").from("client_ai_executions").select("id,package_payload").eq("reservation_id", reservation.reservationId).eq("feature", "icebreaker").maybeSingle()
    if (data) return { allowed: true, idempotent: true, executionId: data.id, promptPackage: data.package_payload }
  }
  try {
    const snapshot = await admin.schema("v3").from("account_internal_snapshots").select("evidence,contacts").eq("workspace_id", principal.workspaceId).eq("company_id", params.companyId).order("generated_at", { ascending: false }).limit(1).maybeSingle()
    const promptPackage = packageFor("icebreaker", { companyId: params.companyId, contact: { name: params.contactName, title: params.contactTitle, country: params.contactCountry }, snapshot: snapshot.data })
    const { data, error } = await admin.schema("v3").from("client_ai_executions").insert({ workspace_id: principal.workspaceId, user_id: principal.userId, api_key_id: principal.keyId, reservation_id: reservation.reservationId, feature: "icebreaker", company_id: params.companyId, contact_id: params.contactName, current_stage: "icebreaker", prompt_version: PROMPT_VERSION, package_hash: promptPackage.packageHash, package_payload: promptPackage, expires_at: promptPackage.expiresAt }).select("id").single()
    if (error) throw new Error(`CLIENT_EXECUTION_CREATE_FAILED:${error.message}`)
    await setReservationStatus(reservation.reservationId, "committed")
    return { allowed: true, executionId: data.id, promptPackage }
  } catch (error) {
    await setReservationStatus(reservation.reservationId, "released")
    throw error
  }
}

export async function submitAccountIcebreaker(principal: McpPrincipal, params: { executionId: string; packageHash: string; result: unknown; clientModel?: string; idempotencyKey: string }) {
  const admin = createAdminClient()
  const { data: execution } = await admin.schema("v3").from("client_ai_executions").select("*").eq("id", params.executionId).eq("workspace_id", principal.workspaceId).eq("user_id", principal.userId).eq("feature", "icebreaker").maybeSingle()
  if (!execution) throw new Error("CLIENT_EXECUTION_NOT_FOUND")
  const { data: replay } = await admin.schema("v3").from("client_ai_stage_submissions").select("result,status").eq("execution_id", params.executionId).eq("stage", "icebreaker").eq("idempotency_key", params.idempotencyKey).maybeSingle()
  if (replay) {
    if (hash(replay.result) !== hash(params.result)) throw new Error("IDEMPOTENCY_KEY_REUSED")
    return { accepted: replay.status === "accepted", idempotent: true }
  }
  if (execution.package_hash !== params.packageHash || execution.status === "completed") throw new Error("CLIENT_PACKAGE_MISMATCH")
  if (new Date(execution.expires_at).getTime() < Date.now()) throw new Error("CLIENT_PACKAGE_EXPIRED")
  const parsed = schemas.icebreaker.safeParse(params.result)
  if (!parsed.success) throw new Error(`CLIENT_RESULT_INVALID:${parsed.error.message}`)
  const evidence = execution.package_payload.evidence.snapshot?.evidence
  const serializedEvidence = JSON.stringify(evidence ?? {})
  if (parsed.data.evidenceIds.some((id) => !serializedEvidence.includes(`\"${id}\"`))) throw new Error("UNAUTHORIZED_EVIDENCE")
  const contact = execution.package_payload.evidence.contact
  const { data, error } = await admin.schema("v3").from("icebreakers").insert({ workspace_id: principal.workspaceId, company_id: execution.company_id, contact_name: contact.name, contact_title: contact.title, contact_country: contact.country, content: parsed.data.content, evidence: parsed.data.evidenceIds, created_by: principal.userId, generation_mode: "client_model", client_execution_id: execution.id, prompt_version: PROMPT_VERSION, model: params.clientModel ?? "client-model" }).select("*").single()
  if (error) throw new Error(`ICEBREAKER_SAVE_FAILED:${error.message}`)
  await admin.schema("v3").from("client_ai_stage_submissions").insert({ execution_id: execution.id, workspace_id: principal.workspaceId, stage: "icebreaker", package_hash: params.packageHash, idempotency_key: params.idempotencyKey, result: parsed.data, validation_report: { valid: true }, client_model: params.clientModel, status: "accepted" })
  await admin.schema("v3").from("client_ai_executions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", execution.id)
  return { accepted: true, icebreaker: data }
}

export { schemas as clientResultSchemas }
