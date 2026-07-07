import { createAdminClient } from "@/lib/supabase/admin"
import { LIMITS, type CompanyResolution } from "./types"
import { isRadarCacheFresh } from "./radar"

// ═══════════════════════════════════════════════════════════
// Resolvedor de empresas: convierte inputs libres del usuario
// ("Arcor", "arcor.com", "Arcor Argentina") en filas de
// public.companies (cache global compartido con v2).
// - Nunca borra ni modifica empresas existentes: solo lee o inserta.
// - Detecta frescura del cache y si la cuenta ya se sigue.
// ═══════════════════════════════════════════════════════════

function looksLikeDomain(input: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(input.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
}

function extractDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Resuelve un input libre a una empresa del cache global.
 * Si hay múltiples candidatos plausibles, los devuelve para desambiguar
 * en el chat en vez de elegir uno arbitrariamente.
 */
export async function resolveCompany(
  input: string,
  workspaceId: string
): Promise<CompanyResolution> {
  const admin = createAdminClient()
  const trimmed = input.trim()

  const empty: CompanyResolution = {
    input: trimmed,
    companyId: null,
    name: null,
    domain: null,
    country: null,
    industry: null,
    cacheFresh: false,
    lastResearchedAt: null,
    alreadyFollowed: false,
    candidates: [],
  }
  if (!trimmed) return empty

  let matches: { id: string; name: string; website: string | null; country: string | null; industry: string | null }[] = []

  if (looksLikeDomain(trimmed)) {
    const domain = extractDomain(trimmed)
    const { data } = await admin
      .from("companies")
      .select("id, name, website, country, industry")
      .ilike("website", `%${domain}%`)
      .limit(5)
    matches = data ?? []
  }

  if (matches.length === 0) {
    const normalized = normalizeName(trimmed)
    // 1) match exacto por nombre normalizado
    const { data: exact } = await admin
      .from("companies")
      .select("id, name, website, country, industry")
      .eq("normalized_name", normalized)
      .limit(5)
    matches = exact ?? []

    // 2) búsqueda parcial si no hay exacto
    if (matches.length === 0 && normalized.length >= 3) {
      const { data: partial } = await admin
        .from("companies")
        .select("id, name, website, country, industry")
        .ilike("name", `%${trimmed}%`)
        .limit(5)
      matches = partial ?? []
    }
  }

  if (matches.length === 0) return empty

  // Ambiguo: más de un candidato con nombres distintos → desambiguar en chat
  const distinctNames = new Set(matches.map((m) => normalizeName(m.name)))
  if (matches.length > 1 && distinctNames.size > 1) {
    return {
      ...empty,
      candidates: matches.map((m) => ({
        companyId: m.id,
        name: m.name,
        domain: m.website,
        country: m.country,
      })),
    }
  }

  const company = matches[0]
  const [cacheFresh, followed, lastRun] = await Promise.all([
    isRadarCacheFresh(company.id, LIMITS.CACHE_TTL_DAYS),
    admin
      .schema("v3")
      .from("followed_accounts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("company_id", company.id)
      .eq("is_active", true)
      .maybeSingle()
      .then((r) => Boolean(r.data)),
    admin
      .from("radar_research_runs")
      .select("created_at")
      .eq("company_id", company.id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then((r) => r.data?.created_at ?? null),
  ])

  return {
    input: trimmed,
    companyId: company.id,
    name: company.name,
    domain: company.website,
    country: company.country,
    industry: company.industry,
    cacheFresh,
    lastResearchedAt: lastRun,
    alreadyFollowed: followed,
    candidates: [],
  }
}

/**
 * Crea una empresa nueva en el cache global cuando no existe.
 * Aditivo: nunca modifica filas existentes de v2.
 */
export async function createCompany(params: {
  name: string
  website?: string | null
  country?: string | null
  industry?: string | null
}): Promise<{ companyId: string } | { error: string }> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("companies")
    .insert({
      name: params.name.trim(),
      normalized_name: normalizeName(params.name),
      website: params.website ?? null,
      country: params.country ?? null,
      industry: params.industry ?? null,
    })
    .select("id")
    .single()

  if (error || !data) {
    console.error("[v3] Error creando empresa:", error?.message)
    return { error: "No se pudo crear la empresa" }
  }
  return { companyId: data.id }
}
