/**
 * Drenaje de la cola de enrichment de organizaciones de Apollo.
 *
 * POR QUE UNA COLA Y NO UN BARRIDO
 * ================================
 * El catalogo tiene ~61.300 empresas con website sin resolver. Barrerlo entero
 * son ~38.000 creditos, y esa es una decision de gasto que toma el dueño del
 * proyecto, no un cron. Asi que el trabajo no se descubre: se SIEMBRA.
 *
 * `v3.apollo_company_enrichment` con `status = 'pending'` es la cola. Este
 * runner solo procesa lo que ya esta sembrado ahi y nunca sale a buscar
 * candidatas por su cuenta. Consecuencia deliberada: con la cola vacia el cron
 * corre, no encuentra nada y gasta cero. Autorizar otro lote es un INSERT.
 *
 * REGLAS DE ESCRITURA -> lib/apollo/company-writer.ts
 *   apollo_*  siempre | genericas solo si estan vacias | industry/is_public nunca
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { bulkEnrichOrganizations, chunkForBulk, BULK_MAX_DOMAINS } from "./bulk-organizations"
import { applyCompanyEnrichment, buildNotFoundUpdate, type CompanyEnrichTarget } from "./company-writer"
import { isNearLimit, type ApolloRateLimits } from "./rate-limits"

/** Tope por corrida. 100 dominios son 10 llamadas bulk: entra holgado en el budget. */
export const DEFAULT_LIMIT = 100

/** Margen de cuota por debajo del cual se corta la corrida en vez de comerse un 429. */
const RATE_LIMIT_MARGIN = 20

/** Espera entre lotes. Con 1000 req/min medidos, 150ms deja ~6.7 req/s: menos de la mitad. */
const SLEEP_MS = 150

/** Cuanto se posterga una fila que fallo por error de red o HTTP. */
const RETRY_DELAY_MS = 30 * 60 * 1000

/**
 * Tope de intentos por empresa. Sin el, una fila que falla SIEMPRE —una
 * constraint que nunca va a ceder, un dominio que revienta el parser— se
 * reintentaria cada 30 minutos para siempre, y cada reintento resuelve la cuenta
 * en Apollo antes de fallar al escribir: un credito por vuelta, indefinidamente.
 * Al llegar al tope la fila queda 'failed', terminal, y sale de la cola.
 */
const MAX_ATTEMPTS = 3

type QueueRow = {
  company_id: string
  requested_domain: string | null
}

type CompanyRow = CompanyEnrichTarget & { name: string | null }

export type OrgEnrichmentRunResult = {
  /** Filas en cola al empezar (tope del select, no el total de la cola) */
  claimed: number
  processed: number
  found: number
  notFound: number
  /** Sin dominio parseable: no se envio a Apollo, no gasto credito */
  skipped: number
  errors: number
  /** 1 por cuenta resuelta. Es el numero que factura Apollo. */
  credits: number
  calls: number
  /** Columnas genericas completadas, por nombre */
  filled: Record<string, number>
  stoppedForBudget: boolean
  stoppedForRateLimit: boolean
  dryRun: boolean
  /** Cuantas quedan en 'pending' despues de esta corrida */
  pendingLeft: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Cuantas filas siguen en cola. Cuenta lo MISMO que reclama la corrida
 * ('pending' y 'error'): si contara menos, el reporte diria "no queda trabajo"
 * mientras el cron sigue teniendo que reintentar.
 */
async function countPending(db: SupabaseClient): Promise<number> {
  const { count } = await db
    .schema("v3")
    .from("apollo_company_enrichment")
    .select("company_id", { count: "exact", head: true })
    .in("status", ["pending", "error"])
    .lt("attempts", MAX_ATTEMPTS)
  return count ?? 0
}

/**
 * Marca una fila como fallida. Vuelve a la cola en 30 minutos, salvo que ya haya
 * agotado MAX_ATTEMPTS: ahi queda 'failed' y no se reintenta mas.
 */
async function markError(db: SupabaseClient, companyId: string, message: string): Promise<void> {
  const { data: previo } = await db
    .schema("v3")
    .from("apollo_company_enrichment")
    .select("attempts")
    .eq("company_id", companyId)
    .maybeSingle<{ attempts: number }>()

  const intentos = (previo?.attempts ?? 0) + 1
  const agotada = intentos >= MAX_ATTEMPTS

  await db
    .schema("v3")
    .from("apollo_company_enrichment")
    .update({
      status: agotada ? "failed" : "error",
      error_message: agotada ? `${message.slice(0, 460)} (${intentos} intentos)` : message.slice(0, 500),
      attempts: intentos,
      processed_at: new Date().toISOString(),
      next_attempt_at: agotada ? null : new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
    })
    .eq("company_id", companyId)
}

/**
 * Procesa hasta `limit` filas de la cola.
 *
 * Se corta antes de tiempo por tres motivos y los tres quedan en el resultado:
 * presupuesto de tiempo agotado, cuota de Apollo cerca del limite, o cola vacia.
 */
export async function runApolloOrgEnrichment(
  opts: { limit?: number; budgetMs?: number; dryRun?: boolean } = {},
): Promise<OrgEnrichmentRunResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT
  const budgetMs = opts.budgetMs ?? 45_000
  const dryRun = opts.dryRun ?? false
  const inicio = Date.now()
  const db = createAdminClient()

  const result: OrgEnrichmentRunResult = {
    claimed: 0,
    processed: 0,
    found: 0,
    notFound: 0,
    skipped: 0,
    errors: 0,
    credits: 0,
    calls: 0,
    filled: {},
    stoppedForBudget: false,
    stoppedForRateLimit: false,
    dryRun,
    pendingLeft: 0,
  }

  // Se reclama 'pending' Y 'error' con el reintento ya vencido. Incluir 'error'
  // no es un detalle: markError reprograma a 30 minutos, pero si la query solo
  // mirara 'pending' esa reprogramacion no existiria — un 429 o un 500 pasajero
  // dejaria las 10 empresas del lote varadas para siempre, con la cola diciendo
  // que no queda trabajo. Se ordena por next_attempt_at para que las
  // reprogramadas no se adelanten a las que nunca se intentaron.
  const ahora = new Date().toISOString()
  const { data: cola, error: colaErr } = await db
    .schema("v3")
    .from("apollo_company_enrichment")
    .select("company_id, requested_domain")
    .in("status", ["pending", "error"])
    .lt("attempts", MAX_ATTEMPTS)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${ahora}`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(limit)
    .returns<QueueRow[]>()

  if (colaErr) throw new Error(`No se pudo leer la cola: ${colaErr.message}`)

  result.claimed = cola?.length ?? 0
  if (!cola || cola.length === 0) {
    result.pendingLeft = await countPending(db)
    return result
  }

  const { data: empresas, error: empErr } = await db
    .from("companies")
    .select("id,name,website,linkedin_url,country,logo_url,description,linkedin_company_id")
    .in(
      "id",
      cola.map((c) => c.company_id),
    )
    .returns<CompanyRow[]>()

  if (empErr) throw new Error(`No se pudieron leer las empresas: ${empErr.message}`)

  const porId = new Map((empresas ?? []).map((e) => [e.id, e]))
  const aProcesar = cola.map((c) => porId.get(c.company_id)).filter((e): e is CompanyRow => !!e)

  for (const lote of chunkForBulk(aProcesar, BULK_MAX_DOMAINS)) {
    if (Date.now() - inicio > budgetMs) {
      result.stoppedForBudget = true
      break
    }

    const respuesta = await bulkEnrichOrganizations(
      lote.map((e) => ({ companyId: e.id, website: e.website })),
    )
    if (respuesta.status > 0) result.calls++

    if (!respuesta.ok) {
      // El lote entero se reprograma: no sabemos cual dominio, si alguno, llego
      // a resolverse, y cobrar dos veces es peor que esperar 30 minutos.
      for (const e of lote) {
        result.errors++
        if (!dryRun) await markError(db, e.id, respuesta.error ?? `HTTP ${respuesta.status}`)
      }
      if (frenar(respuesta.rateLimits)) {
        result.stoppedForRateLimit = true
        break
      }
      continue
    }

    for (let i = 0; i < respuesta.items.length; i++) {
      const item = respuesta.items[i]
      const empresa = porId.get(item.companyId)
      if (!empresa) continue

      if (item.status === "skipped") {
        result.skipped++
        // Terminal, no reintentable: un website que no parsea hoy no va a parsear
        // en 30 minutos. Marcarlo como error lo dejaba volviendo a la cola para
        // siempre (lo desperto "Autonomo", que tiene basura en website).
        if (!dryRun) {
          await db
            .schema("v3")
            .from("apollo_company_enrichment")
            .update({
              status: "skipped",
              error_message: "website sin dominio parseable",
              next_attempt_at: null,
              processed_at: new Date().toISOString(),
            })
            .eq("company_id", empresa.id)
        }
        continue
      }

      if (item.status === "not_found" || !item.organization) {
        result.notFound++
        result.processed++
        if (dryRun) continue
        await db.from("companies").update(buildNotFoundUpdate()).eq("id", empresa.id)
        await db
          .schema("v3")
          .from("apollo_company_enrichment")
          .update({
            status: "not_found",
            requested_domain: item.requestedDomain,
            error_message: null,
            next_attempt_at: null,
            processed_at: new Date().toISOString(),
          })
          .eq("company_id", empresa.id)
        continue
      }

      // Apollo cobra 1 credito por cuenta resuelta, no por dominio enviado.
      result.credits++
      result.found++
      result.processed++
      if (dryRun) continue

      try {
        const columnas = await applyCompanyEnrichment(
          db,
          empresa,
          item.organization,
          item.requestedDomain,
          crudoEnIndice(respuesta.raw, i),
        )
        for (const col of columnas) result.filled[col] = (result.filled[col] ?? 0) + 1
        // applyCompanyEnrichment deja la fila en 'found'; solo falta limpiar el
        // reintento que pudo haber quedado de una corrida anterior.
        await db
          .schema("v3")
          .from("apollo_company_enrichment")
          .update({ next_attempt_at: null })
          .eq("company_id", empresa.id)
      } catch (err) {
        result.errors++
        result.found--
        result.processed--
        await markError(db, empresa.id, err instanceof Error ? err.message : "error desconocido")
      }
    }

    if (frenar(respuesta.rateLimits)) {
      result.stoppedForRateLimit = true
      break
    }
    await sleep(SLEEP_MS)
  }

  result.pendingLeft = await countPending(db)
  return result
}

/** Cortar la corrida es mejor que comerse un 429: la cola persiste y sigue en 10 minutos. */
function frenar(limits: ApolloRateLimits): boolean {
  return isNearLimit(limits, RATE_LIMIT_MARGIN)
}

/**
 * Recupera el objeto crudo de una organizacion dentro de la respuesta bulk.
 *
 * El checkpoint guarda el payload entero para poder promover campos nuevos sin
 * volver a pagar el credito, asi que vale la pena guardarlo bien.
 *
 * El emparejamiento es POSICIONAL y no por dominio: Apollo devuelve el array en
 * el mismo orden que se envio, y `bulkEnrichOrganizations` construye `items`
 * con ese mismo orden (los 'skipped', que nunca se enviaron, van al final). El
 * dominio no sirve de clave porque Apollo puede responder con un
 * `primary_domain` distinto del que se pidio: pedis `arcor.com.ar` y te
 * contesta `arcor.com`.
 *
 * Si la forma de la respuesta cambia, devuelve null: perder el crudo es
 * recuperable, romper el enrichment no.
 */
export function crudoEnIndice(raw: unknown, indice: number): unknown {
  if (!raw || typeof raw !== "object") return null
  const orgs = (raw as { organizations?: unknown }).organizations
  if (!Array.isArray(orgs)) return null
  return orgs[indice] ?? null
}
