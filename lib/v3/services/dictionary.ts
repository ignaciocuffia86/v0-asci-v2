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
    admin.from("dictionary_products").select("id, vendor_id, name, keywords"),
    admin.from("dictionary_processes").select("id, name, keywords"),
  ])

  const data: DictionaryData = {
    vendors: vendorsRes.data ?? [],
    products: (productsRes.data ?? []).map((p) => ({
      ...p,
      keywords: Array.isArray(p.keywords) ? p.keywords : [],
    })),
    processes: (processesRes.data ?? []).map((p) => ({
      ...p,
      keywords: Array.isArray(p.keywords) ? p.keywords : [],
    })),
  }

  cachedDictionary = { data, loadedAt: Date.now() }
  return data
}

/**
 * Matching determinístico de un texto contra el diccionario.
 * Devuelve productos y procesos matcheados con la keyword y un snippet
 * de evidencia (± 60 chars alrededor del match).
 */
export function matchTextAgainstDictionary(
  text: string,
  dictionary: DictionaryData
): DictionaryMatch[] {
  if (!text) return []
  const lower = text.toLowerCase()
  const matches: DictionaryMatch[] = []
  const seen = new Set<string>()

  const findSnippet = (keyword: string): string | null => {
    const idx = lower.indexOf(keyword.toLowerCase())
    if (idx === -1) return null
    const start = Math.max(0, idx - 60)
    const end = Math.min(text.length, idx + keyword.length + 60)
    return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "")
  }

  for (const product of dictionary.products) {
    for (const keyword of product.keywords) {
      if (!keyword || keyword.length < 3) continue
      const snippet = findSnippet(keyword)
      if (snippet && !seen.has(`product:${product.id}`)) {
        seen.add(`product:${product.id}`)
        matches.push({ type: "product", id: product.id, name: product.name, keyword, snippet })
        break
      }
    }
  }

  for (const process of dictionary.processes) {
    for (const keyword of process.keywords) {
      if (!keyword || keyword.length < 3) continue
      const snippet = findSnippet(keyword)
      if (snippet && !seen.has(`process:${process.id}`)) {
        seen.add(`process:${process.id}`)
        matches.push({ type: "process", id: process.id, name: process.name, keyword, snippet })
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
