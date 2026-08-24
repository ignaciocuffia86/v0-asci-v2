import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { loadDictionary } from "./dictionary"
import type { DictionaryData } from "./types"

// ═══════════════════════════════════════════════════════════════════════════
// Búsqueda INVERSA: de capacidad (tecnología / proceso) → empresas.
//
// El buscador web de v2 ya resolvía "qué bancos usan Dynamics 365", pero el MCP
// solo sabía ir de empresa → señales. Un cliente IA respondía literalmente que
// "ASCI no permite este tipo de búsqueda inversa" cuando los datos sí estaban:
// son 53 bancos con Dynamics 365.
//
// El circuito es de dos pasos a propósito (screening → detalle), porque volcar
// el resultado crudo es inviable: Azure sin filtros son 1681 empresas, ~840 KB
// de JSON. El screening pesa ~1,2 KB y dice cuánto hay y dónde, para que el
// modelo le pida al usuario un recorte antes de traer nombres.
//
// ── v2 ─────────────────────────────────────────────────────────────────────
// La v1 devolvía un resultado interpretable pero no accionable, y todo lo que
// faltaba se terminaba resolviendo a mano contra Supabase — con accesos que el
// usuario final no tiene. Lo que se agregó, en orden de cuánto dolía:
//
//   minSignals   Sin esto, llegar a 89 cuentas era bajar 889 y descartar 800.
//   termHits     v1 devolvía ["Angular", "Oracle Forms"] y con eso Mercado
//                Libre y La Segunda parecían equivalentes. En realidad Mercado
//                Libre tiene 115 señales de Angular y 7 de Forms (o sea: una
//                cuenta Angular), y La Segunda 16 y 13 (una cuenta de
//                modernización real). Ahora es [{term, signals}].
//   termsMode    v1 SUMABA los términos. El usuario que pide "Angular Y Oracle
//                Forms" quiere la intersección, y la hacía el modelo afuera.
//   cursor       `truncated: true` avisaba que había más y no daba forma de
//                traerlo. El workaround era cortar por industria hasta que cada
//                corte entrara en 50.
//   include      Bloque firmográfico (LinkedIn, dominio, dotación, si cotiza).
//   excluded     El default descarta service providers; v1 no lo decía.
//
// Y un renombre: `currentEmployees` no eran empleados, eran CONTACTOS de la
// base de ASCI. Mercado Libre figuraba con 122 teniendo 85.000 empleados. Ahora
// son `contactsInBase` / `alumniInBase`, y la dotación real solo sale del
// bloque firmográfico.
// ═══════════════════════════════════════════════════════════════════════════

/** Tope duro de empresas por llamada en modo detalle. */
const MAX_DETAIL_LIMIT = 50

/**
 * Cuántas empresas ya se consideran "demasiadas" para volcar al contexto sin
 * antes preguntarle al usuario. No es un límite técnico: es el umbral a partir
 * del cual la tool sugiere acotar.
 */
const CROWDED_THRESHOLD = 40

/**
 * Hasta cuántas empresas tiene sentido bajar ENTERAS paginando con el cursor.
 *
 * El número sale de una restricción de MCP, no de la base: todo lo que devuelve
 * una tool entra al contexto del modelo, no hay canal lateral. Una fila pesa
 * ~100-200 tokens según cuántos termHits traiga y si se pidieron firmográficos,
 * así que 200 filas son ~20-40k tokens repartidos en 4 llamadas de a 50: caro
 * pero hacible cuando el usuario de verdad quiere la lista completa (para
 * exportarla, para trabajarla afuera). 889 filas serían ~130k tokens en 18
 * llamadas, y ahí ya no es "caro": no entra.
 *
 * Por encima de este techo la respuesta correcta NO es paginar: es acotar.
 */
const PAGINABLE_CEILING = 200

export type CapabilityTerm = {
  id: string
  name: string
  kind: "product" | "process"
  /** Vendor del producto, cuando aplica. Sirve para desambiguar homónimos. */
  vendor: string | null
}

/**
 * Un término TAL COMO LO PIDIÓ EL USUARIO, con todas las entradas del
 * diccionario a las que resolvió.
 *
 * Existe por el modo AND. La unidad de intersección es el término pedido, no la
 * entrada del diccionario: "Dynamics 365" resuelve a CRM y ERP, y exigir las dos
 * sería exigir algo que nadie pidió. Un id puede repetirse entre grupos si dos
 * términos se solapan ("Oracle" y "Oracle EBS"); ahí una señal de EBS satisface
 * los dos, que es la lectura correcta.
 */
export type CapabilityTermGroup = {
  term: string
  ids: string[]
}

export type CapabilityResolution = {
  matched: CapabilityTerm[]
  groups: CapabilityTermGroup[]
  /** Términos pedidos que no existen en el diccionario. */
  unresolved: string[]
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/**
 * Resuelve términos libres a IDs del diccionario, devolviendo TODAS las
 * coincidencias.
 *
 * No se reusa `resolveProductByName` (dictionary.ts) a propósito: esa función
 * devuelve el PRIMER match y corta, porque su caso de uso es canonizar un
 * hallazgo puntual de la IA. Acá eso sería un bug silencioso: "Dynamics 365"
 * son dos productos distintos en el diccionario (CRM y ERP) y devolver solo el
 * CRM perdería 27 bancos sin avisar. "Microsoft" son 10 productos.
 *
 * CUIDADO con cortar en el primer nivel que da resultados. Esa era la primera
 * version de esta funcion y estaba MAL, con el mismo sintoma que venia a
 * arreglar: los keywords del diccionario reparten la familia "Dynamics 365"
 * entre dos productos, de forma que ninguno de los dos la representa entera.
 *
 *   Dynamics 365 ERP -> keywords: {"Dynamics 365", D365, ...}
 *   Dynamics 365 CRM -> keywords: {"Microsoft Dynamics 365", "Dynamics CRM", ...}
 *
 * O sea que "Dynamics 365" es keyword EXACTA del ERP. Cortando ahi se devolvia
 * solo el ERP y se perdian los 27 bancos del CRM en silencio: exactamente el
 * bug original. Por eso los tres primeros niveles ACUMULAN en lugar de cortar.
 *
 * Niveles (los 1-3 se suman entre si; el 4 es fallback solo si no hubo nada):
 *   1. nombre exacto del producto/proceso
 *   2. keyword exacta
 *   3. vendor exacto -> todos sus productos ("Microsoft" = 21, "SAP" = 9)
 *   3a. categoria exacta -> todos sus productos ("ERP" = 12, "Datos y BI" = 11).
 *       Mismo mecanismo que el vendor pero por el otro eje: responde "que
 *       cuentas tienen un ERP" sin que haya que saber la marca. Ver
 *       docs/rediseno-taxonomia-diccionario.md.
 *   3c. ciclo de vida -> "legado" devuelve los 13 productos con sucesor
 *       anunciado por el propio vendor (SAP ECC, Oracle Forms, AS/400...).
 *   3b. prefijo de familia: el termino es prefijo del nombre del producto y lo
 *       que sigue es un sufijo corto de variante ("Dynamics 365" -> "... CRM",
 *       "... ERP"). Esto es lo que reune la familia partida por keywords.
 *   4. substring del nombre (min. 4 caracteres), solo si los anteriores fallaron
 */
export async function resolveCapabilityTerms(
  terms: string[],
  dictionary?: DictionaryData,
): Promise<CapabilityResolution> {
  const dict = dictionary ?? (await loadDictionary())
  const vendorById = new Map(dict.vendors.map((v) => [v.id, v.name]))

  const matched = new Map<string, CapabilityTerm>()
  const groups: CapabilityTermGroup[] = []
  const unresolved: string[] = []

  for (const raw of terms) {
    const q = norm(raw)
    if (!q) continue

    const hits: CapabilityTerm[] = []

    const asProduct = (p: DictionaryData["products"][number]): CapabilityTerm => ({
      id: p.id,
      name: p.name,
      kind: "product",
      vendor: p.vendor_id ? (vendorById.get(p.vendor_id) ?? null) : null,
    })
    const asProcess = (p: DictionaryData["processes"][number]): CapabilityTerm => ({
      id: p.id,
      name: p.name,
      kind: "process",
      vendor: null,
    })

    // 1. nombre exacto
    for (const p of dict.products) if (norm(p.name) === q) hits.push(asProduct(p))
    for (const p of dict.processes) if (norm(p.name) === q) hits.push(asProcess(p))

    // 2. keyword exacta (ACUMULA, no corta: ver comentario del encabezado)
    for (const p of dict.products) {
      if (p.keywords.some((k) => norm(k) === q)) hits.push(asProduct(p))
    }
    for (const p of dict.processes) {
      if (p.keywords.some((k) => norm(k) === q)) hits.push(asProcess(p))
    }

    // 3. vendor exacto → todos sus productos
    const vendor = dict.vendors.find((v) => norm(v.name) === q)
    if (vendor) {
      for (const p of dict.products) if (p.vendor_id === vendor.id) hits.push(asProduct(p))
    }

    // 3a. categoría exacta → todos sus productos. El mismo mecanismo que el
    //     vendor, sobre el otro eje: "ERP" devuelve los 12 productos de ERP sin
    //     importar la marca. Se aceptan variantes cortas de uso comun ("BI",
    //     "seguridad") porque nadie escribe el nombre completo de la categoria.
    const CATEGORIA_ALIAS: Record<string, string> = {
      erp: "ERP y backoffice",
      backoffice: "ERP y backoffice",
      crm: "CRM y marketing",
      marketing: "CRM y marketing",
      bi: "Datos y BI",
      "business intelligence": "Datos y BI",
      datos: "Datos y BI",
      cloud: "Cloud e infraestructura",
      nube: "Cloud e infraestructura",
      infraestructura: "Cloud e infraestructura",
      seguridad: "Ciberseguridad e identidad",
      ciberseguridad: "Ciberseguridad e identidad",
      identidad: "Ciberseguridad e identidad",
      productividad: "Productividad y colaboracion",
      colaboracion: "Productividad y colaboracion",
      desarrollo: "Desarrollo",
      automatizacion: "Automatizacion y low-code",
      "low-code": "Automatizacion y low-code",
      rpa: "Automatizacion y low-code",
      observabilidad: "Observabilidad y gestion de servicios",
      itsm: "Observabilidad y gestion de servicios",
    }
    const categoriaBuscada =
      CATEGORIA_ALIAS[q] ??
      dict.products.find((p) => p.categoria && norm(p.categoria) === q)?.categoria ??
      null
    if (categoriaBuscada) {
      for (const p of dict.products) {
        if (p.categoria && norm(p.categoria) === norm(categoriaBuscada)) hits.push(asProduct(p))
      }
    }

    // 3c. ciclo de vida. Solo "legado" expande: "vigente" son 77 productos y
    //     devolver casi todo el diccionario no es una respuesta util.
    if (q === "legado" || q === "legacy" || q === "obsoleto" || q === "modernizacion") {
      for (const p of dict.products) if (p.ciclo_vida === "legado") hits.push(asProduct(p))
    }

    // 3b. prefijo de familia. Reúne "Dynamics 365 CRM" + "Dynamics 365 ERP" bajo
    //     "Dynamics 365". Se exige que el resto sea corto (<= 24 caracteres) y no
    //     arranque con un separador raro, para no convertir esto en un substring
    //     encubierto: "SAP" NO cae acá (lo agarra el vendor), y "Azure" no se
    //     tragaría un hipotético "Azure DevOps Server Enterprise Edition".
    for (const p of dict.products) {
      const n = norm(p.name)
      if (n !== q && n.startsWith(q)) {
        const rest = n.slice(q.length).trim()
        if (rest.length > 0 && rest.length <= 24) hits.push(asProduct(p))
      }
    }

    // 4. substring, SOLO como último recurso. El mínimo de 4 caracteres evita el
    //    problema conocido de los acrónimos cortos ("ORM" matchea "información").
    if (!hits.length && q.length >= 4) {
      for (const p of dict.products) if (norm(p.name).includes(q)) hits.push(asProduct(p))
      for (const p of dict.processes) if (norm(p.name).includes(q)) hits.push(asProcess(p))
    }

    if (!hits.length) unresolved.push(raw)
    else groups.push({ term: raw, ids: [...new Set(hits.map((hit) => hit.id))] })
    for (const hit of hits) matched.set(hit.id, hit)
  }

  return { matched: [...matched.values()], groups, unresolved }
}

/** Cuántas cuentas se cayeron por el filtro de proveedores de servicios. */
type ExcludedCounts = {
  serviceProviders: number
  providersIncluded: boolean
}

type ScreeningPayload = {
  mode: "screening"
  totalCompanies: number
  totalSignals: number
  excluded: ExcludedCounts
  byCountry: { country: string; companies: number; signals: number }[]
  byIndustry: { industryId: string; industry: string; companies: number; signals: number }[]
}

/** Bloque firmográfico. Todas las claves vienen siempre; `null` = no lo sabemos. */
export type CompanyFirmographics = {
  linkedinUrl: string | null
  domain: string | null
  employeesApollo: number | null
  isPublic: boolean | null
  ticker: string | null
  stockExchange: string | null
}

type DetailPayload = {
  mode: "detail"
  totalCompanies: number
  totalSignals: number
  offset: number
  returned: number
  truncated: boolean
  excluded: ExcludedCounts
  companies: {
    companyId: string
    name: string
    country: string | null
    industryId: string | null
    industry: string | null
    website: string | null
    signals: number
    /** Desglose del total: cuántas señales aportó CADA término. */
    termHits: { term: string; signals: number }[]
    /**
     * Contactos de la base de ASCI vinculados a esta empresa con estas señales.
     * NO es la dotación de la empresa: para eso está firmographics.employeesApollo.
     */
    contactsInBase: number
    alumniInBase: number
    jobPostings: number
    latestSignalAt: string | null
    /** Solo con include: ["firmographics"]. */
    firmographics?: CompanyFirmographics
  }[]
}

export type CapabilitySearchInclude = "firmographics"

export type CapabilitySearchResult = (ScreeningPayload | DetailPayload) & {
  resolvedTerms: CapabilityTerm[]
  unresolvedTerms: string[]
  /** Qué filtros se aplicaron de verdad, incluidos los defaults implícitos. */
  appliedFilters: {
    termsMode: "any" | "all"
    minSignals: number
    countries: string[] | null
    industries: string[] | null
    includeProviders: boolean
  }
  /** Cursor para la página siguiente. Null cuando no hay más. */
  nextCursor: string | null
  /** Instrucción para el modelo. Null cuando el resultado ya es manejable. */
  guidance: string | null
}

export type CapabilitySearchParams = {
  terms: string[]
  countries?: string[]
  industries?: string[]
  includeProviders?: boolean
  mode?: "screening" | "detail"
  limit?: number
  minSignals?: number
  termsMode?: "any" | "all"
  include?: CapabilitySearchInclude[]
  cursor?: string
}

// ── Cursor ─────────────────────────────────────────────────────────────────
// Es un offset, no un keyset: la RPC reagrega todo en cada llamada de todas
// formas, así que saltear filas no cuesta nada, y el ORDER BY termina en
// company_id (desempate total), o sea que el offset es determinístico.
//
// Va firmado con la forma de la consulta para que paginar una búsqueda distinta
// falle en vez de devolver la página N de otra cosa. Es el error más fácil de
// cometer para un cliente IA: cambia un país, conserva el cursor y el resultado
// parece plausible.

function queryShape(params: CapabilitySearchParams): string {
  return JSON.stringify([
    [...params.terms].map((term) => term.toLowerCase().trim()).sort(),
    params.countries?.map((c) => c.toLowerCase().trim()).sort() ?? null,
    params.industries?.map((i) => i.toLowerCase().trim()).sort() ?? null,
    params.includeProviders ?? false,
    params.minSignals ?? 1,
    params.termsMode ?? "any",
    params.include?.slice().sort() ?? [],
  ])
}

export function encodeCursor(params: CapabilitySearchParams, offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset, s: queryShape(params) }), "utf8").toString("base64url")
}

export function decodeCursor(cursor: string, params: CapabilitySearchParams): number {
  let parsed: { o?: unknown; s?: unknown }
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { o?: unknown; s?: unknown }
  } catch {
    throw new Error("CAPABILITY_CURSOR_INVALID:El cursor no es válido. Volvé a llamar sin cursor.")
  }
  if (typeof parsed.o !== "number" || !Number.isInteger(parsed.o) || parsed.o < 0) {
    throw new Error("CAPABILITY_CURSOR_INVALID:El cursor no es válido. Volvé a llamar sin cursor.")
  }
  if (parsed.s !== queryShape(params)) {
    throw new Error(
      "CAPABILITY_CURSOR_MISMATCH:El cursor es de una búsqueda con otros filtros. " +
        "Para paginar hay que repetir EXACTAMENTE los mismos terms, countries, industries, " +
        "minSignals, termsMode, includeProviders e include. Si querés cambiar un filtro, " +
        "empezá de nuevo sin cursor.",
    )
  }
  return parsed.o
}

export async function searchCompaniesByCapability(
  params: CapabilitySearchParams,
): Promise<CapabilitySearchResult> {
  const { matched, groups, unresolved } = await resolveCapabilityTerms(params.terms)

  if (!matched.length) {
    throw new Error(
      `CAPABILITY_TERMS_UNRESOLVED:Ningún término coincide con el diccionario: ${unresolved.join(", ")}. ` +
        `Usá get_document_dictionaries para ver los términos disponibles.`,
    )
  }

  const termsMode = params.termsMode ?? "any"

  // En modo AND un término sin resolver no es un detalle: la intersección que
  // devolvería NO es la que pidió el usuario, y el número resultante se leería
  // como si lo fuera. Mejor fallar y que el modelo corrija el término.
  if (termsMode === "all" && unresolved.length) {
    throw new Error(
      `CAPABILITY_TERMS_UNRESOLVED:Con termsMode="all" todos los términos tienen que existir en el diccionario, ` +
        `y estos no: ${unresolved.join(", ")}. La intersección sin ellos daría un número que no es el que se pidió. ` +
        `Corregí el término (get_document_dictionaries lista los disponibles) o usá termsMode="any".`,
    )
  }

  const productIds = matched.filter((t) => t.kind === "product").map((t) => t.id)
  const processIds = matched.filter((t) => t.kind === "process").map((t) => t.id)
  const mode = params.mode ?? "screening"
  const limit = Math.min(params.limit ?? 25, MAX_DETAIL_LIMIT)
  const minSignals = Math.max(params.minSignals ?? 1, 1)
  const includeFirmographics = params.include?.includes("firmographics") ?? false
  const offset = params.cursor ? decodeCursor(params.cursor, params) : 0

  const admin = createAdminClient()
  const { data, error } = await admin.schema("v3").rpc("search_companies_by_capability", {
    p_product_ids: productIds.length ? productIds : null,
    p_process_ids: processIds.length ? processIds : null,
    p_countries: params.countries?.length ? params.countries : null,
    p_master_industry_ids: params.industries?.length ? params.industries : null,
    p_exclude_providers: !params.includeProviders,
    p_mode: mode,
    p_limit: limit,
    p_offset: offset,
    p_min_signals: minSignals,
    p_terms_mode: termsMode,
    // Solo se mandan cuando hacen falta: la RPC los ignora en modo 'any' y así
    // el payload de la llamada no carga con decenas de uuids al pedo.
    p_term_groups: termsMode === "all" ? groups : null,
    p_include_firmographics: includeFirmographics,
  })

  if (error) {
    // Los topes de la RPC son errores de USO, no fallas: se propaga el mensaje
    // tal cual para que el modelo pueda corregir la llamada.
    throw new Error(`CAPABILITY_SEARCH_FAILED:${error.message}`)
  }

  const payload = data as ScreeningPayload | DetailPayload

  // Sin include, la RPC deja la clave en `null` (es un CASE sin ELSE). Se saca
  // entera: `firmographics: null` se lee como "no tenemos los datos de esta
  // empresa", que es exactamente lo contrario de lo que pasó — no se pidieron.
  // Dentro del bloque, en cambio, null SÍ significa "no lo sabemos".
  if (payload.mode === "detail" && !includeFirmographics) {
    for (const company of payload.companies) delete company.firmographics
  }

  return {
    ...payload,
    resolvedTerms: matched,
    unresolvedTerms: unresolved,
    appliedFilters: {
      termsMode,
      minSignals,
      countries: params.countries?.length ? params.countries : null,
      industries: params.industries?.length ? params.industries : null,
      includeProviders: params.includeProviders ?? false,
    },
    nextCursor:
      payload.mode === "detail" && payload.truncated
        ? encodeCursor(params, payload.offset + limit)
        : null,
    guidance: buildGuidance(payload, matched, { ...params, termsMode, minSignals }),
  }
}

/**
 * Redacta la instrucción de qué hacer con el resultado. Vive acá y no en el
 * prompt de la tool porque depende de los números concretos de la corrida.
 */
function buildGuidance(
  payload: ScreeningPayload | DetailPayload,
  matched: CapabilityTerm[],
  params: CapabilitySearchParams & { termsMode: "any" | "all"; minSignals: number },
): string | null {
  const parts: string[] = []

  if (payload.totalCompanies === 0) {
    const joiner = params.termsMode === "all" ? " Y " : " + "
    return (
      `Sin resultados para ${matched.map((t) => t.name).join(joiner)}` +
      `${params.countries?.length ? ` en ${params.countries.join(", ")}` : ""}` +
      `${params.minSignals > 1 ? ` con al menos ${params.minSignals} señales` : ""}. ` +
      (params.termsMode === "all"
        ? `Probá con termsMode="any" para ver cuántas tiene cada término por separado, `
        : ``) +
      (params.minSignals > 1 ? `bajá minSignals, ` : ``) +
      `sacá el filtro de país o usá un término más amplio.`
    )
  }

  // El default excluye service providers y v1 no lo decía en ningún lado: se
  // descubría comparando contra SQL. Si descartó algo, tiene que verse.
  if (payload.excluded.serviceProviders > 0) {
    parts.push(
      `Se excluyeron ${payload.excluded.serviceProviders} cuentas de industria "service_provider" ` +
        `(consultoras, integradores, software factories), que es el default. ` +
        `Si el usuario los quiere, pasá includeProviders: true.`,
    )
  }

  const ambiguous = matched.length > 1 && matched.some((t) => t.kind === "product")

  if (payload.mode === "screening") {
    if (payload.totalCompanies > CROWDED_THRESHOLD) {
      const top = payload.byCountry.slice(0, 5).map((c) => `${c.country} (${c.companies})`)
      parts.push(
        `Son ${payload.totalCompanies} empresas: demasiadas para listar. ` +
          `Antes de pedir el detalle acotá, y decile al usuario con qué criterio lo hiciste. ` +
          `Tenés tres formas y conviene combinarlas: ` +
          `(1) minSignals, que filtra por VOLUMEN de evidencia y es el corte más útil ` +
          `—una cuenta con 1 señal suelta casi nunca es una oportunidad real—; ` +
          `(2) countries / industries; ` +
          `(3) termsMode: "all" si el usuario quiere las que tienen TODOS los términos y no cualquiera. ` +
          `Países con más presencia: ${top.join(", ")}.`,
      )
      parts.push(exportAdvice(payload.totalCompanies, params.limit ?? 25))
    } else {
      parts.push(
        `Son ${payload.totalCompanies} empresas, un volumen manejable: ` +
          `podés pedir mode="detail" directamente.`,
      )
    }
    if (params.termsMode === "any" && matched.length > 1) {
      parts.push(
        `OJO: termsMode es "any", así que este número SUMA las empresas que tienen ` +
          `cualquiera de los términos. Si el usuario pidió las que tienen todos, repetí con termsMode: "all".`,
      )
    }
    if (ambiguous) {
      parts.push(
        `El término resolvió a ${matched.length} entradas del diccionario ` +
          `(${matched.map((t) => t.name).join(", ")}). ` +
          `Cada empresa trae "termHits" en el detalle con cuántas señales aportó cada una.`,
      )
    }
    return parts.join(" ")
  }

  parts.push(
    `Leé "termHits" antes de priorizar: dos cuentas con el mismo total de señales pueden ser ` +
      `casos completamente distintos según cómo se reparten entre los términos. ` +
      `Y "contactsInBase" son contactos que ASCI tiene de esa empresa, NO su dotación: ` +
      `si el usuario pregunta por tamaño, la dotación sale de firmographics.employeesApollo ` +
      `(include: ["firmographics"]), que puede venir en null porque no la tenemos para todas.`,
  )

  if (payload.truncated) {
    const shown = payload.offset + payload.returned
    const limit = params.limit ?? 25
    parts.push(
      `Se devolvieron ${payload.returned} de ${payload.totalCompanies} (${payload.offset + 1}-${shown}), ` +
        `ordenadas por cantidad de señales. Para la página siguiente reenviá la MISMA llamada ` +
        `agregando cursor: "<nextCursor>".`,
    )
    parts.push(exportAdvice(payload.totalCompanies, limit))
  }

  return parts.join(" ")
}

/**
 * Qué hacer cuando el usuario quiere la lista COMPLETA, no una muestra.
 *
 * Existe porque "paginá" a secas es un mal consejo y "acotá" a secas también:
 * cuál de los dos es el correcto depende del volumen, y el modelo no tiene cómo
 * saber dónde está el techo. Se lo decimos con el número concreto de la corrida.
 */
export function exportAdvice(totalCompanies: number, limit: number): string {
  // Las paginas se cuentan contra el limite MAXIMO, no contra el que se uso en
  // esta corrida. Si alguien exploro con limit 3, contra ese limite 59 empresas
  // dan "20 llamadas" — y el modelo hace 20, cuando la respuesta correcta es
  // subir el limite a 50 y hacer 2. El numero que se le muestra tiene que ser
  // el del camino que queremos que tome, no el del que venia tomando.
  const pages = Math.ceil(totalCompanies / MAX_DETAIL_LIMIT)
  const raiseLimit =
    limit < MAX_DETAIL_LIMIT
      ? ` Para eso subí limit a ${MAX_DETAIL_LIMIT} (venís usando ${limit}).`
      : ""

  if (totalCompanies <= PAGINABLE_CEILING) {
    const cost =
      pages === 1
        ? `es UNA sola llamada y entra: pedila`
        : `son ${pages} llamadas encadenando cursor y entra: pedí las ${pages}`
    return (
      `Si lo que el usuario quiere es la lista COMPLETA (para exportarla o trabajarla afuera), ` +
      `${cost} y armá vos el listado.${raiseLimit} Si tenés herramientas de archivo, escribilo como ` +
      `CSV en vez de volcarlo en el chat. Si no, mostralo como tabla.`
    )
  }

  return (
    `NO intentes bajar las ${totalCompanies} paginando: son ${pages} llamadas aun con limit ` +
    `${MAX_DETAIL_LIMIT} y no entran en una conversación. Si el usuario quiere el listado completo ` +
    `para exportar, decíselo con estas palabras: hoy ASCI no tiene export por MCP, y el camino es ` +
    `acotar la búsqueda (minSignals es lo que más recorta) hasta un recorte que sí pueda trabajar, ` +
    `o pedir el export por la aplicación web. No le prometas un archivo ni una descarga.`
  )
}
