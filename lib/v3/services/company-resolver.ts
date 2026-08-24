import { createAdminClient } from "@/lib/supabase/admin"
import { LIMITS, type CompanyResolution } from "./types"
import { isRadarCacheFresh } from "./radar"
import { findCompanyAlias, normalizeCompanyName } from "./company-aliases"

type Candidate = {
  id: string
  name: string
  website: string | null
  country: string | null
  industry: string | null
  signalsCount: number
  score: number
  matchedBy: "domain" | "alias" | "exact_name" | "ranked"
  reasons: string[]
}

function looksLikeDomain(input: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(input.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
}

function extractDomain(input: string): string {
  return input.trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase()
}

function normalizedDomain(value: string | null): string | null {
  if (!value) return null
  return extractDomain(value)
}

function countryMatches(actual: string | null, expected: string | null): boolean {
  if (!expected) return true
  const left = normalizeCompanyName(actual ?? "")
  const right = normalizeCompanyName(expected)
  return left === right || (right === "argentina" && ["ar", "argentina"].includes(left))
}

async function signalCount(companyId: string): Promise<number> {
  const admin = createAdminClient()
  const { count, error } = await admin.from("signals").select("id", { count: "exact", head: true }).eq("company_id", companyId)
  if (error) return 0
  return count ?? 0
}

async function rankCandidates(params: {
  rows: Array<{ id: string; name: string; website: string | null; country: string | null; industry: string | null }>
  input: string
  expectedDomain: string | null
  expectedCountry: string | null
  aliasApplied: boolean
}): Promise<Candidate[]> {
  const inputName = normalizeCompanyName(params.input)
  return Promise.all(params.rows.map(async (row) => {
    const name = normalizeCompanyName(row.name)
    const domain = normalizedDomain(row.website)
    const reasons: string[] = []
    let score = 0
    let matchedBy: Candidate["matchedBy"] = "ranked"

    if (params.expectedDomain && domain === params.expectedDomain) {
      score += 70
      reasons.push("dominio canónico exacto")
      matchedBy = params.aliasApplied ? "alias" : "domain"
    }
    if (name === inputName) {
      score += 45
      reasons.push("nombre exacto")
      if (matchedBy === "ranked") matchedBy = "exact_name"
    } else if (name.includes(inputName) || inputName.includes(name)) {
      score += 25
      reasons.push("nombre compatible")
    }
    if (countryMatches(row.country, params.expectedCountry)) {
      score += params.expectedCountry ? 15 : 5
      reasons.push("país compatible")
    } else if (params.expectedCountry) {
      score -= 100
      reasons.push("país incompatible")
    }
    if (row.website) score += 5
    if (row.industry) score += 2

    const signalsCount = await signalCount(row.id)
    if (signalsCount > 0) {
      score += Math.min(15, Math.log10(signalsCount + 1) * 5)
      reasons.push(`${signalsCount} señales v2`)
    }

    return { ...row, signalsCount, score, matchedBy, reasons }
  })).then((rows) => rows.sort((a, b) => b.score - a.score || b.signalsCount - a.signalsCount))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function resolveCompany(input: string, workspaceId: string): Promise<CompanyResolution> {
  const admin = createAdminClient()
  const trimmed = input.trim()
  const empty: CompanyResolution = {
    input: trimmed, companyId: null, name: null, domain: null, country: null, industry: null,
    cacheFresh: false, lastResearchedAt: null, alreadyFollowed: false, candidates: [],
  }
  if (!trimmed) return empty

  // Atajo por id exacto.
  //
  // El circuito que hace el modelo es search_companies -> save_account(companyId)
  // -> research. Los dos primeros pasos hablan de `companyId`, pero el research
  // solo aceptaba texto y volvía a resolver por nombre con match difuso, así que
  // podía elegir OTRA entidad que la que el usuario acababa de guardar: el research
  // fallaba con NOT_SAVED aunque la cuenta estuviera guardada, sin forma de
  // arreglarlo desde el cliente. Si ya tenemos el id, no hay nada que adivinar.
  if (UUID_RE.test(trimmed)) {
    const { data: row } = await admin
      .from("companies")
      .select("id,name,website,country,industry")
      .eq("id", trimmed)
      .maybeSingle()
    if (!row) return { ...empty, resolutionReason: "No existe una empresa con ese id." }
    const [cacheFresh, followed, lastRun] = await Promise.all([
      isRadarCacheFresh(row.id, LIMITS.CACHE_TTL_DAYS),
      admin.schema("v3").from("followed_accounts").select("id").eq("workspace_id", workspaceId).eq("company_id", row.id).eq("is_active", true).maybeSingle().then((result) => Boolean(result.data)),
      admin.from("radar_research_runs").select("created_at").eq("company_id", row.id).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle().then((result) => result.data?.created_at ?? null),
    ])
    return {
      input: trimmed, companyId: row.id, name: row.name, domain: row.website,
      country: row.country, industry: row.industry, cacheFresh, lastResearchedAt: lastRun,
      alreadyFollowed: followed, matchedBy: "company_id", confidence: 100,
      resolutionReason: "companyId exacto: no se aplicó resolución por nombre.",
      candidates: [],
    }
  }

  const alias = findCompanyAlias(trimmed)
  const expectedDomain = alias?.canonicalDomain ?? (looksLikeDomain(trimmed) ? extractDomain(trimmed) : null)
  const expectedCountry = alias?.country ?? null
  const searchName = alias?.canonicalName ?? trimmed
  const normalized = normalizeCompanyName(searchName)
  const candidates = new Map<string, { id: string; name: string; website: string | null; country: string | null; industry: string | null }>()
  const add = (rows: typeof candidates extends Map<string, infer V> ? V[] : never) => rows.forEach((row) => candidates.set(row.id, row))

  if (expectedDomain) {
    const { data } = await admin.from("companies").select("id,name,website,country,industry").ilike("website", `%${expectedDomain}%`).limit(20)
    add(data ?? [])
  }

  const [{ data: exact }, { data: partial }] = await Promise.all([
    admin.from("companies").select("id,name,website,country,industry").eq("normalized_name", normalized).limit(20),
    normalized.length >= 3
      ? admin.from("companies").select("id,name,website,country,industry").ilike("name", `%${searchName}%`).limit(20)
      : Promise.resolve({ data: [] }),
  ])
  add(exact ?? [])
  add(partial ?? [])

  if (candidates.size === 0) return empty
  const ranked = await rankCandidates({ rows: [...candidates.values()], input: searchName, expectedDomain, expectedCountry, aliasApplied: Boolean(alias) })
  const best = ranked[0]
  const margin = best.score - (ranked[1]?.score ?? 0)
  const confident = best.score >= 45 && (ranked.length === 1 || margin >= 12 || best.matchedBy === "alias" || best.matchedBy === "domain")

  if (!confident) {
    return {
      ...empty,
      candidates: ranked.slice(0, 5).map((row) => ({
        companyId: row.id, name: row.name, domain: row.website, country: row.country,
        confidence: Math.max(0, Math.min(100, Math.round(row.score))), signalsCount: row.signalsCount,
      })),
      resolutionReason: "Los candidatos no alcanzaron un margen de confianza suficiente.",
    }
  }

  const [cacheFresh, followed, lastRun] = await Promise.all([
    isRadarCacheFresh(best.id, LIMITS.CACHE_TTL_DAYS),
    admin.schema("v3").from("followed_accounts").select("id").eq("workspace_id", workspaceId).eq("company_id", best.id).eq("is_active", true).maybeSingle().then((result) => Boolean(result.data)),
    admin.from("radar_research_runs").select("created_at").eq("company_id", best.id).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle().then((result) => result.data?.created_at ?? null),
  ])

  return {
    input: trimmed,
    companyId: best.id,
    name: best.name,
    domain: best.website,
    country: best.country,
    industry: best.industry,
    cacheFresh,
    lastResearchedAt: lastRun,
    alreadyFollowed: followed,
    matchedBy: best.matchedBy,
    confidence: Math.max(0, Math.min(100, Math.round(best.score))),
    resolutionReason: best.reasons.join("; "),
    candidates: [],
  }
}

/**
 * [455] Resuelve el nombre contra el catalogo global y, solo si no existe, crea.
 *
 * POR QUE NO ES UN INSERT
 *
 * Antes esto insertaba directo en public.companies, con dos consecuencias.
 *
 * La primera es que era la unica via de creacion que NO pasaba por
 * upsert_company, asi que se saltaba las tres pruebas que evitan duplicados
 * (URL de LinkedIn canonizada, nombre exacto, nucleo con guardas). Y es
 * justamente la via con MENOS informacion: `name` es texto libre que alguien
 * tipeo en el chat, sin URL ni website. La que menos datos tiene era la que
 * menos se defendia.
 *
 * La segunda es que escribia `normalized_name` con normalizeCompanyName(), que
 * no es la misma normalizacion que usa el resto del sistema: quita sufijos en
 * cualquier posicion, no quita prefijos y no corta en la barra. Para "Grupo
 * Eolo" daba "grupo eolo" donde company_core_name() da "eolo", y esas filas
 * quedaban invisibles para el match por nucleo de la ingesta.
 *
 * Llamar a upsert_company arregla las dos cosas de una: aplica las mismas
 * pruebas que el ETL y deja que la normalizacion canonica la escriba una sola
 * funcion, en SQL.
 *
 * Cambia la semantica y por eso cambia el nombre: puede devolver una empresa
 * que YA EXISTIA. Es deseable — resolveCompany ya corrio antes y no la
 * encontro, asi que un match aca significa que upsert_company la reconocio por
 * nucleo, que es exactamente lo que se quiere.
 */
export async function resolveOrCreateCompany(params: {
  name: string
  website?: string | null
  country?: string | null
  industry?: string | null
}): Promise<{ companyId: string } | { error: string }> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc("upsert_company", {
    p_name: params.name.trim(),
    p_website: params.website ?? null,
    p_country: params.country ?? null,
    p_industry: params.industry ?? null,
  })
  if (error || !data) {
    console.error("[v3] Error resolviendo o creando empresa:", error?.message)
    return { error: "No se pudo crear la empresa" }
  }
  return { companyId: data as string }
}
