import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { getLegacySignals } from "./services/legacy-signal-provider"
import { getAccountEvidenceDetail } from "./services/internal-account-snapshot"
import { getCompanySignalSummary } from "./services/company-signal-summary"
import type { McpPrincipal } from "./mcp-usage"

type RankedCompany = {
  id: string
  name: string
  normalized_name: string | null
  website: string | null
  country: string | null
  industry: string | null
  /** true si coincide el NOMBRE; false si matcheó de rebote por el website. */
  nameMatch: boolean
  evidence: { signals: number; jobPostings: number; hasWebsite: boolean }
}

/**
 * Busca empresas en el catálogo global.
 *
 * El catálogo v2 tiene muchas entidades homónimas por empresa (plantas,
 * distribuidores oficiales, filiales y variantes de razón social). Para "arcor"
 * hay más de 90 registros y solo uno concentra la evidencia real, así que elegir
 * mal significa ocupar un lugar del plan con una cuenta vacía.
 *
 * El filtro, el ranking y el conteo viven en `v3.search_companies_ranked`
 * (scripts/426). Antes se recortaba con `.limit(limit * 5)` SIN `ORDER BY` y el
 * ranking corría acá, en memoria, sobre un conjunto ya recortado al azar por
 * Postgres. Eso producía cuatro fallas medidas: la canónica real no aparecía
 * (Falabella con 16.065 señales quedaba afuera del top-10), el resultado cambiaba
 * entre corridas idénticas, `totalMatches` informaba el tamaño del recorte en vez
 * del total, y `likelyCanonical` podía caer en otra empresa que solo matcheaba por
 * su URL. Además hacía hasta 201 queries por búsqueda; ahora es una.
 */
export async function searchCompanies(query: string, limit = 10) {
  const admin = createAdminClient()
  const normalized = query.trim().replaceAll(",", "")
  if (!normalized) return { totalMatches: 0, companies: [] }

  const { data, error } = await admin.schema("v3").rpc("search_companies_ranked", {
    p_query: normalized,
    p_limit: limit,
  })
  if (error) throw new Error(`COMPANY_SEARCH_FAILED:${error.message}`)

  const totalMatches: number = data?.totalMatches ?? 0
  const companies: RankedCompany[] = data?.companies ?? []
  if (!companies.length) return { totalMatches, companies: [] }

  // La canónica se elige entre las que coinciden por NOMBRE. Sin esto, buscar
  // "Falabella" proponía Sodimac (misma casa matriz, muchas más señales) y
  // "Techint" proponía Seatech International, que matchea por seatechint.com.
  const byName = companies.filter((c) => c.nameMatch)
  const best = Math.max(0, ...byName.map((c) => c.evidence.signals))

  return {
    totalMatches,
    // El modelo necesita saber que hay homónimos para confirmar la entidad con el
    // usuario antes de gastar un lugar del plan en la equivocada.
    duplicateWarning:
      totalMatches > 1
        ? `Hay ${totalMatches} entidades que coinciden con "${normalized}" (plantas, filiales y distribuidores se cargan por separado). Se muestran las ${companies.length} con más evidencia. Confirmá con el usuario cuál es la correcta antes de guardarla: las que tienen 0 señales y sin dominio suelen ser registros degradados.`
        : null,
    companies: companies.map((company) => ({
      ...company,
      // Señal explícita para el modelo: guardar una cuenta sin evidencia no
      // habilita ningún research útil y consume cupo igual.
      likelyCanonical: company.nameMatch && company.evidence.signals > 0 && company.evidence.signals >= best,
    })),
  }
}

/**
 * Dominio a partir del website. `companies` no tiene columna de dominio: guarda
 * la URL completa, y a veces con path ("https://careers-meli.mercadolibre.com/").
 */
export function domainFromWebsite(website: string | null | undefined): string | null {
  if (!website) return null
  const stripped = website.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
  return stripped || null
}

/**
 * Bloque firmográfico de una fila de `companies`.
 *
 * Todas las claves salen SIEMPRE, con null explícito cuando el dato no está.
 * No es cosmético: `apollo_employees_count` tiene cobertura muy baja (118 de
 * 11.680 empresas argentinas), y si el campo simplemente faltara, el modelo no
 * podría distinguir "empresa chica" de "no lo sabemos" — y termina afirmando lo
 * primero. Ausente y null NO son lo mismo acá.
 */
export function firmographicsOf(company: {
  linkedin_url?: string | null
  website?: string | null
  apollo_employees_count?: number | null
  is_public?: boolean | null
  ticker?: string | null
  stock_exchange?: string | null
}) {
  return {
    linkedinUrl: company.linkedin_url ?? null,
    domain: domainFromWebsite(company.website),
    employeesApollo: company.apollo_employees_count ?? null,
    isPublic: company.is_public ?? null,
    ticker: company.ticker ?? null,
    stockExchange: company.stock_exchange ?? null,
  }
}

export async function getCompanyProfile(companyId: string) {
  const admin = createAdminClient()
  const [{ data: company, error }, signals] = await Promise.all([
    admin
      .from("companies")
      .select(
        "id,name,normalized_name,website,country,industry,description,linkedin_url,apollo_employees_count,is_public,ticker,stock_exchange",
      )
      .eq("id", companyId)
      .maybeSingle(),
    getLegacySignals(companyId, 1),
  ])
  if (error) throw new Error(`COMPANY_READ_FAILED:${error.message}`)
  if (!company) throw new Error("COMPANY_NOT_FOUND")
  const { linkedin_url, apollo_employees_count, is_public, ticker, stock_exchange, ...identity } = company
  return {
    ...identity,
    // A diferencia de search_companies_by_capability, acá va SIEMPRE: es una
    // sola empresa, así que no hay payload que cuidar, y son los datos que un
    // vendedor pide inmediatamente después del nombre.
    firmographics: firmographicsOf(company),
    signalCoverage: { total: signals.total, latestAt: signals.latestAt, status: signals.status },
    fieldNotes:
      apollo_employees_count == null
        ? "employeesApollo viene en null: NO tenemos la dotación de esta empresa (la cobertura del dato es baja). No la presentes como empresa chica ni la estimes."
        : null,
  }
}

/**
 * Señales de una empresa, con atribución de persona.
 *
 * Se aclara explícitamente que esta vista NO incluye vacantes: `signals` solo
 * tiene lo derivado de perfiles y documentos. Antes esa omisión era silenciosa y
 * el modelo concluía que la cuenta no tenía evidencia de una tecnología cuando en
 * realidad estaba en las vacantes. Para el panorama completo hay que usar
 * `get_company_signal_summary`.
 */
export async function getCompanySignals(companyId: string, limit = 50) {
  const result = await getLegacySignals(companyId, Math.min(limit, 100))
  const fromFormerEmployees = result.signals.filter((s) => s.person && !s.person.isCurrentEmployee).length

  return {
    ...result,
    scope: "contact-signals-only" as const,
    note:
      "Estas señales provienen de perfiles y documentos, no de vacantes. Para el panorama completo (que incluye vacantes) usá get_company_signal_summary.",
    // Aviso cuantificado: en esta base ~30% de las señales son de ex-empleados y
    // no prueban uso actual de la tecnología.
    formerEmployeeWarning:
      fromFormerEmployees > 0
        ? `${fromFormerEmployees} de ${result.signals.length} señales provienen de ex-empleados: prueban que la persona trabajó con esa tecnología, no que la cuenta la use hoy.`
        : null,
  }
}

/**
 * Drilldown de evidencia por término.
 *
 * Segunda mitad del panorama liviano: el panorama entrega tags sin snippets y
 * esta función devuelve las fuentes de un término puntual, con el LinkedIn de la
 * persona cuando la señal sale de un perfil. Lee de lo ya persistido, así que no
 * consume cuota ni re-investiga.
 */
/**
 * Detalle de evidencia de un término, con fallback a la evidencia GLOBAL.
 *
 * POR QUÉ EL FALLBACK. Esta tool lee `v3.account_evidence_details`, que es una
 * tabla scopeada por workspace y la MATERIALIZA el research. O sea que la cadena
 * real era: save_account (ocupa 1 de 60 lugares del plan) → run_account_research
 * (consume cuota) → recién ahí esto devuelve algo. Ninguno de los dos pasos era
 * descubrible antes de chocarse con el error, y la descripción de la tool decía
 * "lee evidencia ya persistida: NO consume cuota" —cierto pero incompleto: omitía
 * que sin snapshot no hay nada que leer.
 *
 * Sacar el guard no alcanzaba: habría devuelto una lista vacía, que es peor,
 * porque un vacío mudo se lee como "esta cuenta no tiene evidencia". La evidencia
 * cruda SÍ existe, global y sin workspace, en `public.signals`. El fallback la
 * usa y lo dice en `source`, para que quien lee sepa qué está mirando:
 *   workspace_snapshot  evidencia clasificada por el research de ESTE workspace
 *   global_signals      evidencia cruda del catálogo, sin research previo
 */
export async function getAccountEvidenceDetailTool(
  principal: McpPrincipal,
  params: { companyId: string; term?: string; termIds?: string[] }
) {
  const hasWorkspaceAccount = await hasAccountInWorkspace(principal, params.companyId)
  const details = hasWorkspaceAccount
    ? await getAccountEvidenceDetail({
        workspaceId: principal.workspaceId,
        companyId: params.companyId,
        termIds: params.termIds,
        termQuery: params.term,
      })
    : []

  if (!details.length) {
    const global = await getCompanySignalSummary(params.companyId, "evidence", { term: params.term })
    return {
      source: "global_signals" as const,
      ...global,
      note: hasWorkspaceAccount
        ? "La cuenta está en el workspace pero todavía no tiene snapshot de research, así que esto es la evidencia CRUDA global. Para la versión clasificada y puntuada, corré el research."
        : "La cuenta no está guardada en este workspace. Esto es la evidencia CRUDA global del catálogo: no consumió cupo ni research. Guardarla solo hace falta para trabajarla (research, contactos, seguimiento).",
    }
  }

  return {
    source: "workspace_snapshot" as const,
    terms: details.map((detail) => ({
      term: detail.term,
      termId: detail.termId,
      kind: detail.termKind,
      evidenceLevel: detail.evidenceLevel,
      mentionCount: detail.mentionCount,
      latestAt: detail.latestAt,
      sources: detail.sources.map((source) => ({
        kind: source.kind,
        title: source.title,
        matchedKeyword: source.matchedKeyword,
        snippet: source.snippet,
        date: source.date,
        url: source.url,
        evidenceLevel: source.evidenceLevel,
        // Trazabilidad: si la señal sale de un perfil, se comparte el LinkedIn
        // para que el vendedor pueda verificar de quién se está infiriendo.
        person: source.person
          ? {
              name: source.person.fullName,
              title: source.person.title,
              linkedinUrl: source.person.linkedinUrl,
              isCurrentEmployee: source.person.isCurrentEmployee,
              attribution: source.person.isCurrentEmployee
                ? "Empleado actual"
                : "Ex-empleado: no prueba uso actual en la cuenta",
            }
          : null,
      })),
    })),
  }
}

async function hasAccountInWorkspace(principal: McpPrincipal, companyId: string) {
  const admin = createAdminClient()
  const [{ count: jobs }, { count: followed }] = await Promise.all([
    admin.schema("v3").from("research_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", principal.workspaceId).eq("company_id", companyId),
    admin.schema("v3").from("followed_accounts").select("id", { count: "exact", head: true }).eq("workspace_id", principal.workspaceId).eq("company_id", companyId).eq("is_active", true),
  ])
  return Boolean(jobs || followed)
}

async function assertWorkspaceAccount(principal: McpPrincipal, companyId: string) {
  // Una credencial sin topes trabaja sobre el catálogo global: exigirle que la
  // cuenta esté en el workspace es justamente el tope que apaga.
  if (principal.unrestricted) return
  if (!(await hasAccountInWorkspace(principal, companyId))) throw new Error("ACCOUNT_NOT_AVAILABLE_IN_WORKSPACE")
}

export async function listWorkspaceAccounts(principal: McpPrincipal, limit = 50) {
  const admin = createAdminClient()
  const { data, error } = await admin.schema("v3").from("research_jobs")
    .select("company_id,company_input,status,progress,created_at,finished_at")
    .eq("workspace_id", principal.workspaceId)
    .not("company_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 100))
  if (error) throw new Error(`WORKSPACE_ACCOUNTS_FAILED:${error.message}`)
  return data ?? []
}

export async function getAccountIntelligence(principal: McpPrincipal, companyId: string) {
  await assertWorkspaceAccount(principal, companyId)
  const admin = createAdminClient()
  const [snapshot, scorecard, brief, icebreakers] = await Promise.all([
    admin.schema("v3").from("account_internal_snapshots").select("*").eq("workspace_id", principal.workspaceId).eq("company_id", companyId).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    admin.schema("v3").from("account_scorecards").select("*").eq("workspace_id", principal.workspaceId).eq("company_id", companyId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.schema("v3").from("account_briefs").select("*").eq("workspace_id", principal.workspaceId).eq("company_id", companyId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.schema("v3").from("icebreakers").select("*").eq("workspace_id", principal.workspaceId).eq("company_id", companyId).order("created_at", { ascending: false }).limit(20),
  ])
  return { snapshot: snapshot.data, scorecard: scorecard.data, brief: brief.data, icebreakers: icebreakers.data ?? [] }
}

export async function getResearchStatus(principal: McpPrincipal, batchId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.schema("v3").from("research_jobs")
    .select("id,batch_id,company_id,company_input,status,phase,current_step,progress,error_code,error,created_at,finished_at")
    .eq("workspace_id", principal.workspaceId).eq("batch_id", batchId).order("created_at")
  if (error) throw new Error(`RESEARCH_STATUS_FAILED:${error.message}`)
  if (!data?.length) throw new Error("RESEARCH_NOT_FOUND")
  return { batchId, jobs: data }
}
