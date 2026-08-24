import crypto from "crypto"
import { after } from "next/server"
import { NextRequest } from "next/server"
import { createMcpHandler, withMcpAuth } from "mcp-handler"
import { z } from 'zod/v3';
import { createAdminClient } from "@/lib/supabase/admin"
import { validateMcpRequest, logMcpRequest } from "@/lib/v3/mcp-auth"
import { requirePaidMcp, reserveMcpUsage, setReservationStatus, getMcpUsage, type McpPrincipal } from "@/lib/v3/mcp-usage"
import { searchCompanies, getCompanyProfile, getCompanySignals, listWorkspaceAccounts, getAccountIntelligence, getResearchStatus, getAccountEvidenceDetailTool } from "@/lib/v3/mcp-read-tools"
import { prepareAccountResearch, submitResearchStage, getClientResearchStatus, prepareAccountIcebreaker, submitAccountIcebreaker, refreshPromptPackage, prepareCompanySuccessCases, submitCompanySuccessCases, prepareCompanyNews, submitCompanyNews } from "@/lib/v3/mcp-client-ai"
import { runLinkedinJobsActor, companyNameVariants, isApifyConfigured } from "@/lib/v3/services/apify-client"
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
import { searchCompaniesByCapability } from "@/lib/v3/services/capability-search"
import { screenAccountList, MAX_ACCOUNTS_PER_CALL } from "@/lib/v3/services/screen-account-list"
import { estimateBatch, MAX_ACCOUNTS_PER_BATCH } from "@/lib/v3/services/mcp-batch-estimate"

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
  ACCOUNT_AUTO_REFRESHED: "NO es falta de cuota: la cuenta ya está en seguimiento y se refresca sola. No reintentes ni gastes cuota. Leé lo que ya hay con get_account_intelligence y avisale al usuario en qué fecha llega el próximo digest.",
  PACKAGE_REFRESH_LIMIT_REACHED: "Se alcanzó el techo de refrescos. Volvé a llamar prepare_account_research para esta cuenta (consume cuota nueva).",
  ACCOUNT_NOT_SAVED: "La cuenta no está guardada. Llamá a prepare_save_account, confirmá el costo con el usuario y después save_account.",
  UNAUTHORIZED: "La API key no es válida o no tiene el scope necesario. No reintentes: avisale al usuario que revise su credencial.",
  RATE_LIMITED: "Es un límite temporal de frecuencia, no un error definitivo ni falta de cuota. Esperá ~1 minuto y reintentá la MISMA llamada; no cambies los argumentos ni abandones la cuenta.",
  SCOPE_REQUIRED: "La API key no tiene el permiso para esta operación (por ejemplo contacts:write). No reintentes: avisale al usuario que regenere la key con el scope faltante.",
  // Sin esta entrada el modelo recibía "APIFY_TOKEN_MISSING" pelado y su siguiente
  // movimiento fue buscar vacantes en la web y presentarlas como si fueran datos de
  // ASCI. Es la falla más engañosa posible: una falla NUESTRA de configuración
  // termina disfrazada de resultado. El texto tiene que cerrarle esa puerta.
  APIFY_TOKEN_MISSING:
    "Es una falla de CONFIGURACIÓN de ASCI (falta APIFY_TOKEN en este deployment), no un problema del pedido ni falta de cuota. No se consumió cuota. NO reintentes y NO busques las vacantes en la web ni con otras tools: los resultados web no entran al pipeline de ASCI y no se pueden atribuir a la cuenta. Decile al usuario que el scraping de vacantes está sin configurar y que hay que setear APIFY_TOKEN en el proyecto de Vercel.",
  COMPANY_NOT_FOUND: "El companyId no existe. Llamá a search_companies para obtener el UUID correcto y reintentá.",
}

/**
 * Familias de códigos que se resuelven por PREFIJO.
 *
 * Hace falta porque varios códigos son dinámicos y no se pueden enumerar:
 * `APIFY_RUN_HTTP_429`, `APIFY_RUN_TIMED-OUT`, `APIFY_INGEST_ROWS_FAILED`. Con un
 * mapa por igualdad exacta todos esos caían sin nextAction, que es justo el caso
 * en que el modelo improvisa (y ya vimos que improvisa buscando en la web y
 * presentándolo como dato de ASCI).
 *
 * El orden importa: se toma la primera coincidencia, así que van de más específico
 * a más general.
 */
const NEXT_ACTION_BY_PREFIX: [string, string][] = [
  [
    "APIFY_RUN_",
    "El scraping de LinkedIn falló o terminó sin resultados del lado del proveedor. La cuota ya se liberó, no se cobró nada. Podés reintentar UNA vez la misma llamada, o con una ventana más corta (windowDays 7 o 1) y menos maxRows. Si vuelve a fallar, avisale al usuario: NO busques las vacantes en la web, porque esos resultados no entran al pipeline de ASCI y no se pueden atribuir a la cuenta.",
  ],
  [
    "APIFY_INGEST_",
    "El scraping funcionó pero la ingesta al pipeline de ASCI falló, así que las vacantes NO quedaron guardadas. La cuota ya se liberó. Avisale al usuario y no presentes las vacantes como guardadas.",
  ],
]

/** Resuelve el próximo paso: primero por código exacto, después por familia. */
function nextActionFor(code: string): string | undefined {
  if (NEXT_ACTION_BY_CODE[code]) return NEXT_ACTION_BY_CODE[code]
  return NEXT_ACTION_BY_PREFIX.find(([prefix]) => code.startsWith(prefix))?.[1]
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
    // El guion está permitido porque hay códigos que lo llevan: el estado de un run
    // de Apify se interpola tal cual y produce `APIFY_RUN_TIMED-OUT`. Sin el guion
    // ese caso caía en UNKNOWN_ERROR y perdía el nextAction, justo cuando más falta
    // hace. Sigue exigiendo mayúsculas, así que una frase humana no se confunde.
    const CODE_PATTERN = /^[A-Z][A-Z0-9_-]*$/
    const messageHasCode = CODE_PATTERN.test(candidate)
    const code = structuredCode && CODE_PATTERN.test(structuredCode)
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
        ...(nextActionFor(code) ? { nextAction: nextActionFor(code) } : {}),
        // Se mantiene la cadena original para no romper a un cliente que ya la lea.
        error: raw,
      },
      true
    )
  }
}

/** Códigos de error → status. Sin esto toda falla quedaba registrada como 200. */
const STATUS_BY_CODE: Record<string, number> = {
  RATE_LIMITED: 429,
  UNAUTHORIZED: 401,
  SCOPE_REQUIRED: 403,
  PLAN_REQUIRED: 402,
  PLAN_QUOTA_EXCEEDED: 402,
  MODE_NOT_ALLOWED: 403,
  CLIENT_EXECUTION_NOT_FOUND: 404,
  ACCOUNT_NOT_SAVED: 409,
}

/**
 * Auditoría real de cada invocación.
 *
 * Antes existía un único `logMcpRequest` en el callback de auth, que corría una vez por
 * request HTTP y ANTES de ejecutar la tool. De ahí venían los tres agujeros que dejaban la
 * tabla sin poder responder "quién usó qué": `tool_name` siempre null, `status_code`
 * siempre 200 (incluso si la tool fallaba) y `response_time_ms` siempre 0.
 */
const auditToolCall = async (input: { toolName: string; extra: unknown; result?: unknown; thrown?: unknown; startedAt: number }) => {
  const principal = (input.extra as { authInfo?: { extra?: McpPrincipal } } | undefined)?.authInfo?.extra
  if (!principal) return

  const payload = input.result as { content?: { text?: string }[]; isError?: boolean } | undefined
  const failed = Boolean(input.thrown) || Boolean(payload?.isError)
  let errorCode: string | undefined
  if (failed) {
    // `safely` ya normalizó el error a un envelope JSON con `code`; se reusa esa
    // clasificación en vez de volver a parsear el mensaje crudo.
    try {
      const parsed = JSON.parse(payload?.content?.[0]?.text ?? "{}") as { code?: unknown }
      if (typeof parsed.code === "string") errorCode = parsed.code
    } catch {
      errorCode = "UNKNOWN_ERROR"
    }
    if (!errorCode) errorCode = "UNKNOWN_ERROR"
  }

  await logMcpRequest({
    principal,
    toolName: input.toolName,
    method: "POST",
    statusCode: failed ? (STATUS_BY_CODE[errorCode ?? ""] ?? 400) : 200,
    responseTimeMs: Date.now() - input.startedAt,
    // Lo estampa `requirePaidMcp`, la única puerta por la que pasan todas las tools, así
    // no hace falta mantener un mapa tool→modo en paralelo que se desincronice.
    mode: principal.effectiveMode ?? "read",
    errorCode,
  })
}

/**
 * Envuelve `server.tool` para auditar cada llamada sin tocar las ~36 registraciones.
 *
 * El Proxy devuelve el mismo tipo `S`, así que las tools conservan la inferencia de tipos
 * de sus esquemas zod: la intervención es solo en runtime.
 */
function withToolAudit<S extends object>(server: S): S {
  return new Proxy(server, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver)
      if (prop !== "tool" || typeof original !== "function") return original
      return (...args: unknown[]) => {
        const lastIndex = args.length - 1
        const run = args[lastIndex]
        const toolName = typeof args[0] === "string" ? args[0] : "(desconocida)"
        if (typeof run === "function") {
          args[lastIndex] = async (toolArgs: unknown, extra: unknown) => {
            const startedAt = Date.now()
            try {
              const result = await (run as (a: unknown, e: unknown) => Promise<unknown>)(toolArgs, extra)
              // `after` para no sumarle la latencia del insert a la respuesta.
              after(() => auditToolCall({ toolName, extra, result, startedAt }))
              return result
            } catch (thrown) {
              // Red de seguridad para un error lanzado dentro del handler pero fuera de
              // `safely`. Limitación verificada en runtime: si los argumentos no pasan el
              // esquema zod, el framework rechaza ANTES de llamar acá, así que esas
              // llamadas malformadas no quedan auditadas. Auditarlas exigiría interceptar
              // el transporte, no la tool.
              after(() => auditToolCall({ toolName, extra, thrown, startedAt }))
              throw thrown
            }
          }
        }
        return (original as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  }) as S
}

const handler = createMcpHandler((rawServer) => {
  const server = withToolAudit(rawServer)
  server.tool("search_companies", "Busca empresas globales conocidas por nombre o dominio. Solo lectura; no ejecuta IA. Los resultados vienen ordenados por evidencia disponible (señales y vacantes) e incluyen likelyCanonical. Una misma empresa suele tener homónimos (plantas, filiales, distribuidores): si duplicateWarning viene informado, mostrale las opciones al usuario y confirmá cuál es la correcta antes de guardarla, porque guardar la equivocada ocupa un lugar del plan con una cuenta sin evidencia.", { query: z.string().min(2), limit: z.number().int().min(1).max(25).default(10) }, async ({ query, limit }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "companies:read", "read"); return searchCompanies(query, limit) }))
  server.tool("search_companies_by_capability", "Búsqueda INVERSA: qué EMPRESAS usan una tecnología o ejecutan un proceso. Es la tool para \"qué bancos usan Dynamics 365\", \"qué empresas de retail tienen SAP\" o \"quién tiene Angular y Oracle Forms\" (modernización de legacy). Solo lectura, sin IA y sin consumir cupo.\n\nCIRCUITO DE DOS PASOS: llamá primero con mode=\"screening\", que devuelve SOLO conteos por país e industria (sin nombres); si son muchas, acotá y recién entonces pedí mode=\"detail\". No pidas detail sin filtros para un término amplio.\n\nCÓMO ACOTAR (en este orden de utilidad):\n• minSignals — filtra por VOLUMEN de evidencia. Es el corte más potente y el que más se subusa: una cuenta con 1 señal suelta casi nunca es una oportunidad real. En una prueba real, 380 cuentas bajaron a 32 con minSignals: 6.\n• termsMode — \"any\" (default) SUMA las empresas que tienen CUALQUIERA de los términos; \"all\" devuelve la INTERSECCIÓN, las que tienen TODOS. Si el usuario dice \"y\" (\"Angular y Oracle Forms\"), quiere \"all\". Con \"all\", todos los términos tienen que existir en el diccionario o la llamada falla a propósito.\n• countries / industries — los países se pasan con el nombre EXACTO que devolvió el screening (\"Argentina\"), no con código ISO.\n\nCÓMO LEER EL DETALLE:\n• termHits: [{term, signals}] es el desglose del total por término. NO lo omitas al resumir: Mercado Libre y La Segunda pueden tener los mismos términos y ser casos opuestos (Mercado Libre 115 señales de Angular y 7 de Oracle Forms = una cuenta Angular; La Segunda 16 y 13 = modernización de legacy real).\n• contactsInBase / alumniInBase son CONTACTOS QUE ASCI TIENE de esa empresa, NO su dotación. Nunca los presentes como cantidad de empleados.\n• La dotación real, el LinkedIn, el dominio y si cotiza en bolsa salen con include: [\"firmographics\"] (no viene por default porque infla el payload). employeesApollo puede venir en null: eso significa QUE NO LO SABEMOS, no que la empresa sea chica. Decilo así.\n• excluded.serviceProviders dice cuántas cuentas descartó el filtro por defecto de consultoras/integradores. Si el número es alto y el usuario busca partners, pasá includeProviders: true.\n\nPAGINACIÓN Y LISTADO COMPLETO: si truncated es true, la respuesta trae nextCursor. Reenviá la MISMA llamada con cursor: \"<nextCursor>\" para la página siguiente; si cambiás cualquier filtro, el cursor se rechaza a propósito. Hasta ~200 empresas podés encadenar cursor y bajar la lista entera si el usuario la quiere para exportar (y escribirla como archivo si tenés herramientas para eso). Por encima de eso NO pagines: no entra en una conversación, y no hay export por MCP —decile que acote (minSignals es lo que más recorta) o que exporte desde la aplicación web. Nunca le prometas una descarga. guidance te dice cuál de los dos casos es, con el número de llamadas.\n\nUn término puede resolver a varias entradas del diccionario (\"Dynamics 365\" son CRM y ERP; \"Microsoft\" son 10 productos): mirá resolvedTerms para saber qué se buscó. Los procesos son categorías muy amplias: máximo 2 por llamada. Leé siempre guidance, que indica el próximo paso.", { terms: z.array(z.string().min(2)).min(1).max(10), termsMode: z.enum(["any", "all"]).default("any").describe("\"all\" = intersección (empresas que tienen TODOS los términos). \"any\" = unión."), minSignals: z.number().int().min(1).max(10000).optional().describe("Mínimo de señales por empresa. El filtro más útil para pasar de un listado a una lista accionable."), countries: z.array(z.string().min(2)).max(10).optional(), industries: z.array(z.string().min(2)).max(10).optional(), includeProviders: z.boolean().default(false), include: z.array(z.enum(["firmographics"])).max(1).optional().describe("Campos extra por empresa. \"firmographics\" agrega linkedinUrl, domain, employeesApollo, isPublic, ticker y stockExchange."), mode: z.enum(["screening", "detail"]).default("screening"), limit: z.number().int().min(1).max(50).default(25), cursor: z.string().max(4000).optional().describe("nextCursor de la llamada anterior. Solo válido repitiendo los mismos filtros.") }, async ({ terms, termsMode, minSignals, countries, industries, includeProviders, include, mode, limit, cursor }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "companies:read", "read"); return searchCompaniesByCapability({ terms, termsMode, minSignals, countries, industries, includeProviders, include, mode, limit, cursor }) }))
  server.tool(
    "screen_account_list",
    "Cruza UNA LISTA DE NOMBRES del cliente contra uno o varios términos (tecnologías o procesos) y devuelve UNA FILA POR NOMBRE. Es la tool para \"tengo estas 61 cuentas de Chile, decime cuáles tienen señales de Power BI\". Solo lectura, sin IA, sin consumir cupo y sin necesidad de que las cuentas estén guardadas.\n\nUSALA EN VEZ DE: paginar search_companies_by_capability y matchear a mano (son ~9 llamadas y ~80k tokens para 61 nombres), o llamar search_companies una vez por cuenta (61 llamadas, y no devuelve señales por término).\n\nLOS CUATRO ESTADOS NO SON INTERCAMBIABLES:\n• matched — está en ASCI y tiene el término.\n• matched_no_signal — está en ASCI y NO tiene el término. Es un descarte legítimo y se le puede decir al cliente.\n• no_match — NO está en ASCI. No sabemos nada de esa empresa: NO afirmes que no tiene la tecnología.\n• matched_ambiguous — confirmá con el usuario ANTES de usar la fila. `ambiguityReason` dice qué preguntar.\n\nPasá `domain` cuando lo tengas: es la prueba de identidad más fuerte y evita ambigüedades. Los acrónimos de menos de 4 letras (\"CCU\") no matchean por similitud: para esos, pasá el dominio o el nombre completo.\n\n`signalsForTerms` es el total de la EMPRESA: suma las entidades duplicadas que el catálogo tiene con el mismo nombre canónico (\"AFP HABITAT\", \"AFP HÁBITAT\" y \"AFP HABITAT SA\" son una sola). `signalsOwn` es solo de la entidad devuelta y `duplicateEntities` dice cuántas se consolidaron: si difieren, la cuenta está fragmentada y hay que usar el total.\n\n`minSignals` (default 2) marca como \"weak\" a las cuentas con una mención suelta: en un screening real, 20 de 42 cuentas tenían 1 o 2 señales y presentarlas junto a una con 14 le baja la credibilidad al reporte entero.\n\nSi omitís `terms`, la tool reconcilia la lista contra el catálogo (\"¿cuáles de estas cuentas tenemos?\") y no evalúa señales.",
    {
      accounts: z.array(z.object({
        name: z.string().min(2).describe("El nombre TAL COMO LO MANDÓ EL CLIENTE. No lo normalices ni lo corrijas: la fila vuelve con este texto para que puedas cruzarla con la lista original."),
        domain: z.string().optional().describe("Dominio de la empresa, si el cliente lo tiene. Sube la confianza del match a 0.97-1.00."),
      })).min(1).max(MAX_ACCOUNTS_PER_CALL),
      terms: z.array(z.string()).max(20).optional().describe("Tecnologías o procesos a buscar en cada cuenta. Si lo omitís, solo se reconcilia la lista contra el catálogo."),
      countries: z.array(z.string()).max(20).optional().describe("Acota los candidatos a estos países. MUY recomendado cuando la lista es de un país: es lo que evita que un homónimo argentino se lleve la fila de una empresa chilena."),
      minSignals: z.number().int().min(1).max(50).default(2).describe("Debajo de este número la fila se marca signalStrength=\"weak\"."),
      matchThreshold: z.number().min(0.3).max(1).default(0.75).describe("Confianza mínima para dar un match por resuelto. Debajo, la fila sale matched_ambiguous."),
      maxCandidates: z.number().int().min(1).max(10).default(5).describe("Cuántos candidatos devolver en las filas ambiguas."),
    },
    async (args, extra) => safely(async () => {
      const auth = authOf(extra)
      await requirePaidMcp(auth, "companies:read", "read")
      return screenAccountList({ accounts: args.accounts.map((a) => ({ name: a.name, domain: a.domain })), terms: args.terms, countries: args.countries, minSignals: args.minSignals, matchThreshold: args.matchThreshold, maxCandidates: args.maxCandidates })
    }),
  )
  server.tool("get_company_profile", "Identidad, datos firmográficos y cobertura global de señales de una empresa. Solo lectura. Devuelve siempre un bloque `firmographics` con linkedinUrl, domain, employeesApollo (dotación según Apollo), isPublic, ticker y stockExchange. IMPORTANTE: employeesApollo en null significa que NO tenemos el dato —la cobertura es baja—, no que la empresa sea chica; decilo así en vez de estimar. Usala cuando el usuario pregunte quién es la empresa, de qué tamaño es, si cotiza o cuál es su LinkedIn.", { companyId: z.string().uuid() }, async ({ companyId }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "companies:read", "read"); return getCompanyProfile(companyId) }))
  server.tool("get_company_signals", "Obtiene señales v2 normalizadas para un companyId exacto. Solo lectura y sin generación implícita.", { companyId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(50) }, async ({ companyId, limit }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "signals:read", "read"); return getCompanySignals(companyId, limit) }))
  server.tool("get_company_signal_summary", "Resume evidencia v2 de una empresa consolidando aliases relacionados: señales tecnológicas y de procesos, implementaciones y vacantes. Cada evidencia conserva su entidad de origen; las vacantes sin señales vinculadas son indicios, no confirmaciones. Usá esta tool cuando el usuario pregunte qué tecnologías, procesos o señales tenemos de una empresa.\n\nELEGÍ BIEN EL `detail`:\n• \"compact\" (default) — [{label, type, count, countOwn, lastSeen}] por término, más conteos, SIN fragmentos. Para VALIDAR VARIAS CUENTAS de una búsqueda.\n• \"evidence\" — la CITA TEXTUAL de UN término (pasá `term`): hasta 2 fragmentos con fecha, link, de qué persona se infiere y si sigue en la empresa. <600 tokens por cuenta. NO necesita research previo ni que la cuenta esté guardada. Es la que tenés que usar para armar un icebreaker que nombre la evidencia sobre varias cuentas: 42 cuentas entran en ~25k tokens.\n• \"full\" — todo: hasta 3 fragmentos por término, implementaciones completas y 30 vacantes con descripción. Son varios miles de tokens (medido: ~15.000 en una sola cuenta). Pedila para UNA cuenta que ya decidiste mirar en serio, NUNCA para recorrer una lista.\n\nALIAS: el catálogo tiene entidades homónimas (plantas, filiales, UTEs, empresas sin relación con el mismo nombre). `aliasStrategy` decide cuánto consolidar y el default es \"strict\" a propósito. `signalsOwn` es lo que tiene la entidad que preguntaste y `signalsConsolidated` incluye los homónimos: si difieren, decilo antes de darle el número a un cliente. Si sospechás que la cuenta está fragmentada en varias entidades, repetí con \"balanced\" o \"broad\" y revisá `aliasResolution.consolidatedEntities`.", { companyId: z.string().uuid(), detail: z.enum(["compact", "evidence", "full"]).default("compact").describe("\"compact\" para revisar varias cuentas; \"evidence\" para la cita textual de un término; \"full\" solo para una cuenta que vas a trabajar."), term: z.string().optional().describe("Solo para detail=\"evidence\": el término del que querés la cita. Sin él se devuelven los 3 términos con más señales, con 1 fragmento cada uno."), aliasStrategy: z.enum(["strict", "balanced", "broad"]).default("strict").describe("Cuánto consolidar entidades homónimas. strict (default) no consolida un nombre de un solo token sin dominio en común ni cruza países.") }, async ({ companyId, detail, term, aliasStrategy }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "signals:read", "read"); return getCompanySignalSummary(companyId, detail, { term, aliasStrategy }) }))
  server.tool("get_account_evidence_detail", "Profundiza en UN término del panorama (una tecnología o un proceso) y devuelve sus fuentes con el fragmento de texto exacto, la fecha y el link. Cuando la señal sale del perfil de una persona incluye su LinkedIn para que el vendedor pueda verificar de quién se está infiriendo, y aclara si es empleado actual o ex-empleado.\n\n`source` dice de dónde salió lo que estás leyendo:\n• \"workspace_snapshot\" — evidencia ya clasificada y puntuada por el research de este workspace.\n• \"global_signals\" — evidencia CRUDA del catálogo global. Es lo que devuelve cuando la cuenta no está guardada o todavía no tiene research: no falla ni te pide guardar nada, porque el dato está igual. Guardar la cuenta y correr research solo hace falta para la versión clasificada.\n\nNo consume cuota en ningún caso. Si vas a recorrer varias cuentas, get_company_signal_summary con detail=\"evidence\" es más compacta", { companyId: z.string().uuid(), term: z.string().min(2).max(120).optional(), termIds: z.array(z.string().uuid()).max(10).optional() }, async ({ companyId, term, termIds }, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "signals:read", "read"); return getAccountEvidenceDetailTool(auth, { companyId, term, termIds }) }))
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
    if (rejected.length) {
      // No todo rechazo es falta de cupo. Una cuenta EN SEGUIMIENTO se rechaza porque
      // ya se refresca sola (viene con nextAutoRefreshDate), y devolverla como
      // PLAN_QUOTA_EXCEEDED hacía que el modelo le dijera al usuario "te quedaste sin
      // cuota" teniendo 10/30 disponibles. Se separan los dos casos.
      const soloAutoRefresh = rejected.every((item) => item.nextAutoRefreshDate)
      const code = soloAutoRefresh ? "ACCOUNT_AUTO_REFRESHED" : "PLAN_QUOTA_EXCEEDED"
      throw new Error(`${code}:${rejected.map((item) => item.reason).join(" | ")}`)
    }
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
  server.tool("scrape_company_job_postings", "Trae vacantes frescas de LinkedIn para una cuenta guardada y las ingesta por el pipeline de importación de ASCI, que las normaliza y deduplica. El filtro por empresa se aplica en el buscador usando el nombre y el país que ya tenemos guardados de la cuenta, así que no hace falta pasarlos. Consume cuota de research server-managed porque el scraping corre con recursos de ASCI. Dos cosas a tener en cuenta: (1) `titleQuery` es OPCIONAL y sirve para acotar por título de puesto DENTRO de la empresa (por ejemplo 'SAP'); si lo omitís se traen todas las vacantes de la empresa, que es lo habitual. (2) La ventana sólo puede ser 1, 7 o 30 días; si pedís más, se busca sin límite de fecha y se te avisa. ESTA es la forma de averiguar qué posiciones abiertas tiene una cuenta: no busques vacantes en la web, porque los resultados web no entran al pipeline de ASCI y no se pueden atribuir a la cuenta. Devuelve `preview` con las vacantes ya filtradas (título, ubicación y URL) para que puedas responder en el mismo turno; la ingesta normalizada es asincrónica y se completa después.", { companyId: z.string().uuid(), titleQuery: z.string().min(2).max(120).optional(), location: z.string().min(2).max(120).optional(), windowDays: z.number().int().min(1).max(365).optional(), maxRows: z.number().int().min(1).max(200).optional(), idempotencyKey: z.string().min(8).max(200) }, async ({ companyId, titleQuery, location, windowDays, maxRows, idempotencyKey }, extra) => safely(async () => {
    const auth = authOf(extra); await requirePaidMcp(auth, "research:run", "server_managed")
    // Preflight de configuración ANTES del guard de cuenta guardada y de reservar
    // cuota. Si el token no está, esto falla en microsegundos y sin efectos
    // colaterales; si se dejara para el final, el usuario ya habría ocupado un
    // lugar de su plan guardando la cuenta para una capacidad inejecutable.
    if (!isApifyConfigured()) throw new Error("APIFY_TOKEN_MISSING")
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
      const { data: company } = await admin.from("companies").select("name,linkedin_url,country,linkedin_company_id").eq("id", companyId).maybeSingle()
      if (!company) throw new Error("COMPANY_NOT_FOUND")
      const run = await runLinkedinJobsActor({
        companyNames: companyNameVariants(company.name, company.linkedin_url),
        // Con ID guardado (Fase 3) el filtro es exacto; sin ID, el run por
        // nombre lo aprende en la ingesta y el próximo ya entra por acá.
        linkedinCompanyId: company.linkedin_company_id ?? null,
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
        // `preview` ya viene de la ingesta y son las vacantes ACEPTADAS (pasaron
        // el filtro de pertenencia). Se expone para poder contestar "qué
        // posiciones hay" en este mismo turno, sin esperar al importador.
        note: ingest.batchId
          ? `Las vacantes quedaron en cola. En \`preview\` tenés ${ingest.preview.length} de las ${ingest.queued} encoladas (título, ubicación y URL) para responderle al usuario YA, sin esperar. Si necesitás el listado completo y normalizado, consultá get_company_signal_summary en unos minutos.`
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
  server.tool(
    "estimate_batch",
    "Cotiza UN LOTE de cuentas ANTES de ejecutarlo y devuelve un único `batchPlanHash`. Es la tool para \"voy a investigar estas 42 cuentas y buscar sus CIO: ¿cuánto me cuesta?\".\n\nNO GASTA NADA: no reserva cupo, no reserva créditos, no llama a ningún modelo. Solo mide.\n\nUSALA EN VEZ DE: pedir prepare_contact_enrichment cuenta por cuenta para descubrir el presupuesto (42 previews para una sola decisión), o lanzar el lote y ver qué pasa.\n\nDEVUELVE LOS CUATRO MEDIDORES JUNTOS, que es lo que no existía en ningún lado: lugares del plan, unidades de research, créditos de Apollo y costo estimado en dólares.\n\nMOSTRALE AL USUARIO los cuatro números y pedile UNA confirmación para el lote entero. Ese es el punto de la tool: reemplazar 42 confirmaciones por una.\n\nSi `estimatedCostUsd.research` viene en null es porque no hay telemetría suficiente. Decilo así: NO inventes un número. Si `executable` es false, `blockers` explica por qué el lote no entra como está.\n\nEl hash vence en 1 hora y queda ligado a ESTAS cuentas y estos roles.",
    {
      operation: z.enum(["research", "enrichment", "research+enrichment"]).describe("Qué se va a hacer con el lote. Define qué medidores se cotizan."),
      companyIds: z.array(z.string().uuid()).min(1).max(MAX_ACCOUNTS_PER_BATCH).describe("Los companyId (UUID) del lote. Los que devolvió screen_account_list."),
      roles: z.array(z.string().min(2).max(120)).max(25).optional().describe("Cargos a buscar en Apollo. Solo para las operaciones que incluyen enrichment."),
      maxContactsPerAccount: z.number().int().min(1).max(50).optional().describe("Contactos por cuenta. Se recorta al máximo del plan."),
    },
    async (args, extra) => safely(async () => {
      const auth = authOf(extra)
      await requirePaidMcp(auth, "usage:read", "read")
      return estimateBatch(auth, args)
    }),
  )
  server.tool("get_ai_usage", "Devuelve los TRES medidores mensuales del workspace: monthlyServerResearch (research con tokens de ASCI), monthlyClientResearch (research con tus tokens, que igual ocupa cupo del plan) y monthlyApolloCredits (créditos de contactos, 1 crédito = 1 contacto). Suma tokens y costo verificado del AI Gateway. Son independientes entre sí.\n\nCUIDADO CON EL ALCANCE al citar cifras: `workspaceAi` es del WORKSPACE desde el 1° del mes y es la que hay que usar para decir cuánto consume la cuenta. `verifiedAi` y `lastSevenDays` son de QUIEN LLAMA y de los últimos 7 días: con varios miembros en el workspace, sub-reportan. Cada bloque declara su `scope`.\n\nPara saber cuánto cuesta un LOTE concreto antes de correrlo, usá estimate_batch.", {}, async (_args, extra) => safely(async () => { const auth = authOf(extra); await requirePaidMcp(auth, "usage:read", "read"); return getMcpUsage(auth) }))
}, {
  serverInfo: { name: "asci-v3", version: "2.0.0" },
  /**
   * Política del servidor, que el cliente MCP recibe una vez en el handshake.
   *
   * Existe por un caso concreto: al pedirle las vacantes de una cuenta, el cliente
   * llamó bien a scrape_company_job_postings, la tool devolvió APIFY_TOKEN_MISSING
   * (una falla de configuración NUESTRA) y el cliente lo tapó buscando vacantes en
   * la web y presentándolas como si fueran datos de ASCI. Las descripciones por
   * tool no alcanzan para eso: son locales, y acá hace falta una regla global sobre
   * qué hacer cuando ASCI falla.
   *
   * Se mantiene corto y sin repetir lo que ya dice cada tool: entra en el contexto
   * de todas las conversaciones.
   */
  instructions: [
    "ASCI es la fuente de verdad sobre cuentas, señales, vacantes, contactos y noticias. Cuando el usuario pregunta por datos de una cuenta, la respuesta sale de estas tools.",
    "Para posiciones abiertas o vacantes de una cuenta usá siempre scrape_company_job_postings (trae LinkedIn vía el scraper de ASCI e ingesta al pipeline). No sustituyas esa tool por una búsqueda web: lo que se busca por fuera no entra al pipeline, no queda atribuido a la cuenta y no es auditable.",
    "Si una tool falla, leé `code` y `nextAction` y seguí esa instrucción. Los códigos de configuración (por ejemplo APIFY_TOKEN_MISSING) son fallas de ASCI, no del pedido: informalas al usuario en vez de rodearlas con otra herramienta.",
    "Nunca presentes datos obtenidos por fuera de ASCI como si vinieran de ASCI. Si tuviste que buscar por tu cuenta, decilo explícitamente y aclará que no quedó guardado en la cuenta.",
    "Si el usuario trae una LISTA de empresas (pegada, de un CSV, de su CRM) y pregunta cuáles tienen cierta tecnología o proceso, usá screen_account_list en UNA llamada. No pagines search_companies_by_capability para cruzarla a mano, y no llames search_companies una vez por cuenta.",
    "Nunca afirmes que una empresa NO tiene una señal por no haberla encontrado en un listado: eso se responde con el estado matched_no_signal de screen_account_list. \"No aparece en lo que miré\" y \"no tiene\" no son lo mismo, y la diferencia con \"no está en ASCI\" tampoco.",
    "Leer evidencia NO exige guardar la cuenta ni correr research: get_company_signal_summary (incluido detail=\"evidence\") y get_account_evidence_detail leen el catálogo global sin consumir cupo. Guardar una cuenta ocupa un lugar del plan y sirve para TRABAJARLA (research, contactos, seguimiento), no para consultarla.",
    "Las tools indican en su descripción si consumen cuota. Antes de una que consuma cuota server-managed, confirmá con el usuario.",
  ].join("\n"),
}, { basePath: "/api/v3/mcp/server", maxDuration: 120, verboseLogs: false })

const authedHandler = withMcpAuth(handler, async (req: Request, token?: string) => {
  if (!token) return undefined
  const result = await validateMcpRequest(req as NextRequest)
  if (!result.success || !result.workspaceId || !result.userId || !result.keyId || !result.keyType) return undefined
  // `keyType` viene de validateMcpRequest y hay que propagarlo: es lo que decide
  // si keyId se escribe en api_key_id o en oauth_token_id.
  const principal: McpPrincipal = { workspaceId: result.workspaceId, userId: result.userId, keyId: result.keyId, keyType: result.keyType, scopes: result.scopes ?? [], allowedModes: result.allowedModes ?? ["read"] }
  // Fila de TRANSPORTE (queda con `tool_name` null a propósito): es el ticket que cuenta
  // el rate limiter, y por eso se escribe acá, antes de ejecutar. No describe la tool —de
  // eso se encarga `auditToolCall`—, así que no se le pone status ni duración reales.
  await logMcpRequest({ principal, method: req.method, statusCode: 200, requestId: crypto.randomUUID(), metadata: { phase: "transport" } })
  return { token, clientId: result.keyId, scopes: principal.scopes, extra: principal as unknown as Record<string, unknown> }
}, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
