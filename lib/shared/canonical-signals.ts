// ═══════════════════════════════════════════════════════════
// Unidad canónica de señal.
//
// El problema que resuelve
// ------------------------
// En Molinos Agro, "Intune" aparecía dos veces para la misma persona:
//
//   contact_id 9e6239d2 /in/matias-ezequiel-merino           keyword "Microsoft Intune"  headline
//   contact_id 504b8f07 /in/matias-ezequiel-merino-b36b54260 keyword "Intune"            current_position_description
//
// Las dos filas apuntan al MISMO signal_id (la entrada de diccionario "Intune")
// y son la MISMA persona: el perfil se scrapeó dos veces, una con el slug
// autogenerado de LinkedIn y otra con la vanity URL, y quedaron dos filas en
// `contacts`. La UI las mostraba como dos señales y el tag cloud como dos chips
// distintos ("Microsoft Intune 1" + "Intune 1"), porque agrupaba por
// `keyword_matched` en vez de por entrada de diccionario.
//
// Lo que NO es la causa: que la mención aparezca en dos secciones del perfil.
// Dentro de una misma fila de `contacts` el ETL ya colapsa los campos —
// `process_contact_signals` corta con EXIT y además hay
// UNIQUE (contact_id, company_id, signal_type, signal_id). Una sola fila de
// contacto NO puede generar dos señales del mismo término.
//
// La definición
// -------------
//   Una señal es (empresa, entrada de diccionario, persona resuelta).
//   La keyword literal, el campo de origen y el snippet son EVIDENCIA de esa
//   señal, no señales adicionales.
//
// Este módulo implementa esa definición en LECTURA, sin tocar datos ni ETL, y
// lo comparten v2 (company-drawer) y v3 (company-signal-summary) para que no
// vuelvan a divergir.
//
// Alcance
// -------
// La identidad de persona que se resuelve acá es conservadora a propósito: ante
// la duda NO fusiona, porque mostrar un duplicado es menos grave que fundir dos
// personas distintas. El merge real de filas duplicadas en `contacts`
// (2.737 grupos medidos) es otro trabajo, análogo al que ya existe para
// empresas (`merge_companies` + `v3.company_merges` reversible).
// ═══════════════════════════════════════════════════════════

import { linkedinProfileBase } from "@/lib/shared/linkedin-profile"

/** Persona de la que se desprende una señal, en lo mínimo que hace falta para identificarla. */
export interface CanonicalPerson {
  contactId: string
  fullName: string | null
  linkedinUrl: string | null
  /** Cualquiera de los emails de la fila. Solo se usa como identidad de respaldo. */
  email: string | null
  /**
   * Frescura de la FILA de contacts (`updated_at`), no de la señal.
   *
   * Es lo que decide qué perfil se muestra cuando la misma persona tiene dos
   * filas. No sirve el `created_at` de la señal: una fila vieja de `contacts`
   * puede generar una señal nueva —el caso Merino tiene la señal de Intune del
   * perfil desactualizado creada DESPUÉS que la del perfil vigente— y elegir
   * por ahí muestra el cargo viejo.
   */
  updatedAt?: string | null
}

/** Fila de `signals` normalizada a lo que la canonicalización necesita mirar. */
export interface SignalRowInput {
  /** id de la fila de `signals`. Se conserva para poder volver a la evidencia. */
  rowId: string
  signalType: string
  /** Entrada de diccionario. Es la identidad real de la señal. */
  signalId: string | null
  /** Nombre del diccionario (`dictionary_products.name` / `dictionary_processes.name`). */
  label: string | null
  /** Texto literal que matcheó. Sirve para resaltar el snippet, no para agrupar. */
  keyword: string | null
  sourceField: string | null
  snippet: string | null
  sourceUrl: string | null
  /** `job_posted_at ?? created_at`. Define cuál es el perfil más fresco y el `lastSeen`. */
  occurredAt: string | null
  companyId: string | null
  companyName?: string | null
  jobPostingId: string | null
  person: CanonicalPerson | null
}

/** Una mención concreta: dónde y con qué palabras se dijo. */
export interface SignalMention<T> {
  rowId: string
  keyword: string | null
  sourceField: string | null
  snippet: string | null
  sourceUrl: string | null
  occurredAt: string | null
  contactId: string | null
  companyId: string | null
  /** La fila original, para que la UI siga teniendo todo lo que ya mostraba. */
  row: T
}

/**
 * Una señal ya canonizada: un término de diccionario visto en una entidad
 * (una persona o una vacante), con todas sus menciones plegadas.
 */
export interface CanonicalSignal<T> {
  /** `signalKey|entityKey`. Único por (señal, entidad). */
  key: string
  /** Identidad de la señal, sin la entidad. Agrupa el tag cloud. */
  signalKey: string
  signalType: string
  signalId: string | null
  /** Lo que se muestra: nombre de diccionario; la keyword literal solo si no hay. */
  label: string
  /** Identidad de la entidad que emite la señal: persona, vacante o fila suelta. */
  entityKey: string
  /** Identidad de persona resuelta, `null` si la señal no viene de un perfil. */
  personKey: string | null
  person: CanonicalPerson | null
  jobPostingId: string | null
  companyId: string | null
  companyName: string | null
  /** Mención más reciente. */
  lastSeen: string | null
  /** Frescura del perfil elegido como representante. Interno al agrupamiento. */
  freshness: string | null
  /**
   * Fila que aporta el perfil a mostrar: la del contacto más fresco de esa
   * persona en todo el conjunto, no solo dentro de esta señal.
   */
  representative: T
  /** Todas las menciones, de la más reciente a la más vieja. */
  mentions: SignalMention<T>[]
}

/** Un término de diccionario y en cuántas entidades distintas aparece. */
export interface CanonicalSignalGroup<T> {
  signalKey: string
  signalType: string
  signalId: string | null
  label: string
  /** Personas + vacantes distintas. Es el número que hay que mostrar como "N". */
  entities: number
  people: number
  jobPostings: number
  lastSeen: string | null
  units: CanonicalSignal<T>[]
}

function normalizeText(value: string | null | undefined): string {
  if (!value) return ""
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Identidad de una persona a través de filas duplicadas de `contacts`.
 *
 * Prioridad: slug de LinkedIn > email > el propio contact_id (que nunca fusiona).
 * El nombre normalizado va SIEMPRE en la clave como guarda: dos "Juan Pérez"
 * distintos pueden compartir la base del slug (`juan-perez` vanity contra
 * `juan-perez-8a3f21b0` autogenerado) y sin el nombre no habría forma de que
 * dos personas homónimas no se fundieran — con el nombre, al menos, nunca se
 * funde a alguien con otro nombre.
 */
export function personKeyOf(person: CanonicalPerson | null | undefined): string | null {
  if (!person) return null
  const identity =
    linkedinProfileBase(person.linkedinUrl) ||
    (person.email ? person.email.trim().toLowerCase() : null) ||
    `id:${person.contactId}`
  return `${normalizeText(person.fullName)}|${identity}`
}

/** Identidad de la señal: la entrada de diccionario, con la keyword solo como respaldo. */
export function signalKeyOf(row: SignalRowInput): string {
  const identity = row.signalId ? row.signalId : `kw:${normalizeText(row.keyword)}`
  return `${row.signalType}:${identity}`
}

function labelOf(row: SignalRowInput): string {
  return row.label?.trim() || row.keyword?.trim() || "Sin clasificar"
}

/**
 * Qué tan actual es el perfil del que sale la fila.
 *
 * Prefiere el `updated_at` de la fila de `contacts`; si no vino, cae a la fecha
 * de la señal, que es lo único que queda para ordenar.
 */
function freshnessOf(input: SignalRowInput): string | null {
  return input.person?.updatedAt ?? input.occurredAt ?? null
}

/** Más reciente primero; los sin fecha van al final. */
function isNewer(candidate: string | null, current: string | null): boolean {
  if (!candidate) return false
  if (!current) return true
  return candidate > current
}

/**
 * Colapsa filas de `signals` a la unidad canónica (señal, entidad).
 *
 * Genérico sobre la fila original: `toInput` la traduce a lo que hace falta
 * mirar, y cada mención conserva `row` para que quien llama siga teniendo todo
 * lo que ya mostraba (foto, emails, cargo).
 *
 * Preserva el orden de aparición de la entrada — el drawer recibe las señales
 * ordenadas por nombre desde el RPC y ese orden se mantiene.
 */
export function canonicalizeSignals<T>(rows: readonly T[], toInput: (row: T) => SignalRowInput): CanonicalSignal<T>[] {
  const inputs = rows.map((row) => ({ row, input: toInput(row) }))

  // Pasada 1: el perfil vigente de cada persona.
  //
  // Se resuelve por persona y no por señal a propósito. Si cada señal eligiera
  // su propia fila de `contacts`, Merino aparecería como "Líder de
  // Microinformática" en las señales que salen del perfil nuevo y como
  // "Analista" en las que solo existen en el viejo: la misma persona con dos
  // cargos en la misma pantalla.
  const freshestByPerson = new Map<string, { row: T; input: SignalRowInput; freshness: string | null }>()
  for (const { row, input } of inputs) {
    const personKey = personKeyOf(input.person)
    if (!personKey) continue
    const freshness = freshnessOf(input)
    const current = freshestByPerson.get(personKey)
    if (!current || isNewer(freshness, current.freshness)) freshestByPerson.set(personKey, { row, input, freshness })
  }

  // Pasada 2: una unidad por (señal, entidad), con las menciones plegadas.
  const grouped = new Map<string, CanonicalSignal<T>>()
  for (const { row, input } of inputs) {
    const signalKey = signalKeyOf(input)
    const personKey = personKeyOf(input.person)
    // Una señal de vacante no tiene persona: la vacante es la entidad. Y si no
    // hay ninguna de las dos, la fila se representa a sí misma (no se fusiona).
    const entityKey = personKey ?? (input.jobPostingId ? `job:${input.jobPostingId}` : `row:${input.rowId}`)
    const key = `${signalKey}|${entityKey}`

    const mention: SignalMention<T> = {
      rowId: input.rowId,
      keyword: input.keyword,
      sourceField: input.sourceField,
      snippet: input.snippet,
      sourceUrl: input.sourceUrl,
      occurredAt: input.occurredAt,
      contactId: input.person?.contactId ?? null,
      companyId: input.companyId,
      row,
    }

    const existing = grouped.get(key)
    if (!existing) {
      const freshest = personKey ? freshestByPerson.get(personKey) : undefined
      grouped.set(key, {
        key,
        signalKey,
        signalType: input.signalType,
        signalId: input.signalId,
        label: labelOf(input),
        entityKey,
        personKey,
        person: freshest?.input.person ?? input.person,
        jobPostingId: input.jobPostingId,
        companyId: input.companyId,
        companyName: input.companyName ?? null,
        lastSeen: input.occurredAt,
        freshness: freshest?.freshness ?? freshnessOf(input),
        representative: freshest?.row ?? row,
        mentions: [mention],
      })
      continue
    }

    // El alumni del drawer sale de un CROSS JOIN LATERAL sobre
    // previous_positions: la misma fila de `signals` vuelve una vez por puesto
    // anterior en esa empresa. Sin esto, el mismo snippet se mostraría N veces.
    if (existing.mentions.some((item) => item.rowId === mention.rowId)) continue
    existing.mentions.push(mention)

    if (isNewer(input.occurredAt, existing.lastSeen)) existing.lastSeen = input.occurredAt

    // Sin persona (vacantes) no hubo pasada 1: gana la fila más fresca.
    if (!existing.personKey && isNewer(freshnessOf(input), existing.freshness)) {
      existing.freshness = freshnessOf(input)
      existing.representative = row
    }
    // La entrada de diccionario gana sobre la keyword suelta, venga de la fila
    // que venga: si una fila resolvió a "Intune" y otra no resolvió nada, el
    // grupo se muestra como "Intune".
    if (existing.label === "Sin clasificar" || (!existing.signalId && input.signalId)) {
      existing.label = labelOf(input)
      existing.signalId = input.signalId ?? existing.signalId
    }
  }

  for (const unit of grouped.values()) {
    unit.mentions.sort((a, b) => (isNewer(a.occurredAt, b.occurredAt) ? -1 : isNewer(b.occurredAt, a.occurredAt) ? 1 : 0))
  }

  return [...grouped.values()]
}

/**
 * Agrupa las señales canónicas por término de diccionario.
 *
 * `entities` cuenta personas y vacantes distintas, no filas: es el número que
 * corresponde mostrar en un chip. Ordena por cobertura y, a igualdad, por
 * frescura, que es como se leen las tecnologías de una cuenta.
 */
export function groupBySignal<T>(units: readonly CanonicalSignal<T>[]): CanonicalSignalGroup<T>[] {
  const grouped = new Map<string, CanonicalSignalGroup<T>>()

  for (const unit of units) {
    const existing = grouped.get(unit.signalKey)
    if (!existing) {
      grouped.set(unit.signalKey, {
        signalKey: unit.signalKey,
        signalType: unit.signalType,
        signalId: unit.signalId,
        label: unit.label,
        entities: 1,
        people: unit.personKey ? 1 : 0,
        jobPostings: unit.jobPostingId ? 1 : 0,
        lastSeen: unit.lastSeen,
        units: [unit],
      })
      continue
    }
    existing.entities += 1
    if (unit.personKey) existing.people += 1
    if (unit.jobPostingId) existing.jobPostings += 1
    if (isNewer(unit.lastSeen, existing.lastSeen)) existing.lastSeen = unit.lastSeen
    if (existing.label === "Sin clasificar") existing.label = unit.label
    existing.units.push(unit)
  }

  return [...grouped.values()].sort((a, b) => {
    if (b.entities !== a.entities) return b.entities - a.entities
    if (isNewer(b.lastSeen, a.lastSeen)) return 1
    if (isNewer(a.lastSeen, b.lastSeen)) return -1
    return a.label.localeCompare(b.label)
  })
}

/** Personas distintas en un conjunto de señales canónicas. */
export function countPeople<T>(units: readonly CanonicalSignal<T>[]): number {
  const keys = new Set<string>()
  for (const unit of units) if (unit.personKey) keys.add(unit.personKey)
  return keys.size
}
