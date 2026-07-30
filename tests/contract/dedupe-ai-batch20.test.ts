import { describe, it, expect } from "vitest"
import { classifyAmbiguousDuplicates } from "@/lib/v3/dedupe-ai"
import { createAdminClient } from "@/lib/supabase/admin"

// El lote de 20 es el que reventaba: la respuesta llegaba al techo de 4096 tokens
// y se cortaba a mitad del array. Este test reproduce ESE tamaño para probar que
// con indices cortos el output entra sobrado.
//
// Pega contra el modelo real y escribe veredictos, asi que va gated igual que el
// resto de los contract tests:
//   RUN_DEDUPE_AI_CONTRACT_TESTS=1 npx vitest run tests/contract/dedupe-ai-batch20.test.ts
const gate = process.env.RUN_DEDUPE_AI_CONTRACT_TESTS === "1" ? describe : describe.skip

gate("lote de 20 (el tamaño que fallaba)", () => {
  it("no se trunca y consume muy por debajo del techo de tokens", async () => {
    const antes = Date.now()
    const r = await classifyAmbiguousDuplicates(20)
    console.log("[test] resultado:", JSON.stringify(r))

    // Lo central: no se corto.
    expect(r.truncated).toBe(false)
    expect(r.retriable).toBe(0)

    // Y se resolvieron los 20 (si habia 20 pendientes).
    expect(r.processed).toBeGreaterThan(0)
    expect(r.same + r.different + r.unsure).toBe(r.processed)

    // Cuantos tokens de salida uso realmente? Antes: 4096 (el techo, truncado).
    const supabase = createAdminClient()
    const { data } = await supabase
      .schema("v3")
      .from("ai_usage_log")
      .select("output_tokens, input_tokens")
      .eq("feature", "dedupe")
      .gte("created_at", new Date(antes - 5000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)

    const out = data?.[0]?.output_tokens ?? 0
    console.log(`[test] output_tokens: ${out} (techo 8192, antes tocaba 4096 y truncaba)`)

    // Con ~20 grupos el output tiene que quedar holgado. Si esto empieza a
    // arrimarse al techo, es señal de que hay que bajar el tamaño del lote.
    expect(out).toBeGreaterThan(0)
    expect(out).toBeLessThan(4096)
  }, 180_000)
})
