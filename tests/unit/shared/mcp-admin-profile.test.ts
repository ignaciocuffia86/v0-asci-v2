import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { ADMIN_DESCRIPTION_RULES, withProfileDescriptions } from "@/lib/v3/mcp-server-tools"

// ═══════════════════════════════════════════════════════════════════════════
// Que las diferencias del perfil admin no queden viejas EN SILENCIO.
//
// Es el mismo riesgo que dejó nueve tools inalcanzables cuando el catálogo de
// scopes se desfasó de las tools registradas: dos fuentes, una se actualiza y la
// otra no. Acá el desfasaje posible es entre una regla `find` y la descripción
// real de la tool.
//
// Por eso el test lee LAS DESCRIPCIONES DEL CÓDIGO, no una copia. Si alguien
// reescribe una descripción standard y la frase que la regla busca deja de
// existir, la regla se vuelve inerte —el modelo admin volvería a pedir
// confirmación— y este test falla en vez de dejarlo pasar.
// ═══════════════════════════════════════════════════════════════════════════

const SOURCE = "lib/v3/mcp-server-tools.ts"

/** Descripciones tal como quedan registradas, leídas de la fuente. */
function registeredDescriptions(): Map<string, string> {
  const source = readFileSync(resolve(process.cwd(), SOURCE), "utf8")
  const found = new Map<string, string>()
  for (const match of source.matchAll(/server\.tool\("([a-z_]+)",\s*"((?:[^"\\]|\\.)*)"/g)) {
    // El literal viene escapado en el fuente; se desescapa lo que importa para
    // poder comparar contra el texto de las reglas.
    found.set(match[1], match[2].replace(/\\n/g, "\n").replace(/\\"/g, '"'))
  }
  return found
}

describe("las reglas del perfil admin siguen aplicando", () => {
  const descriptions = registeredDescriptions()

  it("cada regla apunta a una tool que existe", () => {
    const missing = ADMIN_DESCRIPTION_RULES.filter((rule) => !descriptions.has(rule.tool))
    expect(missing.map((r) => r.tool), "reglas admin para tools que ya no existen").toEqual([])
  })

  it("cada regla ENCUENTRA su frase en la descripción real", () => {
    // La garantía central: una regla que ya no matchea es una diferencia de
    // perfil que se perdió sin que nadie lo decidiera.
    const stale = ADMIN_DESCRIPTION_RULES.filter((rule) => !descriptions.get(rule.tool)?.includes(rule.find))
    expect(
      stale.map((r) => `${r.tool}: "${r.find.slice(0, 60)}…"`),
      "reglas admin cuya frase ya no está en la descripción standard",
    ).toEqual([])
  })
})

describe("qué cambia y qué NO cambia entre perfiles", () => {
  const rulesFor = (tool: string) => ADMIN_DESCRIPTION_RULES.filter((r) => r.tool === tool)

  it("el gasto en Apollo conserva su confirmación, y no por una regla de perfil", () => {
    // Es Tier 3 e irreversible: el crédito de un tercero no vuelve. Que admin no
    // pregunte por el cupo NO puede arrastrar a que deje de pedir el planHash.
    //
    // Lo que se preserva es la confirmación DEL PLAN —una por lote, la del
    // batchPlanHash—, no una re-confirmación por cuenta. Esa distinción no se
    // resuelve con una regla de perfil sino en la descripción compartida, que
    // vale para los dos servers: ver el test de abajo.
    expect(rulesFor("run_contact_enrichment")).toEqual([])
    expect(rulesFor("prepare_contact_enrichment")).toEqual([])
  })

  it("lo destructivo conserva su confirmación", () => {
    expect(rulesFor("remove_workspace_account")).toEqual([])
    expect(rulesFor("confirm_document_analysis")).toEqual([])
  })

  it("ninguna regla introduce una frase que vuelva a pedir confirmación", () => {
    // Una regla mal escrita podría "arreglar" una frase reintroduciendo el
    // problema que vino a resolver.
    for (const rule of ADMIN_DESCRIPTION_RULES) {
      expect(rule.replace.toLowerCase()).not.toContain("pedí confirmación")
      expect(rule.replace.toLowerCase()).not.toContain("requiere confirmación")
    }
  })
})

describe("withProfileDescriptions", () => {
  const fakeServer = () => {
    const registered: Array<{ name: string; description: string }> = []
    return {
      registered,
      server: { tool: (name: string, description: string) => registered.push({ name, description }) },
    }
  }

  it("reescribe solo la tool de la regla", () => {
    const { server, registered } = fakeServer()
    const wrapped = withProfileDescriptions(server, [{ tool: "a", find: "viejo", replace: "nuevo" }])
    wrapped.tool("a", "texto viejo")
    wrapped.tool("b", "texto viejo")
    expect(registered).toEqual([
      { name: "a", description: "texto nuevo" },
      { name: "b", description: "texto viejo" },
    ])
  })

  it("sin reglas devuelve el server tal cual, sin envolver", () => {
    const { server } = fakeServer()
    expect(withProfileDescriptions(server, [])).toBe(server)
  })

  it("cuenta las aplicaciones, que es lo que permite detectar una regla inerte", () => {
    const { server } = fakeServer()
    const applied = new Map<string, number>()
    const wrapped = withProfileDescriptions(server, [{ tool: "a", find: "x", replace: "y" }], applied)
    wrapped.tool("a", "sin la frase")
    expect(applied.size).toBe(0)
    wrapped.tool("a", "con x adentro")
    expect(applied.get("a::x")).toBe(1)
  })
})


describe("la descripción de run_contact_enrichment distingue los dos techos", () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // El defecto que este test cierra, medido en la primera corrida real del perfil
  // admin: la descripción decía, sin excepción, "Requiere confirmación explícita
  // del usuario". `prepare_contact_enrichment` SÍ contemplaba el lote, pero el
  // modelo obedece a la tool que ejecuta el gasto — y con razón. Resultado:
  // anunció que las 22 cuentas del lote necesitaban una confirmación cada una,
  // que es exactamente lo que el batchPlanHash viene a evitar.
  //
  // Las dos ramas tienen que estar. Si alguien reescribe esta descripción y borra
  // una, vuelve el problema: sin la de `batch`, 42 preguntas; sin la de
  // `monthly`, un gasto irreversible sin que nadie lo haya autorizado.
  // ═══════════════════════════════════════════════════════════════════════════
  const run = registeredDescriptions().get("run_contact_enrichment") ?? ""

  it("con lote: dice explícitamente que NO hay que volver a confirmar", () => {
    expect(run).toContain("authorizedBy")
    expect(run.toLowerCase()).toContain("ya está autorizado")
    expect(run.toLowerCase()).toContain("no vuelvas a pedir confirmación")
  })

  it("sin lote: sigue exigiendo la confirmación", () => {
    // La rama que protege el gasto suelto. Es la que no se puede perder.
    expect(run.toLowerCase()).toContain("no hay autorización previa")
    expect(run.toLowerCase()).toContain("confirmá antes de ejecutar")
  })
})
