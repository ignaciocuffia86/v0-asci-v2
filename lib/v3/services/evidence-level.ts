// ═══════════════════════════════════════════════════════════
// Nivel de evidencia canónico de v3.
//
// Coexisten tres vocabularios en producción y ninguno se puede borrar:
//   1. v2 `company_implementations`: strong|medium|weak, migrado por el script
//      161 a directa|convergente|inferencia.
//   2. v3 `radar_findings`: CHECK (evidence_level IN ('explicit','inferred')),
//      binario por constraint.
//   3. UI de v2: ya rotula medium→"Probable", weak→"Inferido".
//
// Este módulo define el enum canónico y traduce DESDE los legacy EN LECTURA.
// Los datos de v2 no se reescriben: v2 está en producción y no puede recibir
// ningún cambio derivado de v3.
// ═══════════════════════════════════════════════════════════

/**
 * Nivel de evidencia expuesto por toda la superficie de v3 (MCP incluido).
 *
 * - Confirmado: la afirmación está sostenida por una fuente citable y propia de
 *   la cuenta (una vacante de la empresa, una implementación con URL).
 * - Probable: hay evidencia real pero indirecta, o varias fuentes convergentes
 *   sin una cita única y concluyente.
 * - Inferido: es una deducción a partir de contexto. No es citable como hecho.
 */
export const EVIDENCE_LEVELS = ["Confirmado", "Probable", "Inferido"] as const

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number]

/** Orden de mayor a menor fuerza, para comparar y ordenar. */
const RANK: Record<EvidenceLevel, number> = { Confirmado: 3, Probable: 2, Inferido: 1 }

/**
 * Traduce cualquier valor legacy al enum canónico.
 *
 * Acepta los tres vocabularios y también los valores canónicos, para poder
 * llamarlo sobre datos ya normalizados sin romper (idempotente).
 * Ante un valor desconocido o nulo devuelve "Inferido": es el default seguro,
 * porque nunca hay que presentar como confirmado algo que no se pudo verificar.
 */
export function toEvidenceLevel(value: string | null | undefined): EvidenceLevel {
  if (!value) return "Inferido"
  switch (value.trim().toLowerCase()) {
    // v3 radar_findings + v2 migrado + v2 original
    case "explicit":
    case "directa":
    case "strong":
    case "confirmado":
      return "Confirmado"
    case "convergente":
    case "medium":
    case "probable":
      return "Probable"
    case "inferred":
    case "inferencia":
    case "weak":
    case "inferido":
      return "Inferido"
    default:
      return "Inferido"
  }
}

/**
 * Traduce del canónico al vocabulario binario de `v3.radar_findings`.
 *
 * Necesario mientras el CHECK de la tabla siga siendo binario para las filas
 * históricas: "Probable" colapsa a 'explicit' porque hay evidencia real, solo
 * que indirecta. Se usa al escribir, no al leer.
 */
export function toRadarEvidenceLevel(level: EvidenceLevel): "explicit" | "inferred" {
  return level === "Inferido" ? "inferred" : "explicit"
}

/** El más fuerte de un conjunto. Un término con una vacante citable y diez inferencias es Confirmado. */
export function strongestEvidenceLevel(levels: EvidenceLevel[]): EvidenceLevel {
  return levels.reduce<EvidenceLevel>((best, level) => (RANK[level] > RANK[best] ? level : best), "Inferido")
}

/**
 * Peso de cada nivel para el pilar de buying signals del scorecard.
 *
 * Antes era binario (explicit ×12 / inferred ×5) y no existía punto intermedio.
 * "Probable" se ubica en 8: por encima de una deducción, por debajo de un hecho
 * citable. Cambiar estos números mueve los scores, así que están acá y no
 * dispersos en el cálculo.
 */
export const EVIDENCE_WEIGHTS: Record<EvidenceLevel, number> = {
  Confirmado: 12,
  Probable: 8,
  Inferido: 5,
}

/** Etiqueta para mostrar al usuario junto al motivo de la clasificación. */
export const EVIDENCE_LEVEL_HINTS: Record<EvidenceLevel, string> = {
  Confirmado: "Sostenido por una fuente citable de la propia cuenta.",
  Probable: "Evidencia real pero indirecta, o varias fuentes convergentes.",
  Inferido: "Deducción a partir del contexto. No citar como un hecho.",
}
