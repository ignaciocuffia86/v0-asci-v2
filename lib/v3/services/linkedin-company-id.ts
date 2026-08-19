// Helpers PUROS del LinkedIn company ID numérico (Fase 3 del diseño).
// Sin "server-only" para poder testearlos directo; los writes viven en cada
// consumidor (ingesta, import) porque son un UPDATE write-once de tres líneas.

/** Valida y parsea un LinkedIn company ID (numérico, hasta 15 dígitos). */
export function parseLinkedinCompanyId(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : ""
  if (!/^[0-9]{1,15}$/.test(text)) return null
  const parsed = Number.parseInt(text, 10)
  return parsed > 0 ? parsed : null
}

/**
 * Extrae el companyId consistente de un lote de vacantes ACEPTADAS.
 *
 * El aprendizaje es write-once y el ID pasa a ser el filtro EXACTO de todos
 * los scrapings siguientes, así que la regla es conservadora (diseño 5.4): si
 * las vacantes aceptadas traen MÁS de un ID distinto, es señal de que el
 * guardrail de pertenencia dejó pasar un falso positivo y no se aprende
 * ninguno — mejor seguir por nombre un mes más que fijar un ID equivocado.
 */
export function extractConsistentLinkedinCompanyId(
  items: Array<Record<string, unknown>>,
): { id: number | null; mixed: boolean } {
  const ids = new Set<number>()
  for (const item of items) {
    const parsed = parseLinkedinCompanyId(item.companyId)
    if (parsed !== null) ids.add(parsed)
  }
  if (ids.size === 1) return { id: [...ids][0], mixed: false }
  return { id: null, mixed: ids.size > 1 }
}
