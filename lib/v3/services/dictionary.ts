import { createAdminClient } from "@/lib/supabase/admin"
import type { DictionaryData, DictionaryMatch } from "./types"

// ═══════════════════════════════════════════════════════════
// Servicio de diccionario (reutiliza el diccionario global v2:
// dictionary_vendors / dictionary_products / dictionary_processes)
//
// Roles en la plataforma:
//  1. Matching determinístico de texto (Capa 2, gratis) — anota postings
//     y hallazgos antes de pasar por IA.
//  2. Vocabulario controlado para el estructurador (canoniza hallazgos
//     de Opus contra IDs del diccionario).
//  3. Sugerencias de términos nuevos detectados por IA, aprobables por
//     super-admin (v3.dictionary_term_suggestions).
// ═══════════════════════════════════════════════════════════

let cachedDictionary: { data: DictionaryData; loadedAt: number } | null = null
const DICTIONARY_CACHE_MS = 5 * 60 * 1000 // 5 minutos en memoria del proceso

/** Carga el diccionario completo (con cache in-process de 5 min). */
export async function loadDictionary(): Promise<DictionaryData> {
  if (cachedDictionary && Date.now() - cachedDictionary.loadedAt < DICTIONARY_CACHE_MS) {
    return cachedDictionary.data
  }

  const admin = createAdminClient()
  const [vendorsRes, productsRes, processesRes] = await Promise.all([
    admin.from("dictionary_vendors").select("id, name"),
    admin.from("dictionary_products").select("id, vendor_id, name, keywords, categoria, ciclo_vida"),
    admin.from("dictionary_processes").select("id, name, keywords"),
  ])

  const data: DictionaryData = {
    vendors: vendorsRes.data ?? [],
    products: (productsRes.data ?? []).map((p) => ({
      ...p,
      keywords: Array.isArray(p.keywords) ? p.keywords : [],
      categoria: p.categoria ?? null,
      ciclo_vida: p.ciclo_vida ?? null,
    })),
    processes: (processesRes.data ?? []).map((p) => ({
      ...p,
      keywords: Array.isArray(p.keywords) ? p.keywords : [],
    })),
  }

  cachedDictionary = { data, loadedAt: Date.now() }
  return data
}

// ─── Matching determinístico ─────────────────────────────────
//
// El matching era `indexOf` sobre el texto en minúsculas, sin límites de palabra.
// Con keywords de 3 caracteres eso produce falsos positivos sistemáticos en
// español, porque el acrónimo aparece DENTRO de palabras comunes:
//   "ORM" (Django)          → inf-ORM-ación, f-ORM-ación
//   "OCI" (Oracle Database) → neg-OCI-o, as-OCI-ado
//   "Lex" (AWS)             → f-LEX-ibilidad
//   "PAN" (Palo Alto)       → ex-PAN-sión
// Por eso una fábrica de golosinas aparecía usando Django con 72 menciones: eran
// 72 apariciones de la palabra "información".
//
// Se corrige con dos reglas: todo match exige límite de palabra, y los acrónimos
// cortos exigen además la grafía exacta en mayúsculas.

/**
 * Cache de patrones por keyword. matchTextAgainstDictionary se llama una vez por
 * señal (cientos por cuenta) contra todo el diccionario, así que recompilar la
 * expresión en cada llamada sería caro.
 */
const keywordPatternCache = new Map<string, RegExp>()

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Un acrónimo corto en mayúsculas es ambiguo si se compara ignorando el caso:
 * "información" contiene "orm" y "negocio" contiene "oci". Para estos exigimos
 * la grafía exacta, que es como se escriben de verdad (AWS, SAP, ORM, ERP).
 */
const isShortAcronym = (keyword: string) =>
  keyword.length <= 4 && keyword === keyword.toUpperCase() && /[A-Z]/.test(keyword)

function keywordPattern(keyword: string): RegExp {
  const cached = keywordPatternCache.get(keyword)
  if (cached) return cached
  // Límites propios en lugar de \b, porque \b no contempla acentos (que es lo que
  // generaba los falsos positivos en español) ni sirve en keywords que empiezan o
  // terminan en símbolo.
  //
  // El límite se exige solo en los extremos alfanuméricos de la keyword. Si el
  // extremo ya es un símbolo, el símbolo mismo actúa de separador y exigir límite
  // sería contraproducente: ".NET" no matchearía dentro de "ASP.NET" y "C++" no
  // matchearía en "C++11".
  const boundary = "[\\p{L}\\p{N}]"
  const prefix = new RegExp(`^${boundary}`, "u").test(keyword) ? `(?<!${boundary})` : ""
  const suffix = new RegExp(`${boundary}$`, "u").test(keyword) ? `(?!${boundary})` : ""
  const pattern = new RegExp(
    `${prefix}${escapeRegex(keyword)}${suffix}`,
    isShortAcronym(keyword) ? "u" : "iu"
  )
  keywordPatternCache.set(keyword, pattern)
  return pattern
}

/**
 * Matching determinístico de un texto contra el diccionario.
 * Devuelve productos y procesos matcheados con la keyword tal como aparece en el
 * texto y un snippet de evidencia (± 60 chars alrededor del match real).
 */
export function matchTextAgainstDictionary(
  text: string,
  dictionary: DictionaryData
): DictionaryMatch[] {
  if (!text) return []
  const matches: DictionaryMatch[] = []
  const seen = new Set<string>()

  /** Devuelve la coincidencia real (con su grafía original) y su contexto. */
  const findMatch = (keyword: string): { keyword: string; snippet: string } | null => {
    const found = keywordPattern(keyword).exec(text)
    if (!found) return null
    const start = Math.max(0, found.index - 60)
    const end = Math.min(text.length, found.index + found[0].length + 60)
    return {
      keyword: found[0],
      snippet: (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : ""),
    }
  }

  for (const product of dictionary.products) {
    for (const keyword of product.keywords) {
      if (!keyword || keyword.length < 3) continue
      const found = findMatch(keyword)
      if (found && !seen.has(`product:${product.id}`)) {
        seen.add(`product:${product.id}`)
        matches.push({ type: "product", id: product.id, name: product.name, ...found })
        break
      }
    }
  }

  for (const process of dictionary.processes) {
    for (const keyword of process.keywords) {
      if (!keyword || keyword.length < 3) continue
      const found = findMatch(keyword)
      if (found && !seen.has(`process:${process.id}`)) {
        seen.add(`process:${process.id}`)
        matches.push({ type: "process", id: process.id, name: process.name, ...found })
        break
      }
    }
  }

  return matches
}

/**
 * Resuelve un nombre libre de tecnología/producto al ID canónico del
 * diccionario. Usado por el estructurador para canonizar hallazgos de Opus.
 */
export function resolveProductByName(
  name: string,
  dictionary: DictionaryData
): { id: string; name: string } | null {
  const normalized = name.toLowerCase().trim()
  if (!normalized) return null

  for (const product of dictionary.products) {
    if (product.name.toLowerCase() === normalized) return { id: product.id, name: product.name }
  }
  for (const product of dictionary.products) {
    for (const keyword of product.keywords) {
      if (keyword.toLowerCase() === normalized) return { id: product.id, name: product.name }
    }
  }
  // Contains match defensivo (solo para nombres largos, evita falsos positivos)
  if (normalized.length >= 5) {
    for (const product of dictionary.products) {
      const pn = product.name.toLowerCase()
      if (pn.includes(normalized) || normalized.includes(pn)) {
        return { id: product.id, name: product.name }
      }
    }
  }
  return null
}

/** Ídem para procesos de negocio. */
export function resolveProcessByName(
  name: string,
  dictionary: DictionaryData
): { id: string; name: string } | null {
  const normalized = name.toLowerCase().trim()
  if (!normalized) return null
  for (const process of dictionary.processes) {
    if (process.name.toLowerCase() === normalized) return { id: process.id, name: process.name }
  }
  for (const process of dictionary.processes) {
    for (const keyword of process.keywords) {
      if (keyword.toLowerCase() === normalized) return { id: process.id, name: process.name }
    }
  }
  return null
}

/**
 * Registra (o incrementa) una sugerencia de término nuevo detectado por IA
 * que no existe en el diccionario. El super-admin las revisa y aprueba.
 */
export async function suggestDictionaryTerm(params: {
  term: string
  type: "technology" | "process" | "vendor" | "product"
  vendorHint?: string
  evidence: { companyId?: string; source?: string; snippet?: string }
  agent: string
}): Promise<void> {
  const admin = createAdminClient()
  const normalized = params.term.toLowerCase().trim()
  if (!normalized || normalized.length < 3) return

  const { data: existing } = await admin
    .schema("v3")
    .from("dictionary_term_suggestions")
    .select("id, occurrences, evidence")
    .eq("normalized_term", normalized)
    .eq("suggested_type", params.type)
    .maybeSingle()

  if (existing) {
    const evidence = Array.isArray(existing.evidence) ? existing.evidence : []
    evidence.push(params.evidence)
    await admin
      .schema("v3")
      .from("dictionary_term_suggestions")
      .update({
        occurrences: (existing.occurrences ?? 1) + 1,
        evidence: evidence.slice(-20), // guardamos las últimas 20 evidencias
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
  } else {
    await admin
      .schema("v3")
      .from("dictionary_term_suggestions")
      .insert({
        term: params.term.trim(),
        normalized_term: normalized,
        suggested_type: params.type,
        vendor_hint: params.vendorHint ?? null,
        evidence: [params.evidence],
        suggested_by_agent: params.agent,
      })
  }
}
