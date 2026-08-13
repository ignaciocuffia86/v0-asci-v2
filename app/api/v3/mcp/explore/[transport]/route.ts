import crypto from "crypto"
import { after } from "next/server"
import { NextRequest } from "next/server"
import { createMcpHandler, withMcpAuth } from "mcp-handler"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { validateMcpRequest, logMcpRequest } from "@/lib/v3/mcp-auth"
import { requirePaidMcp, reserveMcpUsage, setReservationStatus, type McpPrincipal } from "@/lib/v3/mcp-usage"
import { guardSavedAccounts, saveAccount } from "@/lib/v3/mcp-account-lifecycle"
import { prepareContactEnrichment, runContactEnrichment } from "@/lib/v3/services/mcp-contact-enrichment"
import { runLinkedinJobsActor, companyNameVariants, isApifyConfigured } from "@/lib/v3/services/apify-client"
import { ingestApifyJobPostings } from "@/lib/v3/services/apify-job-ingest"
import {
  prepareTerms,
  createExploreSession,
  getExploreSession,
  updateExploreSession,
  geoFacets,
  industryFacets,
  searchCompanies,
  companyPeople,
  type ExploreSource,
  type PreparedTerms,
} from "@/lib/v3/explore/mcp-explore"

/**
 * MCP Explore: servidor PARALELO al MCP actual (/api/v3/mcp/server), para A/B.
 *
 * Conversa directamente con la tabla CRUDA de contactos + vacantes, sin el
 * diccionario de senales. Comparte auth, rate limit y telemetria
 * (v3.mcp_request_logs) con el MCP actual, pero usa su propio scope `explore:read`
 * y su propia API key, asi que se puede medir cual embudo resuelve en menos
 * llamadas mirando el prefijo `explore_` de tool_name.
 */

export const maxDuration = 120

type AuthInfo = { token: string; clientId: string; scopes: string[]; extra: McpPrincipal }
const authOf = (extra: unknown) => {
  const auth = (extra as { authInfo?: AuthInfo }).authInfo?.extra
  if (!auth) throw new Error("UNAUTHORIZED")
  return auth
}
const text = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
})

/** Proximo paso por codigo de error: sin esto el modelo improvisa. */
const NEXT_ACTION_BY_CODE: Record<string, string> = {
  TERMS_REQUIRED: "Pedile al usuario la tecnología o proceso y expandilo a una nube de términos (SAP -> SAP, S/4HANA, ABAP, Fiori, SuccessFactors...). Mandá esa lista en `terms`.",
  SESSION_NOT_FOUND: "La sesión venció o es de otro workspace. Volvé a empezar con explore_start; no reintentes con el mismo sessionId.",
  UNAUTHORIZED: "La API key no es válida o le falta el scope explore:read. No reintentes: avisale al usuario que revise su credencial de Explore.",
  SCOPE_REQUIRED: "La API key de Explore no tiene el permiso para esta operación. Avisale al usuario que regenere la key con el scope faltante.",
  RATE_LIMITED: "Límite temporal de frecuencia. Esperá ~1 minuto y reintentá la misma llamada.",
  APIFY_TOKEN_MISSING: "Es una falla de CONFIGURACIÓN de ASCI (falta APIFY_TOKEN), no del pedido. No se consumió cuota. NO busques las vacantes en la web: no entran al pipeline de ASCI. Avisale al usuario que el scraping está sin configurar.",
  COMPANY_NOT_FOUND: "El companyId no existe. Usá explore_companies para obtener el UUID correcto.",
  ACCOUNT_NOT_SAVED: "La cuenta no está guardada. Estas tools la guardan solas al confirmar (userConfirmed: true); si falla, revisá el cupo de cuentas del plan.",
  PLAN_QUOTA_EXCEEDED: "Se agotó el cupo del plan para esta operación paga. Avisale al usuario.",
  PLAN_REQUIRED: "El plan actual (trial) no permite acciones pagas por MCP. Avisale al usuario.",
}
const NEXT_ACTION_BY_PREFIX: [string, string][] = [
  ["APIFY_RUN_", "El scraping de LinkedIn falló o no trajo resultados del proveedor. La cuota se liberó. Podés reintentar una vez con una ventana más corta; no busques las vacantes en la web."],
  ["APIFY_INGEST_", "El scraping funcionó pero la ingesta al pipeline falló: las vacantes NO quedaron guardadas. La cuota se liberó. No las presentes como guardadas."],
]
function nextActionFor(code: string): string | undefined {
  if (NEXT_ACTION_BY_CODE[code]) return NEXT_ACTION_BY_CODE[code]
  return NEXT_ACTION_BY_PREFIX.find(([prefix]) => code.startsWith(prefix))?.[1]
}

/** Envelope uniforme de error, mismo patrón que el MCP actual. */
const safely = async (work: () => Promise<unknown>) => {
  try {
    return text(await work())
  } catch (error) {
    const raw = error instanceof Error ? error.message : "UNKNOWN_ERROR"
    const structuredCode =
      error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : null
    const separator = raw.indexOf(":")
    const candidate = separator > 0 ? raw.slice(0, separator) : raw
    const CODE_PATTERN = /^[A-Z][A-Z0-9_-]*$/
    const messageHasCode = CODE_PATTERN.test(candidate)
    const code = structuredCode && CODE_PATTERN.test(structuredCode) ? structuredCode : messageHasCode ? candidate : "UNKNOWN_ERROR"
    const detail = !structuredCode && messageHasCode ? raw.slice(separator + 1).trim() : raw
    return text(
      { success: false, code, message: detail || code, ...(nextActionFor(code) ? { nextAction: nextActionFor(code) } : {}), error: raw },
      true
    )
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  RATE_LIMITED: 429,
  UNAUTHORIZED: 401,
  SCOPE_REQUIRED: 403,
  PLAN_REQUIRED: 402,
  PLAN_QUOTA_EXCEEDED: 402,
  ACCOUNT_NOT_SAVED: 409,
}

/** Auditoría por tool, para el A/B: cada llamada queda con su tool_name y duración. */
const auditToolCall = async (input: { toolName: string; extra: unknown; result?: unknown; thrown?: unknown; startedAt: number }) => {
  const principal = (input.extra as { authInfo?: { extra?: McpPrincipal } } | undefined)?.authInfo?.extra
  if (!principal) return
  const payload = input.result as { content?: { text?: string }[]; isError?: boolean } | undefined
  const failed = Boolean(input.thrown) || Boolean(payload?.isError)
  let errorCode: string | undefined
  if (failed) {
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
    mode: principal.effectiveMode ?? "read",
    errorCode,
    // Marca de servidor para separar el A/B en la telemetría.
    metadata: { server: "explore" },
  })
}

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
              after(() => auditToolCall({ toolName, extra, result, startedAt }))
              return result
            } catch (thrown) {
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

// -----------------------------------------------------------------------------
// Helpers de presentación: cada respuesta guía el próximo paso y los vacíos son
// accionables (nunca "0 rows" pelado). Las descripciones de las tools son la UX.
// -----------------------------------------------------------------------------

/** Resuelve los términos: de la sesión si viene sessionId, o del parámetro terms. */
async function resolveTerms(auth: McpPrincipal, args: { sessionId?: string; terms?: string[] }): Promise<{ prepared: PreparedTerms; concept: string | null }> {
  if (args.sessionId) {
    const session = await getExploreSession(auth, args.sessionId)
    return { prepared: prepareTerms(session.terms), concept: session.concept }
  }
  if (args.terms?.length) return { prepared: prepareTerms(args.terms), concept: args.terms[0] }
  throw new Error("TERMS_REQUIRED")
}

const handler = createMcpHandler(
  (rawServer) => {
    const server = withToolAudit(rawServer)

    // -------------------------------------------------------------------------
    // CAPA 1 — Concepto. El usuario dice una tecnología/proceso; el modelo la
    // expande a una nube de términos y arranca el embudo.
    // -------------------------------------------------------------------------
    server.tool(
      "explore_start",
      "Inicia una exploración conversacional sobre la base CRUDA de contactos y vacantes de ASCI, SIN diccionario de señales. Paso 1 del embudo. Pasá en `terms` la NUBE DE TÉRMINOS ya expandida por vos: si el usuario pide 'SAP', mandá ['SAP','S/4HANA','ABAP','Fiori','SuccessFactors','Ariba','HANA'] — vos aportás el vocabulario, no un diccionario fijo. El servidor busca esos términos como palabra completa en el texto libre (headline, about, cargo y descripción del puesto), así que 'SAP' no matchea 'WhatsApp'. Devuelve un sessionId y el PRIMER CORTE: en qué países aparece el concepto, con conteos. Mostrale los países al usuario y preguntale por cuál seguir; después llamá explore_set_country. `sources` controla dónde buscar: 'contacts' (gente que SABE de la tecnología) y/o 'jobs' (empresas que la BUSCAN en vacantes); por defecto las dos.",
      {
        concept: z.string().min(2).max(120).describe("El término tal como lo pidió el usuario, para mostrarlo (ej 'SAP')."),
        terms: z.array(z.string().min(2).max(120)).min(1).max(25).describe("Nube de términos expandida por vos. Incluí sinónimos, productos y siglas relacionadas."),
        sources: z.array(z.enum(["contacts", "jobs"])).min(1).max(2).optional(),
      },
      async ({ concept, terms, sources }, extra) =>
        safely(async () => {
          const auth = authOf(extra)
          await requirePaidMcp(auth, "explore:read", "read")
          const prepared = prepareTerms(terms)
          const resolvedSources = (sources ?? ["contacts", "jobs"]) as ExploreSource[]
          const session = await createExploreSession(auth, { concept, terms: prepared.raw, sources: resolvedSources })
          const facets = await geoFacets(prepared)
          const totalPeople = facets.reduce((sum, f) => sum + f.personMatches, 0)
          return {
            sessionId: session.id,
            concept,
            searchedTerms: prepared.raw,
            sources: resolvedSources,
            countries: facets,
            summary:
              facets.length === 0
                ? `No se encontró a nadie que mencione ${prepared.raw.join(", ")} en el texto libre. Probá otros términos o revisá la ortografía.`
                : `${prepared.raw.join(", ")} aparece en ${totalPeople} personas de ${facets.length} países.`,
            nextStep:
              facets.length === 0
                ? "Sin resultados: ampliá o cambiá la nube de términos y volvé a llamar explore_start."
                : "Mostrale los países al usuario, preguntale por cuál seguir, y llamá explore_set_country con el nombre EXACTO del país (ej 'Argentina').",
          }
        })
    )

    // -------------------------------------------------------------------------
    // CAPA 2 — Corte por país. Devuelve las industrias disponibles para el
    // concepto ya recortado por país.
    // -------------------------------------------------------------------------
    server.tool(
      "explore_set_country",
      "Paso 2 del embudo: fija el país elegido y devuelve el SIGUIENTE CORTE: qué industrias tienen personas con el concepto en ese país. Las industrias vienen de la taxonomía normalizada de ASCI (28 categorías, en español). OJO: solo ~12% de las empresas están clasificadas por industria; la respuesta incluye una fila 'Sin clasificar' con cuántas quedarían fuera si filtrás por industria. Mostrale las industrias al usuario y pedile que elija HASTA 3 (o que las saltee); después llamá explore_set_industries. El país filtra por dónde vive la PERSONA (country_normalized), que es lo indexado y rápido.",
      {
        sessionId: z.string().uuid(),
        country: z.string().min(2).max(80).describe("Nombre exacto del país como lo devolvió explore_start (ej 'Argentina')."),
      },
      async ({ sessionId, country }, extra) =>
        safely(async () => {
          const auth = authOf(extra)
          await requirePaidMcp(auth, "explore:read", "read")
          const session = await updateExploreSession(auth, sessionId, { country })
          const prepared = prepareTerms(session.terms)
          const facets = await industryFacets(prepared, country)
          const classified = facets.filter((f) => f.masterIndustryId)
          const unclassified = facets.find((f) => !f.masterIndustryId)
          return {
            sessionId,
            country,
            industries: classified.map((f) => ({ id: f.masterIndustryId, name: f.nameEs ?? f.nameEn, personMatches: f.personMatches })),
            unclassified: unclassified ? { personMatches: unclassified.personMatches, note: "Personas en empresas SIN industria clasificada. Se incluyen por defecto (includeUnclassified) para no perderlas." } : null,
            nextStep:
              classified.length === 0
                ? "No hay industrias clasificadas con este corte. Llamá explore_set_industries con industryIds vacío para ver el ranking de empresas directamente."
                : "Mostrale las industrias al usuario y pedile HASTA 3 (o ninguna). Llamá explore_set_industries con los ids elegidos; si elige ninguna, mandá industryIds: [].",
          }
        })
    )

    // -------------------------------------------------------------------------
    // CAPA 3 — Corte por industria → RESULTADO: ranking de empresas.
    // -------------------------------------------------------------------------
    server.tool(
      "explore_set_industries",
      "Paso 3 del embudo: fija hasta 3 industrias (o ninguna) y devuelve el RESULTADO: el ranking de empresas que matchean el concepto, con cuántas PERSONAS lo saben y cuántas VACANTES lo piden (cada número marca su origen). `includeUnclassified` (default true) suma las empresas sin industria clasificada; ponelo en false para un corte estricto solo de las clasificadas, sabiendo que dejás fuera la mayoría. Cada empresa trae su companyId (UUID). Próximos pasos por empresa: explore_company_people (quiénes saben, con evidencia), explore_scrape_jobs (traer vacantes frescas de LinkedIn, consume cuota) y explore_prepare_decision_makers (buscar tomadores de decisión en Apollo, consume créditos).",
      {
        sessionId: z.string().uuid(),
        industryIds: z.array(z.string().min(1).max(80)).max(3).describe("Ids de master_industries devueltos por explore_set_country. Vacío = sin corte de industria."),
        includeUnclassified: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).default(25),
      },
      async ({ sessionId, industryIds, includeUnclassified, limit }, extra) =>
        safely(async () => {
          const auth = authOf(extra)
          await requirePaidMcp(auth, "explore:read", "read")
          const session = await updateExploreSession(auth, sessionId, {
            industryIds,
            ...(includeUnclassified === undefined ? {} : { includeUnclassified }),
          })
          const prepared = prepareTerms(session.terms)
          const companies = await searchCompanies(
            prepared,
            { country: session.country, industryIds: session.industryIds, includeUnclassified: session.includeUnclassified, sources: session.sources },
            limit
          )
          return {
            sessionId,
            filters: { concept: session.concept, terms: prepared.raw, country: session.country, industryIds: session.industryIds, includeUnclassified: session.includeUnclassified, sources: session.sources },
            companies,
            summary:
              companies.length === 0
                ? "Ninguna empresa matchea con estos cortes. Aflojá un filtro: quitá el país o las industrias, o poné includeUnclassified: true."
                : `${companies.length} empresas. 'personMatches' = personas que saben; 'jobMatches' = vacantes que lo piden.`,
            nextStep:
              companies.length === 0
                ? "Sin resultados: relajá los filtros (país/industria) y volvé a llamar explore_set_industries o explore_companies."
                : "Elegí una empresa y usá explore_company_people para ver quiénes saben (con evidencia), explore_scrape_jobs para vacantes frescas, o explore_prepare_decision_makers para tomadores de decisión.",
          }
        })
    )

    // -------------------------------------------------------------------------
    // Ranking flexible (stateless): permite re-consultar con overrides sin sesión.
    // -------------------------------------------------------------------------
    server.tool(
      "explore_companies",
      "Ranking de empresas por concepto, con filtros explícitos y SIN necesitar sesión (para re-consultas o ajustes rápidos). Pasá `terms` (nube expandida) y opcionalmente country, industryIds, includeUnclassified y sources. Devuelve lo mismo que explore_set_industries: empresas con personMatches (gente que sabe) y jobMatches (vacantes que lo piden). Usá explore_start si preferís el embudo guiado paso a paso.",
      {
        terms: z.array(z.string().min(2).max(120)).min(1).max(25),
        country: z.string().min(2).max(80).optional(),
        industryIds: z.array(z.string().min(1).max(80)).max(3).optional(),
        includeUnclassified: z.boolean().default(true),
        sources: z.array(z.enum(["contacts", "jobs"])).min(1).max(2).optional(),
        limit: z.number().int().min(1).max(50).default(25),
      },
      async ({ terms, country, industryIds, includeUnclassified, sources, limit }, extra) =>
        safely(async () => {
          const auth = authOf(extra)
          await requirePaidMcp(auth, "explore:read", "read")
          const prepared = prepareTerms(terms)
          const companies = await searchCompanies(
            prepared,
            { country: country ?? null, industryIds: industryIds ?? [], includeUnclassified, sources: (sources ?? ["contacts", "jobs"]) as ExploreSource[] },
            limit
          )
          return {
            searchedTerms: prepared.raw,
            companies,
            summary: companies.length === 0 ? "Sin empresas para estos filtros; aflojá país o industria." : `${companies.length} empresas (personMatches = saben, jobMatches = buscan).`,
            nextStep: companies.length === 0 ? "Relajá los filtros y reintentá." : "Usá explore_company_people(companyId) para ver quiénes saben con evidencia.",
          }
        })
    )

    // -------------------------------------------------------------------------
    // DETALLE — Personas de una empresa que matchean, con evidencia + PII cruda.
    // -------------------------------------------------------------------------
    server.tool(
      "explore_company_people",
      "Detalle bajo demanda: las personas de UNA empresa que mencionan el concepto en su texto libre, con la EVIDENCIA (qué término matcheó cada una) y sus datos de contacto crudos ya cargados (email y teléfono del CSV, si existen). Es la tabla 'quién sabe de esto acá dentro'. Pasá el companyId del ranking y la nube de términos (o el sessionId para reusar la de la sesión). matchedTerms explica por qué entró cada persona (auditable, sin diccionario). Para tomadores de decisión que NO están en la base, usá explore_prepare_decision_makers (Apollo).",
      {
        companyId: z.string().uuid(),
        sessionId: z.string().uuid().optional().describe("Reusa los términos de la sesión. Si no lo pasás, mandá `terms`."),
        terms: z.array(z.string().min(2).max(120)).min(1).max(25).optional(),
        limit: z.number().int().min(1).max(50).default(25),
      },
      async ({ companyId, sessionId, terms, limit }, extra) =>
        safely(async () => {
          const auth = authOf(extra)
          await requirePaidMcp(auth, "explore:read", "read")
          const { prepared } = await resolveTerms(auth, { sessionId, terms })
          const people = await companyPeople(prepared, companyId, limit)
          return {
            companyId,
            searchedTerms: prepared.raw,
            people,
            summary:
              people.length === 0
                ? "Nadie de esta empresa menciona el concepto en su texto. Probá explore_scrape_jobs (vacantes) o explore_prepare_decision_makers (Apollo)."
                : `${people.length} personas. matchedTerms muestra qué término disparó cada una; email1/phone1 son los datos crudos del CSV (pueden estar vacíos).`,
            nextStep: "Para sumar tomadores de decisión que no están en la base, proponé cargos con el usuario y llamá explore_prepare_decision_makers.",
          }
        })
    )

    // -------------------------------------------------------------------------
    // CAPA PAGA A — Vacantes frescas (Apify). Reusa el pipeline de ingesta que
    // PERSISTE en public.job_postings con guardrail de pertenencia. Guardado
    // implícito de la cuenta al confirmar.
    // -------------------------------------------------------------------------
    server.tool(
      "explore_scrape_jobs",
      "Trae vacantes FRESCAS de LinkedIn de una empresa vía Apify y las PERSISTE en la base de ASCI (deduplicadas por URL, con guardrail de pertenencia: descarta vacantes de otras empresas). CONSUME CUOTA de research server-managed. Requiere confirmación explícita del usuario (userConfirmed: true) porque gasta cuota. Al confirmar, guarda la cuenta en el workspace automáticamente (ocupa un lugar del plan). `titleQuery` es opcional para acotar por título dentro de la empresa (ej 'SAP'). La ventana solo puede ser 1, 7 o 30 días. Devuelve un preview de las vacantes aceptadas para responder en el mismo turno; la ingesta normalizada termina asincrónica. Estas vacantes quedan como nueva señal buscable por explore_companies con sources incluyendo 'jobs'.",
      {
        companyId: z.string().uuid(),
        titleQuery: z.string().min(2).max(120).optional(),
        windowDays: z.number().int().min(1).max(365).optional(),
        maxRows: z.number().int().min(1).max(200).optional(),
        userConfirmed: z.literal(true),
        idempotencyKey: z.string().min(8).max(200),
      },
      async ({ companyId, titleQuery, windowDays, maxRows, idempotencyKey }, extra) =>
        safely(async () => {
          const auth = authOf(extra)
          await requirePaidMcp(auth, "research:run", "server_managed")
          if (!isApifyConfigured()) throw new Error("APIFY_TOKEN_MISSING")
          // Guardado implícito: si la cuenta no está guardada, se guarda ahora.
          const blocked = await guardSavedAccounts(auth, [companyId])
          if (blocked) await saveAccount(auth, { companyId, userConfirmed: true })
          const reservation = await reserveMcpUsage({ principal: auth, pool: "research_server", units: 1, idempotencyKey, metadata: { companyId, titleQuery: titleQuery ?? null, server: "explore" } })
          if (!reservation.allowed || !reservation.reservationId) return reservation
          if (reservation.idempotent && reservation.status === "committed" && reservation.metadata?.batchId) return { ...reservation.metadata, idempotent: true }
          try {
            const admin = createAdminClient()
            const { data: company } = await admin.from("companies").select("name,linkedin_url,country").eq("id", companyId).maybeSingle()
            if (!company) throw new Error("COMPANY_NOT_FOUND")
            const run = await runLinkedinJobsActor({
              companyNames: companyNameVariants(company.name, company.linkedin_url),
              location: company.country?.trim() || undefined,
              titleQuery: titleQuery ?? null,
              windowDays: windowDays ?? null,
              maxRows,
            })
            const ingest = await ingestApifyJobPostings({ companyId, userId: auth.userId, runId: run.runId, items: run.items })
            await setReservationStatus(reservation.reservationId, "committed", { batchId: ingest.batchId, queued: ingest.queued })
            return {
              ...ingest,
              appliedWindow: run.appliedWindow,
              warnings: run.truncatedWindow ? [...ingest.warnings, `LinkedIn solo permite ventanas de 1, 7 o 30 días: se buscó sin límite de fecha.`] : ingest.warnings,
              nextStep: ingest.batchId
                ? `Quedaron ${ingest.queued} vacantes en cola. En 'preview' tenés una muestra para responder ya. En unos minutos aparecen como señal 'jobs' en explore_companies.`
                : "No se encontraron vacantes de esta empresa con esa búsqueda.",
            }
          } catch (error) {
            await setReservationStatus(reservation.reservationId, "released")
            throw error
          }
        })
    )

    // -------------------------------------------------------------------------
    // CAPA PAGA B — Tomadores de decisión (Apollo). Cargos propuestos por el
    // modelo conversando con el usuario. Guardado implícito + prepare (sin gasto).
    // -------------------------------------------------------------------------
    server.tool(
      "explore_prepare_decision_makers",
      "Paso 1 de 2 para traer TOMADORES DE DECISIÓN de una empresa desde Apollo (personas que NO están en la base). NO gasta créditos: previsualiza. Los `roles` los proponés VOS conversando con el usuario según la tecnología y el contexto (ej para SAP en un banco: ['CIO','IT Director','Head of ERP','SAP Program Manager']); mostrale la lista y ajustala con él antes de llamar. Al confirmar (userConfirmed: true) guarda la cuenta en el workspace automáticamente. Devuelve un planHash, el costo en créditos y el máximo de contactos; mostráselos al usuario y confirmá antes de explore_run_decision_makers. Si la identidad de la empresa se resolvió por nombre (viene un warning), verificá con el usuario que es la correcta.",
      {
        companyId: z.string().uuid(),
        roles: z.array(z.string().min(2).max(120)).min(1).max(25),
        maxContacts: z.number().int().min(1).max(50).optional(),
        userConfirmed: z.literal(true),
        idempotencyKey: z.string().min(8).max(200).optional(),
      },
      async ({ companyId, roles, maxContacts, idempotencyKey }, extra) =>
        safely(async () => {
          const auth = authOf(extra)
          await requirePaidMcp(auth, "accounts:write", "read")
          const blocked = await guardSavedAccounts(auth, [companyId])
          if (blocked) await saveAccount(auth, { companyId, userConfirmed: true })
          const result = await prepareContactEnrichment(auth, { companyId, roles, maxContacts, idempotencyKey })
          return { ...(result as object), nextStep: "Mostrale al usuario el costo y el planHash; si confirma, llamá explore_run_decision_makers con ese planHash y userConfirmed: true." }
        })
    )

    server.tool(
      "explore_run_decision_makers",
      "Paso 2 de 2: ejecuta la búsqueda de tomadores de decisión en Apollo y GASTA CRÉDITOS del cupo mensual. Solo acepta un planHash de explore_prepare_decision_makers (congela cargos y máximo). Requiere confirmación explícita del usuario sobre el costo mostrado. Es idempotente: reejecutar el mismo planHash devuelve lo guardado sin volver a cobrar. Devuelve los contactos con nombre, cargo y EMAIL. IMPORTANTE sobre el teléfono: hoy Apollo se llama en modo solo-email; el teléfono NO se revela en esta versión (queda pendiente como paso confirmado aparte por su costo extra de créditos). Presentá el resultado en tabla: NOMBRE APELLIDO · CARGO · EMAIL, aclarando que el teléfono está pendiente.",
      {
        planHash: z.string().min(16).max(64),
        userConfirmed: z.literal(true),
      },
      async ({ planHash }, extra) =>
        safely(async () => {
          const auth = authOf(extra)
          const result = await runContactEnrichment(auth, { planHash })
          return {
            ...(result as object),
            phoneNote: "El teléfono no se reveló (Apollo se llamó en modo solo-email). Revelarlo es un paso aparte que consume créditos extra y todavía no está habilitado en Explore.",
            presentation: "Mostrá los contactos en tabla: NOMBRE APELLIDO · CARGO · EMAIL · TELÉFONO (teléfono = 'pendiente').",
          }
        })
    )
  },
  {
    serverInfo: { name: "asci-explore", version: "1.0.0" },
    instructions: [
      "MCP Explore conversa con la base CRUDA de contactos y vacantes de ASCI, sin el diccionario de señales. Es un embudo: explore_start (concepto -> países) -> explore_set_country (-> industrias) -> explore_set_industries (-> ranking de empresas) -> explore_company_people (evidencia) y capas pagas explore_scrape_jobs / explore_prepare_decision_makers.",
      "VOS aportás el vocabulario: cuando el usuario nombra una tecnología o proceso, expandilo a una nube de términos (sinónimos, productos, siglas) y pasala en `terms`. No hay diccionario fijo; la riqueza de la búsqueda depende de esa expansión. Mostrale la nube al usuario para que la ajuste.",
      "Seguí SIEMPRE el `nextStep` de cada respuesta y ofrecé al usuario las opciones. Los resultados vacíos indican cómo corregir el filtro: hacelo, no te quedes en 'no hay datos'.",
      "Las capas pagas (explore_scrape_jobs consume cuota; explore_prepare/run_decision_makers consumen créditos) solo se ejecutan tras confirmación explícita del usuario. Mostrá el costo antes.",
      "Nunca presentes datos obtenidos por fuera de ASCI como si vinieran de ASCI. Para vacantes usá explore_scrape_jobs, no búsquedas web.",
    ].join("\n"),
  },
  { basePath: "/api/v3/mcp/explore", maxDuration: 120, verboseLogs: false }
)

const authedHandler = withMcpAuth(
  handler,
  async (req: Request, token?: string) => {
    if (!token) return undefined
    const result = await validateMcpRequest(req as NextRequest)
    if (!result.success || !result.workspaceId || !result.userId || !result.keyId || !result.keyType) return undefined
    const principal: McpPrincipal = { workspaceId: result.workspaceId, userId: result.userId, keyId: result.keyId, keyType: result.keyType, scopes: result.scopes ?? [], allowedModes: result.allowedModes ?? ["read"] }
    // Fila de transporte (tool_name null): la cuenta el rate limiter. Se marca el
    // servidor en metadata para separar el A/B.
    await logMcpRequest({ principal, method: req.method, statusCode: 200, requestId: crypto.randomUUID(), metadata: { phase: "transport", server: "explore" } })
    return { token, clientId: result.keyId, scopes: principal.scopes, extra: principal as unknown as Record<string, unknown> }
  },
  // Metadata propia de Explore: publica su resource + solo sus scopes, para que el
  // consentimiento sepa que se está conectando Explore y pre-seleccione ese permiso.
  { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource/explore" }
)

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
