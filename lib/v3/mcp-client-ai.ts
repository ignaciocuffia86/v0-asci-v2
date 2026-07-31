import "server-only"

import crypto from "crypto"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveCompany } from "./services/company-resolver"
import { buildInternalAccountSnapshot } from "./services/internal-account-snapshot"
import { principalColumns, reserveMcpUsage, setReservationStatus, type McpPrincipal } from "./mcp-usage"
import { guardSavedAccounts } from "./mcp-account-lifecycle"

// v2: el paquete ya no arrastra la evidencia completa en cada etapa (ahora viaja
// el panorama liviano) y el TTL escala con el tamaño del lote. Cambia la forma del
// payload, así que la versión sube para invalidar los paquetes viejos.
import { persistClientSuccessCases, persistClientNews, DEFAULT_NEWS_WINDOW_DAYS } from "./services/external-drilldown"

const PROMPT_VERSION = "mcp-client-research-v2"
const STAGES = ["internal_analysis", "signal_classification", "fit_scoring", "account_brief"] as const
type Stage = (typeof STAGES)[number]

/**
 * TTL del paquete según el tamaño del lote.
 *
 * Con 60 minutos fijos, un lote de 10 cuentas obligaba al cliente a completar 40
 * submits (4 etapas × 10) dentro de la misma hora; si el usuario se distraía, los
 * paquetes vencían y la cuota ya estaba consumida. Se agregan 20 minutos por
 * cuenta extra, con techo de 6 horas para que un paquete abandonado no quede vivo
 * indefinidamente.
 */
const TTL_BASE_MINUTES = 60
const TTL_PER_EXTRA_ACCOUNT_MINUTES = 20
const TTL_MAX_MINUTES = 360

export function packageTtlMinutes(batchSize: number) {
  const extra = Math.max(0, batchSize - 1) * TTL_PER_EXTRA_ACCOUNT_MINUTES
  return Math.min(TTL_BASE_MINUTES + extra, TTL_MAX_MINUTES)
}

const schemas = {
  internal_analysis: z.object({ summary: z.string().min(20).max(3000), technologies: z.array(z.string()).max(50), processes: z.array(z.string()).max(50), evidenceIds: z.array(z.string()).max(100) }),
  signal_classification: z.object({ signals: z.array(z.object({ evidenceId: z.string(), category: z.string().max(100), relevance: z.number().min(0).max(1), rationale: z.string().max(500) })).max(100) }),
  fit_scoring: z.object({ score: z.number().int().min(0).max(100), fitScore: z.number().int().min(0).max(100), buyingSignalsScore: z.number().int().min(0).max(100), accessibilityScore: z.number().int().min(0).max(100), timingScore: z.number().int().min(0).max(100), rationale: z.string().min(20).max(3000), evidenceIds: z.array(z.string()).max(100) }),
  account_brief: z.object({ headline: z.string().min(10).max(300), whyNow: z.string().max(3000), fitSummary: z.string().max(3000), nextActions: z.array(z.string().max(500)).max(10), evidenceIds: z.array(z.string()).max(100) }),
  icebreaker: z.object({ content: z.string().min(20).max(1200), evidenceIds: z.array(z.string()).min(1).max(10) }),
  // Casos de éxito y noticias NO llevan evidenceIds: no describen la evidencia
  // interna, la traen de afuera. Su control no es el set de ids autorizados sino
  // los guardrails (URL viva + mención real de la empresa + ventana temporal),
  // así que `sourceUrl` es obligatoria y con formato de URL.
  success_cases: z.object({
    cases: z.array(z.object({
      title: z.string().min(5).max(300),
      providerName: z.string().max(240).nullish(),
      technology: z.string().max(240).nullish(),
      summary: z.string().max(2000).nullish(),
      results: z.string().max(800).nullish(),
      sourceUrl: z.string().url(),
      sourceName: z.string().max(120).nullish(),
      publishedAt: z.string().nullish(),
      evidenceLevel: z.string().max(40).nullish(),
      supportingSourceUrls: z.array(z.string().url()).max(5).optional(),
    })).min(1).max(20),
  }),
  company_news: z.object({
    items: z.array(z.object({
      title: z.string().min(5).max(500),
      summary: z.string().max(2000).nullish(),
      category: z.string().min(2).max(100),
      direction: z.string().max(40).nullish(),
      sourceUrl: z.string().url(),
      sourceName: z.string().max(120).nullish(),
      publishedAt: z.string().nullish(),
    })).min(1).max(30),
  }),
}

function hash(value: unknown) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex") }
/** Etapas de una sola pasada: no forman parte del pipeline de 4 etapas. */
type SingleShotStage = "icebreaker" | "success_cases" | "company_news"

function jsonSchemaFor(stage: Stage | SingleShotStage) {
  const descriptions: Record<string, unknown> = {
    internal_analysis: { summary: "string", technologies: ["string"], processes: ["string"], evidenceIds: ["string"] },
    signal_classification: { signals: [{ evidenceId: "string", category: "string", relevance: "number 0..1", rationale: "string" }] },
    fit_scoring: { score: "integer 0..100", fitScore: "integer 0..100", buyingSignalsScore: "integer 0..100", accessibilityScore: "integer 0..100", timingScore: "integer 0..100", rationale: "string", evidenceIds: ["string"] },
    account_brief: { headline: "string", whyNow: "string", fitSummary: "string", nextActions: ["string"], evidenceIds: ["string"] },
    icebreaker: { content: "string", evidenceIds: ["string"] },
    success_cases: { cases: [{ title: "string", providerName: "string|null", technology: "string|null", summary: "string|null", results: "string|null", sourceUrl: "url obligatoria y accesible", sourceName: "string|null", publishedAt: "ISO date|null", evidenceLevel: "Confirmado|Probable|Inferido", supportingSourceUrls: ["url"] }] },
    company_news: { items: [{ title: "string", summary: "string|null", category: "string", direction: "expansion|contraccion|neutro", sourceUrl: "url obligatoria y accesible", sourceName: "string|null", publishedAt: "ISO date|null" }] },
  }
  return descriptions[stage]
}

/**
 * Instrucción por etapa. Para las etapas externas se explicita que hay que BUSCAR
 * con fuentes reales y que las URLs se verifican del lado del servidor: si el
 * modelo no sabe que se van a comprobar, tiende a completar el campo con una URL
 * plausible pero inexistente.
 */
function userPromptFor(stage: Stage | SingleShotStage) {
  if (stage === "icebreaker") return "Generá un icebreaker breve, específico y regionalizado, anclado en evidencia."
  if (stage === "success_cases") {
    return "Buscá casos de éxito reales y verificables de esta empresa con la tecnología indicada. Cada caso DEBE incluir una sourceUrl real y accesible: el servidor comprueba que responda y que la página mencione a la empresa, y descarta lo que no pase. No inventes URLs ni completes el campo con una dirección probable."
  }
  if (stage === "company_news") {
    return "Buscá noticias recientes y verificables de esta empresa dentro de la ventana indicada. Cada noticia DEBE incluir una sourceUrl real y accesible: el servidor la verifica y descarta lo que no responda o no mencione a la empresa. Clasificá `direction` como expansion, contraccion o neutro según si el hecho amplía o achica la operación."
  }
  return `Completá la etapa ${stage} del research de cuenta.`
}

function packageFor(
  stage: Stage | SingleShotStage,
  evidence: unknown,
  previous: unknown[] = [],
  options: { batchSize?: number } = {}
) {
  const ttl = packageTtlMinutes(options.batchSize ?? 1)
  const payload = {
    promptVersion: PROMPT_VERSION,
    stage,
    systemPrompt:
      "Sos un analista B2B de ASCI. Usá exclusivamente la evidencia provista. No inventes hechos, IDs ni fuentes. Respondé solo JSON válido conforme al schema. La evidencia trae un nivel por término (Confirmado, Probable o Inferido): no presentes como confirmado algo que sea Probable o Inferido, y si una mención proviene de un ex-empleado no afirmes que la cuenta usa esa tecnología hoy. Si necesitás las fuentes textuales de un término, pedilas con get_account_evidence_detail en vez de suponerlas.",
    userPrompt: userPromptFor(stage),
    responseSchema: jsonSchemaFor(stage),
    evidence,
    previousStages: previous,
  }
  const packageHash = hash(payload)
  return {
    ...payload,
    packageHash,
    expiresAt: new Date(Date.now() + ttl * 60_000).toISOString(),
    ttlMinutes: ttl,
    // Las tools submit_* exigen `idempotencyKey` (min 8 chars) pero el paquete no
    // traía ninguna, así que el modelo la inventaba distinta en cada intento. Con
    // eso el replay no servía de nada: reintentar un submit tras un error de red
    // se registraba como un envío nuevo. Se emite acá para que el reintento use la
    // MISMA key y el replay funcione. Va fuera del payload hasheado a propósito:
    // incluirla cambiaría el packageHash y rompería la comparación del submit.
    submitIdempotencyKey: `${stage}-${packageHash.slice(0, 24)}`,
  }
}

export async function prepareAccountResearch(principal: McpPrincipal, inputs: string[], idempotencyKey: string) {
  const resolved = await Promise.all(inputs.map((input) => resolveCompany(input, principal.workspaceId)))
  if (resolved.some((item) => !item.companyId || item.candidates.length)) throw new Error("COMPANY_RESOLUTION_REQUIRED")
  const unique = [...new Map(resolved.map((item) => [item.companyId!, item])).values()]
  // Investigar exige que la cuenta esté guardada. El chequeo va antes de reservar
  // cuota: sin esto se podía consumir research sobre cuentas nunca guardadas.
  const blocked = await guardSavedAccounts(principal, unique.map((item) => item.companyId!))
  if (blocked) return blocked
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
      // El TTL se calcula sobre el lote entero: si son 10 cuentas, el cliente tiene
      // que poder completar las 40 etapas sin que le venza el paquete.
      const promptPackage = packageFor("internal_analysis", snapshot, [], { batchSize: unique.length })
      const { data, error } = await admin.schema("v3").from("client_ai_executions").insert({ workspace_id: principal.workspaceId, user_id: principal.userId, ...principalColumns(principal), reservation_id: reservation.reservationId, feature: "account_research", company_id: company.companyId, current_stage: "internal_analysis", prompt_version: PROMPT_VERSION, package_hash: promptPackage.packageHash, package_payload: promptPackage, expires_at: promptPackage.expiresAt, batch_size: unique.length }).select("id").single()
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
  // El error dice qué hacer: la cuota ya está consumida y refresh_prompt_package
  // reemite el paquete sin volver a cobrar.
  if (new Date(execution.expires_at).getTime() < Date.now()) throw new Error("CLIENT_PACKAGE_EXPIRED:El paquete venció. Llamá a refresh_prompt_package con este executionId para reemitirlo sin consumir cuota, y reintentá el submit con el packageHash nuevo.")
  if (execution.current_stage !== params.stage || execution.package_hash !== params.packageHash) throw new Error(`CLIENT_PACKAGE_MISMATCH:La ejecución espera la etapa "${execution.current_stage}" con el packageHash vigente. Consultá get_client_research_status para obtener el paquete actual.`)
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
  const nextPackage = packageFor(nextStage, execution.package_payload.evidence, [...(prior ?? []).map((row) => row.result), parsed.data], { batchSize: execution.batch_size ?? 1 })
  await admin.schema("v3").from("client_ai_executions").update({ status: "in_progress", current_stage: nextStage, package_hash: nextPackage.packageHash, package_payload: nextPackage, expires_at: nextPackage.expiresAt }).eq("id", execution.id)
  return { accepted: true, completed: false, nextStage, promptPackage: nextPackage }
}

/**
 * Revive una ejecución cuyo paquete venció, SIN volver a cobrar cuota.
 *
 * Antes un paquete vencido dejaba la ejecución muerta con la cuota ya consumida:
 * la única salida era gastar otro lugar del plan con prepare_account_research. Acá
 * se reemite el paquete de la etapa actual con la misma evidencia y las etapas ya
 * aceptadas, así que no se recalcula nada ni se vuelve a investigar.
 */
const MAX_PACKAGE_REFRESHES = 5

export async function refreshPromptPackage(principal: McpPrincipal, executionId: string) {
  const admin = createAdminClient()
  const { data: execution } = await admin.schema("v3").from("client_ai_executions").select("*").eq("id", executionId).eq("workspace_id", principal.workspaceId).eq("user_id", principal.userId).maybeSingle()
  if (!execution) throw new Error("CLIENT_EXECUTION_NOT_FOUND")
  if (execution.status === "completed") throw new Error("CLIENT_EXECUTION_COMPLETED")
  // Techo para que un cliente que nunca completa no pueda mantener vivo un paquete
  // para siempre y esquivar el consumo de cuota.
  if ((execution.refresh_count ?? 0) >= MAX_PACKAGE_REFRESHES) {
    throw new Error(`PACKAGE_REFRESH_LIMIT_REACHED:Se alcanzó el máximo de ${MAX_PACKAGE_REFRESHES} refrescos. Volvé a preparar el research para esta cuenta.`)
  }

  const { data: prior } = await admin.schema("v3").from("client_ai_stage_submissions").select("result").eq("execution_id", execution.id).eq("status", "accepted").order("created_at")
  const refreshed = packageFor(
    execution.current_stage as Stage | "icebreaker",
    execution.package_payload.evidence,
    (prior ?? []).map((row) => row.result),
    { batchSize: execution.batch_size ?? 1 }
  )
  const { error } = await admin.schema("v3").from("client_ai_executions").update({ package_hash: refreshed.packageHash, package_payload: refreshed, expires_at: refreshed.expiresAt, refresh_count: (execution.refresh_count ?? 0) + 1 }).eq("id", execution.id)
  if (error) throw new Error(`PACKAGE_REFRESH_FAILED:${error.message}`)

  return {
    executionId: execution.id,
    stage: execution.current_stage,
    promptPackage: refreshed,
    refreshesRemaining: MAX_PACKAGE_REFRESHES - ((execution.refresh_count ?? 0) + 1),
    note: "Paquete reemitido sin consumir cuota. Usá este packageHash en el próximo submit.",
  }
}

export async function getClientResearchStatus(principal: McpPrincipal, executionId: string) {
  const admin = createAdminClient()
  const { data } = await admin.schema("v3").from("client_ai_executions").select("id,feature,company_id,current_stage,status,prompt_version,package_payload,expires_at,created_at,completed_at").eq("id", executionId).eq("workspace_id", principal.workspaceId).eq("user_id", principal.userId).maybeSingle()
  if (!data) throw new Error("CLIENT_EXECUTION_NOT_FOUND")
  return data
}

export async function prepareAccountIcebreaker(principal: McpPrincipal, params: { companyId: string; contactName: string; contactTitle?: string; contactCountry?: string; idempotencyKey: string }) {
  const admin = createAdminClient()
  // Antes el criterio era "existe un research_job", distinto al de research. Se
  // unifica en followed_accounts para que "cuenta disponible" signifique lo mismo
  // en todo el MCP.
  const blocked = await guardSavedAccounts(principal, [params.companyId])
  if (blocked) return blocked
  const reservation = await reserveMcpUsage({ principal, pool: "icebreaker_client", units: 1, idempotencyKey: params.idempotencyKey, metadata: { companyId: params.companyId } })
  if (!reservation.allowed || !reservation.reservationId) return reservation
  if (reservation.idempotent && reservation.status === "committed") {
    const { data } = await admin.schema("v3").from("client_ai_executions").select("id,package_payload").eq("reservation_id", reservation.reservationId).eq("feature", "icebreaker").maybeSingle()
    if (data) return { allowed: true, idempotent: true, executionId: data.id, promptPackage: data.package_payload }
  }
  try {
    const snapshot = await admin.schema("v3").from("account_internal_snapshots").select("evidence,contacts").eq("workspace_id", principal.workspaceId).eq("company_id", params.companyId).order("generated_at", { ascending: false }).limit(1).maybeSingle()
    const promptPackage = packageFor("icebreaker", { companyId: params.companyId, contact: { name: params.contactName, title: params.contactTitle, country: params.contactCountry }, snapshot: snapshot.data })
    const { data, error } = await admin.schema("v3").from("client_ai_executions").insert({ workspace_id: principal.workspaceId, user_id: principal.userId, ...principalColumns(principal), reservation_id: reservation.reservationId, feature: "icebreaker", company_id: params.companyId, contact_id: params.contactName, current_stage: "icebreaker", prompt_version: PROMPT_VERSION, package_hash: promptPackage.packageHash, package_payload: promptPackage, expires_at: promptPackage.expiresAt }).select("id").single()
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
  if (new Date(execution.expires_at).getTime() < Date.now()) throw new Error("CLIENT_PACKAGE_EXPIRED:El paquete venció. Llamá a refresh_prompt_package con este executionId para reemitirlo sin consumir cuota.")
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

// ═══════════════════════════════════════════════════════════
// Drilldown externo client-assisted: casos de éxito y noticias.
//
// Reusa el pool `research_client` en vez de crear pools nuevos: eso exigiría
// migrar el CHECK de `pool`, definir límites por plan y versionar la UI de
// consumo. Son trabajo de research sobre una cuenta, así que comparten cupo.
// ═══════════════════════════════════════════════════════════

type ExternalFeature = "success_cases" | "company_news"

async function prepareExternalDrilldown(
  principal: McpPrincipal,
  feature: ExternalFeature,
  params: { companyId: string; term?: string; windowDays?: number; idempotencyKey: string }
) {
  const admin = createAdminClient()
  const blocked = await guardSavedAccounts(principal, [params.companyId])
  if (blocked) return blocked

  const reservation = await reserveMcpUsage({ principal, pool: "research_client", units: 1, idempotencyKey: params.idempotencyKey, metadata: { companyId: params.companyId, feature } })
  if (!reservation.allowed || !reservation.reservationId) return reservation
  if (reservation.idempotent && reservation.status === "committed") {
    const { data } = await admin.schema("v3").from("client_ai_executions").select("id,package_payload").eq("reservation_id", reservation.reservationId).eq("feature", feature).maybeSingle()
    if (data) return { allowed: true, idempotent: true, executionId: data.id, promptPackage: data.package_payload }
  }

  try {
    const { data: company } = await admin.from("companies").select("id,name,website,country,industry").eq("id", params.companyId).maybeSingle()
    if (!company) throw new Error("COMPANY_NOT_FOUND")

    const promptPackage = packageFor(feature, {
      companyId: params.companyId,
      companyName: company.name,
      companyWebsite: company.website,
      companyCountry: company.country,
      companyIndustry: company.industry,
      term: params.term ?? null,
      windowDays: feature === "company_news" ? (params.windowDays ?? DEFAULT_NEWS_WINDOW_DAYS) : null,
    })

    const { data, error } = await admin.schema("v3").from("client_ai_executions").insert({ workspace_id: principal.workspaceId, user_id: principal.userId, ...principalColumns(principal), reservation_id: reservation.reservationId, feature, company_id: params.companyId, current_stage: feature, prompt_version: PROMPT_VERSION, package_hash: promptPackage.packageHash, package_payload: promptPackage, expires_at: promptPackage.expiresAt }).select("id").single()
    if (error) throw new Error(`CLIENT_EXECUTION_CREATE_FAILED:${error.message}`)
    await setReservationStatus(reservation.reservationId, "committed")
    return { allowed: true, executionId: data.id, promptPackage }
  } catch (error) {
    await setReservationStatus(reservation.reservationId, "released")
    throw error
  }
}

async function submitExternalDrilldown(
  principal: McpPrincipal,
  feature: ExternalFeature,
  params: { executionId: string; packageHash: string; result: unknown; clientModel?: string; idempotencyKey: string }
) {
  const admin = createAdminClient()
  const { data: execution } = await admin.schema("v3").from("client_ai_executions").select("*").eq("id", params.executionId).eq("workspace_id", principal.workspaceId).eq("user_id", principal.userId).eq("feature", feature).maybeSingle()
  if (!execution) throw new Error("CLIENT_EXECUTION_NOT_FOUND")

  const { data: replay } = await admin.schema("v3").from("client_ai_stage_submissions").select("result,status,validation_report").eq("execution_id", params.executionId).eq("stage", feature).eq("idempotency_key", params.idempotencyKey).maybeSingle()
  if (replay) {
    if (hash(replay.result) !== hash(params.result)) throw new Error("IDEMPOTENCY_KEY_REUSED")
    return { accepted: replay.status === "accepted", idempotent: true, report: replay.validation_report }
  }

  if (execution.package_hash !== params.packageHash || execution.status === "completed") throw new Error(`CLIENT_PACKAGE_MISMATCH:La ejecución espera el packageHash vigente. Consultá get_client_research_status.`)
  if (new Date(execution.expires_at).getTime() < Date.now()) throw new Error("CLIENT_PACKAGE_EXPIRED:El paquete venció. Llamá a refresh_prompt_package con este executionId para reemitirlo sin consumir cuota.")

  const parsed = schemas[feature].safeParse(params.result)
  if (!parsed.success) throw new Error(`CLIENT_RESULT_INVALID:${parsed.error.message}`)

  const evidence = execution.package_payload.evidence as { companyName: string; windowDays: number | null; term: string | null }

  // Los guardrails corren ACÁ, del lado del servidor, antes de persistir. Es el
  // punto en el que se descartan URLs muertas y contenido que no menciona a la
  // empresa: sin esto estaríamos escribiendo alucinaciones en tablas que v2 lee.
  const report = feature === "success_cases"
    ? await persistClientSuccessCases({
        companyId: execution.company_id,
        companyName: evidence.companyName,
        userId: principal.userId,
        searchContext: evidence.term ?? "v3-drilldown",
        // Normalización explícita: zod devuelve `undefined` para lo ausente y el
        // servicio exige `null`. Se convierte acá, en el límite, para no relajar
        // el contrato de la capa que escribe en tablas de v2.
        cases: (parsed.data as z.infer<typeof schemas.success_cases>).cases.map((item) => ({
          title: item.title,
          providerName: item.providerName ?? null,
          technology: item.technology ?? null,
          summary: item.summary ?? null,
          results: item.results ?? null,
          sourceUrl: item.sourceUrl,
          sourceName: item.sourceName ?? null,
          publishedAt: item.publishedAt ?? null,
          evidenceLevel: item.evidenceLevel ?? null,
          supportingSourceUrls: item.supportingSourceUrls ?? [],
        })),
      })
    : await persistClientNews({
        companyId: execution.company_id,
        companyName: evidence.companyName,
        workspaceId: principal.workspaceId,
        userId: principal.userId,
        windowDays: evidence.windowDays ?? DEFAULT_NEWS_WINDOW_DAYS,
        items: (parsed.data as z.infer<typeof schemas.company_news>).items.map((item) => ({
          title: item.title,
          summary: item.summary ?? null,
          category: item.category,
          direction: item.direction ?? null,
          sourceUrl: item.sourceUrl,
          sourceName: item.sourceName ?? null,
          publishedAt: item.publishedAt ?? null,
        })),
      })

  // Se registra incluso cuando los guardrails rechazan todo: el rechazo es
  // información útil (dice que el modelo del cliente está inventando fuentes) y
  // sin registro no habría manera de detectar ese patrón.
  await admin.schema("v3").from("client_ai_stage_submissions").insert({ execution_id: execution.id, workspace_id: principal.workspaceId, stage: feature, package_hash: params.packageHash, idempotency_key: params.idempotencyKey, result: parsed.data, validation_report: report, client_model: params.clientModel, status: report.accepted > 0 ? "accepted" : "rejected" })
  await admin.schema("v3").from("client_ai_executions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", execution.id)

  return {
    accepted: report.accepted,
    rejected: report.rejected,
    note: report.accepted === 0
      ? "Ninguna fuente pasó la verificación: se descartaron todas. Revisá que las URLs existan y que las páginas mencionen a la empresa."
      : `${report.accepted} de ${report.accepted + report.rejected.length} fuentes verificadas y guardadas.`,
    ...("directions" in report ? { directions: report.directions } : {}),
  }
}

export function prepareCompanySuccessCases(principal: McpPrincipal, params: { companyId: string; term?: string; idempotencyKey: string }) {
  return prepareExternalDrilldown(principal, "success_cases", params)
}
export function submitCompanySuccessCases(principal: McpPrincipal, params: { executionId: string; packageHash: string; result: unknown; clientModel?: string; idempotencyKey: string }) {
  return submitExternalDrilldown(principal, "success_cases", params)
}
export function prepareCompanyNews(principal: McpPrincipal, params: { companyId: string; term?: string; windowDays?: number; idempotencyKey: string }) {
  return prepareExternalDrilldown(principal, "company_news", params)
}
export function submitCompanyNews(principal: McpPrincipal, params: { executionId: string; packageHash: string; result: unknown; clientModel?: string; idempotencyKey: string }) {
  return submitExternalDrilldown(principal, "company_news", params)
}

export { schemas as clientResultSchemas }
