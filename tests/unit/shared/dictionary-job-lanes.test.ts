import { describe, expect, it } from "vitest"

import { planDictionaryJobs, type PendingChange } from "@/lib/dictionary/plan-jobs"

// Un cambio de co-ocurrencia sobre una keyword existente NO es lo mismo que
// agregar o sacar una keyword, aunque los dos terminen en dictionary_jobs:
// rehace señales que ya existen y que nadie está esperando. Por eso va al
// carril nocturno. Que se vuelva a colar en el inmediato es la regresión que
// devolvería el problema, así que se fija acá.

const ID = "p-fabric"
const TIPO = "technology"

describe("planDictionaryJobs", () => {
  it("manda el recálculo al carril nocturno y no al inmediato", () => {
    const cambios: PendingChange[] = [{ type: "recalculate", keyword: "Fabric" }]
    const { inmediatos, recalcs } = planDictionaryJobs(cambios, ID, TIPO)

    expect(inmediatos).toEqual([])
    expect(recalcs).toEqual(["Fabric"])
  })

  it("agregar y sacar keywords sigue en el carril inmediato", () => {
    const cambios: PendingChange[] = [
      { type: "add", keyword: "OneLake" },
      { type: "remove", keyword: "Storage" },
    ]
    const { inmediatos, recalcs } = planDictionaryJobs(cambios, ID, TIPO)

    expect(recalcs).toEqual([])
    expect(inmediatos.map((j) => [j.job_type, j.keyword])).toEqual([
      ["remove_keyword", "Storage"],
      ["add_keyword", "OneLake"],
    ])
    expect(inmediatos.every((j) => j.status === "pending")).toBe(true)
  })

  it("reparte una edición mixta sin mezclar carriles", () => {
    const cambios: PendingChange[] = [
      { type: "add", keyword: "Direct Lake" },
      { type: "recalculate", keyword: "Fabric" },
      { type: "remove", keyword: "Data Manager" },
      { type: "recalculate", keyword: "Exchange" },
    ]
    const { inmediatos, recalcs } = planDictionaryJobs(cambios, ID, TIPO)

    expect(recalcs).toEqual(["Fabric", "Exchange"])
    expect(inmediatos.map((j) => j.keyword)).toEqual(["Data Manager", "Direct Lake"])
    // Ninguna keyword recalculada puede aparecer en el carril inmediato: ahí
    // se insertaría 'pending' y el cron del minuto la tomaría enseguida.
    for (const job of inmediatos) {
      expect(recalcs).not.toContain(job.keyword)
    }
  })

  it("los remove salen antes que los add", () => {
    const cambios: PendingChange[] = [
      { type: "add", keyword: "A" },
      { type: "remove", keyword: "B" },
      { type: "add", keyword: "C" },
      { type: "remove", keyword: "D" },
    ]
    const { inmediatos } = planDictionaryJobs(cambios, ID, TIPO)

    const tipos = inmediatos.map((j) => j.job_type)
    expect(tipos.lastIndexOf("remove_keyword")).toBeLessThan(tipos.indexOf("add_keyword"))
  })

  it("propaga signal_id y signal_type a cada job", () => {
    const { inmediatos } = planDictionaryJobs([{ type: "add", keyword: "X" }], ID, "process")
    expect(inmediatos[0]).toMatchObject({ signal_id: ID, signal_type: "process" })
  })

  it("no genera nada si no hay cambios", () => {
    expect(planDictionaryJobs([], ID, TIPO)).toEqual({ inmediatos: [], recalcs: [] })
  })
})
