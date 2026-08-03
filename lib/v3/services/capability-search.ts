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
// ═══════════════════════════════════════════════════════════════════════════

/** Tope duro de empresas por llamada en modo detalle. */
const MAX_DETAIL_LIMIT = 50

/**
 * Cuántas empresas ya se consideran "demasiadas" para volcar al contexto sin
 * antes preguntarle al usuario. No es un límite técnico: es el umbral a partir
 * del cual la tool sugiere acotar.
 */
const CROWDED_THRESHOLD = 40

export type CapabilityTerm = {
  id: string
  name: string
  kind: "product" | "process"
  /** Vendor del producto, cuando aplica. Sirve para desambiguar homónimos. */
  vendor: string | null
}

export type CapabilityResolution = {
  matched: CapabilityTerm[]
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
 * Orden de resolución, de más preciso a más laxo. Se corta en el primer nivel
 * que da resultados para no mezclar un match exacto con ruido de substring:
 *   1. nombre exacto del producto/proceso
 *   2. keyword exacta
 *   3. vendor exacto → todos sus productos ("Microsoft", "SAP")
 *   4. substring del nombre (mín. 4 caracteres) → "dynamics" trae CRM y ERP
 */
export async function resolveCapabilityTerms(
  terms: string[],
  dictionary?: DictionaryData,
): Promise<CapabilityResolution> {
  const dict = dictionary ?? (await loadDictionary())
  const vendorById = new Map(dict.vendors.map((v) => [v.id, v.name]))

  const matched = new Map<string, CapabilityTerm>()
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

    // 2. keyword exacta
    if (!hits.length) {
      for (const p of dict.products) {
        if (p.keywords.some((k) => norm(k) === q)) hits.push(asProduct(p))
      }
      for (const p of dict.processes) {
        if (p.keywords.some((k) => norm(k) === q)) hits.push(asProcess(p))
      }
    }

    // 3. vendor exacto → todos sus productos
    if (!hits.length) {
      const vendor = dict.vendors.find((v) => norm(v.name) === q)
      if (vendor) {
        for (const p of dict.products) if (p.vendor_id === vendor.id) hits.push(asProduct(p))
      }
    }

    // 4. substring. El mínimo de 4 caracteres evita el problema ya conocido de
    //    los acrónimos cortos del diccionario ("ORM" matcheando "información").
    if (!hits.length && q.length >= 4) {
      for (const p of dict.products) if (norm(p.name).includes(q)) hits.push(asProduct(p))
      for (const p of dict.processes) if (norm(p.name).includes(q)) hits.push(asProcess(p))
    }

    if (!hits.length) unresolved.push(raw)
    for (const hit of hits) matched.set(hit.id, hit)
  }

  return { matched: [...matched.values()], unresolved }
}

type ScreeningPayload = {
  mode: "screening"
  totalCompanies: number
  totalSignals: number
  byCountry: { country: string; companies: number; signals: number }[]
  byIndustry: { industryId: string; industry: string; companies: number; signals: number }[]
}

type DetailPayload = {
  mode: "detail"
  totalCompanies: number
  totalSignals: number
  returned: number
  truncated: boolean
  companies: {
    companyId: string
    name: string
    country: string | null
    industryId: string | null
    industry: string | null
    website: string | null
    signals: number
    currentEmployees: number
    alumni: number
    jobPostings: number
    latestSignalAt: string | null
    matchedTerms: string[] | null
  }[]
}

export type CapabilitySearchResult = (ScreeningPayload | DetailPayload) & {
  resolvedTerms: CapabilityTerm[]
  unresolvedTerms: string[]
  /** Instrucción para el modelo. Null cuando el resultado ya es manejable. */
  guidance: string | null
}

export async function searchCompaniesByCapability(params: {
  terms: string[]
  countries?: string[]
  industries?: string[]
  includeProviders?: boolean
  mode?: "screening" | "detail"
  limit?: number
}): Promise<CapabilitySearchResult> {
  const { matched, unresolved } = await resolveCapabilityTerms(params.terms)

  if (!matched.length) {
    throw new Error(
      `CAPABILITY_TERMS_UNRESOLVED:Ningún término coincide con el diccionario: ${unresolved.join(", ")}. ` +
        `Usá get_document_dictionaries para ver los términos disponibles.`,
    )
  }

  const productIds = matched.filter((t) => t.kind === "product").map((t) => t.id)
  const processIds = matched.filter((t) => t.kind === "process").map((t) => t.id)
  const mode = params.mode ?? "screening"

  const admin = createAdminClient()
  const { data, error } = await admin.schema("v3").rpc("search_companies_by_capability", {
    p_product_ids: productIds.length ? productIds : null,
    p_process_ids: processIds.length ? processIds : null,
    p_countries: params.countries?.length ? params.countries : null,
    p_master_industry_ids: params.industries?.length ? params.industries : null,
    p_exclude_providers: !params.includeProviders,
    p_mode: mode,
    p_limit: Math.min(params.limit ?? 25, MAX_DETAIL_LIMIT),
  })

  if (error) {
    // Los topes de la RPC son errores de USO, no fallas: se propaga el mensaje
    // tal cual para que el modelo pueda corregir la llamada.
    throw new Error(`CAPABILITY_SEARCH_FAILED:${error.message}`)
  }

  const payload = data as ScreeningPayload | DetailPayload

  return {
    ...payload,
    resolvedTerms: matched,
    unresolvedTerms: unresolved,
    guidance: buildGuidance(payload, matched, params),
  }
}

/**
 * Redacta la instrucción de qué hacer con el resultado. Vive acá y no en el
 * prompt de la tool porque depende de los números concretos de la corrida.
 */
function buildGuidance(
  payload: ScreeningPayload | DetailPayload,
  matched: CapabilityTerm[],
  params: { countries?: string[]; industries?: string[] },
): string | null {
  if (payload.totalCompanies === 0) {
    return (
      `Sin resultados para ${matched.map((t) => t.name).join(" + ")}` +
      `${params.countries?.length ? ` en ${params.countries.join(", ")}` : ""}. ` +
      `Probá sin el filtro de país o con un término más amplio.`
    )
  }

  const ambiguous = matched.length > 1 && matched.some((t) => t.kind === "product")

  if (payload.mode === "screening") {
    const parts: string[] = []
    if (payload.totalCompanies > CROWDED_THRESHOLD) {
      const top = payload.byCountry.slice(0, 5).map((c) => `${c.country} (${c.companies})`)
      parts.push(
        `Son ${payload.totalCompanies} empresas: demasiadas para listar. ` +
          `Antes de pedir el detalle, preguntale al usuario por qué país o industria quiere empezar. ` +
          `Países con más presencia: ${top.join(", ")}.`,
      )
    } else {
      parts.push(
        `Son ${payload.totalCompanies} empresas, un volumen manejable: ` +
          `podés pedir mode="detail" directamente.`,
      )
    }
    if (ambiguous) {
      parts.push(
        `El término resolvió a ${matched.length} entradas del diccionario ` +
          `(${matched.map((t) => t.name).join(", ")}) y el resultado las suma. ` +
          `Cada empresa trae "matchedTerms" en el detalle para saber cuál usa.`,
      )
    }
    return parts.join(" ")
  }

  if (payload.truncated) {
    return (
      `Se devolvieron ${payload.returned} de ${payload.totalCompanies}, ordenadas por cantidad de señales. ` +
      `Para ver otras, acotá por país o industria en vez de subir el límite.`
    )
  }
  return null
}
