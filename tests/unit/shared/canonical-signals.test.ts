import { describe, expect, it } from "vitest"
import {
  canonicalizeSignals,
  canonicalLinkedinSlug,
  countPeople,
  groupBySignal,
  personKeyOf,
  type SignalRowInput,
} from "@/lib/shared/canonical-signals"

type Row = SignalRowInput

const row = (over: Partial<Row> = {}): Row => ({
  rowId: "row-1",
  signalType: "technology",
  signalId: "021bc519-d850-4574-8836-6b3d551d49e7",
  label: "Intune",
  keyword: "Intune",
  sourceField: "about",
  snippet: "...Intune...",
  sourceUrl: null,
  occurredAt: "2026-01-01T00:00:00Z",
  companyId: "molinos",
  jobPostingId: null,
  person: null,
  ...over,
})

const persona = (over: Partial<NonNullable<Row["person"]>> = {}) => ({
  contactId: "c1",
  fullName: "Matias Ezequiel Merino",
  linkedinUrl: "https://www.linkedin.com/in/matias-ezequiel-merino",
  email: "matiasmerino.mm@gmail.com",
  ...over,
})

describe("canonicalLinkedinSlug", () => {
  it("saca el sufijo autogenerado de LinkedIn", () => {
    expect(canonicalLinkedinSlug("https://www.linkedin.com/in/matias-ezequiel-merino-b36b54260")).toBe(
      "matias-ezequiel-merino",
    )
  })

  it("deja intacta la vanity URL", () => {
    expect(canonicalLinkedinSlug("https://www.linkedin.com/in/matias-ezequiel-merino")).toBe("matias-ezequiel-merino")
  })

  it("normaliza dominio regional, query, hash y barra final", () => {
    expect(canonicalLinkedinSlug("http://ar.linkedin.com/in/Juan-Perez/?trk=x#top")).toBe("juan-perez")
  })

  it("no mutila un apellido que termina en letras hexadecimales", () => {
    // "abbaca" es [a-f]{6} pero no tiene ningún dígito: es parte del nombre.
    expect(canonicalLinkedinSlug("https://www.linkedin.com/in/ana-abbaca")).toBe("ana-abbaca")
  })

  it("no toca sufijos numéricos cortos de vanity URLs", () => {
    expect(canonicalLinkedinSlug("https://www.linkedin.com/in/matias-merino-1")).toBe("matias-merino-1")
  })

  it("ignora urls que no son de perfil o son placeholders", () => {
    expect(canonicalLinkedinSlug("https://www.linkedin.com/company/molinos-agro")).toBeNull()
    expect(canonicalLinkedinSlug("https://www.linkedin.com/in/placeholder-123456")).toBeNull()
    expect(canonicalLinkedinSlug(null)).toBeNull()
  })
})

describe("personKeyOf", () => {
  it("une las dos filas de contacts del mismo perfil", () => {
    const vanity = personKeyOf(persona())
    const autoSlug = personKeyOf(
      persona({ contactId: "c2", linkedinUrl: "https://www.linkedin.com/in/matias-ezequiel-merino-b36b54260" }),
    )
    expect(vanity).toBe(autoSlug)
  })

  it("no une homónimos con slug distinto", () => {
    const a = personKeyOf(persona({ fullName: "Juan Perez", linkedinUrl: "https://www.linkedin.com/in/juan-perez" }))
    const b = personKeyOf(
      persona({ contactId: "c2", fullName: "Juan Perez", linkedinUrl: "https://www.linkedin.com/in/juan-perez-lopez" }),
    )
    expect(a).not.toBe(b)
  })

  it("no une a dos personas con distinto nombre aunque compartan el email", () => {
    const a = personKeyOf(persona({ fullName: "Ana Gomez", linkedinUrl: null, email: "info@molinosagro.com.ar" }))
    const b = personKeyOf(
      persona({ contactId: "c2", fullName: "Luis Diaz", linkedinUrl: null, email: "info@molinosagro.com.ar" }),
    )
    expect(a).not.toBe(b)
  })

  it("cae al contact_id cuando no hay identidad, y así nunca fusiona", () => {
    const a = personKeyOf(persona({ linkedinUrl: null, email: null }))
    const b = personKeyOf(persona({ contactId: "c2", linkedinUrl: null, email: null }))
    expect(a).not.toBe(b)
    expect(a).toContain("id:c1")
  })

  it("el nombre normalizado ignora acentos y mayúsculas", () => {
    const a = personKeyOf(persona({ fullName: "María Pérez", linkedinUrl: "https://www.linkedin.com/in/maria-perez" }))
    const b = personKeyOf(
      persona({ contactId: "c2", fullName: "maria perez", linkedinUrl: "https://www.linkedin.com/in/maria-perez" }),
    )
    expect(a).toBe(b)
  })
})

describe("canonicalizeSignals", () => {
  it("colapsa el caso Merino: una señal, dos menciones", () => {
    // Las dos filas reales de Molinos Agro: mismo signal_id, keywords distintas,
    // dos filas de contacts del mismo perfil.
    const rows: Row[] = [
      row({
        rowId: "s-headline",
        keyword: "Microsoft Intune",
        sourceField: "headline",
        occurredAt: "2026-07-05T20:22:12Z",
        person: persona({ contactId: "9e6239d2", updatedAt: "2026-07-05T20:22:12Z" }),
      }),
      row({
        rowId: "s-position",
        keyword: "Intune",
        sourceField: "current_position_description",
        occurredAt: "2025-12-18T03:15:18Z",
        person: persona({
          contactId: "504b8f07",
          linkedinUrl: "https://www.linkedin.com/in/matias-ezequiel-merino-b36b54260",
          updatedAt: "2026-02-18T02:40:58Z",
        }),
      }),
    ]

    const units = canonicalizeSignals(rows, (r) => r)

    expect(units).toHaveLength(1)
    expect(units[0].label).toBe("Intune")
    expect(units[0].mentions).toHaveLength(2)
    expect(units[0].mentions.map((m) => m.sourceField)).toEqual(["headline", "current_position_description"])
    expect(units[0].person?.contactId).toBe("9e6239d2")
    expect(countPeople(units)).toBe(1)
  })

  it("el representante es la fila de contacts más fresca, no la señal más nueva", () => {
    // Caso real: la señal de Intune del perfil DESACTUALIZADO se creó después
    // que la del perfil vigente. Ordenar por fecha de señal muestra el cargo
    // viejo; hay que ordenar por `updated_at` del contacto.
    const vieja = persona({ contactId: "504b8f07", updatedAt: "2026-02-18T02:40:58Z" })
    const nueva = persona({ contactId: "9e6239d2", updatedAt: "2026-07-05T20:22:12Z" })
    const rows: Row[] = [
      row({ rowId: "señal-nueva-perfil-viejo", occurredAt: "2026-08-24T04:00:44Z", person: vieja }),
      row({ rowId: "señal-vieja-perfil-nuevo", occurredAt: "2026-07-05T20:22:12Z", person: nueva }),
    ]

    const [unit] = canonicalizeSignals(rows, (r) => r)

    expect(unit.representative.rowId).toBe("señal-vieja-perfil-nuevo")
    expect(unit.person?.contactId).toBe("9e6239d2")
    // `lastSeen` sí es la señal más reciente: es frescura de evidencia, no de perfil.
    expect(unit.lastSeen).toBe("2026-08-24T04:00:44Z")
  })

  it("la persona se muestra con el mismo perfil en todas sus señales", () => {
    // Sin esto, una señal que solo existe en la fila vieja mostraría a la misma
    // persona con el cargo anterior en la card de al lado.
    const vieja = persona({ contactId: "504b8f07", updatedAt: "2026-02-18T02:40:58Z" })
    const nueva = persona({ contactId: "9e6239d2", updatedAt: "2026-07-05T20:22:12Z" })
    const rows: Row[] = [
      row({ rowId: "a", signalId: "sig-intune", person: nueva }),
      row({ rowId: "b", signalId: "sig-solo-en-perfil-viejo", person: vieja }),
    ]

    const units = canonicalizeSignals(rows, (r) => r)

    expect(units).toHaveLength(2)
    expect(units.every((unit) => unit.person?.contactId === "9e6239d2")).toBe(true)
    expect(units.every((unit) => unit.representative.person?.contactId === "9e6239d2")).toBe(true)
  })

  it("no fusiona dos entradas de diccionario distintas de la misma keyword", () => {
    // "Transformación Digital" está en el proceso homónimo y en "Liderazgo IT":
    // son dos señales reales, no un duplicado.
    const rows: Row[] = [
      row({ rowId: "a", signalType: "process", signalId: "70920edf", label: "Transformación Digital", keyword: "Transformación Digital", person: persona() }),
      row({ rowId: "b", signalType: "process", signalId: "2283a841", label: "Liderazgo IT", keyword: "Transformación Digital", person: persona() }),
    ]

    expect(canonicalizeSignals(rows, (r) => r)).toHaveLength(2)
  })

  it("no fusiona la misma señal en dos personas distintas", () => {
    const rows: Row[] = [
      row({ rowId: "a", person: persona() }),
      row({ rowId: "b", person: persona({ contactId: "otro", fullName: "Alexis David R.", linkedinUrl: "https://www.linkedin.com/in/alexis-david-romero" }) }),
    ]

    const units = canonicalizeSignals(rows, (r) => r)

    expect(units).toHaveLength(2)
    expect(countPeople(units)).toBe(2)
  })

  it("descarta la misma fila repetida por el CROSS JOIN de alumni", () => {
    const repetida = row({ rowId: "s-1", person: persona() })
    const units = canonicalizeSignals([repetida, { ...repetida }], (r) => r)

    expect(units).toHaveLength(1)
    expect(units[0].mentions).toHaveLength(1)
  })

  it("agrupa las señales de vacante por vacante, no por persona", () => {
    const rows: Row[] = [
      row({ rowId: "a", jobPostingId: "jp-1", keyword: "Intune" }),
      row({ rowId: "b", jobPostingId: "jp-1", keyword: "Microsoft Intune" }),
      row({ rowId: "c", jobPostingId: "jp-2", keyword: "Intune" }),
    ]

    const units = canonicalizeSignals(rows, (r) => r)

    expect(units).toHaveLength(2)
    expect(countPeople(units)).toBe(0)
  })

  it("prefiere el nombre de diccionario a la keyword literal", () => {
    const rows: Row[] = [
      row({ rowId: "a", signalId: null, label: null, keyword: "Intune", person: persona() }),
      row({ rowId: "b", label: "Intune", keyword: "Microsoft Intune", person: persona() }),
    ]

    const units = canonicalizeSignals(rows, (r) => r)

    // Sin signal_id la primera fila no puede afirmar identidad de diccionario:
    // queda como grupo propio, pero la que sí la tiene se muestra por su nombre.
    expect(units.map((u) => u.label)).toContain("Intune")
    expect(units.every((u) => u.label !== "Microsoft Intune")).toBe(true)
  })

  it("mantiene el orden de aparición de la entrada", () => {
    const rows: Row[] = [
      row({ rowId: "a", signalId: "sig-b", label: "Beta", person: persona({ contactId: "c9", fullName: "Zoe", linkedinUrl: null, email: null }) }),
      row({ rowId: "b", signalId: "sig-a", label: "Alfa", person: persona() }),
    ]

    expect(canonicalizeSignals(rows, (r) => r).map((u) => u.label)).toEqual(["Beta", "Alfa"])
  })
})

describe("groupBySignal", () => {
  it("cuenta entidades distintas, no filas", () => {
    const rows: Row[] = [
      // Una sola persona con dos filas de contacts y dos keywords.
      row({ rowId: "a", keyword: "Microsoft Intune", person: persona({ contactId: "9e6239d2" }) }),
      row({
        rowId: "b",
        keyword: "Intune",
        person: persona({ contactId: "504b8f07", linkedinUrl: "https://www.linkedin.com/in/matias-ezequiel-merino-b36b54260" }),
      }),
      // Una vacante que también la menciona.
      row({ rowId: "c", jobPostingId: "jp-1" }),
    ]

    const [group] = groupBySignal(canonicalizeSignals(rows, (r) => r))

    expect(group.label).toBe("Intune")
    expect(group.entities).toBe(2)
    expect(group.people).toBe(1)
    expect(group.jobPostings).toBe(1)
  })

  it("ordena por cobertura y desempata por frescura", () => {
    const rows: Row[] = [
      row({ rowId: "a", signalId: "sig-poco", label: "Poco", occurredAt: "2026-08-01T00:00:00Z", person: persona({ contactId: "p1", fullName: "A", linkedinUrl: null, email: null }) }),
      row({ rowId: "b", signalId: "sig-mucho", label: "Mucho", occurredAt: "2020-01-01T00:00:00Z", person: persona({ contactId: "p2", fullName: "B", linkedinUrl: null, email: null }) }),
      row({ rowId: "c", signalId: "sig-mucho", label: "Mucho", occurredAt: "2020-01-01T00:00:00Z", person: persona({ contactId: "p3", fullName: "C", linkedinUrl: null, email: null }) }),
    ]

    expect(groupBySignal(canonicalizeSignals(rows, (r) => r)).map((g) => g.label)).toEqual(["Mucho", "Poco"])
  })
})
