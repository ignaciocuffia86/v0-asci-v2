// Reglas PURAS de movimientos de personal (Fase 7 de la radiografía
// self-service). Sin "server-only" a propósito para poder testearlas directo;
// el servicio (personnel-movements.ts) trae los datos y estas funciones
// deciden, así las definiciones del informe (qué es rotación interna, qué es
// un decisor) tienen tests y una sola fuente de verdad.

/** Ventana por defecto del informe: los últimos 6 meses de movimientos. */
export const MOVEMENTS_WINDOW_MONTHS = 6

export type MovementType = "ingreso_nuevo" | "rotacion_interna"

export type MovementFocus = "decisor" | "perfil_objetivo" | null

export interface PreviousPositionEntry {
  company_id?: string | null
  company_name?: string | null
  title?: string | null
  started_on?: string | null
  ended_on?: string | null
}

/**
 * Misma definición que el informe manual: "rotación interna" significa que la
 * empresa anterior del perfil es la misma que la actual; "ingreso nuevo" que
 * venía de otra empresa o no tiene empresa previa registrada.
 */
export function classifyMovementType(
  previousPositions: PreviousPositionEntry[] | null | undefined,
  currentCompanyId: string,
  currentCompanyName: string | null,
): MovementType {
  const prev = previousPositions?.[0]
  if (!prev) return "ingreso_nuevo"
  if (prev.company_id && prev.company_id === currentCompanyId) return "rotacion_interna"
  const prevName = prev.company_name?.trim().toLowerCase()
  const curName = currentCompanyName?.trim().toLowerCase()
  if (prevName && curName && prevName === curName) return "rotacion_interna"
  return "ingreso_nuevo"
}

// Cargos con poder de decisión o de compra. Vocabulario genérico deliberado:
// las categorías de foco por workspace (derivadas de la propuesta + editables)
// llegan en la fase 9; esto cubre el corte "decisores" del scorecard mientras.
const DECISION_TITLE_PATTERN =
  /\b(gerent[ea]|director[a]?|jefe[a]?|head|chief|vp|vice ?president[ea]?|c[ieft]o\b|ceo|compras|procurement|abastecimiento|purchasing|sourcing|owner|due[ñn][oa]|founder|fundador[a]?)\b/i

export interface FocusProfileTerms {
  /** Cargos recomendados del workspace (buyer personas + documentos). */
  recommendedJobTitles: string[]
  /** Tecnologías y procesos objetivo de la propuesta de valor. */
  targetTerms: string[]
}

export interface FocusResult {
  focus: MovementFocus
  /** Términos que matchearon (para mostrar el porqué en la UI/informe). */
  matchedTerms: string[]
}

/**
 * Clasifica el foco de un movimiento para el scorecard de señales:
 * - "decisor": el cargo tiene poder de decisión/compra (patrón genérico o
 *   matchea los cargos recomendados del workspace).
 * - "perfil_objetivo": el cargo/headline menciona tecnologías o procesos de la
 *   propuesta de valor (términos de ≥3 chars).
 * - null: sin señal para este workspace.
 * Un decisor que además matchea perfil se reporta como decisor (es el corte
 * más accionable), con todos los términos matcheados.
 */
export function classifyMovementFocus(
  title: string | null | undefined,
  headline: string | null | undefined,
  profile: FocusProfileTerms,
): FocusResult {
  const text = [title ?? "", headline ?? ""].join(" · ").toLowerCase()
  if (!text.trim()) return { focus: null, matchedTerms: [] }

  const matchedTerms: string[] = []

  const titleLower = (title ?? "").toLowerCase()
  const decisionByPattern = DECISION_TITLE_PATTERN.test(titleLower)
  const decisionByRecommended = profile.recommendedJobTitles.some((item) => {
    const normalized = item.trim().toLowerCase()
    return normalized.length >= 3 && titleLower.includes(normalized)
  })

  for (const term of profile.targetTerms) {
    const normalized = term.trim().toLowerCase()
    if (normalized.length >= 3 && text.includes(normalized)) {
      matchedTerms.push(term.trim())
    }
  }

  if (decisionByPattern || decisionByRecommended) {
    return { focus: "decisor", matchedTerms }
  }
  if (matchedTerms.length > 0) {
    return { focus: "perfil_objetivo", matchedTerms }
  }
  return { focus: null, matchedTerms: [] }
}

export interface ContactChannels {
  email1?: string | null
  email1_status?: string | null
  email2?: string | null
  email2_status?: string | null
  email3?: string | null
  email3_status?: string | null
  email4?: string | null
  email4_status?: string | null
  phone1?: string | null
  phone1_type?: string | null
  phone2?: string | null
  phone2_type?: string | null
}

/** Corporativo (dominio de la empresa) o personal (gmail, hotmail…). */
export type ChannelKind = "corporativo" | "personal"

/**
 * Dominios de correo personal. Es el MISMO listado que la función SQL
 * `public.is_personal_email` (baseline), portado acá para poder clasificar sin
 * ir a la base. Si se agrega un dominio, agregarlo en los dos lados.
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "hotmail.com", "hotmail.es", "hotmail.com.ar",
  "outlook.com", "outlook.es",
  "live.com", "live.com.ar", "msn.com",
  "yahoo.com", "yahoo.es", "yahoo.com.ar", "ymail.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com",
  "proton.me", "protonmail.com", "pm.me",
  "gmx.com", "gmx.net",
  "mail.com",
  "yandex.com", "yandex.ru",
  "zoho.com", "fastmail.com", "tutanota.com", "hey.com",
])

export function emailKind(email: string): ChannelKind {
  const domain = email.split("@")[1]?.trim().toLowerCase()
  if (!domain) return "corporativo"
  return PERSONAL_EMAIL_DOMAINS.has(domain) ? "personal" : "corporativo"
}

/**
 * Tipos de teléfono que el origen marca como línea de la empresa. El resto
 * (mobile, home, other, o sin tipo) se trata como personal.
 */
const CORPORATE_PHONE_TYPES = new Set(["company", "work", "corporate", "office", "hq"])

export function phoneKind(type: string | null | undefined): ChannelKind {
  return type && CORPORATE_PHONE_TYPES.has(type.trim().toLowerCase()) ? "corporativo" : "personal"
}

export interface PickedChannel {
  value: string
  kind: ChannelKind
  /** Tipo crudo del origen, solo para teléfonos ("mobile", "company"…). */
  rawType?: string | null
}

/**
 * Email de contacto: **el corporativo manda**.
 *
 * Para una primera aproximación comercial el mail de la empresa es el canal
 * legítimo — llega al buzón donde la persona trabaja y no expone que se
 * consiguió su correo particular. El personal queda como respaldo, marcado como
 * tal, para cuando no hay otro. Antes se devolvía el primero válido sin mirar el
 * dominio, así que la elección dependía del orden de las columnas.
 *
 * Se listan solo los emails que la base marca con estado "valid".
 */
export function pickEmail(c: ContactChannels): PickedChannel | null {
  const pairs: Array<[string | null | undefined, string | null | undefined]> = [
    [c.email1, c.email1_status],
    [c.email2, c.email2_status],
    [c.email3, c.email3_status],
    [c.email4, c.email4_status],
  ]
  const validos = pairs
    .filter(([email, status]) => email?.trim() && status?.trim().toLowerCase() === "valid")
    .map(([email]) => email!.trim())

  const corporativo = validos.find((e) => emailKind(e) === "corporativo")
  if (corporativo) return { value: corporativo, kind: "corporativo" }

  const personal = validos[0]
  return personal ? { value: personal, kind: "personal" } : null
}

/**
 * Teléfono de contacto, con el mismo criterio: la línea de la empresa primero,
 * el particular como respaldo.
 *
 * `rawType` viaja tal como viene del origen porque no es confiable — la base no
 * distingue celular de fijo de forma consistente, y el informe lo advierte.
 */
export function pickPhone(c: ContactChannels): PickedChannel | null {
  const pairs: Array<[string | null | undefined, string | null | undefined]> = [
    [c.phone1, c.phone1_type],
    [c.phone2, c.phone2_type],
  ]
  const disponibles = pairs
    .filter(([phone]) => phone?.trim())
    .map(([phone, type]) => ({
      value: phone!.trim(),
      rawType: type?.trim() || null,
      kind: phoneKind(type),
    }))

  return disponibles.find((p) => p.kind === "corporativo") ?? disponibles[0] ?? null
}
