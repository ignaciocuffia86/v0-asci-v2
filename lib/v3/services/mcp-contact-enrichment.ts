import "server-only"

/**
 * Fase 3 — Enrichment de contactos vía Apollo por MCP.
 *
 * Se parte en dos tools a propósito:
 *
 *   prepare_contact_enrichment → congela un plan (cargos, maxContacts, costo)
 *                                y devuelve un planHash. No gasta créditos.
 *   run_contact_enrichment     → ejecuta EXACTAMENTE ese planHash. Gasta créditos.
 *
 * El planHash es lo que impide que el modelo cambie los cargos o el maxContacts
 * entre lo que el usuario confirmó y lo que realmente se ejecuta y se cobra.
 *
 * Contabilidad de créditos (los absorbe ASCI, por eso el tope es por plan):
 *   - Se RESERVA el peor caso (maxContacts), porque antes de buscar no sabemos
 *     cuántas personas va a devolver Apollo.
 *   - Se COMMITEA solo lo realmente enriquecido, vía commitReservationWithUnits.
 *   - Un hit de caché libera la reserva completa: 0 créditos.
 */

import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { getContactEnrichmentLimits } from "@/lib/v3/plans"
import {
  reserveMcpUsage,
  commitReservationWithUnits,
  setReservationStatus,
  getMonthlyPoolUsage,
  requirePaidMcp,
  type McpPrincipal,
} from "@/lib/v3/mcp-usage"
import { searchPeople } from "@/lib/apollo/search"
import { enrichMany, type EnrichedPerson } from "@/lib/apollo/enrich"
import { readSearchCache, writeSearchCache } from "@/lib/apollo/search-cache"
import { hashSearchParams, type SearchParams } from "@/lib/apollo/query-hash"
import { sanitizeTitleList } from "@/lib/apollo/title-validator"
import { normalizeDomain } from "@/lib/apollo/domain"
import { resolveCompanyOrganizationId } from "@/lib/apollo/organizations"
import { recordTitleObservations, recordTitleSuccess } from "@/lib/apollo/title-catalog"
import { requireSavedAccount } from "@/lib/v3/mcp-account-lifecycle"

const POOL = "apollo_enrichment" as const
const PREPARE_TTL_MINUTES = 30

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type PrepareInput = {
  companyId: string
  roles: string[]
  maxContacts?: number
  /** Filtra por ubicación de la empresa en lugar de la persona. */
  useOrganizationLocation?: boolean
  /** Reintentar con la misma key devuelve la misma preparación. */
  idempotencyKey?: string
}

/**
 * Identidad de la organización de Apollo contra la que se va a buscar.
 *
 * Existe por el caso de empresas fusionadas o renombradas (ej: "Banco Francés
 * Argentina" es el nombre viejo de BBVA Argentina). Cuando la fila no tiene
 * dominio y se resuelve POR NOMBRE, Apollo hace fuzzy match y puede devolver la
 * entidad vieja, la sucesora, o una empresa parecida de otro país — en silencio.
 * El usuario tiene que poder verificar CONTRA QUIÉN se va a gastar antes del run.
 */
export type ResolvedOrgIdentity = {
  /** Cómo se llegó al organization_id. `name_lookup` es el de menor confianza. */
  method: "stored" | "domain" | "name_lookup"
  apolloName: string | null
  apolloDomain: string | null
  employees: number | null
  industry: string | null
  country: string | null
  linkedinUrl: string | null
  /** Presente solo cuando la identidad requiere confirmación humana. */
  warning: string | null
}

export type PreparedPlan = {
  planHash: string
  companyId: string
  companyName: string
  /** null solo si la empresa se va a buscar por dominio sin org_id. */
  resolvedOrganization: ResolvedOrgIdentity | null
  roles: string[]
  rejectedRoles: Array<{ input: string; reason: string }>
  maxContacts: number
  /** Créditos en el peor caso. El commit real puede ser menor. */
  maxCredits: number
  expiresAt: string
  monthly: { used: number; limit: number; remaining: number }
  /** true si ya hay datos frescos en caché: la ejecución no gastaría créditos. */
  likelyCacheHit: boolean
  freshnessDays: number
}

export type RunResult = {
  planHash: string
  companyId: string
  contacts: EnrichedPerson[]
  contactsFound: number
  contactsWithEmail: number
  creditsSpent: number
  fromCache: boolean
}

/** Error con código estable para que la capa MCP lo traduzca. */
export class EnrichmentError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = "EnrichmentError"
  }
}

// ---------------------------------------------------------------------------
// prepare_contact_enrichment
// ---------------------------------------------------------------------------

export async function prepareContactEnrichment(
  principal: McpPrincipal,
  input: PrepareInput,
): Promise<PreparedPlan> {
  await requirePaidMcp(principal, "contacts:write", "server_managed")

  const limits = await getContactEnrichmentLimits(principal.workspaceId)
  if (!limits.allowed) {
    throw new EnrichmentError("PLAN_REQUIRED", limits.reason ?? "Tu plan no permite enrichment de contactos.")
  }

  // La cuenta tiene que estar guardada en el workspace, igual que exigen
  // recommend_contact_roles y get_company_contacts. Sin esto se podrían gastar
  // créditos de Apollo en empresas que el workspace no está trabajando.
  const guard = await requireSavedAccount(principal, input.companyId)
  if (guard.state !== "saved") {
    throw new EnrichmentError(
      `ACCOUNT_${guard.state.toUpperCase()}`,
      guard.message ?? "La cuenta tiene que estar guardada en el workspace antes de buscar contactos.",
    )
  }

  const admin = createAdminClient()

  // 1) Resolver la empresa. `companies` no tiene columna `domain`: el dominio se
  //    deriva de `website` con normalizeDomain.
  const { data: company, error: companyError } = await admin
    .from("companies")
    .select("id, name, website, country, apollo_organization_id")
    .eq("id", input.companyId)
    .maybeSingle()

  if (companyError) throw new EnrichmentError("COMPANY_LOOKUP_FAILED", companyError.message)
  if (!company) throw new EnrichmentError("COMPANY_NOT_FOUND", "No encontré esa empresa en el catálogo.")

  const domain = normalizeDomain(company.website)?.primary ?? null

  // Muchas empresas del catálogo no tienen website ni organization_id (por ejemplo
  // "Banco Francés Argentina", cargada desde LinkedIn sin dominio). Antes de
  // rendirse hay que intentar resolverla contra Apollo: `organizations/enrich`
  // acepta `name` cuando no hay dominio y cuesta 0 créditos, así que resolver acá
  // es gratis y evita un COMPANY_NOT_RESOLVABLE innecesario.
  let organizationId = company.apollo_organization_id ?? null
  let resolvedOrganization: ResolvedOrgIdentity | null = organizationId
    ? {
        method: "stored",
        apolloName: null,
        apolloDomain: null,
        employees: null,
        industry: null,
        country: null,
        linkedinUrl: null,
        // El resolvedor persiste en `companies` el org_id que obtuvo, incluso si
        // lo resolvió por nombre. Sin este warning, la SEGUNDA preparación de una
        // empresa mal matcheada caería en "stored" y el riesgo quedaría oculto.
        // Si hay org_id guardado pero la empresa sigue sin website, lo más
        // probable es que aquella resolución haya sido por nombre.
        warning: domain
          ? null
          : `Hay un organization_id de Apollo guardado para "${company.name}", pero la empresa no tiene sitio web cargado, así que probablemente fue resuelto por nombre en el pasado. Si la empresa fue fusionada o renombrada, puede apuntar a la entidad equivocada. Confirmá con el usuario antes de ejecutar.`,
      }
    : null

  if (!organizationId) {
    const resolved = await resolveCompanyOrganizationId(input.companyId, { userId: principal.userId })
    if (resolved.status === "found") {
      organizationId = resolved.organizationId

      // Sin dominio, la resolución fue POR NOMBRE: el match es difuso y puede
      // apuntar a la entidad equivocada (fusiones, renombres, homónimos).
      // Se expone la identidad y se marca para confirmación humana.
      const viaName = !domain
      const org = resolved.organization
      const identityBits = [
        org?.name ?? null,
        org?.primaryDomain ? `dominio ${org.primaryDomain}` : null,
        org?.employeesCount != null ? `${org.employeesCount} empleados` : null,
        org?.country ?? null,
      ]
        .filter(Boolean)
        .join(", ")

      resolvedOrganization = {
        method: viaName ? "name_lookup" : "domain",
        apolloName: org?.name ?? null,
        apolloDomain: org?.primaryDomain ?? null,
        employees: org?.employeesCount ?? null,
        industry: org?.industry ?? null,
        country: org?.country ?? null,
        linkedinUrl: org?.linkedinUrl ?? null,
        warning: viaName
          ? `La empresa no tiene sitio web cargado, así que se resolvió por NOMBRE contra Apollo${
              identityBits ? ` y el match fue: ${identityBits}` : ""
            }. Si "${company.name}" fue fusionada o renombrada (nombre viejo), este match puede apuntar a la entidad equivocada. Mostrale esta identidad al usuario y confirmá que es la empresa correcta ANTES de ejecutar el run.`
          : null,
      }
    } else if (resolved.status === "error") {
      // Falla de infraestructura (API key ausente, 5xx, red), NO un problema de
      // datos de la empresa. Se distingue con un código propio: si acá se
      // devolviera COMPANY_NOT_RESOLVABLE, el modelo le pediría al usuario que
      // "cargue el website" cuando en realidad no hay nada que él pueda arreglar.
      throw new EnrichmentError(
        "APOLLO_UNAVAILABLE",
        `No pude consultar Apollo para resolver ${company.name}: ${resolved.reason}. Es un problema de configuración o del servicio, no de la empresa. No se gastaron créditos.`,
      )
    } else if (!domain) {
      // not_found + sin dominio: no hay forma de anclar la búsqueda a la empresa.
      // Buscar solo por cargo devolvería gente de cualquier compañía y gastaría
      // créditos en contactos inútiles, así que se corta acá.
      throw new EnrichmentError(
        "COMPANY_NOT_RESOLVABLE",
        `No puedo buscar contactos de ${company.name}: Apollo no la tiene indexada (${resolved.reason}) y la empresa no tiene sitio web para derivar el dominio. Cargale el website y reintentá.`,
      )
    }
  }

  // 2) Validar cargos con el límite del plan (nunca hardcodear 10).
  const sanitized = sanitizeTitleList(input.roles ?? [], { max: limits.maxRoles })
  if (sanitized.accepted.length === 0) {
    throw new EnrichmentError(
      "NO_VALID_ROLES",
      `Ningún cargo es válido. Rechazados: ${sanitized.rejected.map((r) => `${r.input} (${r.reason})`).join("; ") || "lista vacía"}.`,
    )
  }

  const maxContacts = Math.min(Math.max(1, input.maxContacts ?? limits.maxContacts), limits.maxContacts)

  // 3) Cupo MENSUAL. El RPC solo controla minuto/día/semana, así que sin este
  //    chequeo el tope por plan sería decorativo.
  const used = await getMonthlyPoolUsage(principal.workspaceId, POOL)
  const remaining = Math.max(0, limits.monthlyUnits - used)
  if (remaining <= 0) {
    throw new EnrichmentError(
      "MONTHLY_LIMIT_REACHED",
      `Agotaste tu cupo mensual de enrichment (${limits.monthlyUnits} contactos en el plan ${limits.plan}). Se renueva el 1° del mes que viene.`,
    )
  }

  // Nunca reservar más de lo que queda en el mes.
  const effectiveMax = Math.min(maxContacts, remaining)

  const searchParams: SearchParams = {
    organizationId,
    domain,
    jobTitles: sanitized.accepted,
    country: company.country ?? null,
    useOrganizationLocation: input.useOrganizationLocation === true,
    maxResults: effectiveMax,
    revealEmail: true,
    revealPhone: false, // Fase 3 es solo email. El teléfono llega en Fase 5.
  }

  const queryHash = hashSearchParams(searchParams)

  // 4) ¿Ya hay datos frescos? Se avisa en el preview para que el usuario sepa
  //    que confirmar no gasta créditos. TTL = frescura del plan (90 días).
  const cached = await readSearchCache(queryHash, limits.freshnessDays, { enabled: true })

  // 5) planHash: liga la preparación a ESTOS parámetros exactos.
  const planPayload = { ...searchParams, companyId: company.id, queryHash, maxContacts: effectiveMax }
  const planHash = crypto.createHash("sha256").update(JSON.stringify(planPayload)).digest("hex").slice(0, 40)

  const idempotencyKey = input.idempotencyKey?.trim() || `prep:${planHash}`
  const expiresAt = new Date(Date.now() + PREPARE_TTL_MINUTES * 60 * 1000)

  // 6) Reservar el peor caso. Un hit de caché la libera sin cobrar.
  const reservation = await reserveMcpUsage({
    principal,
    pool: POOL,
    units: effectiveMax,
    idempotencyKey,
    metadata: { companyId: company.id, planHash, roles: sanitized.accepted },
  })

  if (!reservation.allowed) {
    throw new EnrichmentError(
      reservation.code ?? "RATE_LIMITED",
      "Alcanzaste el límite de uso por ahora. Esperá unos minutos y volvé a intentar.",
    )
  }

  const { error: insertError } = await admin
    .schema("v3")
    .from("contact_enrichment_runs")
    .upsert(
      {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        api_key_id: principal.keyId,
        company_id: company.id,
        plan_hash: planHash,
        plan_payload: planPayload,
        reservation_id: reservation.reservationId ?? null,
        idempotency_key: idempotencyKey,
        status: "prepared",
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "workspace_id,idempotency_key" },
    )

  if (insertError) {
    // No dejar la reserva colgada ocupando cupo si no pudimos persistir el plan.
    if (reservation.reservationId) {
      await setReservationStatus(reservation.reservationId, "released", { reason: "prepare_persist_failed" })
    }
    throw new EnrichmentError("PREPARE_FAILED", insertError.message)
  }

  return {
    planHash,
    companyId: company.id,
    companyName: company.name,
    resolvedOrganization,
    roles: sanitized.accepted,
    rejectedRoles: sanitized.rejected,
    maxContacts: effectiveMax,
    maxCredits: cached.hit ? 0 : effectiveMax,
    expiresAt: expiresAt.toISOString(),
    monthly: { used, limit: limits.monthlyUnits, remaining },
    likelyCacheHit: cached.hit,
    freshnessDays: limits.freshnessDays,
  }
}

// ---------------------------------------------------------------------------
// run_contact_enrichment
// ---------------------------------------------------------------------------

export async function runContactEnrichment(
  principal: McpPrincipal,
  args: { planHash: string },
): Promise<RunResult> {
  await requirePaidMcp(principal, "contacts:write", "server_managed")

  const admin = createAdminClient()

  const { data: run, error: runError } = await admin
    .schema("v3")
    .from("contact_enrichment_runs")
    .select("*")
    .eq("workspace_id", principal.workspaceId)
    .eq("plan_hash", args.planHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (runError) throw new EnrichmentError("RUN_LOOKUP_FAILED", runError.message)
  if (!run) {
    throw new EnrichmentError(
      "PLAN_NOT_FOUND",
      "Ese plan no existe. Llamá primero a prepare_contact_enrichment y confirmá con el usuario.",
    )
  }

  // Idempotencia: si ya se completó, devolver lo guardado sin volver a pagar.
  if (run.status === "completed") {
    const contacts = await loadRunContacts(principal.workspaceId, run.company_id, run.plan_payload?.queryHash)
    return {
      planHash: args.planHash,
      companyId: run.company_id,
      contacts,
      contactsFound: run.contacts_found,
      contactsWithEmail: run.contacts_with_email,
      creditsSpent: run.credits_spent,
      fromCache: true,
    }
  }

  if (run.status === "running") {
    throw new EnrichmentError("ALREADY_RUNNING", "Esa búsqueda ya se está ejecutando. Esperá a que termine.")
  }
  if (run.status !== "prepared") {
    throw new EnrichmentError("PLAN_NOT_RUNNABLE", `El plan está en estado "${run.status}" y no se puede ejecutar.`)
  }
  if (new Date(run.expires_at).getTime() < Date.now()) {
    await admin
      .schema("v3")
      .from("contact_enrichment_runs")
      .update({ status: "expired" })
      .eq("id", run.id)
    if (run.reservation_id) {
      await setReservationStatus(run.reservation_id, "released", { reason: "plan_expired" })
    }
    throw new EnrichmentError(
      "PLAN_EXPIRED",
      "El plan venció. Volvé a llamar a prepare_contact_enrichment para reconfirmar.",
    )
  }

  // Lock optimista: solo un runner pasa de 'prepared' a 'running'.
  const { data: locked, error: lockError } = await admin
    .schema("v3")
    .from("contact_enrichment_runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", run.id)
    .eq("status", "prepared")
    .select("id")
    .maybeSingle()

  if (lockError) throw new EnrichmentError("RUN_LOCK_FAILED", lockError.message)
  if (!locked) throw new EnrichmentError("ALREADY_RUNNING", "Otra ejecución tomó este plan primero.")

  const plan = run.plan_payload as SearchParams & { companyId: string; queryHash: string; maxContacts: number }
  const limits = await getContactEnrichmentLimits(principal.workspaceId)

  try {
    let contacts: EnrichedPerson[] = []
    let totalEntries = 0
    let fromCache = false
    let creditsSpent = 0

    // 1) Caché primero. Lectura habilitada explícitamente (v3 opt-in).
    const cached = await readSearchCache(plan.queryHash, limits.freshnessDays, { enabled: true })

    if (cached.hit) {
      contacts = cached.contacts
      totalEntries = cached.totalEntries
      fromCache = true
    } else {
      // 2) Buscar en Apollo. El search no cobra por persona; cobra el enrichment.
      const search = await searchPeople({
        ...plan,
        userId: principal.userId,
        bookmarkId: null,
        companyId: plan.companyId,
        maxResults: plan.maxContacts,
      })

      if (!search.ok) {
        throw new EnrichmentError("APOLLO_SEARCH_FAILED", `Apollo devolvió un error (${search.status}): ${search.error}`)
      }

      totalEntries = search.totalEntries

      if (search.people.length > 0) {
        // 3) Enrichment: acá se gastan los créditos, uno por contacto.
        contacts = await enrichMany(
          search.people.slice(0, plan.maxContacts),
          { userId: principal.userId, bookmarkId: null, companyId: plan.companyId, revealEmail: true },
          4,
        )
        creditsSpent = contacts.length

        await writeSearchCache({
          queryHash: plan.queryHash,
          params: { ...plan, companyId: plan.companyId },
          totalEntries,
          contacts,
          pagesFetched: search.pagesFetched,
          fetchedBy: principal.userId,
        })
      }

      // 4) Alimentar el catálogo de títulos. Sin esto el ordenamiento por tasa
      //    de éxito de Fase 2 nunca aprende.
      await recordTitleObservations(
        contacts
          .filter((c) => Boolean(c.title))
          .map((c) => ({
            title: c.title as string,
            seniority: c.seniority,
            departments: c.departments,
          })),
      )
      await recordTitleSuccess(plan.jobTitles, contacts.length)
    }

    // 5) Vincular al workspace. La PII vive en el caché global compartido;
    //    account_contacts solo referencia apollo_cache_id.
    await linkContactsToAccount({
      workspaceId: principal.workspaceId,
      companyId: plan.companyId,
      contacts,
      matchedRoles: plan.jobTitles,
    })

    const withEmail = contacts.filter((c) => Boolean(c.email)).length

    // 6) Cobrar SOLO lo consumido. Un hit de caché libera la reserva entera.
    if (run.reservation_id) {
      await commitReservationWithUnits(run.reservation_id, creditsSpent, {
        companyId: plan.companyId,
        fromCache,
        contactsFound: contacts.length,
      })
    }

    await admin
      .schema("v3")
      .from("contact_enrichment_runs")
      .update({
        status: "completed",
        contacts_found: contacts.length,
        contacts_with_email: withEmail,
        credits_spent: creditsSpent,
        cache_hit: fromCache,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id)

    return {
      planHash: args.planHash,
      companyId: plan.companyId,
      contacts,
      contactsFound: contacts.length,
      contactsWithEmail: withEmail,
      creditsSpent,
      fromCache,
    }
  } catch (err) {
    // Falló: devolver el crédito. Si no, el usuario paga por nada.
    if (run.reservation_id) {
      await setReservationStatus(run.reservation_id, "released", { reason: "run_failed" })
    }
    await admin
      .schema("v3")
      .from("contact_enrichment_runs")
      .update({
        status: "failed",
        error_message: err instanceof Error ? err.message : String(err),
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id)
    throw err
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Vincula contactos del caché global a la cuenta del workspace.
 *
 * No duplica PII: account_contacts referencia apollo_cache_id. Así el workspace B
 * reusa lo que el workspace A ya pagó, que es la decisión de diseño acordada.
 */
async function linkContactsToAccount(opts: {
  workspaceId: string
  companyId: string
  contacts: EnrichedPerson[]
  matchedRoles: string[]
}): Promise<void> {
  if (opts.contacts.length === 0) return

  const admin = createAdminClient()
  const apolloIds = opts.contacts.map((c) => c.apolloId).filter(Boolean)
  if (apolloIds.length === 0) return

  const { data: cacheRows } = await admin
    .from("apollo_contacts_cache")
    .select("id, apollo_id")
    .in("apollo_id", apolloIds)

  const cacheIdByApolloId = new Map((cacheRows ?? []).map((r) => [r.apollo_id as string, r.id as string]))
  const nowIso = new Date().toISOString()

  const rows = opts.contacts
    .filter((c) => c.apolloId)
    .map((c) => ({
      workspace_id: opts.workspaceId,
      company_id: opts.companyId,
      apollo_person_id: c.apolloId,
      apollo_cache_id: cacheIdByApolloId.get(c.apolloId) ?? null,
      person_last_verified_at: nowIso,
      email_last_verified_at: c.email ? nowIso : null,
      phone_status: "not_requested",
      role_origin: "mcp_enrichment",
      matched_role: matchRole(c.title, opts.matchedRoles),
      first_seen_at: nowIso,
    }))

  const { error } = await admin
    .schema("v3")
    .from("account_contacts")
    .upsert(rows, { onConflict: "workspace_id,company_id,apollo_person_id" })

  if (error) throw new EnrichmentError("LINK_CONTACTS_FAILED", error.message)
}

/** Cargo solicitado que mejor explica el título devuelto por Apollo. */
function matchRole(title: string | null, roles: string[]): string | null {
  if (!title) return null
  const lower = title.toLowerCase()
  return roles.find((r) => lower.includes(r.toLowerCase())) ?? roles[0] ?? null
}

/** Recupera los contactos de un run ya completado, sin volver a pagar. */
async function loadRunContacts(
  workspaceId: string,
  companyId: string,
  queryHash: string | undefined,
): Promise<EnrichedPerson[]> {
  if (!queryHash) return []
  const cached = await readSearchCache(queryHash, 3650, { enabled: true })
  return cached.hit ? cached.contacts : []
}
