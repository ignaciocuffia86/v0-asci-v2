import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { getCompanySignalSummary } from "./company-signal-summary"
import { buildEvidenceIcebreaker, type TermEvidence } from "./icebreaker-template"
import type { McpPrincipal } from "@/lib/v3/mcp-usage"

/**
 * Icebreaker sin IA, apoyado en la evidencia cruda global.
 *
 * Es Tier 0 de punta a punta: lee lo que ya está persistido, no llama a ningún
 * modelo, no consume cupo y no exige que la cuenta esté guardada. La versión con
 * IA (`generate_account_icebreaker` en modo `generated`) sigue existiendo para
 * cuando se quiera tono, personalización por industria o síntesis de varias
 * señales; esto cubre el caso que motivó todo: "que nombre la evidencia".
 *
 * Se persiste en la MISMA tabla `v3.icebreakers` que el resto, con
 * `generation_mode = "deterministic"`, para que un icebreaker sea un icebreaker
 * venga de donde venga y el historial de la cuenta no quede partido en dos.
 */
export async function generateDeterministicIcebreaker(
  principal: McpPrincipal,
  params: {
    companyId: string
    term?: string
    contactName?: string
    contactTitle?: string
    contactCountry?: string
    nameIndividuals?: boolean
    includeQuote?: boolean
  },
) {
  const admin = createAdminClient()
  const summary = await getCompanySignalSummary(params.companyId, "evidence", { term: params.term })

  if (summary.detail !== "evidence") throw new Error("EVIDENCE_MODE_EXPECTED")

  const terms: TermEvidence[] = summary.terms.map((item) => ({
    term: item.term,
    fromCurrentEmployees: item.fromCurrentEmployees,
    fromFormerEmployees: item.fromFormerEmployees,
    fromJobPostings: item.fromJobPostings,
    snippet: item.evidence[0]?.snippet ?? null,
    sourceField: item.evidence[0]?.sourceField ?? null,
  }))

  const built = buildEvidenceIcebreaker({
    companyName: summary.company.name,
    terms,
    contactCountry: params.contactCountry ?? null,
    nameIndividuals: params.nameIndividuals,
    personName: params.contactName ?? null,
    includeQuote: params.includeQuote,
  })

  if (!built.ok) {
    return {
      generated: false as const,
      code: built.code,
      reason: built.reason,
      // Se devuelve la evidencia igual: quien llama tiene que poder ver POR QUÉ
      // no alcanzó, en vez de recibir un "no" pelado que se lee como un fallo.
      evidence: summary.terms.map((item) => ({
        term: item.term,
        fromCurrentEmployees: item.fromCurrentEmployees,
        fromFormerEmployees: item.fromFormerEmployees,
        fromJobPostings: item.fromJobPostings,
      })),
      nextAction:
        built.code === "ONLY_FORMER_EMPLOYEES"
          ? "La cuenta tiene la tecnología solo en perfiles de gente que ya no está. Podés buscar otro término con get_company_signal_summary detail=\"evidence\", o decirle al usuario que esta cuenta no tiene evidencia viva."
          : "No hay señales para ese término en esta cuenta. Revisá el panorama con get_company_signal_summary detail=\"compact\" antes de insistir.",
    }
  }

  const { data, error } = await admin
    .schema("v3")
    .from("icebreakers")
    .insert({
      workspace_id: principal.workspaceId,
      company_id: params.companyId,
      contact_name: params.contactName?.trim() || "Equipo de tecnología",
      contact_title: params.contactTitle ?? null,
      contact_country: params.contactCountry ?? null,
      content: built.text,
      evidence: { basis: built.basis, terms: built.termsUsed, namesIndividual: built.namesIndividual },
      created_by: principal.userId,
      generation_mode: "deterministic",
    })
    .select("*")
    .single()

  if (error) throw new Error(`ICEBREAKER_PERSIST_FAILED:${error.message}`)

  return {
    generated: true as const,
    icebreaker: data,
    text: built.text,
    basis: built.basis,
    termsUsed: built.termsUsed,
    namesIndividual: built.namesIndividual,
    cost: {
      tier: 0,
      quotaConsumed: false,
      note: "Template determinístico: no llamó a ningún modelo, no consumió cupo y no puede alucinar una tecnología que la cuenta no tenga.",
    },
    privacyNote: built.namesIndividual
      ? "Este mensaje NOMBRA a una persona física a partir de su perfil. Avisale al usuario: en Chile aplica la Ley 19.628 y su reforma 21.719, y si hay matriz europea, GDPR."
      : "El mensaje agrega y no nombra a ninguna persona: transmite la misma señal sin exponer a nadie.",
  }
}
