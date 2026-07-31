/**
 * Contract test: pega al modelo real (AI Gateway) y a la base real para verificar
 * que la clasificacion de duplicados ambiguos funciona de punta a punta.
 *
 * Skipped por default porque cuesta plata y escribe en v3.company_dup_candidates.
 * Para correrlo:
 *
 *   RUN_DEDUPE_AI_CONTRACT_TESTS=1 npx vitest run tests/contract/dedupe-ai.test.ts
 *
 * Existe por un bug concreto: con UUIDs en la salida y maxOutputTokens=4096, la
 * respuesta se cortaba a la mitad y el lote entero se perdia con "La IA devolvio
 * una respuesta ilegible". Un test unitario no lo habria detectado porque el
 * problema aparece recien con el tamaño real de la respuesta del modelo.
 *
 * No valida veredictos puntuales (dependen del modelo, cambian): valida que la
 * respuesta se parsee, que la salida entre en el presupuesto y que las cuentas
 * cierren.
 */

import { describe, expect, it } from "vitest"

const RUN = process.env.RUN_DEDUPE_AI_CONTRACT_TESTS === "1"
const hasEnv = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY

const runIf = RUN && hasEnv ? describe : describe.skip

runIf("clasificacion de duplicados ambiguos (modelo real)", () => {
  it("resuelve un lote chico sin romper el parseo", async () => {
    const { classifyAmbiguousDuplicates } = await import("@/lib/v3/dedupe-ai")

    const res = await classifyAmbiguousDuplicates({ batchSize: 3 })

    // Lo central: no tira "respuesta ilegible".
    expect(res).toBeTruthy()

    // Si no habia nada pendiente el test no prueba nada util: avisar en vez de
    // pasar en verde por vacio.
    if (res.processed === 0 && res.retriable === 0) {
      console.warn("[test] no habia candidatos ambiguos pendientes; el lote vino vacio")
      return
    }

    // Las cuentas tienen que cerrar contra lo que se pidio.
    expect(res.processed + res.retriable).toBeLessThanOrEqual(3)
    expect(res.same + res.different + res.unsure).toBe(res.processed)

    // Con indices cortos la salida no deberia acercarse al techo: si esto empieza
    // a fallar es que el formato volvio a inflarse.
    expect(res.truncated).toBe(false)
    expect(res.retriable).toBe(0)

    // Se cobro algo (hubo llamada real) pero centavos, no dolares.
    expect(res.costUsd).toBeGreaterThan(0)
    expect(res.costUsd).toBeLessThan(0.01)

    console.log("[test] resultado:", JSON.stringify(res))
  }, 120_000)
})
