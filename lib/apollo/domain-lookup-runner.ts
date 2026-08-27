/**
 * Drenaje de la cola de lookup de dominio por nombre (Apollo, gratuito).
 *
 * QUE LO FRENA (en este orden)
 * ============================
 * 1. La cuota horaria del plan: 400 llamadas/hora sobre `organizations/search`.
 *    Este proceso usa 350 y deja 50 libres a proposito — si el barrido se
 *    comiera las 400, una busqueda manual se toparia con un 429 provocado por
 *    un proceso que puede esperar. El barrido tiene meses; la persona no.
 * 2. El presupuesto de tiempo de la funcion serverless.
 * 3. La cola vacia.
 * Los tres motivos quedan en el resultado, para que el cron no mienta sobre
 * por que hizo poco.
 *
 * COMO SE CUENTA LA CUOTA
 * No con un contador propio: leyendo `apollo_api_calls`, que es donde el
 * cliente HTTP ya registra cada llamada. Asi el presupuesto sale de lo que
 * REALMENTE se llamo en la ultima hora —incluidas las llamadas manuales de otra
 * persona y las de una corrida anterior que murio a mitad— y no de una cuenta
 * teorica de "6 corridas por hora x N".
 *
 * QUE ESCRIBE EN companies
 * Solo los `auto_ok`, y solo en columnas vacias. Un match difuso promovido de
 * mas no se nota al escribirlo: se nota cuando alguien contacta a la empresa
 * equivocada. Los `revisar` quedan en la cola con su score, esperando ojo
 * humano; no se promueven solos nunca.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  classifyMatch,
  lookupOrganizationsByName,
  pickBestCandidate,
  LOOKUP_HOURLY_BUDGET,
  type LookupCandidate,
} from "./domain-lookup"

/** Tope por corrida. Con 350/hora y el cron cada 10', ~58 es el reparto parejo. */
export const DEFAULT_LIMIT = 58

/** Pausa entre llamadas. 350/hora son ~10s; no hay nada que ganar yendo mas rapido. */
const SLEEP_MS = 250

/** Cuanto se posterga una fila que fallo por error de red o HTTP. */
const RETRY_DELAY_MS = 60 * 60 * 1000

/**
 * Tope de intentos. Una fila que falla siempre —un nombre que revienta el
 * parser, una constraint que no va a ceder— se reintentaria para siempre y
 * cada reintento gasta cuota que le sacamos a las filas que si pueden avanzar.
 */
const MAX_ATTEMPTS = 3

type QueueRow = {
  company_id: string
  queried_name: string
  queried_country_iso: string | null
  attempts: number
}

type CompanyRow = {
  id: string
  website: string | null
  logo_url: string | null
  apollo_organization_id: string | null
}

export type DomainLookupRunResult = {
  /** Cuota que quedaba al empezar, ya descontadas las llamadas de la ultima hora */
  hourlyBudgetLeft: number
  claimed: number
  processed: number
  /** Promovidos a companies.website */
  autoOk: number
  /** Con dominio pero score insuficiente: esperan revision */
  revisar: number
  descartado: number
  matchSinDominio: number
  sinMatch: number
  errors: number
  calls: number
  /** Columnas genericas completadas, por nombre */
  filled: Record<string, number>
  stoppedForBudget: boolean
  stoppedForQuota: boolean
  stoppedForRateLimit: boolean
  dryRun: boolean
  pendingLeft: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** '' cuenta como vacio: hay ~66k filas historicas con string vacio. */
function isEmpty(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === ""
}

/**
 * Llamadas al endpoint en la ultima hora, segun el ledger. Es la unica fuente
 * de verdad disponible: la cuota la lleva Apollo y no la expone.
 */
async function callsLastHour(db: SupabaseClient): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error } = await db
    .from("apollo_api_calls")
    .select("id", { count: "exact", head: true })
    .eq("endpoint", "organizations/search")
    .gte("created_at", since)

  if (error) {
    // Sin ledger no sabemos cuanto se gasto. Asumir cero seria optimista de la
    // peor manera: nos comeriamos la reserva manual. Asumimos el peor caso.
    console.error("[apollo-domain] no se pudo leer el ledger:", error.message)
    return LOOKUP_HOURLY_BUDGET
  }
  return count ?? 0
}

async function countPending(db: SupabaseClient): Promise<number> {
  const { count } = await db
    .schema("v3")
    .from("apollo_domain_lookup")
    .select("company_id", { count: "exact", head: true })
    .in("status", ["pending", "error"])
    .lt("attempts", MAX_ATTEMPTS)
  return count ?? 0
}

async function markError(db: SupabaseClient, companyId: string, attempts: number, message: string) {
  const intentos = attempts + 1
  const agotada = intentos >= MAX_ATTEMPTS
  await db
    .schema("v3")
    .from("apollo_domain_lookup")
    .update({
      status: agotada ? "failed" : "error",
      error_message: message.slice(0, 500),
      attempts: intentos,
      checked_at: new Date().toISOString(),
      next_attempt_at: agotada ? null : new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
    })
    .eq("company_id", companyId)
}

/**
 * Promueve un match `auto_ok` a `companies`. Misma regla de precedencia que
 * lib/apollo/company-writer.ts: las columnas genericas solo se completan si
 * estan vacias, nunca se pisan.
 */
async function promote(
  db: SupabaseClient,
  company: CompanyRow,
  candidate: LookupCandidate,
): Promise<string[]> {
  const patch: Record<string, unknown> = {}
  const filled: string[] = []

  // El dominio es lo que vinimos a buscar. `website_url` trae la URL completa;
  // si Apollo no la da, el dominio pelado alcanza: normalizeDomain() lo maneja.
  const website = candidate.websiteUrl ?? candidate.domain
  if (isEmpty(company.website) && !isEmpty(website)) {
    patch.website = website
    filled.push("website")
  }
  if (isEmpty(company.logo_url) && !isEmpty(candidate.logoUrl)) {
    patch.logo_url = candidate.logoUrl
    filled.push("logo_url")
  }
  // Guardar el org id le ahorra a la cola de enrichment (esa si paga) tener que
  // resolver la empresa de nuevo.
  if (isEmpty(company.apollo_organization_id) && !isEmpty(candidate.apolloOrganizationId)) {
    patch.apollo_organization_id = candidate.apolloOrganizationId
    filled.push("apollo_organization_id")
  }

  if (Object.keys(patch).length === 0) return []

  const { error } = await db.from("companies").update(patch).eq("id", company.id)
  if (error) throw new Error(`promocion fallida: ${error.message}`)
  return filled
}

/**
 * Procesa hasta `limit` filas de la cola, sin pasarse de la reserva horaria.
 */
export async function runApolloDomainLookup(
  opts: { limit?: number; budgetMs?: number; dryRun?: boolean } = {},
): Promise<DomainLookupRunResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT
  const budgetMs = opts.budgetMs ?? 45_000
  const dryRun = opts.dryRun ?? false
  const startedAt = Date.now()
  const db = createAdminClient()

  const result: DomainLookupRunResult = {
    hourlyBudgetLeft: 0,
    claimed: 0,
    processed: 0,
    autoOk: 0,
    revisar: 0,
    descartado: 0,
    matchSinDominio: 0,
    sinMatch: 0,
    errors: 0,
    calls: 0,
    filled: {},
    stoppedForBudget: false,
    stoppedForQuota: false,
    stoppedForRateLimit: false,
    dryRun,
    pendingLeft: 0,
  }

  const used = await callsLastHour(db)
  const quotaLeft = Math.max(0, LOOKUP_HOURLY_BUDGET - used)
  result.hourlyBudgetLeft = quotaLeft

  if (quotaLeft === 0) {
    result.stoppedForQuota = true
    result.pendingLeft = await countPending(db)
    return result
  }

  const toProcess = Math.min(limit, quotaLeft)

  const { data: queue, error: queueError } = await db
    .schema("v3")
    .from("apollo_domain_lookup")
    .select("company_id, queried_name, queried_country_iso, attempts")
    .in("status", ["pending", "error"])
    .lt("attempts", MAX_ATTEMPTS)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
    .limit(toProcess)
    .returns<QueueRow[]>()

  if (queueError) throw new Error(`no se pudo leer la cola: ${queueError.message}`)

  result.claimed = queue?.length ?? 0
  if (!queue || queue.length === 0) {
    result.pendingLeft = await countPending(db)
    return result
  }

  for (const row of queue) {
    if (Date.now() - startedAt > budgetMs) {
      result.stoppedForBudget = true
      break
    }

    if (dryRun) {
      result.processed++
      continue
    }

    const lookup = await lookupOrganizationsByName({
      name: row.queried_name,
      companyId: row.company_id,
    })
    result.calls++

    if (!lookup.ok) {
      // 429 = cuota horaria agotada antes de lo que decia el ledger (por
      // ejemplo, alguien llamando por fuera de la app). Insistir no la
      // devuelve: cortamos y la fila queda intacta para la proxima corrida.
      if (lookup.rateLimited) {
        result.stoppedForRateLimit = true
        break
      }
      result.errors++
      await markError(db, row.company_id, row.attempts, lookup.error)
      continue
    }

    const candidate = pickBestCandidate(lookup.candidates)
    const score = classifyMatch(row.queried_name, candidate)
    result.processed++

    const checkpoint: Record<string, unknown> = {
      status: score.klass,
      apollo_organization_id: candidate?.apolloOrganizationId ?? null,
      matched_name: candidate?.name ?? null,
      candidate_domain: candidate?.domain ?? null,
      similarity: score.similarity,
      containment: score.containment,
      geo_mismatch: score.geoMismatch.length > 0 ? score.geoMismatch : null,
      payload: candidate ? (candidate as unknown as Record<string, unknown>) : null,
      attempts: row.attempts + 1,
      checked_at: new Date().toISOString(),
      next_attempt_at: null,
      error_message: null,
    }

    if (score.klass === "auto_ok" && candidate) {
      const { data: company } = await db
        .from("companies")
        .select("id, website, logo_url, apollo_organization_id")
        .eq("id", row.company_id)
        .maybeSingle<CompanyRow>()

      if (company) {
        try {
          const filled = await promote(db, company, candidate)
          for (const col of filled) result.filled[col] = (result.filled[col] ?? 0) + 1
          // 'promoted' distingue "lo escribimos" de "matcheo bien pero la
          // columna ya tenia dato": sin eso no se puede auditar el aporte real.
          checkpoint.status = filled.length > 0 ? "promoted" : "auto_ok"
        } catch (error) {
          result.errors++
          await markError(
            db,
            row.company_id,
            row.attempts,
            error instanceof Error ? error.message : "promocion fallida",
          )
          continue
        }
      }
      result.autoOk++
    } else if (score.klass === "revisar") result.revisar++
    else if (score.klass === "descartado") result.descartado++
    else if (score.klass === "match_sin_dominio") result.matchSinDominio++
    else if (score.klass === "sin_match") result.sinMatch++

    await db
      .schema("v3")
      .from("apollo_domain_lookup")
      .update(checkpoint)
      .eq("company_id", row.company_id)

    await sleep(SLEEP_MS)
  }

  result.pendingLeft = await countPending(db)
  return result
}
