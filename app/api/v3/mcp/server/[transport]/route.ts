import crypto from "crypto"
import { after } from "next/server"
import { NextRequest } from "next/server"
import { createMcpHandler, withMcpAuth } from "mcp-handler"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { validateMcpRequest, logMcpRequest } from "@/lib/v3/mcp-auth"
import { requirePaidMcp, reserveMcpUsage, setReservationStatus, getMcpUsage, type McpPrincipal } from "@/lib/v3/mcp-usage"
import { searchCompanies, getCompanyProfile, getCompanySignals, listWorkspaceAccounts, getAccountIntelligence, getResearchStatus, getAccountEvidenceDetailTool } from "@/lib/v3/mcp-read-tools"
import { prepareAccountResearch, submitResearchStage, getClientResearchStatus, prepareAccountIcebreaker, submitAccountIcebreaker, refreshPromptPackage, prepareCompanySuccessCases, submitCompanySuccessCases, prepareCompanyNews, submitCompanyNews } from "@/lib/v3/mcp-client-ai"
import { runLinkedinJobsActor, companyNameVariants } from "@/lib/v3/services/apify-client"
import { ingestApifyJobPostings } from "@/lib/v3/services/apify-job-ingest"
import { prepareSaveAccount, saveAccount, removeWorkspaceAccount, listSavedAccounts, requireSavedAccount, guardSavedAccounts } from "@/lib/v3/mcp-account-lifecycle"
import { recommendContactRoles, getCompanyContacts } from "@/lib/v3/mcp-contact-coverage"
import { prepareContactEnrichment, runContactEnrichment } from "@/lib/v3/services/mcp-contact-enrichment"
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
/**
 * Qué hacer ante cada código de error. Sin esto, el cliente IA recibe
 * "UNAUTHORIZED_EVIDENCE" pelado y su siguiente movimiento es adivinar: reintenta
 * igual, abandona la cuenta o inventa una tool que no existe. El código lo dice el
 * servidor; la salida también.
 */
const NEXT_ACTION_BY_CODE: Record<string, string> = {
  COMPANY_RESOLUTION_REQUIRED: "El nombre coincide con varias empresas. Llamá a search_companies y pedile al usuario que elija, después reintentá con el companyId (UUID).",
  UNAUTHORIZED_EVIDENCE: "Usaste un evidenceId que no está en el paquete. Reenviá la etapa usando solo los ids que vienen en `evidence`; no inventes ni combines ids.",
  CLIENT_PACKAGE_EXPIRED: "Llamá a refresh_prompt_package con este executionId (no consume cuota) y reintentá el submit con el packageHash nuevo.",
  CLIENT_PACKAGE_MISMATCH: "Llamá a get_client_research_status para traer la etapa y el packageHash vigentes, y reintentá con esos valores.",
  CLIENT_RESULT_INVALID: "El detalle indica la ruta exacta del campo inválido (por ejemplo `items.3.title`). Corregí SOLO ese ítem y reenviá la etapa completa con la misma idempotencyKey.",
  CLIENT_EXECUTION_COMPLETED: "Esta ejecución ya terminó. Leé el resultado con get_account_intelligence en vez de reenviar etapas.",
  CLIENT_EXECUTION_NOT_FOUND: "El executionId no existe en este workspace. Verificá el id devuelto por prepare_account_research.",
  IDEMPOTENCY_KEY_REUSED: "Reusaste una idempotencyKey con un contenido distinto. Si es un reintento, mandá el MISMO payload; si es un envío nuevo, usá una key nueva.",
  PLAN_QUOTA_EXCEEDED: "Se agotó el cupo del plan. Consultá get_ai_usage para ver qué pool se agotó (monthlyServerResearch o monthlyClientResearch) y avisale al usuario.",
  PACKAGE_REFRESH_LIMIT_REACHED: "Se alcanzó el techo de refrescos. Volvé a llamar prepare_account_research para esta cuenta (consume cuota nueva).",
  ACCOUNT_NOT_SAVED: "La cuenta no está guardada. Llamá a prepare_save_account, confirmá el costo con el usuario y después save_account.",
  UNAUTHORIZED: "La API key no es válida o no tiene el scope necesario. No reintentes: avisale al usuario que revise su credencial.",
  RATE_LIMITED: "Es un límite temporal de frecuencia, no un error definitivo ni falta de cuota. Esperá ~1 minuto y reintentá la MISMA llamada; no cambies los argumentos ni abandones la cuenta.",
  SCOPE_REQUIRED: "La API key no tiene el permiso para esta operación (por ejemplo contacts:write). No reintentes: avisale al usuario que regenere la key con el scope faltante.",
}

/**
 * Envelope uniforme de error.
 *
 * Los errores se lanzan como "CODIGO:mensaje humano". Antes esa cadena se devolvía
 * entera en `error`, así que el cliente tenía que parsearla por su cuenta y el
 * código quedaba mezclado con la explicación. Acá se separan y se agrega el
 * próximo paso, que es el patrón que ya usaban bien las tools de contactos.
 */
const safely = async (work: () => Promise<unknown>) => {
  try {
    return text(await work())
  } catch (error) {
    const raw = error instanceof Error ? error.message : "UNKNOWN_ERROR"
    // Prioridad 1: un `.code` estructurado en el propio error. EnrichmentError (y
    // otras clases del dominio) llevan el código en una propiedad aparte y ponen en
    // `message` solo la frase para el usuario ("Alcanzaste el límite de uso…"). Si
    // solo se parseara el message, todos esos códigos —RATE_LIMITED, PREPARE_FAILED,
    // SCOPE_REQUIRED— colapsarían en UNKNOWN_ERROR y el cliente perdería el
    // nextAction. Se detectó probando el flujo de contactos, no en revisión de código.
    const structuredCode =
      error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string"
        ? ((error as { code: string }).code)
        : null
    // Prioridad 2: el patrón "CODIGO:mensaje" embebido en el string.
    const separator = raw.indexOf(":")
    const candidate = separator > 0 ? raw.slice(0, separator) : raw
    const messageHasCode = /^[A-Z][A-Z0-9_]*$/.test(candidate)
    const code = structuredCode && /^[A-Z][A-Z0-9_]*$/.test(structuredCode)
      ? structuredCode
      : messageHasCode
        ? candidate
        : "UNKNOWN_ERROR"
    // El detalle: si el código vino del string, se recorta el prefijo; si vino de
    // la propiedad, el message ya es la frase limpia.
    const detail = !structuredCode && messageHasCode ? raw.slice(separator + 1).trim() : raw
    return text(
      {
        success: false,
        code,
        message: detail || code,
        ...(NEXT_ACTION_BY_CODE[code] ? { nextAction: NEXT_ACTION_BY_CODE[code] } : {}),
        // Se mantiene la cadena original para no romper a un cliente que ya la lea.
        error: raw,
      },
      true
    )
  }
}

const handler = createMcpHandler((server) => {
  server.tool("search_companies", "Busca empresas globales conocidas por nombre o dominio. Solo lectura; no ejecuta IA. Los resultados vienen ordenados por evidencia disponible (señales y vacantes) e incluyen likelyCanonical. Una misma empresa suele tener homónimos (plantas, filiales, distribuidores): si duplicateWarning viene informado, mostrale las opciones al usuario y confirmá cuál es la correcta antes de guardarla, porque guardar la equivocada ocupa un lugar del plan con una cuenta sin evidencia.", { query: z.string().min(2), limit: z.number().int().min(1).max(25).default(10) }, async ({ query, limit }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "companies:read", "read"); return searchCompanies(query, limit) }))
  server.tool("get_company_profile", "Obtiene identidad y cobertura global de señales de una empresa. Solo lectura.", { companyId: z.string().uuid() }, async ({ companyId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "companies:read", "read"); return getCompanyProfile(companyId) }))
  server.tool("get_company_signals", "Obtiene señales v2 normalizadas para un companyId exacto. Solo lectura y sin generación implícita.", { companyId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(50) }, async ({ companyId, limit }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "signals:read", "read"); return getCompanySignals(companyId, limit) }))
  server.tool("get_company_signal_summary", "Resume evidencia v2 de una empresa consolidando aliases relacionados: señales tecnológicas y de procesos, implementaciones y vacantes. Cada evidencia conserva su entidad de origen; las vacantes sin señales vinculadas son indicios, no confirmaciones. Usa esta tool cuando el usuario pregunte qué tecnologías, procesos o señales tenemos de una empresa.", { companyId: z.string().uuid() }, async ({ companyId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "signals:read", "read"); return getCompanySignalSummary(companyId) }))
  server.tool("get_account_evidence_detail", "Profundiza en UN término del panorama (una tecnología o un proceso) y devuelve sus fuentes con el fragmento de texto exacto, la fecha y el link. Cuando la señal sale del perfil de una persona incluye su LinkedIn para que el vendedor pueda verificar de quién se está infiriendo, y aclara si es empleado actual o ex-empleado. Usala después de get_company_signal_summary, cuando el usuario pregunte por qué aparece una tecnología o pida más detalle sobre una. Lee evidencia ya persistida: NO consume cuota ni vuelve a investigar.", { companyId: z.string().uuid(), term: z.string().min(2).max(120).optional(), termIds: z.array(z.string().uuid()).max(10).optional() }, async ({ companyId, term, termIds }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "signals:read", "read"); return getAccountEvidenceDetailTool(auth, { companyId, term, termIds }) }))
  server.tool("list_workspace_accounts", "Lista cuentas investigadas por el workspace de la API key.", { limit: z.number().int().min(1).max(100).default(50) }, async ({ limit }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return listWorkspaceAccounts(auth, limit) }))
  server.tool("get_account_intelligence", "Lee snapshot, scorecard, brief e icebreakers privados ya materializados.", { companyId: z.string().uuid() }, async ({ companyId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return getAccountIntelligence(auth, companyId) }))
  server.tool("list_saved_accounts", "Lista las cuentas guardadas activas del workspace y el cupo del plan. Buscar una empresa no la guarda: usá esta tool para saber cuáles ya se pueden trabajar.", { limit: z.number().int().min(1).max(100).default(50) }, async ({ limit }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return listSavedAccounts(auth, limit) }))
  server.tool("check_account_access", "Verifica si una empresa está guardada en el workspace antes de investigarla o buscar tomadores de decisión. Devuelve el cupo del plan y la próxima acción sugerida.", { companyId: z.string().uuid() }, async ({ companyId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return requireSavedAccount(auth, companyId) }))
  server.tool("prepare_save_account", "Previsualiza guardar una empresa en el workspace sin escribir nada. Devuelve el costo en cupo del plan y qué habilita. Llamala siempre antes de save_account para poder pedir confirmación al usuario.", { companyId: z.string().uuid() }, async ({ companyId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return prepareSaveAccount(auth, companyId) }))
  server.tool("save_account", "Guarda la empresa en el workspace y ocupa 1 lugar del plan. Requiere confirmación explícita del usuario porque consume cupo. Es idempotente y reactiva cuentas dadas de baja.", { companyId: z.string().uuid(), userConfirmed: z.literal(true) }, async ({ companyId, userConfirmed }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:write", "read"); return saveAccount(auth, { companyId, userConfirmed }) }))
  server.tool("remove_workspace_account", "Quita una cuenta del workspace y libera el cupo de inmediato. No borra la inteligencia global de la empresa. Requiere confirmación explícita del usuario.", { companyId: z.string().uuid(), userConfirmed: z.literal(true) }, async ({ companyId, userConfirmed }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:write", "read"); return removeWorkspaceAccount(auth, { companyId, userConfirmed }) }))

  server.tool("recommend_contact_roles", "Deriva los cargos a los que conviene apuntar en una cuenta guardada, justificados por las señales reales de la empresa (tecnologías, procesos, implementaciones y vacantes). Cada cargo incluye su evidencia y la tasa de éxito histórica en Apollo. Requiere que la cuenta esté guardada. NO consume créditos de enrichment. El usuario puede sumar cargos manuales vía additionalTitles: se marcan como user_input y no están respaldados por señales.", { companyId: z.string().uuid(), additionalTitles: z.array(z.string().min(2).max(120)).max(10).optional() }, async ({ companyId, additionalTitles }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "signals:read", "read"); return recommendContactRoles(auth, { companyId, additionalTitles }) }))
  server.tool("get_company_contacts", "Devuelve los contactos que el workspace ya tiene para una cuenta guardada, con frescura evaluada por campo (persona, email y teléfono) y la cobertura frente a los cargos recomendados. NUNCA llama a Apollo ni consume créditos. Llamala siempre antes de proponer un enrichment: si la cobertura ya es suficiente, no hay que gastar créditos.", { companyId: z.string().uuid(), roles: z.array(z.string().min(2).max(120)).max(10).optional() }, async ({ companyId, roles }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return getCompanyContacts(auth, { companyId, roles }) }))

  server.tool("prepare_contact_enrichment", "Previsualiza una búsqueda de tomadores de decisión en Apollo SIN gastar créditos. Devuelve los cargos validados, cuántos contactos como máximo, el costo en créditos y el cupo mensual restante. Llamá antes a get_company_contacts: si la cobertura ya alcanza, no hace falta gastar. Devuelve un planHash que DEBÉS mostrar al usuario junto al costo y confirmar explícitamente antes de llamar a run_contact_enrichment. Si likelyCacheHit es true, ejecutar no gasta créditos. IMPORTANTE: si resolvedOrganization trae un warning, la identidad de la empresa se resolvió por nombre (match difuso) — mostrale al usuario el nombre, dominio y tamaño que devolvió Apollo y confirmá que es la empresa correcta (no una fusionada, renombrada u homónima) antes de ejecutar.", { companyId: z.string().uuid(), roles: z.array(z.string().min(2).max(120)).min(1).max(25), maxContacts: z.number().int().min(1).max(50).optional(), useOrganizationLocation: z.boolean().optional(), idempotencyKey: z.string().min(8).max(200).optional() }, async (args, extra) => safely(async () => { const auth = authOf(extra); return prepareContactEnrichment(auth, args) }))
  server.tool("run_contact_enrichment", "Ejecuta el enrichment de contactos en Apollo y GASTA CRÉDITOS del cupo mensual del workspace. Solo acepta un planHash devuelto por prepare_contact_enrichment, y ese plan congela los cargos y el máximo de contactos: no podés cambiarlos acá. Requiere confirmación explícita del usuario sobre el costo mostrado en la preparación. Es idempotente: reejecutar el mismo planHash devuelve el resultado guardado sin volver a cobrar. Solo obtiene emails; el teléfono no se pide en esta tool.", { planHash: z.string().min(16).max(64), userConfirmed: z.literal(true) }, async ({ planHash }, extra) => safely(async () => { const auth = authOf(extra); return runContactEnrichment(auth, { planHash }) }))

  server.tool("get_research_status", "Consulta un batch server-managed perteneciente al workspace.", { batchId: z.string().uuid() }, async ({ batchId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return getResearchStatus(auth, batchId) }))

  server.tool("run_account_research", "Lanza research server-managed con AI Gateway de ASCI. Consume cuota y hard limits; operación atómica por lote. PASÁ EL companyId (UUID) que devolvió search_companies o save_account, no el nombre: con un UUID la cuenta queda identificada sin ambigüedad, mientras que un nombre se resuelve por match difuso y puede apuntar a un homónimo distinto del que guardaste. Requiere que TODAS las cuentas del lote estén guardadas en el workspace: si alguna no lo está, devuelve el detalle sin consumir cuota y hay que llamar save_account antes de reintentar.", { companies: z.array(z.string().min(2)).min(1).max(10).describe("companyId (UUID) de cada cuenta. Se acepta el nombre solo si no tenés el id, pero es ambiguo."), forceRefresh: z.boolean().default(false), idempotencyKey: z.string().min(8).max(200) }, async ({ companies, forceRefresh, idempotencyKey }, extra) => safely(async () => {
    const auth = authOf(extra); await requirePaidMcp(auth, "research:run", "server_managed")
    const resolved = await Promise.all(companies.map((input) => resolveCompany(input, auth.workspaceId)))
    if (resolved.some((item) => item.candidates.length || !item.companyId)) throw new Error("COMPANY_RESOLUTION_REQUIRED")
    const canonical = [...new Map(resolved.map((item, index) => [item.companyId!, { input: companies[index], companyId: item.companyId! }])).values()]
    // Mismo guard que el research client-assisted: trabajar una cuenta exige
    // tenerla guardada, y se verifica antes de tocar cuota.
    const blocked = await guardSavedAccounts(auth, canonical.map((item) => item.companyId))
    if (blocked) return blocked
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

  server.tool("prepare_account_research", "Prepara research completo para ejecutar con el modelo y tokens del cliente MCP. ASCI no llama AI Gateway. PASÁ EL companyId (UUID) que devolvió search_companies o save_account, no el nombre: con un UUID la cuenta queda identificada sin ambigüedad, mientras que un nombre se resuelve por match difuso y puede apuntar a un homónimo distinto del que guardaste. Requiere que todas las cuentas estén guardadas en el workspace: si alguna no lo está, devuelve el detalle sin consumir cuota y hay que llamar save_account antes de reintentar.", { companies: z.array(z.string().min(2)).min(1).max(10).describe("companyId (UUID) de cada cuenta. Se acepta el nombre solo si no tenés el id, pero es ambiguo."), idempotencyKey: z.string().min(8).max(200) }, async ({ companies, idempotencyKey }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "research:prepare", "client_assisted"); return prepareAccountResearch(auth, companies, idempotencyKey) }))
  server.tool("submit_account_research_stage", "Valida y persiste una etapa estructurada generada por el modelo del cliente.", { executionId: z.string().uuid(), stage: z.enum(["internal_analysis", "signal_classification", "fit_scoring", "account_brief"]), packageHash: z.string().length(64), result: z.unknown(), clientModel: z.string().max(200).optional(), idempotencyKey: z.string().min(8).max(200) }, async (args, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "research:submit", "client_assisted"); return submitResearchStage(auth, args) }))
  server.tool("prepare_company_success_cases", "Paso 1 de 2 para buscar casos de éxito de una cuenta con una tecnología concreta. Devuelve el prompt package para que el cliente BUSQUE con sus propios tokens. Consume 1 unidad del pool CLIENT-ASSISTED, que en get_ai_usage se ve como monthlyClientResearch: NO mueve monthlyServerResearch, son dos cupos independientes. Usala después de get_company_signal_summary, cuando el usuario quiera evidencia externa de una tecnología puntual. Cada caso debe traer una sourceUrl real: el servidor verifica que responda y que la página mencione a la empresa antes de guardar, y descarta lo que no pase.", { companyId: z.string().uuid(), term: z.string().min(2).max(120).optional(), idempotencyKey: z.string().min(8).max(200) }, async ({ companyId, term, idempotencyKey }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "research:prepare", "client_assisted"); return prepareCompanySuccessCases(auth, { companyId, term, idempotencyKey }) }))
  server.tool("submit_company_success_cases", "Paso 2 de 2: entrega los casos de éxito que encontró el cliente. El servidor aplica los guardrails (URL viva y mención real de la empresa) y descarta lo que no pase, así que la respuesta informa cuántos se aceptaron y cuántos se rechazaron con su motivo. No consume cuota adicional.", { executionId: z.string().uuid(), packageHash: z.string().length(64), result: z.unknown(), clientModel: z.string().max(200).optional(), idempotencyKey: z.string().min(8).max(200) }, async (args, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "research:submit", "client_assisted"); return submitCompanySuccessCases(auth, args) }))
  server.tool("prepare_company_news", "Paso 1 de 2 para buscar noticias recientes de una cuenta. Devuelve el prompt package para que el cliente BUSQUE con sus propios tokens, con una ventana temporal explícita (180 días por defecto) para que no traiga notas viejas como si fueran novedad. Consume 1 unidad del pool CLIENT-ASSISTED, que en get_ai_usage se ve como monthlyClientResearch: NO mueve monthlyServerResearch, son dos cupos independientes. Clasificá `category` con la taxonomía cerrada que viene en el responseSchema del paquete; si mandás una variante, el servidor la normaliza y te lo informa en remappedCategories.", { companyId: z.string().uuid(), term: z.string().min(2).max(120).optional(), windowDays: z.number().int().min(1).max(730).optional(), idempotencyKey: z.string().min(8).max(200) }, async ({ companyId, term, windowDays, idempotencyKey }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "research:prepare", "client_assisted"); return prepareCompanyNews(auth, { companyId, term, windowDays, idempotencyKey }) }))
  server.tool("submit_company_news", "Paso 2 de 2: entrega las noticias que encontró el cliente. El servidor verifica URLs y relevancia, descarta lo que no pase, y clasifica cada noticia como expansion, contraccion o neutro para que una mala noticia (un cierre de planta, una desinversión) no sume puntaje de timing como si fuera una oportunidad. No consume cuota adicional.", { executionId: z.string().uuid(), packageHash: z.string().length(64), result: z.unknown(), clientModel: z.string().max(200).optional(), idempotencyKey: z.string().min(8).max(200) }, async (args, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "research:submit", "client_assisted"); return submitCompanyNews(auth, args) }))
  server.tool("scrape_company_job_postings", "Trae vacantes frescas de LinkedIn para una cuenta guardada y las ingesta por el pipeline de importación de ASCI, que las normaliza y deduplica. El filtro por empresa se aplica en el buscador usando el nombre y el país que ya tenemos guardados de la cuenta, así que no hace falta pasarlos. Consume cuota de research server-managed porque el scraping corre con recursos de ASCI. Dos cosas a tener en cuenta: (1) `titleQuery` es OPCIONAL y sirve para acotar por título de puesto DENTRO de la empresa (por ejemplo 'SAP'); si lo omitís se traen todas las vacantes de la empresa, que es lo habitual. (2) La ventana sólo puede ser 1, 7 o 30 días; si pedís más, se busca sin límite de fecha y se te avisa. La ingesta es asincrónica: las vacantes aparecen cuando el importador procesa el lote, no de inmediato.", { companyId: z.string().uuid(), titleQuery: z.string().min(2).max(120).optional(), location: z.string().min(2).max(120).optional(), windowDays: z.number().int().min(1).max(365).optional(), maxRows: z.number().int().min(1).max(200).optional(), idempotencyKey: z.string().min(8).max(200) }, async ({ companyId, titleQuery, location, windowDays, maxRows, idempotencyKey }, extra) => safely(async () => {
    const auth = authOf(extra); await requirePaidMcp(auth, "research:run", "server_managed")
    const blocked = await guardSavedAccounts(auth, [companyId])
    if (blocked) return blocked
    const reservation = await reserveMcpUsage({ principal: auth, pool: "research_server", units: 1, idempotencyKey, metadata: { companyId, titleQuery: titleQuery ?? null } })
    if (!reservation.allowed || !reservation.reservationId) return reservation
    // Replay: la cuota ya se cobró y el batch ya existe. Devolver lo mismo evita
    // un segundo scraping (que se paga) y un segundo batch con las mismas filas.
    if (reservation.idempotent && reservation.status === "committed" && reservation.metadata?.batchId) return { ...reservation.metadata, idempotent: true }
    try {
      // El nombre y el país salen de nuestra tabla `companies`, no del input: son
      // exactamente los dos valores que el actor necesita para filtrar en origen,
      // y son los que ya tenemos confirmados. Así el filtrado no depende de que
      // quien llama escriba bien el nombre de la empresa.
      const admin = createAdminClient()
      const { data: company } = await admin.from("companies").select("name,linkedin_url,country").eq("id", companyId).maybeSingle()
      if (!company) throw new Error("COMPANY_NOT_FOUND")
      const run = await runLinkedinJobsActor({
        companyNames: companyNameVariants(company.name, company.linkedin_url),
        // `||` y no `??`: hay filas con country = "" (string vacío), que `??` deja pasar.
        location: location?.trim() || company.country?.trim() || undefined,
        titleQuery: titleQuery ?? null,
        windowDays: windowDays ?? null,
        maxRows,
      })
      const ingest = await ingestApifyJobPostings({ companyId, userId: auth.userId, runId: run.runId, items: run.items })
      const response = {
        ...ingest,
        // La ventana real puede ser más amplia que la pedida: el actor no soporta
        // nada entre 30 días e infinito. Decirlo evita que el usuario crea que
        // filtró por un período que en realidad no se aplicó.
        appliedWindow: run.appliedWindow,
        warnings: run.truncatedWindow
          ? [...ingest.warnings, `LinkedIn sólo permite ventanas de 1, 7 o 30 días: se pidió ${windowDays} y se buscó sin límite de fecha.`]
          : ingest.warnings,
        note: ingest.batchId
          ? "Las vacantes quedaron en cola. Consultá get_company_signal_summary en unos minutos para verlas ya normalizadas."
          : "No se encontraron vacantes de esta empresa con esa búsqueda.",
      }
      await setReservationStatus(reservation.reservationId, "committed", { batchId: ingest.batchId, queued: ingest.queued })
      return response
    } catch (error) {
      // Se libera la reserva: si el scraping falló, el usuario no gastó nada útil.
      await setReservationStatus(reservation.reservationId, "released")
      throw error
    }
  }))

  server.tool("refresh_prompt_package", "Reemite el prompt package de una ejecución client-assisted cuya vigencia venció, SIN consumir cuota ni volver a investigar. Usala cuando un submit falle con CLIENT_PACKAGE_EXPIRED: la cuota ya se consumió al preparar, así que no hay que llamar de nuevo a prepare_account_research. Devuelve el packageHash nuevo con el que hay que reintentar el submit. Tiene un máximo de refrescos por ejecución.", { executionId: z.string().uuid() }, async ({ executionId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "accounts:read", "read"); return refreshPromptPackage(auth, executionId) }))
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
  server.tool("prepare_account_icebreaker", "Prepara un icebreaker para ejecutar con tokens del cliente. Requiere que la cuenta esté guardada en el workspace.", { companyId: z.string().uuid(), contactName: z.string().min(2), contactTitle: z.string().optional(), contactCountry: z.string().optional(), idempotencyKey: z.string().min(8).max(200) }, async (args, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "icebreakers:prepare", "client_assisted"); return prepareAccountIcebreaker(auth, args) }))
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
  if (!result.success || !result.workspaceId || !result.userId || !result.keyId || !result.keyType) return undefined
  // `keyType` viene de validateMcpRequest y hay que propagarlo: es lo que decide
  // si keyId se escribe en api_key_id o en oauth_token_id.
  const principal: McpPrincipal = { workspaceId: result.workspaceId, userId: result.userId, keyId: result.keyId, keyType: result.keyType, scopes: result.scopes ?? [], allowedModes: result.allowedModes ?? ["read"] }
  await logMcpRequest({ principal, method: req.method, statusCode: 200, requestId: crypto.randomUUID() })
  return { token, clientId: result.keyId, scopes: principal.scopes, extra: principal as unknown as Record<string, unknown> }
}, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
