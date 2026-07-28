/** Verificación temporal del TTL por lote y del refresh sin recobro. Se borra al terminar. */
import { packageTtlMinutes, refreshPromptPackage } from "../lib/v3/mcp-client-ai"
import { createAdminClient } from "../lib/supabase/admin"

const WORKSPACE = "c731ba5a-aeb1-4e36-8bd5-401135566ecd"

async function main() {
  console.log("=== TTL segun tamano de lote ===")
  for (const size of [1, 2, 5, 10, 20]) {
    const min = packageTtlMinutes(size)
    console.log(`  lote ${String(size).padStart(2)} cuentas -> ${String(min).padStart(3)} min (${(min / 60).toFixed(1)} h) | submits requeridos: ${size * 4}`)
  }

  const admin = createAdminClient()
  // Ejecucion vencida artificial para probar que el refresh la revive.
  const { data: user } = await admin.schema("v3").from("workspace_members").select("user_id").eq("workspace_id", WORKSPACE).limit(1).single()
  const userId = user!.user_id

  const stalePackage = {
    promptVersion: "mcp-client-research-v2",
    stage: "internal_analysis",
    evidence: { technologies: [{ id: "technology:abc", term: "Power BI" }] },
    previousStages: [],
    packageHash: "x".repeat(64),
  }
  // Se reutiliza una reserva ya existente: el check de principal exige api_key_id
  // u oauth_token_id y acá solo importa satisfacer la FK.
  const { data: res, error: resError } = await admin.schema("v3").from("client_ai_executions").select("reservation_id,user_id,api_key_id,oauth_token_id,principal_id").eq("workspace_id", WORKSPACE).limit(1).single()
  if (resError) throw new Error(`No hay ejecuciones para copiar el principal: ${resError.message}`)

  const { data: exec, error } = await admin.schema("v3").from("client_ai_executions").insert({
    workspace_id: WORKSPACE,
    user_id: res.user_id,
    api_key_id: res.api_key_id,
    oauth_token_id: res.oauth_token_id,
    reservation_id: res.reservation_id,
    company_id: "fd18c397-f503-4a9e-9039-4ad7fe09d403",
    feature: "account_research",
    current_stage: "internal_analysis",
    prompt_version: "mcp-client-research-v2",
    package_hash: "x".repeat(64),
    package_payload: stalePackage,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
    batch_size: 10,
    status: "prepared",
  }).select("id,expires_at,batch_size").single()
  if (error) throw new Error(error.message)

  console.log("\n=== Refresh de un paquete vencido ===")
  console.log(`  antes: vence ${exec.expires_at} (VENCIDO), batch_size=${exec.batch_size}`)

  const principal = { workspaceId: WORKSPACE, userId: res.user_id, scopes: ["accounts:read"] } as never
  const first = await refreshPromptPackage(principal, exec.id)
  console.log(`  despues: vence ${first.promptPackage.expiresAt} | ttl=${first.promptPackage.ttlMinutes} min | refrescos restantes=${first.refreshesRemaining}`)
  console.log(`  hash cambio: ${first.promptPackage.packageHash !== "x".repeat(64)}`)
  console.log(`  evidencia preservada: ${JSON.stringify(first.promptPackage.evidence)}`)

  // Agotar el limite para confirmar que el techo aplica.
  let blocked = ""
  for (let i = 0; i < 6; i++) {
    try { await refreshPromptPackage(principal, exec.id) } catch (e) { blocked = (e as Error).message; break }
  }
  console.log(`  techo de refrescos: ${blocked || "NO APLICO (problema)"}`)

  await admin.schema("v3").from("client_ai_executions").delete().eq("id", exec.id)
  // La reserva NO se borra: es preexistente y real.
  console.log("\n  ejecucion de prueba eliminada")
}

main().then(() => process.exit(0)).catch((e) => { console.error("ERROR:", e); process.exit(1) })
