import { generateText } from "ai"
import { createAdminClient } from "@/lib/supabase/admin"
import { getRadarFindings } from "./radar"
import { MODELS, type Icebreaker } from "./types"
import { logAiUsage } from "@/lib/v3/usage"
import { renderPrompt } from "@/lib/v3/prompts"

// ═══════════════════════════════════════════════════════════
// Icebreakers por contacto, regionalizados por país:
//  - Registro de lenguaje según país del contacto (voseo AR/UY,
//    tuteo MX/CO/CL/PE, neutro para el resto, inglés si aplica).
//  - Basados en evidencia: hallazgos de radar + value profile del vendor.
//  - Versionables: regeneración con instrucción del usuario encadena
//    versiones vía regenerated_from.
//  - Feedback 👍/👎 persistido para mejorar prompts futuros.
// ═══════════════════════════════════════════════════════════

function registerForCountry(country: string | null): { register: string; instructions: string } {
  const c = (country ?? "").toLowerCase()
  if (["argentina", "uruguay"].some((x) => c.includes(x))) {
    return {
      register: "es-rioplatense",
      instructions:
        "Usá voseo rioplatense (vos, tenés, querés). Tono profesional pero cercano, directo, sin formalidad excesiva.",
    }
  }
  if (["mexico", "méxico", "colombia", "chile", "peru", "perú", "ecuador"].some((x) => c.includes(x))) {
    return {
      register: "es-tuteo",
      instructions:
        "Usa tuteo (tú, tienes, quieres). Tono profesional y cordial, ligeramente más formal que el rioplatense.",
    }
  }
  if (["spain", "españa"].some((x) => c.includes(x))) {
    return {
      register: "es-espana",
      instructions: "Usa tuteo peninsular. Tono profesional directo, sin rodeos.",
    }
  }
  if (["united states", "usa", "canada", "united kingdom", "brazil", "brasil"].some((x) => c.includes(x))) {
    return {
      register: "en",
      instructions: "Write in professional English. Direct, concise, no fluff.",
    }
  }
  return {
    register: "es-neutral",
    instructions: "Usa español neutro profesional (tú/usted según convenga, evita regionalismos).",
  }
}

export interface IcebreakerRequest {
  workspaceId: string
  companyId: string
  companyName: string
  contact: {
    apolloId?: string | null
    name: string
    title?: string | null
    country?: string | null
  }
  createdBy: string
  researchJobId?: string | null
  /** Para regeneración: id del icebreaker anterior + instrucción del usuario */
  regenerateFrom?: { icebreakerId: string; instruction: string } | null
}

export async function generateIcebreaker(req: IcebreakerRequest): Promise<Icebreaker | null> {
  const admin = createAdminClient()
  const { register, instructions } = registerForCountry(req.contact.country ?? null)

  // Evidencia: top hallazgos de la cuenta + perfil del vendor
  const [findings, profileRes, previousRes] = await Promise.all([
    getRadarFindings(req.companyId, { limit: 12 }),
    admin
      .schema("v3")
      .from("workspace_value_profiles")
      .select("profile_summary, target_technologies, target_processes")
      .eq("workspace_id", req.workspaceId)
      .maybeSingle(),
    req.regenerateFrom
      ? admin
          .schema("v3")
          .from("icebreakers")
          .select("content, version")
          .eq("id", req.regenerateFrom.icebreakerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const profile = profileRes.data
  const previous = previousRes.data as { content: string; version: number } | null

  const evidenceLines = findings
    .slice(0, 8)
    .map((f) => `- [${f.evidence_level}${f.source_name ? `, ${f.source_name}` : ""}] ${f.title}: ${f.summary ?? ""}`)
    .join("\n")

  const regenerationBlock = req.regenerateFrom && previous
    ? `\nVERSIÓN ANTERIOR (el usuario pidió cambiarla):
---
${previous.content}
---
INSTRUCCIÓN DEL USUARIO: ${req.regenerateFrom.instruction}\n`
    : ""

  try {
    const prompt = await renderPrompt("icebreaker.main", {
      contactBlock: `${req.contact.name}${req.contact.title ? `, ${req.contact.title}` : ""} en ${req.companyName}${req.contact.country ? ` (${req.contact.country})` : ""}`,
      registerInstructions: instructions,
      vendorProfile: profile?.profile_summary ?? "Servicios de tecnología B2B",
      evidence: evidenceLines || "(sin hallazgos: personalizá por rol e industria)",
      regenerationBlock,
    })

    const { text, usage } = await generateText({
      model: MODELS.WRITER,
      prompt,
      temperature: 0.6,
      maxOutputTokens: 400,
    })

    await logAiUsage({
      workspaceId: req.workspaceId,
      userId: req.createdBy,
      feature: "icebreaker",
      model: MODELS.WRITER,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      companyId: req.companyId,
      metadata: { regenerated: Boolean(req.regenerateFrom) },
    })

    const content = text.trim()
    if (!content) return null

    const evidenceUsed = findings.slice(0, 8).map((f) => ({
      finding_id: f.id,
      title: f.title,
      url: f.url,
      evidence_level: f.evidence_level,
    }))

    const { data, error } = await admin
      .schema("v3")
      .from("icebreakers")
      .insert({
        workspace_id: req.workspaceId,
        company_id: req.companyId,
        research_job_id: req.researchJobId ?? null,
        contact_apollo_id: req.contact.apolloId ?? null,
        contact_name: req.contact.name,
        contact_title: req.contact.title ?? null,
        contact_country: req.contact.country ?? null,
        language_register: register,
        content,
        evidence: evidenceUsed,
        version: previous ? previous.version + 1 : 1,
        regenerated_from: req.regenerateFrom?.icebreakerId ?? null,
        regeneration_instruction: req.regenerateFrom?.instruction ?? null,
        created_by: req.createdBy,
      })
      .select("*")
      .single()

    if (error) {
      console.error("[v3] Error guardando icebreaker:", error.message)
      return null
    }
    return data as Icebreaker
  } catch (err) {
    console.error("[v3] Error generando icebreaker:", err instanceof Error ? err.message : err)
    return null
  }
}

/** Registra feedback 👍/👎 sobre un icebreaker. */
export async function setIcebreakerFeedback(params: {
  icebreakerId: string
  workspaceId: string
  feedback: 1 | -1
  note?: string
}): Promise<{ success: boolean }> {
  const admin = createAdminClient()
  const { error } = await admin
    .schema("v3")
    .from("icebreakers")
    .update({ feedback: params.feedback, feedback_note: params.note ?? null })
    .eq("id", params.icebreakerId)
    .eq("workspace_id", params.workspaceId)
  return { success: !error }
}

/** Icebreakers de una cuenta (últimas versiones primero). */
export async function getIcebreakersForCompany(
  workspaceId: string,
  companyId: string,
  limit = 30
): Promise<Icebreaker[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .schema("v3")
    .from("icebreakers")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit)
  return (data as Icebreaker[]) ?? []
}
