/**
 * Enrichment de personas via /people/match.
 *
 * Fix del bug de teléfonos:
 *  - Antes: hacíamos dos llamadas, la segunda con `reveal_phone_number` +
 *    `webhook_url`, pero IGNORABAMOS el body de la respuesta. Apollo a veces
 *    devuelve el teléfono inline (cuando lo tiene cacheado) y solo usa webhook
 *    si necesita scraping. Al descartar el body, perdíamos esos teléfonos.
 *  - Ahora: leemos la respuesta del segundo people/match y, si viene
 *    phone_numbers, lo mergeamos con el resultado del primer match.
 *
 * Opt-in de reveals:
 *  - Los params `revealEmail` y `revealPhone` permiten al caller elegir si
 *    consumir créditos. Default: revealEmail=true, revealPhone=false (antes
 *    era siempre true para ambos).
 */

import { apolloRequest } from "./client"
import { normalizePerson, type ApolloPersonNormalized, type ApolloPersonRaw } from "./parsers"

export type EnrichOptions = {
  userId: string | null
  bookmarkId: string | null
  companyId: string | null
  revealEmail?: boolean
  revealPhone?: boolean
  webhookUrl?: string | null
}

export type EnrichedPerson = ApolloPersonNormalized & {
  enrichmentStatus: "ok" | "partial" | "failed"
  phoneAwaitingWebhook: boolean
}

export async function enrichPerson(
  person: ApolloPersonNormalized,
  opts: EnrichOptions,
): Promise<EnrichedPerson> {
  const revealEmail = opts.revealEmail ?? true
  const revealPhone = opts.revealPhone ?? false

  // ---- Llamada principal: datos + email
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

  // ---- Segunda llamada: phone reveal (opt-in)
  if (!revealPhone) {
    return {
      ...merged,
      enrichmentStatus: mainOk ? "ok" : "failed",
      phoneAwaitingWebhook: false,
    }
  }

  const phoneBody: Record<string, unknown> = {
    id: person.apolloId,
    reveal_phone_number: true,
  }
  if (opts.webhookUrl) {
    phoneBody.webhook_url = opts.webhookUrl
  }

  const phoneRes = await apolloRequest<{ person?: ApolloPersonRaw }>({
    endpoint: "people/match:phone",
    method: "POST",
    userId: opts.userId,
    bookmarkId: opts.bookmarkId,
    companyId: opts.companyId,
    requestBody: phoneBody,
    creditsEstimated: 1,
  })

  let phoneAwaiting = true
  if (phoneRes.ok && phoneRes.data?.person) {
    // FIX: leer phone_numbers del response sync. Si Apollo tenía el teléfono
    // cacheado, viene aquí y NO dispara el webhook. Antes lo ignorábamos.
    const phoneEnriched = normalizePerson(phoneRes.data.person)
    if (phoneEnriched && (phoneEnriched.mobilePhone || phoneEnriched.workPhone)) {
      merged = {
        ...merged,
        mobilePhone: phoneEnriched.mobilePhone || merged.mobilePhone,
        workPhone: phoneEnriched.workPhone || merged.workPhone,
      }
      phoneAwaiting = false
    }
  }

  return {
    ...merged,
    enrichmentStatus: mainOk ? "ok" : "partial",
    phoneAwaitingWebhook: phoneAwaiting && !merged.mobilePhone,
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
