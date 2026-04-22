/**
 * Enrichment de personas via /people/match.
 *
 * DEPRECATION: El phone reveal fue removido. Apollo aceptaba el request y
 * consumia creditos, pero el delivery asincrono (webhook) nunca llegaba a
 * pesar de agotar todas las variantes documentadas. La feature se quito para
 * evitar estados pending eternos en la UI y consumo inutil de creditos.
 * Mantenemos solo el enrichment de email + datos basicos.
 *
 * Si un contacto ya tiene `mobile_phone` o `phone` en DB (por enrichments
 * previos o por data del search inicial), se siguen mostrando — no borramos
 * data existente, solo desactivamos el flujo de reveal.
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
