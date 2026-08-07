/**
 * Contract test del Tech Radar migrado (Parallel -> collect/motor unificado).
 *
 * Pega al modelo real (AI Gateway: Haiku + web_search y Gemini structurer) y a
 * la base real. Skipped por default porque cuesta plata (varios centavos) y
 * escribe filas de telemetria en v3.ai_usage_log. NO escribe hallazgos
 * (runTechRadar no persiste: eso lo hace el caller), asi que es un dry-run
 * seguro del motor + atribucion + ciclo de vida de la corrida.
 *
 * Para correrlo:
 *
 *   RUN_TECH_RADAR_CONTRACT_TESTS=1 npx vitest run tests/contract/tech-radar.test.ts
 *
 * Objetivo: verificar que la migracion es TRANSPARENTE en ai@5 antes de tocar
 * la version del SDK. Valida:
 *   1. runTechRadar devuelve la forma nueva (findings + usage) sin romper.
 *   2. El gasto queda ATRIBUIDO (feature 'radar-tech' + company_id), NO huerfano.
 *   3. No se crean filas huerfanas ('research-structure' con company_id NULL).
 *   4. El ciclo de vida de v3.tech_radar_runs (start -> finish) escribe bien.
 *
 * No valida hallazgos puntuales (dependen del modelo y cambian): valida que el
 * circuito completo funcione y que la telemetria cuadre.
 */

import { describe, expect, it } from "vitest"

const RUN = process.env.RUN_TECH_RADAR_CONTRACT_TESTS === "1"
const hasEnv = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY

const runIf = RUN && hasEnv ? describe : describe.skip

runIf("Tech Radar migrado a collect (motor real)", () => {
  it("corre de punta a punta, atribuye el gasto y no deja filas huerfanas", async () => {
    const { runTechRadar } = await import("@/lib/tech-radar")
    const { createAdminClient } = await import("@/lib/supabase/admin")
    const admin = createAdminClient()

    // Empresa de prueba: La Polar (Chile), la que motivo este trabajo. Se busca
    // por nombre para no hardcodear el UUID.
    const { data: company, error: cErr } = await admin
      .from("companies")
      .select("id, name, country")
      .ilike("name", "%la polar%")
      .eq("country", "Chile")
      .limit(1)
      .single()

    expect(cErr).toBeNull()
    expect(company?.id).toBeTruthy()
    const companyId = company!.id as string
    console.log(`[test] empresa: ${company!.name} (${companyId})`)

    // Marca temporal para aislar las filas creadas por ESTA corrida.
    const startTs = new Date().toISOString()

    // ── 1. Ejecutar el radar con tracking (arregla el bug de las huerfanas) ──
    const res = await runTechRadar({
      companyName: company!.name as string,
      country: company!.country ?? undefined,
      tracking: { companyId, workspaceId: null, userId: null },
    })

    // Forma nueva del resultado.
    expect(Array.isArray(res.findings)).toBe(true)
    expect(res.usage).toBeTruthy()
    expect(res.usage.model).toBe("anthropic/claude-haiku-4.5")
    expect(res.usage.webSearches).toBeGreaterThan(0) // hubo busqueda web real
    expect(res.usage.sourcesCount).toBeGreaterThan(0) // collect trajo fuentes
    expect(res.usage.costUsd).toBeGreaterThan(0) // se cobro algo
    expect(res.usage.costUsd).toBeLessThan(1) // centavos, no dolares
    console.log("[test] usage:", JSON.stringify(res.usage))
    console.log(
      "[test] findings:", res.findings.length,
      "| bundles:", res.bundle_stats.map((b) => `${b.bundle}=${b.sources}`).join(" "),
    )

    // ── 2. El gasto quedo atribuido a 'radar-tech' + company_id ──
    const { data: attributed, error: aErr } = await admin
      .schema("v3")
      .from("ai_usage_log")
      .select("id, feature, company_id, cost_usd, model, metadata")
      .eq("feature", "radar-tech")
      .eq("company_id", companyId)
      .gte("created_at", startTs)

    expect(aErr).toBeNull()
    expect((attributed?.length ?? 0)).toBeGreaterThan(0)
    // TODAS las filas de esta corrida deben tener company_id (no huerfanas).
    for (const row of attributed ?? []) {
      expect(row.company_id).toBe(companyId)
    }
    console.log(`[test] filas radar-tech atribuidas: ${attributed?.length}`)

    // ── 3. No se crearon filas huerfanas por esta corrida ──
    // El bug viejo: structure() sin tracking logueaba 'research-structure' con
    // company_id NULL y metadata.context='tech-radar'. Ahora structure() recibe
    // tracking.feature='radar-tech', asi que NO deberia aparecer ninguna.
    const { data: orphans, error: oErr } = await admin
      .schema("v3")
      .from("ai_usage_log")
      .select("id, feature, company_id, metadata")
      .eq("feature", "research-structure")
      .is("company_id", null)
      .gte("created_at", startTs)

    expect(oErr).toBeNull()
    const techRadarOrphans = (orphans ?? []).filter(
      (r) => (r.metadata as any)?.context === "tech-radar" || (r.metadata as any)?.context === "tech-radar-retry",
    )
    expect(techRadarOrphans.length).toBe(0)
    console.log(`[test] filas huerfanas de esta corrida: ${techRadarOrphans.length} (esperado 0)`)
  }, 300_000)

  it("el ciclo de vida de v3.tech_radar_runs escribe start -> finish", async () => {
    const { startTechRadarRun, finishTechRadarRun } = await import("@/lib/v3/tech-radar-runs")
    const { createAdminClient } = await import("@/lib/supabase/admin")
    const admin = createAdminClient()

    // Abrir una corrida de prueba (marcada para poder limpiarla).
    const handle = await startTechRadarRun({
      companyId: null,
      companyName: "__TEST__ tech_radar_runs lifecycle",
      caller: "drilldown",
    })
    expect(handle?.id).toBeTruthy()

    // Debe existir en estado 'running'.
    const { data: running } = await admin
      .schema("v3")
      .from("tech_radar_runs")
      .select("id, status, company_name")
      .eq("id", handle!.id)
      .single()
    expect(running?.status).toBe("running")

    // Cerrarla con metricas simuladas.
    await finishTechRadarRun(handle!, {
      status: "completed",
      result: {
        findings: [],
        digest: null,
        bundle_stats: [],
        ai_provider: "test",
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.0001,
          webSearches: 3,
          sourcesCount: 5,
          model: "anthropic/claude-haiku-4.5",
        },
      },
    })

    const { data: done } = await admin
      .schema("v3")
      .from("tech_radar_runs")
      .select("id, status, cost_usd, web_searches, sources_count, completed_at, duration_ms")
      .eq("id", handle!.id)
      .single()
    expect(done?.status).toBe("completed")
    expect(done?.completed_at).toBeTruthy()
    expect(Number(done?.web_searches)).toBe(3)
    expect(Number(done?.sources_count)).toBe(5)
    console.log("[test] corrida de prueba cerrada:", JSON.stringify(done))

    // Limpieza: borrar la fila de prueba para no ensuciar la tabla.
    await admin.schema("v3").from("tech_radar_runs").delete().eq("id", handle!.id)
  }, 60_000)
})
