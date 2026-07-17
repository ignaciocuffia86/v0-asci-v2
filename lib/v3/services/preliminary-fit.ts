import "server-only"

import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import type { InternalAccountSnapshot, InternalEvidenceItem } from "./internal-account-snapshot"
import { getWorkspaceFitProfile } from "./workspace-fit-profile"

export type FitReason = { component: "fit" | "signals" | "accessibility" | "timing"; label: string; detail: string; evidenceIds: string[] }
export type PreliminaryFit =
  | { status: "evaluated"; score: number; fitScore: number; buyingSignalsScore: number; accessibilityScore: number; timingScore: number; reasons: FitReason[]; profileVersion: string; snapshotVersion: string }
  | { status: "fit_not_evaluated"; score: null; reasons: []; missing: ["workspace_value_profile"]; profileVersion: null; snapshotVersion: string }

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
const freshnessScore = (date: string | null) => {
  if (!date) return 0
  const days = Math.max(0, (Date.now() - new Date(date).getTime()) / 86_400_000)
  return Math.round(100 * Math.exp(-days / 180))
}

function matches(items: InternalEvidenceItem[], targets: string[]) {
  const normalized = targets.map(normalize)
  return items.filter((item) => normalized.some((target) => normalize(item.term).includes(target) || target.includes(normalize(item.term))))
}

export async function computePreliminaryFit(params: { workspaceId: string; snapshot: InternalAccountSnapshot; researchJobId: string }): Promise<{ fit: PreliminaryFit; scorecardId: string; briefId: string }> {
  const admin = createAdminClient()
  const profile = await getWorkspaceFitProfile(params.workspaceId)
  const base = { workspace_id: params.workspaceId, company_id: params.snapshot.company.id, research_job_id: params.researchJobId, score_stage: "preliminary", profile_version: profile.version, snapshot_version: params.snapshot.snapshotVersion }
  let fit: PreliminaryFit

  if (!profile.available || !profile.version) {
    fit = { status: "fit_not_evaluated", score: null, reasons: [], missing: ["workspace_value_profile"], profileVersion: null, snapshotVersion: params.snapshot.snapshotVersion }
  } else {
    const techMatches = matches(params.snapshot.technologies, profile.targetTechnologies)
    const processMatches = matches(params.snapshot.processes, profile.targetProcesses)
    const targetCount = Math.max(1, profile.targetTechnologies.length + profile.targetProcesses.length)
    const fitScore = Math.min(100, Math.round(((techMatches.length + processMatches.length) / targetCount) * 100))
    const buyingSignalsScore = Math.min(100, Math.round(20 * Math.log2(1 + params.snapshot.coverage.signals + params.snapshot.coverage.jobPostings)))
    const accessibilityScore = Math.min(100, params.snapshot.contacts.reduce((score, contact) => score + (contact.email ? 18 : 9) + (contact.rank >= 25 ? 8 : 0), 0))
    const timingScore = Math.round((freshnessScore(params.snapshot.freshness.signalsLatestAt) + freshnessScore(params.snapshot.freshness.jobsLatestAt)) / 2)
    const score = Math.round(fitScore * 0.45 + buyingSignalsScore * 0.25 + accessibilityScore * 0.15 + timingScore * 0.15)
    const reasons: FitReason[] = []
    if (techMatches.length) reasons.push({ component: "fit", label: `${techMatches.length} tecnologías alineadas`, detail: techMatches.slice(0, 4).map((item) => item.term).join(", "), evidenceIds: techMatches.map((item) => item.id) })
    if (processMatches.length) reasons.push({ component: "fit", label: `${processMatches.length} procesos alineados`, detail: processMatches.slice(0, 4).map((item) => item.term).join(", "), evidenceIds: processMatches.map((item) => item.id) })
    if (params.snapshot.jobPostings.length) reasons.push({ component: "timing", label: `${params.snapshot.jobPostings.length} vacantes disponibles`, detail: "Las búsquedas activas aportan contexto de prioridades y timing.", evidenceIds: params.snapshot.jobPostings.slice(0, 5).map((item) => item.id) })
    if (params.snapshot.contacts.length) reasons.push({ component: "accessibility", label: `${params.snapshot.contacts.length} contactos sugeridos`, detail: "Hay personas relevantes disponibles para activar la cuenta.", evidenceIds: params.snapshot.contacts.slice(0, 5).map((item) => item.id) })
    fit = { status: "evaluated", score, fitScore, buyingSignalsScore, accessibilityScore, timingScore, reasons, profileVersion: profile.version, snapshotVersion: params.snapshot.snapshotVersion }
  }

  const scoreRow = fit.status === "evaluated"
    ? { ...base, fit_status: fit.status, score: fit.score, fit_score: fit.fitScore, buying_signals_score: fit.buyingSignalsScore, accessibility_score: fit.accessibilityScore, timing_score: fit.timingScore, rationale: fit.reasons.map((reason) => reason.label).join(" · "), dictionary_matches: fit.reasons, signals_snapshot: params.snapshot.coverage }
    : { ...base, fit_status: fit.status, score: null, fit_score: null, buying_signals_score: null, accessibility_score: null, timing_score: null, rationale: "Fit no evaluado: falta completar la propuesta de valor", dictionary_matches: [], signals_snapshot: params.snapshot.coverage }
  const { data: scorecard, error: scoreError } = await admin.schema("v3").from("account_scorecards").insert(scoreRow).select("id").single()
  if (scoreError) throw new Error(`No se pudo persistir el fit preliminar: ${scoreError.message}`)

  const headline = fit.status === "evaluated" ? `${params.snapshot.company.name}: fit preliminar ${fit.score}/100` : `${params.snapshot.company.name}: evidencia interna disponible`
  const inputHash = createHash("sha256").update(`${params.snapshot.snapshotVersion}:${profile.version ?? "no-profile"}`).digest("hex")
  const briefRow = { workspace_id: params.workspaceId, company_id: params.snapshot.company.id, research_job_id: params.researchJobId, scorecard_id: scorecard.id, stage: "preliminary", status: params.snapshot.warnings.length ? "partial" : "ready", headline, why_now: params.snapshot.jobPostings.length ? `${params.snapshot.jobPostings.length} vacantes y ${params.snapshot.coverage.signals} señales ya disponibles.` : `${params.snapshot.coverage.signals} señales internas ya disponibles.`, fit_summary: fit.status === "evaluated" ? fit.reasons.map((reason) => reason.label).join(" · ") : "Fit no evaluado. Completá tu propuesta de valor para calcularlo.", evidence: [...params.snapshot.technologies.slice(0, 5), ...params.snapshot.processes.slice(0, 5), ...params.snapshot.jobPostings.slice(0, 5)], recommended_contacts: params.snapshot.contacts.slice(0, 5), next_actions: fit.status === "evaluated" ? ["Revisar la evidencia principal", "Validar los contactos sugeridos", "Esperar las señales web adicionales"] : ["Completar la propuesta de valor", "Revisar la evidencia interna", "Esperar las señales web adicionales"], coverage: params.snapshot.coverage, freshness: params.snapshot.freshness, warnings: params.snapshot.warnings, profile_version: profile.version, snapshot_version: params.snapshot.snapshotVersion, input_hash: inputHash }
  const { data: brief, error: briefError } = await admin.schema("v3").from("account_briefs").upsert(briefRow, { onConflict: "workspace_id,company_id,stage,input_hash" }).select("id").single()
  if (briefError) throw new Error(`No se pudo persistir el brief preliminar: ${briefError.message}`)

  return { fit, scorecardId: scorecard.id, briefId: brief.id }
}
