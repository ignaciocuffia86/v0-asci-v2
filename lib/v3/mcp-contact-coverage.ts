import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { getLegacySignals } from "@/lib/v3/services/legacy-signal-provider"
import { getContactEnrichmentLimits } from "@/lib/v3/plans"
import { requireSavedAccount, type SavedAccountGuard } from "./mcp-account-lifecycle"
import type { McpPrincipal } from "./mcp-usage"

// ═══════════════════════════════════════════════════════════
// Fase 2: cargos justificados por señales y cobertura de contactos.
//
// Esta fase NO gasta un solo crédito de Apollo. Su función es que, cuando
// llegue el momento de enriquecer, la búsqueda esté justificada por evidencia
// y no se repita trabajo ya pagado.
//
// Cadena determinística:
//   signals.signal_type + signal_id
//     -> public.dictionary_processes / dictionary_products
//     -> v3.dictionary_job_titles (cargo + seniority)
//     -> public.apollo_title_catalog (tasa de éxito real en Apollo)
//
// El orden final de los cargos usa la tasa de éxito histórica, para no gastar
// créditos en títulos que Apollo nunca devuelve.
// ═══════════════════════════════════════════════════════════

/** Ventana de frescura por defecto. El valor real sale del plan del workspace. */
const DEFAULT_FRESHNESS_DAYS = 90

export type RoleOrigin = "signal_derived" | "user_input"

export interface RoleJustification {
  signalType: string
  /** Nombre del proceso o tecnología que originó el cargo. */
  driver: string
  /** Cantidad de señales de la cuenta que apuntan a ese driver. */
  signalCount: number
  /** Peso relativo del driver dentro de la cuenta, en porcentaje. */
  driverShare: number
  latestSignalAt: string | null
  sampleSourceUrl: string | null
}

export interface RecommendedRole {
  role: string
  seniority: string | null
  origin: RoleOrigin
  /** Por qué ASCI cree que esta persona es dueña del problema. */
  because: RoleJustification[]
  /** Tasa de éxito histórica en Apollo (null si nunca se buscó). */
  apolloSuccessRate: number | null
  apolloAttempts: number
  confidence: "high" | "medium" | "low"
}

export interface RecommendRolesResult {
  companyId: string
  companyName: string | null
  accountAccess: SavedAccountGuard
  signalsAnalyzed: number
  driversDetected: { driver: string; signalType: string; signalCount: number }[]
  roles: RecommendedRole[]
  maxRolesPerEnrichment: number
  truncated: boolean
  warnings: string[]
  message: string
}

/**
 * Deriva los cargos a los que conviene apuntar en una cuenta, con trazabilidad.
 *
 * Requiere que la cuenta esté guardada: trabajar una cuenta consume cupo del plan
 * y no queremos que el modelo derive cargos de empresas que el usuario solo miró.
 * El usuario puede sumar cargos manuales (origin = user_input), que se marcan como
 * no respaldados por señales para que el modelo lo advierta.
 */
export async function recommendContactRoles(
  principal: McpPrincipal,
  params: { companyId: string; additionalTitles?: string[] }
): Promise<RecommendRolesResult> {
  const guard = await requireSavedAccount(principal, params.companyId)
  const limits = await getContactEnrichmentLimits(principal.workspaceId)
  const maxRoles = limits.maxRoles || 10
  const warnings: string[] = []

  if (guard.state !== "saved") {
    return {
      companyId: params.companyId,
      companyName: guard.companyName,
      accountAccess: guard,
      signalsAnalyzed: 0,
      driversDetected: [],
      roles: [],
      maxRolesPerEnrichment: maxRoles,
      truncated: false,
      warnings: [],
      message:
        guard.message ??
        "La cuenta no está guardada en el workspace. Guardala antes de derivar cargos y buscar personas.",
    }
  }

  const admin = createAdminClient()

  // 1. Señales de la cuenta. Se leen con signal_id porque es el puente al diccionario.
  const [signalRes, legacy] = await Promise.all([
    admin
      .from("signals")
      .select("id, signal_type, signal_id, keyword_matched, source_url, job_posted_at, created_at")
      .eq("company_id", params.companyId)
      .order("created_at", { ascending: false })
      .limit(400),
    getLegacySignals(params.companyId, 1),
  ])

  if (legacy.status === "failed") warnings.push(legacy.warning ?? "La fuente de señales no respondió.")

  const signals = (signalRes.data ?? []).filter((row) => row.signal_id)
  const processIds = uniq(signals.filter((s) => s.signal_type === "process").map((s) => s.signal_id as string))
  const productIds = uniq(signals.filter((s) => s.signal_type !== "process").map((s) => s.signal_id as string))

  // 2. Resolver nombres de drivers (proceso / tecnología).
  const [processRes, productRes] = await Promise.all([
    processIds.length
      ? admin.from("dictionary_processes").select("id,name").in("id", processIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    productIds.length
      ? admin.from("dictionary_products").select("id,name").in("id", productIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])
  const driverNames = new Map<string, string>()
  for (const row of processRes.data ?? []) driverNames.set(row.id, row.name)
  for (const row of productRes.data ?? []) driverNames.set(row.id, row.name)

  // 3. Agregar señales por driver.
  const byDriver = new Map<
    string,
    { signalType: string; driverId: string; count: number; latestAt: string | null; sourceUrl: string | null }
  >()
  for (const s of signals) {
    const key = s.signal_id as string
    const current = byDriver.get(key)
    const occurredAt = s.job_posted_at ?? s.created_at
    if (current) {
      current.count += 1
      if (!current.sourceUrl && s.source_url) current.sourceUrl = s.source_url
      if (occurredAt && (!current.latestAt || occurredAt > current.latestAt)) current.latestAt = occurredAt
    } else {
      byDriver.set(key, {
        signalType: s.signal_type,
        driverId: key,
        count: 1,
        latestAt: occurredAt,
        sourceUrl: s.source_url,
      })
    }
  }

  // 4. Cargos del diccionario para esos drivers.
  const driverIds = [...byDriver.keys()]
  const { data: titleRows } = driverIds.length
    ? await admin
        .schema("v3")
        .from("dictionary_job_titles")
        .select("job_title, seniority, process_id, product_id")
        .or(`process_id.in.(${driverIds.join(",")}),product_id.in.(${driverIds.join(",")})`)
    : { data: [] as { job_title: string; seniority: string | null; process_id: string | null; product_id: string | null }[] }

  // 5. Un cargo puede estar justificado por varios drivers: se acumulan.
  //
  // El peso NO usa el conteo absoluto de señales. Una empresa grande puede tener
  // decenas de miles de señales en "Marketing y Ventas" solo por su tamaño, y eso
  // haría que toda cuenta grande devuelva siempre los mismos cargos genéricos.
  // Se usa la fuerza RELATIVA del driver dentro de la cuenta, más un bonus por
  // recencia: un driver con señales de este trimestre pesa más que uno histórico.
  const totalSignals = [...byDriver.values()].reduce((sum, d) => sum + d.count, 0) || 1
  const maxDriverCount = Math.max(...[...byDriver.values()].map((d) => d.count), 1)

  const roleMap = new Map<string, { seniority: string | null; because: RoleJustification[]; weight: number }>()
  for (const row of titleRows ?? []) {
    const driverId = row.process_id ?? row.product_id
    if (!driverId) continue
    const agg = byDriver.get(driverId)
    if (!agg) continue

    const justification: RoleJustification = {
      signalType: agg.signalType,
      driver: driverNames.get(driverId) ?? "driver desconocido",
      signalCount: agg.count,
      /** Porcentaje de las señales de la cuenta que apuntan a este driver. */
      driverShare: Math.round((agg.count / totalSignals) * 1000) / 10,
      latestSignalAt: agg.latestAt,
      sampleSourceUrl: agg.sourceUrl,
    }

    const driverWeight = driverStrength(agg.count, maxDriverCount, agg.latestAt)
    const existing = roleMap.get(row.job_title)
    if (existing) {
      existing.because.push(justification)
      existing.weight += driverWeight
    } else {
      roleMap.set(row.job_title, { seniority: row.seniority, because: [justification], weight: driverWeight })
    }
  }

  // 6. Cargos manuales del usuario. No tienen respaldo de señales, pero se permiten.
  const manualTitles = uniq((params.additionalTitles ?? []).map((t) => t.trim()).filter(Boolean))
  for (const title of manualTitles) {
    if (!roleMap.has(title)) roleMap.set(title, { seniority: null, because: [], weight: 0 })
  }
  if (manualTitles.length) {
    warnings.push(
      `${manualTitles.length} cargo(s) fueron agregados manualmente y no están respaldados por señales de la cuenta. Advertíselo al usuario antes de gastar créditos en ellos.`
    )
  }

  // 7. Tasa de éxito real en Apollo, para ordenar por probabilidad de encontrar gente.
  const allTitles = [...roleMap.keys()]
  const successByTitle = await getApolloSuccessRates(allTitles)

  const roles: RecommendedRole[] = allTitles
    .map((role) => {
      const entry = roleMap.get(role)!
      const stats = successByTitle.get(normalizeTitle(role)) ?? null
      const origin: RoleOrigin = entry.because.length ? "signal_derived" : "user_input"
      return {
        role,
        seniority: entry.seniority,
        origin,
        because: entry.because,
        apolloSuccessRate: stats?.rate ?? null,
        apolloAttempts: stats?.attempts ?? 0,
        confidence: confidenceOf(entry.weight, entry.because.length, stats?.rate ?? null, origin),
        // La evidencia manda; la tasa de éxito de Apollo desempata entre cargos
        // igualmente justificados. Sin historial se asume 0.5 para no castigar
        // títulos que nunca se buscaron.
        _score: entry.weight * 10 + (stats?.rate ?? 0.5) * 3,
      }
    })
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...role }) => role)

  const truncated = roles.length > maxRoles

  if (!roles.length) {
    warnings.push(
      "No hay señales que permitan derivar un área responsable. Conviene investigar la cuenta antes de buscar personas, o que el usuario indique los cargos manualmente."
    )
  }

  return {
    companyId: params.companyId,
    companyName: guard.companyName,
    accountAccess: guard,
    signalsAnalyzed: signals.length,
    driversDetected: [...byDriver.values()].map((d) => ({
      driver: driverNames.get(d.driverId) ?? "driver desconocido",
      signalType: d.signalType,
      signalCount: d.count,
    })),
    roles: roles.slice(0, maxRoles),
    maxRolesPerEnrichment: maxRoles,
    truncated,
    warnings,
    message: roles.length
      ? `Se derivaron ${roles.length} cargo(s) desde ${signals.length} señal(es) de la cuenta.${
          truncated ? ` Se muestran los ${maxRoles} de mayor prioridad porque es el tope por ejecución del plan.` : ""
        } Revisá las justificaciones con el usuario y dejá que ajuste la lista antes de buscar contactos.`
      : "No se pudieron derivar cargos desde las señales disponibles.",
  }
}

// ─── Cobertura de contactos existentes ───────────────────────

export interface ExistingContact {
  contactId: string
  apolloPersonId: string | null
  fullName: string | null
  title: string | null
  seniority: string | null
  linkedinUrl: string | null
  email: string | null
  emailStatus: string | null
  hasPhone: boolean
  phoneStatus: string
  roleOrigin: RoleOrigin
  matchedRole: string | null
  /** Frescura evaluada por campo: la persona puede estar vigente y el email no. */
  freshness: {
    person: FreshnessState
    email: FreshnessState
    phone: FreshnessState
  }
}

export type FreshnessState = "fresh" | "stale" | "never_verified"

export interface ContactCoverageResult {
  companyId: string
  companyName: string | null
  accountAccess: SavedAccountGuard
  freshnessDays: number
  contacts: ExistingContact[]
  coverage: {
    totalContacts: number
    freshContacts: number
    staleContacts: number
    withUsableEmail: number
    withUsablePhone: number
    pendingPhone: number
    recommendedRoles: number
    matchedRoles: string[]
    missingRoles: string[]
  }
  enrichmentRecommended: boolean
  enrichmentReason: string
  enrichmentAllowedByPlan: boolean
  message: string
}

/**
 * Devuelve los contactos que el workspace ya tiene para la cuenta y calcula la
 * cobertura frente a los cargos recomendados. NUNCA llama a Apollo: su objetivo
 * es evitar gastar créditos en información que ya está pagada.
 */
export async function getCompanyContacts(
  principal: McpPrincipal,
  params: { companyId: string; roles?: string[] }
): Promise<ContactCoverageResult> {
  const guard = await requireSavedAccount(principal, params.companyId)
  const limits = await getContactEnrichmentLimits(principal.workspaceId)
  const freshnessDays = limits.freshnessDays || DEFAULT_FRESHNESS_DAYS

  const empty = (message: string): ContactCoverageResult => ({
    companyId: params.companyId,
    companyName: guard.companyName,
    accountAccess: guard,
    freshnessDays,
    contacts: [],
    coverage: {
      totalContacts: 0,
      freshContacts: 0,
      staleContacts: 0,
      withUsableEmail: 0,
      withUsablePhone: 0,
      pendingPhone: 0,
      recommendedRoles: params.roles?.length ?? 0,
      matchedRoles: [],
      missingRoles: params.roles ?? [],
    },
    enrichmentRecommended: false,
    enrichmentAllowedByPlan: limits.allowed,
    enrichmentReason: "account_not_saved",
    message,
  })

  if (guard.state !== "saved") {
    return empty(guard.message ?? "La cuenta no está guardada en el workspace.")
  }

  const admin = createAdminClient()

  // El puente v3 aporta scope de workspace y frescura por campo;
  // los datos de la persona viven en el caché global de Apollo.
  const { data: bridgeRows } = await admin
    .schema("v3")
    .from("account_contacts")
    .select(
      "id, apollo_cache_id, apollo_person_id, person_last_verified_at, email_last_verified_at, phone_last_verified_at, phone_status, role_origin, matched_role"
    )
    .eq("workspace_id", principal.workspaceId)
    .eq("company_id", params.companyId)

  const bridge = bridgeRows ?? []
  const cacheIds = bridge.map((r) => r.apollo_cache_id).filter((id): id is string => Boolean(id))

  const { data: cacheRows } = cacheIds.length
    ? await admin
        .from("apollo_contacts_cache")
        .select("id, apollo_id, full_name, title, seniority, linkedin_url, email, email_status, phone, mobile_phone")
        .in("id", cacheIds)
    : { data: [] as Record<string, unknown>[] }

  const cacheMap = new Map((cacheRows ?? []).map((row) => [row.id as string, row]))
  const now = Date.now()

  const contacts: ExistingContact[] = bridge.map((row) => {
    const cache = row.apollo_cache_id ? cacheMap.get(row.apollo_cache_id) : undefined
    return {
      contactId: row.id,
      apolloPersonId: row.apollo_person_id,
      fullName: (cache?.full_name as string) ?? null,
      title: (cache?.title as string) ?? null,
      seniority: (cache?.seniority as string) ?? null,
      linkedinUrl: (cache?.linkedin_url as string) ?? null,
      email: (cache?.email as string) ?? null,
      emailStatus: (cache?.email_status as string) ?? null,
      hasPhone: Boolean(cache?.phone || cache?.mobile_phone),
      phoneStatus: row.phone_status,
      roleOrigin: row.role_origin as RoleOrigin,
      matchedRole: row.matched_role,
      freshness: {
        person: freshnessOf(row.person_last_verified_at, now, freshnessDays),
        email: freshnessOf(row.email_last_verified_at, now, freshnessDays),
        phone: freshnessOf(row.phone_last_verified_at, now, freshnessDays),
      },
    }
  })

  // Cobertura por cargo: se compara de forma laxa porque Apollo devuelve
  // variantes ("Head of IT" vs "Head of Information Technology").
  const requestedRoles = uniq((params.roles ?? []).map((r) => r.trim()).filter(Boolean))
  const matchedRoles: string[] = []
  const missingRoles: string[] = []
  for (const role of requestedRoles) {
    const covered = contacts.some(
      (c) => c.freshness.person !== "stale" && titlesOverlap(c.title, role)
    )
    if (covered) matchedRoles.push(role)
    else missingRoles.push(role)
  }

  const freshContacts = contacts.filter((c) => c.freshness.person === "fresh").length
  const withUsableEmail = contacts.filter((c) => c.email && c.freshness.email === "fresh").length
  const withUsablePhone = contacts.filter((c) => c.hasPhone && c.freshness.phone === "fresh").length
  const pendingPhone = contacts.filter((c) => c.phoneStatus === "processing").length

  const { recommended, reason, message } = decideEnrichment({
    planAllows: limits.allowed,
    planReason: limits.reason,
    totalContacts: contacts.length,
    freshContacts,
    withUsableEmail,
    requestedRoles: requestedRoles.length,
    missingRoles,
    companyName: guard.companyName,
    freshnessDays,
  })

  return {
    companyId: params.companyId,
    companyName: guard.companyName,
    accountAccess: guard,
    freshnessDays,
    contacts,
    coverage: {
      totalContacts: contacts.length,
      freshContacts,
      staleContacts: contacts.length - freshContacts,
      withUsableEmail,
      withUsablePhone,
      pendingPhone,
      recommendedRoles: requestedRoles.length,
      matchedRoles,
      missingRoles,
    },
    enrichmentRecommended: recommended,
    enrichmentAllowedByPlan: limits.allowed,
    enrichmentReason: reason,
    message,
  }
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Tasa de éxito histórica por título normalizado. Ordenar por este valor evita
 * quemar créditos de ASCI en cargos que Apollo nunca devuelve para el segmento.
 */
async function getApolloSuccessRates(
  titles: string[]
): Promise<Map<string, { rate: number; attempts: number }>> {
  const result = new Map<string, { rate: number; attempts: number }>()
  if (!titles.length) return result

  const admin = createAdminClient()
  const normalized = uniq(titles.map(normalizeTitle))
  const { data } = await admin
    .from("apollo_title_catalog")
    .select("normalized_title, usage_count, success_count")
    .in("normalized_title", normalized)

  for (const row of data ?? []) {
    const attempts = Number(row.usage_count ?? 0)
    const successes = Number(row.success_count ?? 0)
    // Sin intentos no hay evidencia: se deja null para no penalizar cargos nuevos.
    if (attempts > 0) {
      result.set(row.normalized_title as string, { rate: successes / attempts, attempts })
    }
  }
  return result
}

function decideEnrichment(input: {
  planAllows: boolean
  planReason: string | null
  totalContacts: number
  freshContacts: number
  withUsableEmail: number
  requestedRoles: number
  missingRoles: string[]
  companyName: string | null
  freshnessDays: number
}): { recommended: boolean; reason: string; message: string } {
  const name = input.companyName ?? "la cuenta"

  if (!input.planAllows) {
    return {
      recommended: false,
      reason: "plan_not_allowed",
      message: input.planReason ?? "El plan actual no incluye búsqueda de tomadores de decisión.",
    }
  }

  if (input.totalContacts === 0) {
    return {
      recommended: true,
      reason: "no_contacts",
      message: `No hay ningún contacto guardado para ${name}. Si las señales justifican el interés, tiene sentido buscar tomadores de decisión.`,
    }
  }

  if (input.requestedRoles > 0 && input.missingRoles.length === 0) {
    return {
      recommended: false,
      reason: "coverage_complete",
      message: `Ya hay contactos vigentes para todos los cargos recomendados de ${name}. No hace falta gastar créditos: trabajá con los contactos existentes.`,
    }
  }

  if (input.missingRoles.length > 0) {
    return {
      recommended: true,
      reason: "missing_roles",
      message: `Faltan contactos para ${input.missingRoles.length} cargo(s) relevantes de ${name}: ${input.missingRoles.join(", ")}. Ahí sí conviene buscar.`,
    }
  }

  if (input.freshContacts === 0) {
    return {
      recommended: true,
      reason: "stale_contacts",
      message: `Los ${input.totalContacts} contacto(s) de ${name} superan los ${input.freshnessDays} días de antigüedad. Conviene re-verificarlos antes de usarlos.`,
    }
  }

  if (input.withUsableEmail === 0) {
    return {
      recommended: true,
      reason: "missing_contact_data",
      message: `Hay contactos vigentes en ${name} pero ninguno con email utilizable. Enriquecerlos permitiría contactarlos.`,
    }
  }

  return {
    recommended: false,
    reason: "coverage_sufficient",
    message: `${name} ya tiene ${input.freshContacts} contacto(s) vigentes con datos utilizables. No recomiendo gastar créditos todavía.`,
  }
}

/**
 * Fuerza de un driver dentro de la cuenta, en escala 0..1.
 *
 * Deliberadamente NO usa el conteo absoluto: se normaliza contra el driver más
 * fuerte de la misma cuenta para que el resultado sea comparable entre una pyme
 * con 20 señales y una corporación con 40.000. La recencia aporta hasta un 30%
 * extra, porque un área que muestra actividad reciente es mejor punto de entrada
 * que una que aparece solo en evidencia histórica.
 */
function driverStrength(count: number, maxCount: number, latestAt: string | null): number {
  const relative = count / maxCount
  let recency = 0
  if (latestAt) {
    const ageDays = (Date.now() - new Date(latestAt).getTime()) / 86_400_000
    if (ageDays <= 90) recency = 0.3
    else if (ageDays <= 180) recency = 0.2
    else if (ageDays <= 365) recency = 0.1
  }
  return Math.min(1, relative * 0.7 + recency)
}

function freshnessOf(value: string | null, now: number, days: number): FreshnessState {
  if (!value) return "never_verified"
  const ageDays = (now - new Date(value).getTime()) / 86_400_000
  return ageDays <= days ? "fresh" : "stale"
}

/**
 * Confianza sobre la escala normalizada de driverStrength (cada driver aporta 0..1).
 * Un cargo respaldado por varios drivers fuertes es más creíble que uno que
 * depende de una sola señal aislada.
 */
function confidenceOf(
  weight: number,
  justifications: number,
  successRate: number | null,
  origin: RoleOrigin
): "high" | "medium" | "low" {
  if (origin === "user_input") return "low"
  if (justifications >= 2 && weight >= 1.2) return "high"
  if (weight >= 0.8 && (successRate === null || successRate >= 0.4)) return "high"
  if (weight >= 0.4) return "medium"
  return "low"
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

/** Comparación laxa de títulos: Apollo devuelve variantes del mismo rol. */
function titlesOverlap(actual: string | null, expected: string): boolean {
  if (!actual) return false
  const a = normalizeTitle(actual)
  const b = normalizeTitle(expected)
  if (a === b || a.includes(b) || b.includes(a)) return true

  const stop = new Set(["of", "the", "and", "for", "head", "chief", "officer", "director", "manager", "vp"])
  const aTokens = new Set(a.split(" ").filter((t) => t.length > 2 && !stop.has(t)))
  const bTokens = b.split(" ").filter((t) => t.length > 2 && !stop.has(t))
  if (!bTokens.length) return false
  const hits = bTokens.filter((t) => aTokens.has(t)).length
  return hits / bTokens.length >= 0.6
}

function uniq<T>(values: T[]): T[] {
  return [...new Set(values)]
}
