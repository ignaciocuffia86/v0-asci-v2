import "server-only"

import { createHash } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCanonicalContacts } from "./contact-provider"
import { getRadarFindings } from "./radar"
import { getWorkspaceFitProfile } from "./workspace-fit-profile"
import { BRIEF_CONFLICT_TARGET, findSupersededBriefId, resolveBriefStatus } from "./account-brief-row"

export async function buildFinalAccountBrief(input: {
  workspaceId: string
  companyId: string
  companyName: string
  researchJobId: string
}) {
  const admin = createAdminClient()
  const [scorecardResult, findings, contactsResult, profile, supersedesBriefId] = await Promise.all([
    admin
      .schema("v3")
      .from("account_scorecards")
      .select("id, score, fit_score, fit_status, rationale, created_at")
      .eq("workspace_id", input.workspaceId)
      .eq("company_id", input.companyId)
      .eq("score_stage", "final")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getRadarFindings(input.companyId, { limit: 12 }),
    getCanonicalContacts({ companyId: input.companyId, limit: 10 }),
    getWorkspaceFitProfile(input.workspaceId),
    findSupersededBriefId(admin, input.workspaceId, input.companyId),
  ])

  const scorecard = scorecardResult.data
  const evidence = findings.slice(0, 8).map((finding) => ({
    id: finding.id,
    source: "external_ai",
    type: finding.radar_type,
    title: finding.title,
    summary: finding.summary,
    url: finding.url,
    occurredAt: finding.source_date ?? finding.detected_at,
    confidence: finding.confidence,
  }))
  const inputHash = createHash("sha256")
    .update(JSON.stringify({ scorecard: scorecard?.id, evidence: evidence.map((item) => item.id), profile: profile.version }))
    .digest("hex")

  const fitEvaluated = scorecard?.fit_status === "evaluated"
  const headline = typeof scorecard?.score === "number"
    ? `${input.companyName}: score final ${scorecard.score}/100 con ${evidence.length} señales externas verificadas`
    : `${input.companyName}: evidencia actualizada; fit pendiente de propuesta de valor`

  const { data, error } = await admin
    .schema("v3")
    .from("account_briefs")
    .upsert(
      {
        workspace_id: input.workspaceId,
        company_id: input.companyId,
        research_job_id: input.researchJobId,
        scorecard_id: scorecard?.id ?? null,
        stage: "final",
        status: resolveBriefStatus({ evidenceCount: evidence.length }),
        headline,
        why_now: evidence[0]?.summary ?? "No se encontraron señales externas nuevas; se conservaron los datos internos.",
        fit_summary: fitEvaluated ? scorecard?.rationale : "Fit no evaluado: completá la propuesta de valor para obtener un score.",
        evidence,
        recommended_contacts: contactsResult.contacts.slice(0, 5),
        next_actions: [
          evidence.length > 0 ? "Usar la señal principal para contextualizar el contacto." : "Revisar nuevamente cuando aparezcan señales nuevas.",
          contactsResult.contacts.length > 0 ? "Validar el rol con mayor afinidad antes de contactar." : "Ampliar la búsqueda de contactos.",
        ],
        coverage: { externalFindings: findings.length, contacts: contactsResult.contacts.length },
        freshness: {
          externalResearchAt: new Date().toISOString(),
          contactsAt: contactsResult.contacts
            .map((contact) => contact.freshness)
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1) ?? null,
        },
        warnings: contactsResult.warnings,
        profile_version: profile.version,
        input_hash: inputHash,
        supersedes_brief_id: supersedesBriefId,
      },
      { onConflict: BRIEF_CONFLICT_TARGET }
    )
    .select("*")
    .single()

  if (error) throw new Error(`No se pudo persistir el Account Brief final: ${error.message}`)
  return data
}
