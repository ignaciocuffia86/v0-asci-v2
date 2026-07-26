import crypto from "crypto"
import { after } from "next/server"
import { NextRequest } from "next/server"
import { createMcpHandler, withMcpAuth } from "mcp-handler"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { validateMcpRequest, logMcpRequest } from "@/lib/v3/mcp-auth"
import { requirePaidMcp, reserveMcpUsage, setReservationStatus, getMcpUsage, type McpPrincipal } from "@/lib/v3/mcp-usage"
import { searchCompanies, getCompanyProfile, getCompanySignals, listWorkspaceAccounts, getAccountIntelligence, getResearchStatus } from "@/lib/v3/mcp-read-tools"
import { prepareAccountResearch, submitResearchStage, getClientResearchStatus, prepareAccountIcebreaker, submitAccountIcebreaker } from "@/lib/v3/mcp-client-ai"
import { prepareSaveAccount, saveAccount, removeWorkspaceAccount, listSavedAccounts, requireSavedAccount } from "@/lib/v3/mcp-account-lifecycle"
import { resolveCompany } from "@/lib/v3/services/company-resolver"
import { createResearchBatch, runResearchJob } from "@/lib/v3/services/research-pipeline"
import { checkResearchQuota } from "@/lib/v3/plans"
import { generateIcebreaker } from "@/lib/v3/services/icebreakers"
import { getCompanySignalSummary } from "@/lib/v3/services/company-signal-summary"
import { createDocumentDraft, getDraftText } from "@/lib/v3/services/mcp-document-ingestion"
import { confirmDocumentAnalysis, documentAnalysisSchema, getDocumentDictionaries } from "@/lib/v3/services/mcp-document-analysis"
import { recommendAccountsForValueProposition } from "@/lib/v3/services/value-proposition-recommender"

export const maxDuration = 120

type AuthInfo = { token: string; clientId: string; scopes: string[]; extra: McpPrincipal }
const authOf = (extra: unknown) => {
  const auth = (extra as { authInfo?: AuthInfo }).authInfo?.extra
  if (!auth) throw new Error("UNAUTHORIZED")
  return auth
}
const text = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) })
const safely = async (work: () => Promise<unknown>) => { try { return text(await work()) } catch (error) { return text({ success: false, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }, true) } }

const handler = createMcpHandler((server) => {
  server.tool("search_companies", "Busca empresas globales conocidas por nombre o dominio. Solo lectura; no ejecuta IA.", { query: z.string().min(2), limit: z.number().int().min(1).max(25).default(10) }, async ({ query, limit }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "companies:read", "read"); return searchCompanies(query, limit) }))
  server.tool("get_company_profile", "Obtiene identidad y cobertura global de señales de una empresa. Solo lectura.", { companyId: z.string().uuid() }, async ({ companyId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "companies:read", "read"); return getCompanyProfile(companyId) }))
  server.tool("get_company_signals", "Obtiene señales v2 normalizadas para un companyId exacto. Solo lectura y sin generación implícita.", { companyId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(50) }, async ({ companyId, limit }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "signals:read", "read"); return getCompanySignals(companyId, limit) }))
  server.tool("get_company_signal_summary", "Resume evidencia v2 de una empresa consolidando aliases relacionados: señales tecnológicas y de procesos, implementaciones y vacantes. Cada evidencia conserva su entidad de origen; las vacantes sin señales vinculadas son indicios, no confirmaciones. Usa esta tool cuando el usuario pregunte qué tecnologías, procesos o señales tenemos de una empresa.", { companyId: z.string().uuid() }, async ({ companyId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "signals:read", "read"); return getCompanySignalSummary(companyId) }))
  server.tool("list_workspace_accounts", "Lista cuentas investigadas por el workspace de la API key.", { limit: z.number().int().min(1).max(100).default(50) }, async ({ limit }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return listWorkspaceAccounts(auth, limit) }))
  server.tool("get_account_intelligence", "Lee snapshot, scorecard, brief e icebreakers privados ya materializados.", { companyId: z.string().uuid() }, async ({ companyId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return getAccountIntelligence(auth, companyId) }))
  server.tool("list_saved_accounts", "Lista las cuentas guardadas activas del workspace y el cupo del plan. Buscar una empresa no la guarda: usá esta tool para saber cuáles ya se pueden trabajar.", { limit: z.number().int().min(1).max(100).default(50) }, async ({ limit }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return listSavedAccounts(auth, limit) }))
  server.tool("check_account_access", "Verifica si una empresa está guardada en el workspace antes de investigarla o buscar tomadores de decisión. Devuelve el cupo del plan y la próxima acción sugerida.", { companyId: z.string().uuid() }, async ({ companyId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return requireSavedAccount(auth, companyId) }))
  server.tool("prepare_save_account", "Previsualiza guardar una empresa en el workspace sin escribir nada. Devuelve el costo en cupo del plan y qué habilita. Llamala siempre antes de save_account para poder pedir confirmación al usuario.", { companyId: z.string().uuid() }, async ({ companyId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return prepareSaveAccount(auth, companyId) }))
  server.tool("save_account", "Guarda la empresa en el workspace y ocupa 1 lugar del plan. Requiere confirmación explícita del usuario porque consume cupo. Es idempotente y reactiva cuentas dadas de baja.", { companyId: z.string().uuid(), userConfirmed: z.literal(true) }, async ({ companyId, userConfirmed }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:write", "read"); return saveAccount(auth, { companyId, userConfirmed }) }))
  server.tool("remove_workspace_account", "Quita una cuenta del workspace y libera el cupo de inmediato. No borra la inteligencia global de la empresa. Requiere confirmación explícita del usuario.", { companyId: z.string().uuid(), userConfirmed: z.literal(true) }, async ({ companyId, userConfirmed }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:write", "read"); return removeWorkspaceAccount(auth, { companyId, userConfirmed }) }))

  server.tool("get_research_status", "Consulta un batch server-managed perteneciente al workspace.", { batchId: z.string().uuid() }, async ({ batchId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return getResearchStatus(auth, batchId) }))

  server.tool("run_account_research", "Lanza research server-managed con AI Gateway de ASCI. Consume cuota y hard limits; operación atómica por lote.", { companies: z.array(z.string().min(2)).min(1).max(10), forceRefresh: z.boolean().default(false), idempotencyKey: z.string().min(8).max(200) }, async ({ companies, forceRefresh, idempotencyKey }, extra) => safely(async () => {
    const auth = authOf(extra); await requirePaidMcp(auth, "research:run", "server_managed")
    const resolved = await Promise.all(companies.map((input) => resolveCompany(input, auth.workspaceId)))
    if (resolved.some((item) => item.candidates.length || !item.companyId)) throw new Error("COMPANY_RESOLUTION_REQUIRED")
    const canonical = [...new Map(resolved.map((item, index) => [item.companyId!, { input: companies[index], companyId: item.companyId! }])).values()]
    const quota = await checkResearchQuota({ workspaceId: auth.workspaceId, companies: canonical })
    const rejected = quota.items.filter((item) => !item.allowed)
    if (rejected.length) throw new Error(`PLAN_QUOTA_EXCEEDED:${rejected.map((item) => item.reason).join(" | ")}`)
    const reservation = await reserveMcpUsage({ principal: auth, pool: "research_server", units: canonical.length, idempotencyKey, metadata: { companies: canonical } })
    if (!reservation.allowed || !reservation.reservationId) return reservation
    if (reservation.idempotent && reservation.status === "committed" && reservation.metadata?.batchId) return { ...reservation.metadata, idempotent: true }
    const result = await createResearchBatch({ workspaceId: auth.workspaceId, userId: auth.userId, inputs: canonical.map((item) => item.input), forceRefresh, source: "user", quotaMode: "all_or_nothing" })
    if ("error" in result) { await setReservationStatus(reservation.reservationId, "released"); throw new Error(result.error) }
    const response = { batchId: result.batchId, enqueued: result.jobs.length, reservationId: reservation.reservationId }
    await setReservationStatus(reservation.reservationId, "committed", response)
    after(async () => { for (const job of result.jobs) await runResearchJob(job.id).catch((error) => console.error("[v3][mcp] research job", error)) })
    return response
  }))

  server.tool("prepare_account_research", "Prepara research completo para ejecutar con el modelo y tokens del cliente MCP. ASCI no llama AI Gateway.", { companies: z.array(z.string().min(2)).min(1).max(10), idempotencyKey: z.string().min(8).max(200) }, async ({ companies, idempotencyKey }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "research:prepare", "client_assisted"); return prepareAccountResearch(auth, companies, idempotencyKey) }))
  server.tool("submit_account_research_stage", "Valida y persiste una etapa estructurada generada por el modelo del cliente.", { executionId: z.string().uuid(), stage: z.enum(["internal_analysis", "signal_classification", "fit_scoring", "account_brief"]), packageHash: z.string().length(64), result: z.unknown(), clientModel: z.string().max(200).optional(), idempotencyKey: z.string().min(8).max(200) }, async (args, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "research:submit", "client_assisted"); return submitResearchStage(auth, args) }))
  server.tool("get_client_research_status", "Consulta estado y próximo package del research client-assisted.", { executionId: z.string().uuid() }, async ({ executionId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return getClientResearchStatus(auth, executionId) }))

  server.tool("generate_account_icebreaker", "Genera un icebreaker server-managed con AI Gateway de ASCI y límites separados.", { companyId: z.string().uuid(), contactName: z.string().min(2), contactTitle: z.string().optional(), contactCountry: z.string().optional(), idempotencyKey: z.string().min(8).max(200) }, async ({ companyId, contactName, contactTitle, contactCountry, idempotencyKey }, extra) => safely(async () => {
    const auth = authOf(extra); await requirePaidMcp(auth, "icebreakers:generate", "server_managed"); await getAccountIntelligence(auth, companyId)
    const reservation = await reserveMcpUsage({ principal: auth, pool: "icebreaker_server", units: 1, idempotencyKey, metadata: { companyId } }); if (!reservation.allowed || !reservation.reservationId) return reservation
    if (reservation.idempotent && reservation.status === "committed" && reservation.metadata?.icebreakerId) {
      const admin = createAdminClient(); const { data } = await admin.schema("v3").from("icebreakers").select("*").eq("id", reservation.metadata.icebreakerId).eq("workspace_id", auth.workspaceId).maybeSingle(); return data ?? reservation.metadata
    }
    try {
      const admin = createAdminClient(); const { data: company } = await admin.from("companies").select("name").eq("id", companyId).maybeSingle(); if (!company) throw new Error("COMPANY_NOT_FOUND")
      const result = await generateIcebreaker({ workspaceId: auth.workspaceId, companyId, companyName: company.name, contact: { name: contactName, title: contactTitle, country: contactCountry }, createdBy: auth.userId })
      if (!result) throw new Error("ICEBREAKER_GENERATION_FAILED")
      await setReservationStatus(reservation.reservationId, "committed", { companyId, icebreakerId: result.id }); return result
    } catch (error) {
      await setReservationStatus(reservation.reservationId, "released"); throw error
    }
  }))
  server.tool("prepare_account_icebreaker", "Prepara un icebreaker para ejecutar con tokens del cliente.", { companyId: z.string().uuid(), contactName: z.string().min(2), contactTitle: z.string().optional(), contactCountry: z.string().optional(), idempotencyKey: z.string().min(8).max(200) }, async (args, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "icebreakers:prepare", "client_assisted"); return prepareAccountIcebreaker(auth, args) }))
  server.tool("submit_account_icebreaker", "Valida y guarda un icebreaker generado por el modelo del cliente.", { executionId: z.string().uuid(), packageHash: z.string().length(64), result: z.unknown(), clientModel: z.string().max(200).optional(), idempotencyKey: z.string().min(8).max(200) }, async (args, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "icebreakers:submit", "client_assisted"); return submitAccountIcebreaker(auth, args) }))
  server.tool("create_document_draft", "Inicia un documento compartido desde texto, URL HTTPS pública/Google Drive público o una carga temporal. Para upload devuelve un enlace de un solo uso por 15 minutos.", { title: z.string().min(2).max(240), sourceType: z.enum(["text", "url", "upload"]), text: z.string().max(2_000_000).optional(), url: z.string().url().optional() }, async ({ title, sourceType, text: sourceText, url }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "documents:write", "client_assisted"); if (sourceType === "text" && !sourceText) throw new Error("TEXT_REQUIRED"); if (sourceType === "url" && !url) throw new Error("URL_REQUIRED"); const source = sourceType === "text" ? { type: "text" as const, text: sourceText! } : sourceType === "url" ? { type: "url" as const, url: url! } : { type: "upload" as const }; return createDocumentDraft({ workspaceId: auth.workspaceId, userId: auth.userId, title, source }) }))
  server.tool("get_document_text", "Devuelve el texto completo cuando entra en el límite seguro. Si complete=false, llama nuevamente con nextOffset hasta leer todo antes de extraer información.", { draftId: z.string().uuid(), offset: z.number().int().min(0).default(0) }, async ({ draftId, offset }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "documents:read", "read"); return getDraftText(auth.workspaceId, draftId, offset) }))
  server.tool("get_document_dictionaries", "Obtiene tecnologías, procesos e industrias actuales de ASCI y el JSON Schema obligatorio. Mapea equivalencias claras y conserva términos libres.", {}, async (_args, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "documents:read", "read"); return getDocumentDictionaries() }))
  server.tool("confirm_document_analysis", "Persiste la extracción client-assisted únicamente después de mostrarla, permitir correcciones y recibir confirmación explícita del usuario. Todas las evidencias deben ser citas literales del documento.", { draftId: z.string().uuid(), userConfirmed: z.literal(true), analysis: documentAnalysisSchema }, async ({ draftId, analysis }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "documents:write", "client_assisted"); return confirmDocumentAnalysis(auth, draftId, analysis) }))
  server.tool("recommend_accounts_for_value_proposition", "Prefiltra hasta 20 cuentas del catálogo v2 según toda la documentación complementaria del workspace. Antes de llamar, pregunta explícitamente qué países interesan y envía ISO alpha-2. No completa con matches débiles.", { countries: z.array(z.string().length(2)).min(1).max(20), limit: z.number().int().min(1).max(20).default(20) }, async ({ countries, limit }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "recommendations:read", "client_assisted"); return recommendAccountsForValueProposition(auth.workspaceId, countries, limit) }))
  server.tool("get_ai_usage", "Devuelve cuota mensual, reservas por pool y tokens/costo server-managed verificados.", {}, async (_args, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "usage:read", "read"); return getMcpUsage(auth) }))
}, { serverInfo: { name: "asci-v3", version: "2.0.0" } }, { basePath: "/api/v3/mcp/server", maxDuration: 120, verboseLogs: false })

const authedHandler = withMcpAuth(handler, async (req: Request, token?: string) => {
  if (!token) return undefined
  const result = await validateMcpRequest(req as NextRequest)
  if (!result.success || !result.workspaceId || !result.userId || !result.keyId) return undefined
  const principal: McpPrincipal = { workspaceId: result.workspaceId, userId: result.userId, keyId: result.keyId, scopes: result.scopes ?? [], allowedModes: result.allowedModes ?? ["read"] }
  await logMcpRequest({ principal, method: req.method, statusCode: 200, requestId: crypto.randomUUID() })
  return { token, clientId: result.keyId, scopes: principal.scopes, extra: principal as unknown as Record<string, unknown> }
}, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
