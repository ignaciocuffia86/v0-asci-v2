import crypto from "crypto"
import { after } from "next/server"
import { NextRequest } from "next/server"
import { createMcpHandler, withMcpAuth } from "mcp-handler"
import { z } from "zod"
import { validateMcpRequest, logMcpRequest } from "@/lib/v3/mcp-auth"
import { requirePaidMcp, type McpPrincipal } from "@/lib/v3/mcp-usage"
import {
  prepareTerms,
  geoFacets,
  industryFacets,
  searchPeople,
} from "@/lib/v3/profiles/mcp-profiles"

/**
 * MCP Perfiles: TERCER servidor MCP, persona-first, para busqueda de TALENTO.
 *
 * Los otros dos son empresa-first (MCP estandar sobre senales v2; MCP Explore
 * sobre la tabla cruda, "que empresas usan X"). Este invierte el eje: el usuario
 * busca PERSONAS por tecnologia/proceso + experiencia de industria (+ pais +
 * cargo) en la tabla cruda de contactos, y lo que necesita es el dato de contacto
 * PERSONAL (mail y telefono) para llegarle directo al perfil.
 *
 * Reusa la infraestructura del MCP Explore (prepareTerms + facetas de pais e
 * industria) y agrega la busqueda global de personas con contacto personal
 * resuelto (v3.profiles_search_people). Comparte auth, rate limit y telemetria
 * (v3.mcp_request_logs) con los otros dos, con su propio scope `profiles:read` y
 * su propia API key; el prefijo `profiles_` de tool_name separa su uso.
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
  TERMS_REQUIRED: "Pedile al usuario la tecnología/proceso/skill del perfil y expandilo a una nube de términos (SAP -> SAP, S/4HANA, ABAP, Fiori, SuccessFactors...). Mandá esa lista en `terms`.",
  UNAUTHORIZED: "La API key no es válida o le falta el scope profiles:read. No reintentes: avisale al usuario que revise su credencial de Perfiles.",
  SCOPE_REQUIRED: "La API key de Perfiles no tiene el permiso para esta operación. Avisale al usuario que regenere la key con el scope faltante (profiles:read).",
  RATE_LIMITED: "Límite temporal de frecuencia. Esperá ~1 minuto y reintentá la misma llamada.",
  TOO_MANY_TERMS: "Mandaste demasiados términos. Máximo 25; priorizá los más específicos del perfil.",
}
function nextActionFor(code: string): string | undefined {
  return NEXT_ACTION_BY_CODE[code]
}

/** Envelope uniforme de error, mismo patrón que los otros dos MCP. */
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
}

/** Auditoría por tool: cada llamada queda con su tool_name y duración. */
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
    // Marca de servidor para separar la telemetría de los tres MCP.
    metadata: { server: "profiles" },
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

const handler = createMcpHandler(
  (rawServer) => {
    const server = withToolAudit(rawServer)

    // -------------------------------------------------------------------------
    // BUSQUEDA PRINCIPAL — persona-first. Concepto (+ filtros) -> personas con
    // contacto personal.
    // -------------------------------------------------------------------------
    server.tool(
      "profiles_search",
      "Busca PERSONAS (perfiles/talento) en la base cruda de contactos por lo que saben, y devuelve su CONTACTO PERSONAL (email y teléfono) para llegarles directo. Es la tool para 'buscame perfiles con experiencia en SAP en banca en Argentina'. Pasá en `terms` la NUBE DE TÉRMINOS ya expandida por vos (si el usuario pide 'SAP', mandá ['SAP','S/4HANA','ABAP','Fiori','SuccessFactors','Ariba','HANA']): el servidor los busca como palabra completa en el texto libre del perfil (headline, about, cargo y descripción del puesto), así 'SAP' no matchea 'WhatsApp'. Filtros OPCIONALES para acotar: `country` (nombre exacto, ej 'Argentina'), `industryIds` (hasta 3, de profiles_industries), `titleTerms` (nube para el CARGO/seniority, ej ['Manager','Director','Head']) y `onlyContactable` (true = solo quien tiene algún dato de contacto). CONTACTO: `personalEmail` es el mail de dominio personal (gmail/hotmail/...); si la persona no tiene uno, `personalEmail` viene null y se expone `workEmail` (corporativo) con `emailIsPersonal:false` para que decidas. `personalPhone` prioriza el teléfono de tipo móvil/personal. `linkedinUrl` es el perfil de LinkedIn de la persona (siempre presente): mostralo para que el usuario pueda verificar el perfil. `matchedTerms` explica por qué entró cada persona (auditable, sin diccionario). Si el resultado es enorme, acotá con country/industry (usá profiles_countries / profiles_industries) o paginá con `offset`. PII sensible: mostrá el contacto solo para el uso legítimo de contacto profesional que pidió el usuario.",
      {
        concept: z.string().min(2).max(120).describe("El término tal como lo pidió el usuario, para mostrarlo (ej 'SAP')."),
        terms: z.array(z.string().min(2).max(120)).min(1).max(25).describe("Nube de términos del skill/tecnología/proceso, expandida por vos."),
        country: z.string().min(2).max(80).optional().describe("Nombre exacto del país (ej 'Argentina'). Filtra por dónde vive la persona."),
        industryIds: z.array(z.string().min(1).max(80)).max(3).optional().describe("Ids de master_industries (de profiles_industries). Industria de la empresa ACTUAL de la persona."),
        includeUnclassified: z.boolean().default(true).describe("Al filtrar por industria, incluir también empresas sin industria clasificada (la mayoría)."),
        titleTerms: z.array(z.string().min(2).max(120)).max(15).optional().describe("Nube opcional para acotar por CARGO/seniority (ej ['Manager','Lead','Architect'])."),
        onlyContactable: z.boolean().default(false).describe("true = solo personas con algún email o teléfono cargado."),
        limit: z.number().int().min(1).max(50).default(25),
        offset: z.number().int().min(0).max(5000).default(0).describe("Para paginar cuando hay muchas personas."),
      },
      async ({ concept, terms, country, industryIds, includeUnclassified, titleTerms, onlyContactable, limit, offset }, extra) =>
        safely(async () => {
          const auth = authOf(extra)
          await requirePaidMcp(auth, "profiles:read", "read")
          const prepared = prepareTerms(terms)
          const people = await searchPeople(
            prepared,
            {
              country: country ?? null,
              industryIds: industryIds ?? [],
              includeUnclassified,
              titleTerms: titleTerms ?? [],
              onlyContactable,
            },
            limit,
            offset
          )
          const withPersonalEmail = people.filter((p) => p.personalEmail).length
          const withPhone = people.filter((p) => p.personalPhone).length
          return {
            concept,
            searchedTerms: prepared.raw,
            filters: { country: country ?? null, industryIds: industryIds ?? [], includeUnclassified, titleTerms: titleTerms ?? [], onlyContactable },
            page: { limit, offset, returned: people.length },
            people,
            summary:
              people.length === 0
                ? `Nadie menciona ${prepared.raw.join(", ")} en el texto libre con estos filtros. Ampliá la nube de términos, sacá el filtro de cargo, o relajá país/industria.`
                : `${people.length} personas (página desde ${offset}). ${withPersonalEmail} con email personal, ${withPhone} con teléfono. 'personalEmail' es el mail de dominio personal; si viene null, mirá 'workEmail' (corporativo, emailIsPersonal:false).`,
            nextStep:
              people.length === 0
                ? "Sin resultados: relajá filtros o cambiá la nube de términos y reintentá. Para ver dónde SÍ aparece el concepto, usá profiles_countries."
                : people.length >= limit
                  ? "Hay más personas: paginá subiendo `offset`, o acotá con country/industry (profiles_countries / profiles_industries) para achicar el universo."
                  : "Presentá los perfiles al usuario en tabla: NOMBRE · CARGO · EMPRESA · PAÍS · LINKEDIN · EMAIL PERSONAL · TELÉFONO. Aclarale cuando el mail sea corporativo (emailIsPersonal:false).",
          }
        })
    )

    // -------------------------------------------------------------------------
    // FACETA DE PAIS — reusa la del MCP Explore. Para acotar cuando hay demasiadas
    // personas: "el concepto aparece en qué países".
    // -------------------------------------------------------------------------
    server.tool(
      "profiles_countries",
      "Corte de apoyo: en qué PAÍSES hay personas que mencionan el concepto, con conteos. Usalo cuando profiles_search trae demasiadas personas y conviene preguntarle al usuario por qué país empezar. Pasá la misma nube de `terms`. Después pasá el país elegido (nombre exacto) a `country` en profiles_search o en profiles_industries.",
      {
        terms: z.array(z.string().min(2).max(120)).min(1).max(25),
        limit: z.number().int().min(1).max(50).default(30),
      },
      async ({ terms, limit }, extra) =>
        safely(async () => {
          const auth = authOf(extra)
          await requirePaidMcp(auth, "profiles:read", "read")
          const prepared = prepareTerms(terms)
          const countries = await geoFacets(prepared, limit)
          const total = countries.reduce((sum, f) => sum + f.personMatches, 0)
          return {
            searchedTerms: prepared.raw,
            countries,
            summary:
              countries.length === 0
                ? `No se encontró a nadie que mencione ${prepared.raw.join(", ")}. Probá otros términos o revisá la ortografía.`
                : `${prepared.raw.join(", ")} aparece en ${total} personas de ${countries.length} países.`,
            nextStep:
              countries.length === 0
                ? "Sin resultados: ampliá o cambiá la nube de términos."
                : "Mostrale los países al usuario, y con el elegido llamá profiles_industries (para afinar por industria) o directamente profiles_search con `country`.",
          }
        })
    )

    // -------------------------------------------------------------------------
    // FACETA DE INDUSTRIA — reusa la del MCP Explore. Concepto (+ país) -> qué
    // industrias, para acotar el perfil por experiencia de industria.
    // -------------------------------------------------------------------------
    server.tool(
      "profiles_industries",
      "Corte de apoyo: qué INDUSTRIAS (de la empresa actual de la persona) tienen perfiles con el concepto, opcionalmente dentro de un país. Sirve para 'perfiles de SAP con experiencia en banca'. Las industrias vienen de la taxonomía normalizada de ASCI (28 categorías, en español). OJO: solo ~12% de las empresas están clasificadas por industria; incluye una fila 'Sin clasificar' con cuántas personas quedarían fuera si filtrás. Mostrale las industrias al usuario, que elija hasta 3, y pasá esos ids en `industryIds` de profiles_search.",
      {
        terms: z.array(z.string().min(2).max(120)).min(1).max(25),
        country: z.string().min(2).max(80).optional().describe("Nombre exacto del país (de profiles_countries). Opcional."),
        limit: z.number().int().min(1).max(50).default(30),
      },
      async ({ terms, country, limit }, extra) =>
        safely(async () => {
          const auth = authOf(extra)
          await requirePaidMcp(auth, "profiles:read", "read")
          const prepared = prepareTerms(terms)
          const facets = await industryFacets(prepared, country ?? null, limit)
          const classified = facets.filter((f) => f.masterIndustryId)
          const unclassified = facets.find((f) => !f.masterIndustryId)
          return {
            searchedTerms: prepared.raw,
            country: country ?? null,
            industries: classified.map((f) => ({ id: f.masterIndustryId, name: f.nameEs ?? f.nameEn, personMatches: f.personMatches })),
            unclassified: unclassified
              ? { personMatches: unclassified.personMatches, note: "Personas en empresas SIN industria clasificada. Se incluyen por defecto (includeUnclassified) para no perderlas." }
              : null,
            nextStep:
              classified.length === 0
                ? "No hay industrias clasificadas con este corte. Llamá profiles_search sin `industryIds` (o dejalo vacío)."
                : "Mostrale las industrias al usuario, pedile hasta 3 y pasá esos ids en `industryIds` de profiles_search.",
          }
        })
    )
  },
  {
    serverInfo: { name: "asci-profiles", version: "1.0.0" },
    instructions: [
      "MCP Perfiles es persona-first: busca TALENTO en la base cruda de contactos por lo que la persona sabe (tecnología/proceso/skill) y su experiencia de industria, y devuelve el CONTACTO PERSONAL (email y teléfono) para llegarle directo. La tool central es profiles_search; profiles_countries y profiles_industries son cortes de apoyo para acotar cuando hay demasiados resultados.",
      "VOS aportás el vocabulario: cuando el usuario nombra una tecnología/proceso/skill, expandilo a una nube de términos (sinónimos, productos, siglas) y pasala en `terms`. No hay diccionario fijo; la riqueza de la búsqueda depende de esa expansión. Mostrale la nube al usuario para que la ajuste.",
      "Contacto PERSONAL: `personalEmail` es el mail de dominio personal (gmail/hotmail/...). Si la persona no tiene uno, viene null y se expone `workEmail` (corporativo) con `emailIsPersonal:false`; presentalo aclarando que es corporativo. `personalPhone` prioriza el teléfono de tipo móvil/personal. `linkedinUrl` (el perfil de LinkedIn de la persona) viene siempre: mostralo junto al contacto para poder verificar el perfil. Nunca inventes datos de contacto: si no están, decilo.",
      "Seguí SIEMPRE el `nextStep` de cada respuesta. Un resultado vacío indica cómo corregir el filtro (ampliar términos, sacar cargo, relajar país/industria): hacelo, no te quedes en 'no hay datos'.",
      "Son datos de contacto PERSONALES (PII sensible). Usalos y mostralos solo para el objetivo de contacto profesional que pidió el usuario. Nunca presentes como dato de ASCI algo que hayas buscado por fuera.",
    ].join("\n"),
  },
  { basePath: "/api/v3/mcp/profiles", maxDuration: 120, verboseLogs: false }
)

const authedHandler = withMcpAuth(
  handler,
  async (req: Request, token?: string) => {
    if (!token) return undefined
    const result = await validateMcpRequest(req as NextRequest)
    if (!result.success || !result.workspaceId || !result.userId || !result.keyId || !result.keyType) return undefined
    const principal: McpPrincipal = { workspaceId: result.workspaceId, userId: result.userId, keyId: result.keyId, keyType: result.keyType, scopes: result.scopes ?? [], allowedModes: result.allowedModes ?? ["read"] }
    // Fila de transporte (tool_name null): la cuenta el rate limiter. Se marca el
    // servidor en metadata para separar la telemetría de los tres MCP.
    await logMcpRequest({ principal, method: req.method, statusCode: 200, requestId: crypto.randomUUID(), metadata: { phase: "transport", server: "profiles" } })
    return { token, clientId: result.keyId, scopes: principal.scopes, extra: principal as unknown as Record<string, unknown> }
  },
  { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource" }
)

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
