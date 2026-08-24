import { put } from "@vercel/blob"
import type { Client } from "pg"
import { conConexionDirecta } from "@/lib/db/direct"

/**
 * ENRICHMENT DE public.companies VIA LINKEDIN (Apify)
 * =========================================================================
 * Actor: harvestapi/linkedin-company, modo `companies` (lista de URLs).
 *
 * Este servicio es la version reutilizable del script 437, pensada para correr
 * desde el cron. Mismas reglas de escritura, mas tres cosas que el script no
 * tenia y que el cron necesita:
 *   - guardrail de cuota de Apify ANTES de gastar,
 *   - presupuesto de tiempo para cortar antes del timeout de la funcion,
 *   - logos persistidos en Vercel Blob.
 *
 * REGLAS DE ESCRITURA (no cambiar sin releer los comentarios)
 * ---------------------------------------------------------------------
 * - Solo se llenan columnas VACIAS. Nunca se sobrescribe un valor existente.
 * - `country` se escribe con el NOMBRE completo ("Costa Rica"). El trigger
 *   trg_normalize_country deriva `country_normalized`, que es lo que filtran
 *   los exports de admin de v2. NUNCA escribir country_normalized a mano: esa
 *   columna guarda el nombre, no el ISO, y meterle ISO rompe v2 en silencio.
 * - `hq_country_iso` (columna propia de v3) recibe el ISO alpha-2. Es la CASA
 *   MATRIZ y puede diferir legitimamente del pais de operacion: "HDI Seguros
 *   Mexico" tiene HQ en ES. Por eso vive aparte y no se sincroniza con country.
 * - `industry` recibe industries[0].name, que ya viene en la misma taxonomia
 *   que los valores existentes de la tabla.
 * - No se tocan las columnas apollo_* (semantica de otra fuente).
 */

const ACTOR = "harvestapi~linkedin-company"

/** Techo de reintentos: una empresa irrecuperable no debe quemar cuota para siempre. */
const MAX_ATTEMPTS = 3

/**
 * `logo_url` tiene ~59k placeholders roto heredados de SalesQL que terminan en
 * "/None". Para esta columna "vacio" incluye ese caso, si no el 52% de las filas
 * quedarian con una imagen quebrada para siempre.
 */
const LOGO_PLACEHOLDER_SUFFIX = "/None"

export interface EnrichmentResult {
  processed: number
  ok: number
  noHq: number
  noResult: number
  errors: number
  /** [453] URLs que resultaron ser de otra empresa. No se les escribio nada. */
  identityMismatch: number
  /** [454] Filas que venian bautizadas con el slug y adoptaron su nombre real. */
  renamed: number
  filled: Record<string, number>
  skippedForQuota: boolean
  quota: QuotaStatus | null
  stoppedForBudget: boolean
}

export interface QuotaStatus {
  usedUsd: number
  limitUsd: number
  hasMargin: boolean
  cycleEnd: string | null
}

interface Candidate {
  id: string
  name: string | null
  linkedin_url: string
  priority: number
}

interface HqPick {
  iso: string
  country: string
  source: "headquarter_flag" | "single_location" | "unanimous_country"
}

// ------------------------------------------------------------------ utilidades

/**
 * Elige la ubicacion del HQ. El actor marca la sede con headquarter=true y trae
 * el pais ya parseado, asi que no hace falta IA ni heuristica de texto.
 */
export function pickHq(locations: unknown): HqPick | null {
  const locs = (Array.isArray(locations) ? locations : []).filter(
    (l: any) => l?.parsed?.countryCode,
  ) as any[]
  if (locs.length === 0) return null

  const flagged = locs.find((l) => l.headquarter === true)
  if (flagged) {
    return {
      iso: flagged.parsed.countryCode,
      country: flagged.parsed.countryFull || flagged.parsed.country,
      source: "headquarter_flag",
    }
  }

  if (locs.length === 1) {
    return {
      iso: locs[0].parsed.countryCode,
      country: locs[0].parsed.countryFull || locs[0].parsed.country,
      source: "single_location",
    }
  }

  // Sin flag de HQ pero todas las sedes en el mismo pais: es inequivoco.
  const isos = new Set(locs.map((l) => l.parsed.countryCode))
  if (isos.size === 1) {
    return {
      iso: locs[0].parsed.countryCode,
      country: locs[0].parsed.countryFull || locs[0].parsed.country,
      source: "unanimous_country",
    }
  }

  return null
}

/** El slug es el segmento de /company/<slug>. Es la clave para matchear la respuesta. */
export function slugFromUrl(url: string | null | undefined): string | null {
  const m = String(url || "").match(/\/company\/([^/?#]+)/i)
  return m ? decodeURIComponent(m[1]).toLowerCase() : null
}

/** La convencion dominante en la tabla (96%) es website con protocolo. */
export function normalizeWebsite(w: unknown): string | null {
  if (!w || typeof w !== "string") return null
  const t = w.trim()
  if (!t) return null
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

/**
 * Consulta la cuota de la cuenta ANTES de gastar.
 *
 * Por que existe: la tanda manual de 1.000 murio en el lote 12 porque la cuenta
 * llego al tope mensual, y los 9 lotes siguientes escribieron 450 filas de
 * "error" que no eran fallas de esas empresas sino de la cuenta. Preguntando
 * primero, el cron corta limpio y no ensucia el checkpoint.
 */
export async function checkApifyQuota(token: string): Promise<QuotaStatus | null> {
  try {
    const res = await fetch(`https://api.apify.com/v2/users/me/limits?token=${token}`, {
      cache: "no-store",
    })
    if (!res.ok) return null

    const body = (await res.json()) as any
    const limitUsd = Number(body?.data?.limits?.maxMonthlyUsageUsd ?? 0)
    const usedUsd = Number(body?.data?.current?.monthlyUsageUsd ?? 0)
    const cycleEnd = body?.data?.monthlyUsageCycle?.endAt ?? null

    if (!Number.isFinite(limitUsd) || limitUsd <= 0) return null

    // Margen del 2%: si queda menos, no vale la pena arrancar un lote que se
    // va a cortar a mitad de camino.
    const hasMargin = usedUsd < limitUsd * 0.98

    return { usedUsd, limitUsd, hasMargin, cycleEnd }
  } catch {
    // Si no se puede consultar la cuota no se bloquea el proceso: el error del
    // actor se maneja igual mas abajo.
    return null
  }
}

/** Minusculas sin acentos ni puntuacion, para comparar nombres. */
function soloAlfanum(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** Palabras de 4+ letras, que son las que distinguen una empresa de otra. */
function palabrasLargas(s: string): string[] {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4)
}

/**
 * [453] Guard de identidad: el nombre que devolvio LinkedIn, ¿es esta empresa?
 *
 * Sin esto, cuando la fila trae la URL de OTRA empresa el enrichment le escribe
 * encima los datos ajenos. Asi "Maxam North America" quedo como Insurance en
 * Bermuda (que es AXA XL) y "Ceiba Software" se llevo el linkedin_company_id de
 * SoftwareOne. Fueron 50 filas que hubo que limpiar a mano en el script 447, y
 * la unica razon por la que se pudieron limpiar bien es que 437 guardaba
 * `filled_columns`. Es mas barato no escribirlas.
 *
 * Los tres tests son los que se validaron en el 447 sobre las 11.833 empresas
 * con payload: identico, uno contiene al otro, o comparten una palabra de 4+
 * letras. El tercero es el que salva rebrands y traducciones ("Techint
 * Ingenieria y Construccion" contra "Techint Engineering & Construction",
 * "Barrick Gold Corporation" contra "Barrick Mining Corporation"), que son la
 * mayoria de las diferencias legitimas: de 132 discrepancias, 70 eran esto.
 *
 * Se queda corto a proposito con los acronimos y los nombres en otro idioma sin
 * palabras en comun (Air Space Intelligence / ASI, Banque Scotia / Scotiabank).
 * Esos quedan marcados para revision en vez de escribirse, que es el lado
 * seguro: no escribir un dato bueno se corrige en la proxima corrida, escribir
 * el dato de otra empresa contamina la fila y hay que rastrearlo despues.
 *
 * Si falta cualquiera de los dos nombres NO bloquea: el guard solo actua cuando
 * tiene evidencia de que son empresas distintas.
 */
export function esLaMismaEmpresa(
  nombreBase: string | null | undefined,
  nombreLinkedIn: string | null | undefined,
): boolean {
  const a = soloAlfanum(nombreBase ?? "")
  const b = soloAlfanum(nombreLinkedIn ?? "")
  if (!a || !b) return true
  if (a === b) return true
  // El containment solo vale si el nombre corto tiene cuerpo suficiente. Con
  // menos, matchea por accidente: "EY" esta contenido en "Ripley Customer SpA"
  // (ripl-EY-customerspa) y esa fila, que en realidad tenia la URL de Ernst &
  // Young, pasaba como si fuera la misma empresa.
  // [454] Bajado de 4 a 3. Con 4 se bloqueaban siglas legitimas de tres letras
  // ("Epe_2" contra "EPE", "Nfqgroup" contra "NFQ"). El caso que motivo el
  // minimo era "EY" dentro de "ripl-EY-customerspa", que con 2 caracteres sigue
  // sin pasar.
  const MIN_CONTAINMENT = 3
  if (Math.min(a.length, b.length) >= MIN_CONTAINMENT && (a.includes(b) || b.includes(a))) return true
  const enBase = new Set(palabrasLargas(nombreBase ?? ""))
  return palabrasLargas(nombreLinkedIn ?? "").some((w) => enBase.has(w))
}

/**
 * [454] ¿El nombre de la fila es, literalmente, el slug de su propia URL?
 *
 * upsert_company, cuando el ETL no trae nombre, lo inventa con
 * INITCAP(SPLIT_PART(url,'/',5)). Quedan filas llamadas "Unvimeoficial",
 * "Grupomat" o "Epe_2": eso no es un nombre, es un placeholder.
 *
 * Importa para el guard de identidad. Medido en la primera corrida real del
 * drenaje: los 11 identity_mismatch eran TODOS filas asi. Contrastar el nombre
 * que devolvio LinkedIn contra un placeholder no prueba nada — no hay dos
 * nombres que comparar, hay uno solo — y el guard bloqueaba enriquecimientos
 * correctos ("Unvimeoficial" contra "Universidad Nacional de Villa Mercedes",
 * que es la misma universidad).
 */
export function nombreEsElSlug(
  nombre: string | null | undefined,
  linkedinUrl: string | null | undefined,
): boolean {
  const slug = slugFromUrl(linkedinUrl)
  if (!slug) return false
  const n = soloAlfanum(nombre ?? "")
  return n.length > 0 && n === soloAlfanum(slug)
}

async function runActor(token: string, urls: string[]): Promise<any[]> {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companies: urls }),
    },
  )
  if (!res.ok) {
    throw new Error(`Apify HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

/** True si el error viene de la cuenta (cuota/plan) y no de la empresa consultada. */
function isQuotaError(message: string): boolean {
  return /actor-disabled|platform-feature-disabled|usage hard limit|Monthly usage/i.test(message)
}

/**
 * Baja el logo de LinkedIn y lo sube a Blob, devolviendo una URL permanente.
 *
 * POR QUE NO SE GUARDA LA URL DE LINKEDIN
 * Las URLs de media.licdn.com vienen firmadas y con expiracion
 * (`?e=<epoch>&v=beta&t=<firma>`). En los payloads del piloto el epoch daba
 * ~16 dias de vida. Guardar esa URL en logo_url produce logos rotos en semanas.
 *
 * El blob va con access "public" a proposito: logo_url se renderiza directo en
 * un <img>, y un blob privado necesita URL firmada, que vuelve a expirar. Son
 * logos publicos de empresas tomados de LinkedIn, no hay dato sensible.
 */
async function storeLogo(logoUrl: string, companyId: string): Promise<string | null> {
  try {
    const res = await fetch(logoUrl, { cache: "no-store" })
    if (!res.ok) return null

    const contentType = res.headers.get("content-type") || "image/jpeg"
    if (!contentType.startsWith("image/")) return null

    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.byteLength === 0) return null

    const ext = contentType.includes("png") ? "png" : contentType.includes("svg") ? "svg" : "jpg"

    const blob = await put(`v3/company-logos/${companyId}.${ext}`, buffer, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    return blob.url
  } catch {
    // Un logo que no baja no debe abortar el enrichment del resto de la fila.
    return null
  }
}

// ------------------------------------------------------------------ candidatas

/**
 * Devuelve las empresas a enriquecer, ordenadas por rendimiento esperado.
 *
 * PRIORIDADES (medidas, no intuidas)
 *   0. Companies nuevas del ETL (jobpostings/contactos) con LinkedIn. Es el caso
 *      que motiva el cron: entran ~720/dia, de las cuales ~49 traen linkedin_url.
 *   1. Falta `industry`: LinkedIn lo trae en el 95% de los casos y es la columna
 *      que mas funciones de v2 leen (10). Mejor retorno por dolar.
 *   2. Falta `website`: disponible en 73%, y es el hueco mas grande del backlog.
 *   3. Falta `country`: solo 54%, porque depende de que la pagina declare HQ.
 *   4. Solo falta logo o description: el resto.
 *
 * Se excluye lo que no tiene nada que ganar, para no pagar por filas completas:
 * ese fue el error del filtro original (`hq_country_iso IS NULL` traia 57k
 * candidatas de las cuales 47k ya estaban completas para v2).
 */
async function fetchCandidates(
  db: Client,
  limit: number,
  newCompanyWindowDays: number,
): Promise<Candidate[]> {
  const { rows } = await db.query<Candidate>(
    `SELECT c.id, c.name, c.linkedin_url,
            CASE
              WHEN c.created_at > now() - ($2 || ' days')::interval           THEN 0
              WHEN c.industry IS NULL OR btrim(c.industry) = ''               THEN 1
              WHEN c.website  IS NULL OR btrim(c.website)  = ''               THEN 2
              WHEN c.country  IS NULL OR btrim(c.country)  = ''               THEN 3
              -- [453] La cola de verificacion va ULTIMA: completar un hueco que
              -- v2 consume rinde mas que confirmar una URL que probablemente ya
              -- este bien.
              WHEN e.status = 'pending_verify'                                THEN 5
              ELSE 4
            END AS priority
       FROM public.companies c
       LEFT JOIN v3.linkedin_company_enrichment e ON e.company_id = c.id
      WHERE c.linkedin_url ~ 'linkedin\\.com/company/'
        AND (
              -- [453] Cola explicita de verificacion de identidad. Entra aunque
              -- no falte NINGUNA columna, porque lo que se quiere confirmar es
              -- que la URL sea de esta empresa, no completar datos.
              --
              -- Es una cola explicita y no una condicion abierta a proposito:
              -- "toda empresa con linkedin_url y sin registro" son ~51.900
              -- filas, y encolarlas todas seria un gasto de Apify que nadie
              -- pidio. Se encola a mano lo que se quiere verificar.
              e.status = 'pending_verify'
           OR (
                (    e.company_id IS NULL
                 OR (    e.status = 'error'
                     AND e.attempts < $3
                     AND (e.next_attempt_at IS NULL OR e.next_attempt_at <= now())))
                AND (
                      (c.industry    IS NULL OR btrim(c.industry)    = '')
                   OR (c.website     IS NULL OR btrim(c.website)     = '')
                   OR (c.country     IS NULL OR btrim(c.country)     = '')
                   OR (c.description IS NULL OR btrim(c.description) = '')
                   OR (c.logo_url    IS NULL OR btrim(c.logo_url)    = '' OR c.logo_url LIKE $4)
                )
              )
        )
      ORDER BY priority, c.created_at DESC
      LIMIT $1`,
    [limit, String(newCompanyWindowDays), MAX_ATTEMPTS, `%${LOGO_PLACEHOLDER_SUFFIX}`],
  )
  return rows
}

// ---------------------------------------------------------------------- main

export interface RunOptions {
  /** Tope de empresas a procesar en esta corrida. */
  limit?: number
  /** Empresas por llamada al actor. */
  batchSize?: number
  /** Milisegundos disponibles; corta antes de agotarlos. */
  budgetMs?: number
  /** Ventana para considerar una company "nueva" del ETL. */
  newCompanyWindowDays?: number
  /** Si es true consulta el actor pero no escribe nada. */
  dryRun?: boolean
}

export async function runLinkedInEnrichment(options: RunOptions = {}): Promise<EnrichmentResult> {
  const {
    limit = 100,
    batchSize = 25,
    budgetMs = 45_000,
    newCompanyWindowDays = 30,
    dryRun = false,
  } = options

  const token = process.env.APIFY_TOKEN
  if (!token) throw new Error("Falta APIFY_TOKEN")

  const startedAt = Date.now()
  const result: EnrichmentResult = {
    processed: 0,
    ok: 0,
    noHq: 0,
    noResult: 0,
    errors: 0,
    identityMismatch: 0,
    renamed: 0,
    filled: {},
    skippedForQuota: false,
    quota: null,
    stoppedForBudget: false,
  }
  const bump = (col: string) => {
    result.filled[col] = (result.filled[col] || 0) + 1
  }

  // Guardrail de cuota: se pregunta una sola vez, antes de tocar nada.
  const quota = await checkApifyQuota(token)
  result.quota = quota
  if (quota && !quota.hasMargin) {
    result.skippedForQuota = true
    console.log(
      `[v3-enrich] sin cuota Apify (${quota.usedUsd.toFixed(2)}/${quota.limitUsd} USD). ` +
        `Reintenta solo. Ciclo cierra: ${quota.cycleEnd ?? "?"}`,
    )
    return result
  }

  return conConexionDirecta(async (db) => {
    const candidates = await fetchCandidates(db, limit, newCompanyWindowDays)
    console.log(`[v3-enrich] candidatas=${candidates.length} dryRun=${dryRun}`)
    if (candidates.length === 0) return result

    for (let i = 0; i < candidates.length; i += batchSize) {
      // Presupuesto de tiempo: se corta ANTES de arrancar un lote que no llega.
      // Lo que no se procesa queda sin fila de checkpoint y lo toma la corrida
      // siguiente, asi que no se pierde nada.
      const elapsed = Date.now() - startedAt
      if (elapsed > budgetMs) {
        result.stoppedForBudget = true
        console.log(`[v3-enrich] corte por presupuesto a los ${elapsed}ms`)
        break
      }

      const batch = candidates.slice(i, i + batchSize)
      let items: any[] = []

      try {
        items = await runActor(
          token,
          batch.map((c) => c.linkedin_url),
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)

        // Si el actor se cayo por cuota, no es culpa de estas empresas: se sale
        // sin escribir errores, para no bloquear su reintento.
        if (isQuotaError(message)) {
          result.skippedForQuota = true
          console.log(`[v3-enrich] cuota agotada a mitad de corrida, corte limpio`)
          break
        }

        console.error(`[v3-enrich] error del actor: ${message}`)
        result.errors += batch.length
        if (!dryRun) {
          for (const c of batch) {
            await registerError(db, c, message)
          }
        }
        continue
      }

      // El actor puede devolver en otro orden o saltear items: se matchea por slug.
      const bySlug = new Map<string, any>()
      for (const it of items) {
        const s = slugFromUrl(it.linkedinUrl) || String(it.universalName || "").toLowerCase()
        if (s) bySlug.set(s, it)
      }

      for (const c of batch) {
        const item = bySlug.get(slugFromUrl(c.linkedin_url) ?? "")
        result.processed++

        if (!item) {
          result.noResult++
          if (!dryRun) {
            await db.query(
              `INSERT INTO v3.linkedin_company_enrichment (company_id, requested_url, status)
               VALUES ($1,$2,'no_result')
               ON CONFLICT (company_id) DO UPDATE
                 SET status='no_result', processed_at=now(),
                     attempts = v3.linkedin_company_enrichment.attempts + 1`,
              [c.id, c.linkedin_url],
            )
          }
          continue
        }

        // [454] Si la fila esta bautizada con el slug de su propia URL, su
        // "nombre" es un placeholder y no sirve para contrastar identidad. El
        // guard no aplica: mas abajo se adopta el nombre que trae LinkedIn.
        const bautizadaConElSlug = nombreEsElSlug(c.name, c.linkedin_url)

        // [453] Antes de escribir NADA: si el nombre que devolvio LinkedIn no
        // tiene relacion con el de la fila, la URL es de otra empresa. Se
        // guarda el payload (es la evidencia para revisarlo) pero no se toca
        // ninguna columna, y no se reintenta: no es un fallo transitorio.
        if (!bautizadaConElSlug && !esLaMismaEmpresa(c.name, item.name)) {
          result.identityMismatch++
          if (!dryRun) {
            await db.query(
              `INSERT INTO v3.linkedin_company_enrichment
                 (company_id, requested_url, status, payload, error_message, attempts, next_attempt_at)
               VALUES ($1,$2,'identity_mismatch',$3,$4,1,NULL)
               ON CONFLICT (company_id) DO UPDATE
                 SET status='identity_mismatch', payload=EXCLUDED.payload,
                     error_message=EXCLUDED.error_message, next_attempt_at=NULL,
                     attempts = v3.linkedin_company_enrichment.attempts + 1,
                     processed_at=now()`,
              [
                c.id,
                c.linkedin_url,
                item,
                `LinkedIn devolvio "${item.name}" para una fila llamada "${c.name}": ` +
                  `la URL es de otra empresa. No se escribio ninguna columna.`,
              ],
            )
          }
          continue
        }

        const hq = pickHq(item.locations)
        const filled: string[] = []

        if (!dryRun) {
          // [454] La fila venia bautizada con el slug: LinkedIn acaba de decir
          // como se llama de verdad, asi que se adopta. Es el mismo arreglo que
          // el script 452 hizo contra el import del proveedor, pero para las
          // filas que ese import no cubria.
          //
          // normalized_name se recalcula si o si: si queda apuntando al slug
          // viejo, la busqueda por nombre (script 450) no encuentra la empresa.
          //
          // El NOT EXISTS cubre el UNIQUE de companies.name: si el nombre real
          // ya lo tiene otra fila, son duplicados y no se renombra nada. Los
          // resuelve la deteccion nocturna, que deja registro y se revierte.
          if (typeof item.name === "string" && item.name.trim().length >= 3 && bautizadaConElSlug) {
            const nombreReal = item.name.trim()
            const { rowCount } = await db.query(
              `UPDATE public.companies
                  SET name = $1,
                      normalized_name = public.company_core_name($1),
                      updated_at = now()
                WHERE id = $2
                  AND NOT EXISTS (
                    SELECT 1 FROM public.companies o WHERE o.name = $1 AND o.id <> $2)`,
              [nombreReal, c.id],
            )
            if (rowCount && rowCount > 0) result.renamed++
          }

          // Un UPDATE por columna, cada uno condicionado a que este vacia. Asi
          // nunca se sobrescribe y cada trigger se dispara donde corresponde.
          const setIfEmpty = async (col: string, value: unknown) => {
            if (value === null || value === undefined || value === "") return
            const { rowCount } = await db.query(
              `UPDATE public.companies
                  SET ${col} = $1
                WHERE id = $2
                  AND (${col} IS NULL OR btrim(${col}::text) = '')`,
              [value, c.id],
            )
            if (rowCount && rowCount > 0) {
              filled.push(col)
              bump(col)
            }
          }

          if (hq) {
            // country primero: su trigger deriva country_normalized (contrato v2).
            await setIfEmpty("country", hq.country)
            await setIfEmpty("hq_country_iso", hq.iso)
          }
          await setIfEmpty("website", normalizeWebsite(item.website))
          await setIfEmpty("industry", item.industries?.[0]?.name ?? null)
          await setIfEmpty("description", item.description)
          await setIfEmpty("linkedin_slug", item.universalName)

          // Logo: se resuelve aparte porque hay que bajar el binario y subirlo a
          // Blob, y porque "vacio" incluye los placeholders "/None" de SalesQL.
          const logoSource = pickLogoUrl(item)
          if (logoSource) {
            const { rows: needsLogo } = await db.query<{ id: string }>(
              `SELECT id FROM public.companies
                WHERE id = $1
                  AND (logo_url IS NULL OR btrim(logo_url) = '' OR logo_url LIKE $2)`,
              [c.id, `%${LOGO_PLACEHOLDER_SUFFIX}`],
            )
            if (needsLogo.length > 0) {
              const stored = await storeLogo(logoSource, c.id)
              if (stored) {
                // Aca si se sobreescribe el placeholder "/None", que es basura.
                await db.query(
                  `UPDATE public.companies SET logo_url = $1
                    WHERE id = $2
                      AND (logo_url IS NULL OR btrim(logo_url) = '' OR logo_url LIKE $3)`,
                  [stored, c.id, `%${LOGO_PLACEHOLDER_SUFFIX}`],
                )
                filled.push("logo_url")
                bump("logo_url")
              }
            }
          }
        }

        const status = hq ? "ok" : "no_hq"
        if (hq) result.ok++
        else result.noHq++

        if (!dryRun) {
          await db.query(
            `INSERT INTO v3.linkedin_company_enrichment
               (company_id, requested_url, status, hq_iso, hq_country, hq_source,
                payload, filled_columns, attempts, next_attempt_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,NULL)
             ON CONFLICT (company_id) DO UPDATE
               SET status=EXCLUDED.status, hq_iso=EXCLUDED.hq_iso,
                   hq_country=EXCLUDED.hq_country, hq_source=EXCLUDED.hq_source,
                   payload=EXCLUDED.payload, filled_columns=EXCLUDED.filled_columns,
                   error_message=NULL, next_attempt_at=NULL,
                   attempts = v3.linkedin_company_enrichment.attempts + 1,
                   processed_at=now()`,
            [
              c.id,
              c.linkedin_url,
              status,
              hq?.iso ?? null,
              hq?.country ?? null,
              hq?.source ?? null,
              item,
              filled,
            ],
          )
        }
      }
    }

    console.log(
      `[v3-enrich] ok=${result.ok} no_hq=${result.noHq} no_result=${result.noResult} ` +
        `identidad_dudosa=${result.identityMismatch} err=${result.errors} ` +
        `filled=${JSON.stringify(result.filled)}`,
    )
    return result
  }, { timeoutMs: 60_000 })
}

/** El actor trae `logo` (string) y `logos` (variantes). Se prefiere la mas grande. */
function pickLogoUrl(item: any): string | null {
  const variants = Array.isArray(item?.logos) ? item.logos : []
  const best = variants
    .filter((l: any) => typeof l?.url === "string" && l.url)
    .sort((a: any, b: any) => (b.width ?? 0) - (a.width ?? 0))[0]
  if (best?.url) return best.url
  return typeof item?.logo === "string" && item.logo ? item.logo : null
}

/** Registra un error real de la empresa, con backoff exponencial y techo. */
async function registerError(db: Client, c: Candidate, message: string): Promise<void> {
  await db.query(
    `INSERT INTO v3.linkedin_company_enrichment
       (company_id, requested_url, status, error_message, attempts, next_attempt_at)
     VALUES ($1,$2,'error',$3,1, now() + interval '1 hour')
     ON CONFLICT (company_id) DO UPDATE
       SET status='error',
           error_message=EXCLUDED.error_message,
           attempts = v3.linkedin_company_enrichment.attempts + 1,
           next_attempt_at = now() +
             (interval '1 hour' * power(4, LEAST(v3.linkedin_company_enrichment.attempts, 3))),
           processed_at=now()`,
    [c.id, c.linkedin_url, message.slice(0, 500)],
  )
}
