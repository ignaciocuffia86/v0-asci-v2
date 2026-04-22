/**
 * Validación de títulos de cargo antes de enviarlos a Apollo.
 *
 * La UI usa estos helpers para dar feedback inmediato al usuario y para
 * sanear la lista antes del request. Reglas basadas en patrones observados:
 * - Títulos largos (> 60 chars) tienden a devolver 0 resultados porque Apollo
 *   no tiene ese string exacto indexado.
 * - Títulos sin letras (solo numeros / simbolos) nunca matchean.
 * - Duplicados con distinto casing contaminan el payload.
 */

import { normalizeTitle } from "./query-hash"

export type TitleValidation =
  | { valid: true; normalized: string; warning?: string }
  | { valid: false; reason: string }

const MIN_LEN = 2
const MAX_LEN = 120
const WARN_LEN = 60

export function validateTitle(raw: string): TitleValidation {
  if (!raw || typeof raw !== "string") {
    return { valid: false, reason: "Título vacío" }
  }

  const trimmed = raw.trim()
  if (trimmed.length < MIN_LEN) {
    return { valid: false, reason: "Muy corto (mínimo 2 caracteres)" }
  }
  if (trimmed.length > MAX_LEN) {
    return { valid: false, reason: `Muy largo (máximo ${MAX_LEN} caracteres)` }
  }
  // Debe tener al menos una secuencia de 2+ letras
  if (!/[a-záéíóúñü]{2,}/i.test(trimmed)) {
    return { valid: false, reason: "Debe contener al menos una palabra" }
  }

  const normalized = normalizeTitle(trimmed)

  const warning =
    trimmed.length > WARN_LEN
      ? "Los títulos de más de 60 caracteres suelen traer 0 resultados. Probá con 2-4 palabras (ej: 'IT Director')."
      : undefined

  return { valid: true, normalized, warning }
}

/**
 * Toma una lista cruda y devuelve:
 * - `accepted`: normalizados y deduplicados
 * - `rejected`: con razón por cada uno
 * - `truncated`: true si se corto por exceder el limite
 */
export function sanitizeTitleList(
  titles: string[],
  { max = 25 }: { max?: number } = {},
): {
  accepted: string[]
  rejected: Array<{ input: string; reason: string }>
  truncated: boolean
} {
  const accepted: string[] = []
  const seen = new Set<string>()
  const rejected: Array<{ input: string; reason: string }> = []

  for (const raw of titles) {
    const r = validateTitle(raw)
    if (!r.valid) {
      rejected.push({ input: raw, reason: r.reason })
      continue
    }
    if (seen.has(r.normalized)) continue
    seen.add(r.normalized)
    accepted.push(raw.trim())
    if (accepted.length >= max) break
  }

  return {
    accepted,
    rejected,
    truncated: titles.length > max,
  }
}
