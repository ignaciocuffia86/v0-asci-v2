/**
 * Enrichment de personas via /people/match. SOLO email + datos basicos.
 *
 * ALCANCE: esta funcion no pide telefono a proposito. NO es que el phone reveal
 * de Apollo no funcione.
 *
 * CORRECCION (auditoria Fase 3): un comentario previo aca afirmaba que el phone
 * reveal se habia removido porque "el delivery asincrono nunca llegaba". Los datos
 * de produccion lo desmienten: en los ultimos 60 dias hubo 81 llamadas a
 * people/match:phone y 55 webhooks recibidos, con 102 contactos que hoy tienen
 * telefono. El flujo funciona con ~68% de entrega.
 *
 * La implementacion viva del telefono es `revealProspectPhone` en
 * app/actions/apollo.ts, que envia reveal_phone_number y webhook_url como QUERY
 * PARAMS (no en el body) — esa es la diferencia que importa.
 *
 * Si un contacto ya tiene `mobile_phone` o `phone` en DB, se sigue mostrando:
 * no borramos data existente.
 */

import { apolloRequest } from "./client"
import { normalizePerson, type ApolloPersonNormalized, type ApolloPersonRaw } from "./parsers"

export type EnrichOptions = {
  userId: string | null
  bookmarkId: string | null
  companyId: string | null
  revealEmail?: boolean
}

export type EnrichedPerson = ApolloPersonNormalized & {
  enrichmentStatus: "ok" | "partial" | "failed"
}

export async function enrichPerson(
  person: ApolloPersonNormalized,
  opts: EnrichOptions,
): Promise<EnrichedPerson> {
  const revealEmail = opts.revealEmail ?? true

  const emailBody: Record<string, unknown> = {
    id: person.apolloId,
  }
  if (revealEmail) {
    emailBody.reveal_personal_emails = true
  }

  const mainRes = await apolloRequest<{ person?: ApolloPersonRaw }>({
    endpoint: "people/match",
    method: "POST",
    userId: opts.userId,
    bookmarkId: opts.bookmarkId,
    companyId: opts.companyId,
    requestBody: emailBody,
    creditsEstimated: revealEmail ? 1 : 0,
  })

  let merged: ApolloPersonNormalized = person
  let mainOk = false

  if (mainRes.ok && mainRes.data?.person) {
    const enriched = normalizePerson(mainRes.data.person)
    if (enriched) {
      merged = { ...person, ...enriched }
      mainOk = true
    }
  }

  return {
    ...merged,
    enrichmentStatus: mainOk ? "ok" : "failed",
  }
}

/**
 * Enriquece una lista de personas en paralelo con concurrencia limitada.
 */
export async function enrichMany(
  people: ApolloPersonNormalized[],
  opts: EnrichOptions,
  concurrency = 4,
): Promise<EnrichedPerson[]> {
  const results: EnrichedPerson[] = []
  let idx = 0

  async function worker() {
    while (idx < people.length) {
      const i = idx++
      results[i] = await enrichPerson(people[i], opts)
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, people.length) }, () => worker())
  await Promise.all(workers)
  return results
}
