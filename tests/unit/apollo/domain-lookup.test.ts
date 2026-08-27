import { describe, expect, it } from "vitest"
import {
  classifyMatch,
  containment,
  coreName,
  geoMismatch,
  jaccard,
  parseLookupResponse,
  pickBestCandidate,
  type LookupCandidate,
} from "@/lib/apollo/domain-lookup"

const candidate = (over: Partial<LookupCandidate> = {}): LookupCandidate => ({
  apolloOrganizationId: "5e66b6381e05b4008c8331b8",
  name: "Ejemplo S.A.",
  domain: "ejemplo.com",
  websiteUrl: "http://www.ejemplo.com",
  logoUrl: null,
  ...over,
})

describe("coreName", () => {
  it("saca el sufijo legal para que el nombre nuestro y el legal de Apollo comparen igual", () => {
    expect(coreName("Smurfit Kappa Argentina S.A.")).toBe("smurfit kappa argentina")
    expect(coreName("MB SERVICE SYSTEM LTDA")).toBe("mb service system")
    expect(coreName("First Brands Group LLC")).toBe("first brands group")
  })

  it("saca acentos y prefijos de grupo", () => {
    expect(coreName("Grupo Telecom Argentina")).toBe("telecom argentina")
    expect(coreName("Universidade de Brasília")).toBe("universidade de brasilia")
  })

  it("tolera nulos y vacios sin romper", () => {
    expect(coreName(null)).toBe("")
    expect(coreName(undefined)).toBe("")
    expect(coreName("   ")).toBe("")
  })
})

describe("jaccard / containment", () => {
  it("da 1 para el mismo nucleo escrito distinto", () => {
    expect(jaccard("telecom argentina", "Telecom Argentina S.A.")).toBe(1)
  })

  it("containment distingue el subconjunto del solapamiento parcial", () => {
    // "Cencosud" entero dentro de "Cencosud Retail": subconjunto.
    expect(containment("cencosud", "Cencosud Retail S.A.")).toBe(1)
    // "Support Chile" vs "Support Argentina": comparten una palabra de dos.
    expect(containment("support chile", "Support Argentina")).toBeLessThan(1)
  })

  it("no explota con nombres vacios", () => {
    expect(jaccard("", "algo")).toBe(0)
    expect(containment("algo", null)).toBe(0)
  })
})

describe("geoMismatch", () => {
  it("detecta un lugar presente de un solo lado", () => {
    expect(geoMismatch("joyeria vasari", "JOYERIA VASARI MADRID SL")).toContain("madrid")
    expect(geoMismatch("abstracta uruguay", "Abstracta")).toContain("uruguay")
  })

  it("no marca nada cuando el lugar esta en los dos", () => {
    expect(geoMismatch("smurfit kappa argentina", "Smurfit Kappa Argentina S.A.")).toEqual([])
  })

  it("ignora palabras que no son lugares", () => {
    expect(geoMismatch("cencosud", "Cencosud Retail S.A.")).toEqual([])
  })
})

describe("classifyMatch", () => {
  it("promueve el match exacto", () => {
    expect(classifyMatch("repemex", candidate({ name: "REPEMEX" })).klass).toBe("auto_ok")
  })

  it("promueve cuando el candidato solo agrega la forma legal", () => {
    const score = classifyMatch("telecom argentina", candidate({ name: "Telecom Argentina S.A." }))
    expect(score.klass).toBe("auto_ok")
  })

  it("NO promueve cuando el candidato agrega un lugar: puede ser otra empresa", () => {
    // Caso real medido: similitud 0.67 y contencion 1.00 lo daban por bueno.
    const score = classifyMatch("joyeria vasari", candidate({ name: "JOYERIA VASARI MADRID SL" }))
    expect(score.klass).toBe("revisar")
    expect(score.geoMismatch).toContain("madrid")
  })

  it("NO promueve la matriz cuando nosotros tenemos la filial", () => {
    expect(classifyMatch("abstracta uruguay", candidate({ name: "Abstracta" })).klass).toBe("revisar")
  })

  it("descarta dos homonimas de paises distintos", () => {
    expect(classifyMatch("support chile", candidate({ name: "Support Argentina" })).klass).toBe(
      "descartado",
    )
  })

  it("no confunde dos ministerios de paises distintos", () => {
    const score = classifyMatch(
      "ministerio de defensa argentina",
      candidate({ name: "Ministerio de Defensa de Colombia" }),
    )
    expect(score.klass).not.toBe("auto_ok")
  })

  it("marca match_sin_dominio cuando el candidato no trae dominio", () => {
    const score = classifyMatch("dhl global forwarding", candidate({ name: "DHL Global Forwarding", domain: null }))
    expect(score.klass).toBe("match_sin_dominio")
  })

  it("marca sin_match cuando Apollo no devolvio nada", () => {
    expect(classifyMatch("lo que sea", null).klass).toBe("sin_match")
  })
})

describe("parseLookupResponse", () => {
  it("lee los dos buckets y toma el id de organizacion correcto en accounts", () => {
    const parsed = parseLookupResponse({
      organizations: [{ id: "org1", name: "Uno", primary_domain: "uno.com" }],
      // En `accounts` el id es de la CUENTA: el de la organizacion viene aparte.
      accounts: [{ id: "acc2", organization_id: "org2", name: "Dos", domain: "dos.com" }],
    })
    expect(parsed).toHaveLength(2)
    expect(parsed[0].apolloOrganizationId).toBe("org1")
    expect(parsed[1].apolloOrganizationId).toBe("org2")
    expect(parsed[1].domain).toBe("dos.com")
  })

  it("devuelve vacio para respuestas raras en vez de romper", () => {
    expect(parseLookupResponse(null)).toEqual([])
    expect(parseLookupResponse({})).toEqual([])
    expect(parseLookupResponse({ organizations: "no es un array" })).toEqual([])
  })

  it("descarta entradas sin nombre ni dominio", () => {
    expect(parseLookupResponse({ organizations: [{ id: "x" }] })).toEqual([])
  })
})

describe("pickBestCandidate", () => {
  it("prefiere el que trae dominio aunque no sea el primero", () => {
    const best = pickBestCandidate([
      candidate({ name: "Sin dominio", domain: null }),
      candidate({ name: "Con dominio", domain: "si.com" }),
    ])
    expect(best?.domain).toBe("si.com")
  })

  it("cae al primero si ninguno trae dominio", () => {
    const best = pickBestCandidate([candidate({ name: "A", domain: null })])
    expect(best?.name).toBe("A")
  })

  it("devuelve null con la lista vacia", () => {
    expect(pickBestCandidate([])).toBeNull()
  })
})
