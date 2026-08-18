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
    // `sin_evidencia` es un cuarto valor del vocabulario de tech-radar que v2
    // NO publica ("no publicamos esos por default"). Colapsarlo a Inferido lo
    // convertiría en evidencia presentable, que es justamente lo que v2 evita.
    // Se mapea al nivel más débil pero se expone aparte con isPublishable().
    case "sin_evidencia":
      return "Inferido"
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

/**
 * ¿Este valor legacy es publicable como evidencia?
 *
 * Solo `sin_evidencia` no lo es. Existe como función aparte porque el enum
 * canónico tiene tres niveles a propósito: agregar un cuarto "SinEvidencia"
 * obligaría a todo consumidor a manejar un caso que nunca debería mostrarse.
 * La regla la fija tech-radar de v2 y acá se respeta, no se reinterpreta.
 */
export function isPublishableEvidence(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() !== "sin_evidencia"
}

/**
 * Traduce del canónico al vocabulario de v2 `company_implementations`
 * (`directa|convergente|inferencia`).
 *
 * Obligatorio al escribir casos de éxito en esa tabla: la UI de v2 ya rotula
 * esos tres valores. Escribir "Confirmado" ahí dejaría filas que v2 no sabe
 * mostrar, y v2 está en producción. La traducción va en la escritura para que
 * v2 siga leyendo exactamente el vocabulario que espera.
 */
export function toV2EvidenceLevel(level: EvidenceLevel): "directa" | "convergente" | "inferencia" {
  if (level === "Confirmado") return "directa"
  if (level === "Probable") return "convergente"
  return "inferencia"
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

// ─── Dirección de la señal ───────────────────────────────────
//
// Eje independiente de la categoría. Una noticia de "venta de unidad de negocio"
// es categoría `ma` igual que una adquisición, pero apunta al lado opuesto.
// Sin este eje, TIMING_RULES solo sumaba y una cuenta en crisis puntuaba igual
// que una en expansión.

export const SIGNAL_DIRECTIONS = ["expansion", "contraccion", "neutro"] as const

export type SignalDirection = (typeof SIGNAL_DIRECTIONS)[number]

/** Normaliza el valor de `company_news.direction`, tolerando nulos y acentos. */
export function toSignalDirection(value: string | null | undefined): SignalDirection {
  if (!value) return "neutro"
  const normalized = value.trim().toLowerCase()
  if (normalized === "expansion" || normalized === "expansión") return "expansion"
  if (normalized === "contraccion" || normalized === "contracción") return "contraccion"
  return "neutro"
}

// ─── Categoría de la noticia ─────────────────────────────────
//
// `category` viajaba como string libre, así que cada cliente MCP inventaba su
// taxonomía y la tabla quedó con variantes que agrupan mal. Medido en producción:
// 'alianzas' (74 filas) contra 'alanzas' (1, con typo), y 'regulatorio' (25)
// contra 'regulacion' (3). Son lo mismo contado por separado, y cualquier filtro
// por categoría pierde filas sin avisar.
//
// La lista sale de los valores reales dominantes de `company_news`, no de una
// taxonomía inventada de cero.

export const NEWS_CATEGORIES = [
  "crecimiento", "ejecutivos", "inversion", "innovacion", "transformacion",
  "alianzas", "ma", "desafios", "regulatorio", "financiero", "corporativo",
  "sector", "tecnologia", "reputacion", "otro",
] as const

export type NewsCategory = (typeof NEWS_CATEGORIES)[number]

/** Variantes conocidas → canónica. */
const CATEGORY_ALIASES: Record<string, NewsCategory> = {
  alanzas: "alianzas",
  alianza: "alianzas",
  regulacion: "regulatorio",
  regulatoria: "regulatorio",
  "m&a": "ma",
  fusiones: "ma",
  adquisiciones: "ma",
  adquisicion: "ma",
  crisis: "desafios",
  personas: "ejecutivos",
  liderazgo: "ejecutivos",
  expansion: "crecimiento",
}

/**
 * Lleva una categoría a la forma canónica.
 *
 * Nunca falla: lo que no reconoce cae en "otro" y se informa aparte. Rechazar la
 * noticia entera por una etiqueta mal escrita perdería lo valioso —el hecho y su
 * fuente— por un problema de vocabulario. Es idempotente, así que se puede llamar
 * sobre datos ya normalizados.
 */
export function normalizeNewsCategory(value: string | null | undefined): {
  category: NewsCategory
  /** true si el valor recibido no era exactamente el canónico. */
  wasRemapped: boolean
  original: string | null
} {
  const original = value?.trim() || null
  if (!original) return { category: "otro", wasRemapped: false, original: null }
  // Sin tildes y en minúscula, para que 'Inversión' e 'inversion' colapsen.
  const key = original
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  if ((NEWS_CATEGORIES as readonly string[]).includes(key)) {
    return { category: key as NewsCategory, wasRemapped: key !== original, original }
  }
  const alias = CATEGORY_ALIASES[key]
  if (alias) return { category: alias, wasRemapped: true, original }
  return { category: "otro", wasRemapped: true, original }
}

/** Etiqueta para mostrar al usuario junto al motivo de la clasificación. */
export const EVIDENCE_LEVEL_HINTS: Record<EvidenceLevel, string> = {
  Confirmado: "Sostenido por una fuente citable de la propia cuenta.",
  Probable: "Evidencia real pero indirecta, o varias fuentes convergentes.",
  Inferido: "Deducción a partir del contexto. No citar como un hecho.",
}
