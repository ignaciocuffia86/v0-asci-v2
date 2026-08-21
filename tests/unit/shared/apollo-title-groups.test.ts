import { describe, expect, it } from "vitest"
import {
  APOLLO_COUNTRIES,
  PREDEFINED_JOB_TITLE_GROUPS,
  mapToApolloCountry,
} from "@/lib/shared/apollo-title-groups"

describe("mapToApolloCountry", () => {
  it("traduce el nombre en español al valor que espera Apollo", () => {
    expect(mapToApolloCountry("Brasil")).toBe("Brazil")
    expect(mapToApolloCountry("México")).toBe("Mexico")
    expect(mapToApolloCountry("España")).toBe("Spain")
  })

  it("acepta el valor de Apollo tal cual", () => {
    expect(mapToApolloCountry("Argentina")).toBe("Argentina")
    expect(mapToApolloCountry("United States")).toBe("United States")
  })

  it("extrae el país de una dirección completa", () => {
    // `companies.country` guarda direcciones enteras: es el caso real que
    // rompía el filtro cuando se comparaba el string entero.
    expect(mapToApolloCountry("Quito, Pichincha, Ecuador")).toBe("Ecuador")
    expect(mapToApolloCountry("Santiago, Región Metropolitana, Chile")).toBe("Chile")
  })

  it("es insensible a mayúsculas y espacios", () => {
    expect(mapToApolloCountry("  peru  ")).toBe("Peru")
    expect(mapToApolloCountry("URUGUAY")).toBe("Uruguay")
  })

  it("devuelve vacío cuando no reconoce: sin filtro es mejor que el filtro equivocado", () => {
    expect(mapToApolloCountry("Suiza")).toBe("")
    expect(mapToApolloCountry("")).toBe("")
    expect(mapToApolloCountry(null)).toBe("")
    expect(mapToApolloCountry(undefined)).toBe("")
  })
})

describe("catálogos compartidos", () => {
  it("los grupos de cargos no tienen títulos repetidos entre sí", () => {
    // Un título en dos grupos se mandaría duplicado a Apollo y confundiría la
    // selección en la UI (destildarlo en un grupo lo dejaría tildado en el otro).
    const todos = PREDEFINED_JOB_TITLE_GROUPS.flatMap((g) => g.titles)
    expect(new Set(todos).size).toBe(todos.length)
  })

  it("los países no tienen valores repetidos", () => {
    const valores = APOLLO_COUNTRIES.map((c) => c.value)
    expect(new Set(valores).size).toBe(valores.length)
  })
})
