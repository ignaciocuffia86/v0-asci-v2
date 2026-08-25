import { describe, expect, it } from "vitest"
import {
  pickCountryFromPeopleStats,
  pickHq,
} from "@/lib/v3/services/linkedin-company-enrichment"

/** El vocabulario real es `country_normalized`; acá alcanza con un recorte. */
const VOCABULARIO = new Map<string, string>([
  ["argentina", "Argentina"],
  ["chile", "Chile"],
  ["peru", "Peru"],
  ["united states", "United States"],
  ["costa rica", "Costa Rica"],
])

/** Arma el `peopleStats` tal como lo devuelve harvestapi, con otras stats al lado. */
function conLocations(...titulos: string[]) {
  return {
    peopleStats: [
      { statTitle: "School", values: [{ count: 5, title: "Universidad de Chile" }] },
      {
        statTitle: "Locations",
        values: titulos.map((title, i) => ({ count: 40 - i, title })),
      },
    ],
  }
}

describe("pickCountryFromPeopleStats", () => {
  it("toma el país cuando el valor más alto ya es un país", () => {
    expect(pickCountryFromPeopleStats(conLocations("Chile", "Santiago"), VOCABULARIO)).toBe("Chile")
  })

  it("devuelve la grafía canónica, no la que vino en el payload", () => {
    expect(pickCountryFromPeopleStats(conLocations("ARGENTINA"), VOCABULARIO)).toBe("Argentina")
  })

  it("se queda con el último segmento cuando el valor trae región y país", () => {
    expect(
      pickCountryFromPeopleStats(conLocations("Santiago Metropolitan Region, Chile"), VOCABULARIO),
    ).toBe("Chile")
  })

  it("resuelve países de dos palabras", () => {
    expect(pickCountryFromPeopleStats(conLocations("Costa Rica"), VOCABULARIO)).toBe("Costa Rica")
  })

  it("no baja por la lista: una ciudad suelta arriba no hereda el país de abajo", () => {
    // Bajar recuperaría "Peru", pero también permitiría que la minoría de
    // empleados en otro país le gane al país real de la empresa.
    expect(pickCountryFromPeopleStats(conLocations("Lima", "Peru"), VOCABULARIO)).toBeNull()
  })

  it("no inventa países fuera del vocabulario de la tabla", () => {
    expect(pickCountryFromPeopleStats(conLocations("Narnia"), VOCABULARIO)).toBeNull()
    expect(
      pickCountryFromPeopleStats(conLocations("Some Region, Narnia"), VOCABULARIO),
    ).toBeNull()
  })

  it("tolera payloads sin peopleStats, sin la stat de Locations o vacíos", () => {
    expect(pickCountryFromPeopleStats({}, VOCABULARIO)).toBeNull()
    expect(pickCountryFromPeopleStats(null, VOCABULARIO)).toBeNull()
    expect(pickCountryFromPeopleStats({ peopleStats: [] }, VOCABULARIO)).toBeNull()
    expect(pickCountryFromPeopleStats(conLocations(), VOCABULARIO)).toBeNull()
    expect(
      pickCountryFromPeopleStats(
        { peopleStats: [{ statTitle: "Locations", values: [{ count: 1, title: "  " }] }] },
        VOCABULARIO,
      ),
    ).toBeNull()
  })

  it("el caso que motivó el fix: locations vacío pero peopleStats con el país", () => {
    // Recorte del payload real de "Laminadora Los Angeles S.A." (status no_hq).
    const item = {
      name: "Laminadora Los Angeles S.A.",
      locations: [],
      ...conLocations("Chile", "Biobío Region, Chile", "Los Ángeles"),
    }
    expect(pickHq(item.locations)).toBeNull()
    expect(pickCountryFromPeopleStats(item, VOCABULARIO)).toBe("Chile")
  })
})
