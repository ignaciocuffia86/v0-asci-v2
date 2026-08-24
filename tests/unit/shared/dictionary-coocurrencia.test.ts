import { describe, expect, it } from "vitest"

import { matchTextAgainstDictionary } from "@/lib/v3/services/dictionary"
import type { DictionaryData } from "@/lib/v3/services/types"

// Los dos mecanismos de co-ocurrencia resuelven errores distintos, medidos
// sobre el corpus real (ver docs/auditoria-diccionario-tecnologia.md):
//
//   contexto  → ambigüedad de DOMINIO. "Fabric" también es tela y también es
//               el plano de datos de una red. Se pide que el texto mencione
//               algo del dominio correcto.
//   excluye   → ambigüedad de COLOCACIÓN. "Service Fabric" y "Hyperledger
//               Fabric" son otros productos. El contexto no las filtra porque
//               las dice gente de datos que sí usa Power BI.
//
// Este archivo fija que el matcher de TypeScript decida igual que
// process_dictionary_job, que es el que corre sobre la base.

const producto = (over: Partial<DictionaryData["products"][number]>): DictionaryData["products"][number] => ({
  id: "p-fabric",
  vendor_id: "v-ms",
  name: "Microsoft Fabric",
  keywords: ["Fabric"],
  categoria: "Datos y BI",
  ciclo_vida: "vigente",
  keywords_contexto: {},
  keywords_excluye: {},
  ...over,
})

const dict = (over: Partial<DictionaryData["products"][number]>): DictionaryData => ({
  vendors: [{ id: "v-ms", name: "Microsoft" }],
  products: [producto(over)],
  processes: [],
})

const CONTEXTO = { fabric: ["Power BI", "Synapse", "OneLake"] }
const EXCLUYE = { fabric: ["Service Fabric", "Hyperledger Fabric"] }

describe("co-ocurrencia: contexto obligatorio", () => {
  it("sin contexto declarado la keyword matchea como siempre", () => {
    const hits = matchTextAgainstDictionary("Consultor Fabric", dict({}))
    expect(hits.map((h) => h.name)).toEqual(["Microsoft Fabric"])
  })

  it("con contexto declarado, exige que el texto lo mencione", () => {
    const d = dict({ keywords_contexto: CONTEXTO })
    expect(matchTextAgainstDictionary("Jefe de compras de Fabric y telas", d)).toEqual([])
    expect(matchTextAgainstDictionary("Data Engineer: Fabric y Power BI", d).map((h) => h.name)).toEqual([
      "Microsoft Fabric",
    ])
  })

  it("el contexto se busca en toda la entidad, no cerca de la keyword", () => {
    // Es evidencia sobre el dominio de la persona: alcanza con que aparezca en
    // cualquier parte del perfil, aunque sea en un puesto de hace diez años.
    const d = dict({ keywords_contexto: CONTEXTO })
    const texto = "Arquitecto de Fabric. " + "x".repeat(2000) + " Antes: reporting en Power BI."
    expect(matchTextAgainstDictionary(texto, d).map((h) => h.name)).toEqual(["Microsoft Fabric"])
  })

  it("el contexto ignora mayúsculas y acepta cualquiera de los términos", () => {
    const d = dict({ keywords_contexto: CONTEXTO })
    expect(matchTextAgainstDictionary("Fabric sobre synapse", d)).toHaveLength(1)
    expect(matchTextAgainstDictionary("Fabric y ONELAKE", d)).toHaveLength(1)
  })

  it("el término de contexto exige palabra completa", () => {
    // "Synapsen" no es "Synapse": sin límite de palabra el contexto sería tan
    // laxo como el indexOf que se sacó del matcher en su momento.
    const d = dict({ keywords_contexto: CONTEXTO })
    expect(matchTextAgainstDictionary("Fabric y Synapsengeschichte", d)).toEqual([])
  })
})

describe("co-ocurrencia: colocaciones excluidas", () => {
  it("la ocurrencia dentro de la frase excluida no cuenta", () => {
    const d = dict({ keywords_excluye: EXCLUYE })
    expect(matchTextAgainstDictionary("Microservicios en Service Fabric", d)).toEqual([])
    expect(matchTextAgainstDictionary("Blockchain con Hyperledger Fabric", d)).toEqual([])
  })

  it("si además hay una ocurrencia legítima, la señal se conserva", () => {
    // El caso que obliga a enmascarar en vez de descartar la entidad entera:
    // un perfil de datos que usa las dos cosas.
    const d = dict({ keywords_excluye: EXCLUYE })
    const hits = matchTextAgainstDictionary("Uso Service Fabric y también Fabric para reporting", d)
    expect(hits.map((h) => h.name)).toEqual(["Microsoft Fabric"])
  })

  it("el snippet se recorta del texto original, no del enmascarado", () => {
    const d = dict({ keywords_excluye: EXCLUYE })
    const [hit] = matchTextAgainstDictionary("Migramos de Service Fabric a Fabric este año", d)
    expect(hit.snippet).toContain("Service Fabric")
    expect(hit.snippet).toContain("este año")
  })

  it("los dos mecanismos se combinan", () => {
    const d = dict({ keywords_contexto: CONTEXTO, keywords_excluye: EXCLUYE })
    // Contexto sí, pero la única ocurrencia es la excluida.
    expect(matchTextAgainstDictionary("Power BI y Service Fabric", d)).toEqual([])
    // Ocurrencia legítima pero sin contexto de dominio.
    expect(matchTextAgainstDictionary("Compra de Fabric para confección", d)).toEqual([])
    // Las dos condiciones.
    expect(matchTextAgainstDictionary("Power BI, Service Fabric y Fabric", d)).toHaveLength(1)
  })
})

describe("co-ocurrencia: forma de los mapas", () => {
  it("la clave del mapa matchea la keyword sin importar mayúsculas", () => {
    // Del lado SQL la comparación es lower(clave) = lower(keyword); acá el
    // mapa ya viene con las claves normalizadas por asTermMap.
    const d = dict({ keywords: ["FABRIC"], keywords_contexto: { fabric: ["Power BI"] } })
    expect(matchTextAgainstDictionary("FABRIC y telas", d)).toEqual([])
    expect(matchTextAgainstDictionary("FABRIC y Power BI", d)).toHaveLength(1)
  })

  it("una keyword sin entrada en el mapa no se ve afectada por las de otras", () => {
    const d = dict({
      keywords: ["Fabric", "OneLake"],
      keywords_contexto: { fabric: ["Power BI"] },
    })
    // OneLake no tiene contexto declarado: matchea sola.
    expect(matchTextAgainstDictionary("Ingesta en OneLake", d)).toHaveLength(1)
  })
})
