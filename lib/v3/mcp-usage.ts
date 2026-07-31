import "server-only"

import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { getWorkspacePlan, getWorkspaceUsage } from "@/lib/v3/plans"

export type McpUsagePool =
  | "research_server"
  | "icebreaker_server"
  | "research_client"
  | "icebreaker_client"
  /** Enrichment de contactos vía Apollo. 1 unidad = 1 contacto. */
  | "apollo_enrichment"

export interface McpPrincipal {
  workspaceId: string
  userId: string
  /**
   * Id de la credencial. Vive en v3.mcp_api_keys o en v3.mcp_oauth_tokens según
   * `keyType`, así que NUNCA se puede escribir a ciegas en una columna con FK a
   * una de las dos tablas: hay que discriminar primero.
   */
  keyId: string
  /**
   * Tipo de credencial. Sin este discriminador, las reservas y los logs asumían
   * que todo principal era una API key: las reservas OAuth fallaban con
   * INVALID_MCP_PRINCIPAL y los logs OAuth se descartaban en silencio.
   */
  keyType: "api_key" | "oauth_token"
  scopes: string[]
  allowedModes: string[]
}

/** Mapea el principal a la columna correcta de reservas/logs. */
export function principalColumns(principal: McpPrincipal): {
  api_key_id: string | null
  oauth_token_id: string | null
} {
  return principal.keyType === "api_key"
    ? { api_key_id: principal.keyId, oauth_token_id: null }
    : { api_key_id: null, oauth_token_id: principal.keyId }
}

export interface ReservationResult {
  allowed: boolean
  reservationId?: string
  idempotent?: boolean
  status?: "reserved" | "committed" | "released"
  metadata?: Record<string, unknown>
  code?: string
  remaining?: Record<string, number>
}

export async function requirePaidMcp(principal: McpPrincipal, scope: string, mode: "read" | "server_managed" | "client_assisted") {
  if (!principal.scopes.includes(scope) && !principal.scopes.includes("*")) {
    throw new Error(`SCOPE_REQUIRED:${scope}`)
  }
  if (mode === "read") return
  const plan = await getWorkspacePlan(principal.workspaceId)
  if (plan === "trial") throw new Error("PLAN_REQUIRED:Trial no permite acciones de IA por MCP")
  if (!principal.allowedModes.includes(mode)) throw new Error(`MODE_NOT_ALLOWED:${mode}`)
}

export async function reserveMcpUsage(params: {
  principal: McpPrincipal
  pool: McpUsagePool
  units: number
  idempotencyKey: string
  metadata?: Record<string, unknown>
}): Promise<ReservationResult> {
  if (!params.idempotencyKey.trim()) throw new Error("IDEMPOTENCY_KEY_REQUIRED")
  const admin = createAdminClient()
  const requestId = crypto.randomUUID()
  const cols = principalColumns(params.principal)
  const { data, error } = await admin.schema("v3").rpc("reserve_mcp_usage", {
    p_workspace_id: params.principal.workspaceId,
    p_user_id: params.principal.userId,
    p_api_key_id: cols.api_key_id,
    p_oauth_token_id: cols.oauth_token_id,
    p_request_id: requestId,
    p_idempotency_key: params.idempotencyKey,
    p_pool: params.pool,
    p_units: params.units,
    p_metadata: params.metadata ?? {},
  })
  if (error) throw new Error(`RESERVATION_FAILED:${error.message}`)
  return data as ReservationResult
}

/**
 * Unidades consumidas por el workspace en un pool durante el mes calendario actual.
 *
 * El RPC reserve_mcp_usage solo controla ventanas de minuto, día y semana: no tiene
 * noción de mes. Sin esta función, los topes mensuales por plan serían decorativos.
 *
 * Cuenta 'reserved' + 'committed' y excluye 'released', para que un run fallido cuyo
 * crédito se devolvió no siga ocupando cupo del mes.
 */
export async function getMonthlyPoolUsage(workspaceId: string, pool: McpUsagePool): Promise<number> {
  const admin = createAdminClient()
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

  const { data, error } = await admin
    .schema("v3")
    .from("mcp_usage_reservations")
    .select("units")
    .eq("workspace_id", workspaceId)
    .eq("pool", pool)
    .neq("status", "released")
    .gte("created_at", monthStart)

  if (error) throw new Error(`MONTHLY_USAGE_FAILED:${error.message}`)
  return (data ?? []).reduce((sum, row) => sum + (row.units ?? 0), 0)
}

export async function setReservationStatus(reservationId: string, status: "committed" | "released", metadata?: Record<string, unknown>) {
  const admin = createAdminClient()
  const timestamp = new Date().toISOString()
  const { error } = await admin.schema("v3").from("mcp_usage_reservations").update({
    status,
    ...(metadata ? { metadata } : {}),
    ...(status === "committed" ? { committed_at: timestamp } : { released_at: timestamp }),
  }).eq("id", reservationId).eq("status", "reserved")
  if (error) throw new Error(`RESERVATION_UPDATE_FAILED:${error.message}`)
}

/**
 * Cierra una reserva cobrando SOLO las unidades realmente consumidas.
 *
 * Apollo se reserva por el peor caso (maxContacts) porque no sabemos cuantas
 * personas va a devolver la busqueda. Si se reservan 10 y se enriquecen 3,
 * `setReservationStatus` dejaria las 10 unidades ocupando cupo mensual, cobrandole
 * al workspace creditos que nunca se gastaron. Esta funcion ajusta el consumo.
 *
 * Si actualUnits es 0, libera la reserva completa en lugar de committear.
 */
export async function commitReservationWithUnits(
  reservationId: string,
  actualUnits: number,
  metadata?: Record<string, unknown>
) {
  if (actualUnits <= 0) {
    await setReservationStatus(reservationId, "released", metadata)
    return
  }
  const admin = createAdminClient()
  const { error } = await admin
    .schema("v3")
    .from("mcp_usage_reservations")
    .update({
      status: "committed",
      units: actualUnits,
      committed_at: new Date().toISOString(),
      ...(metadata ? { metadata } : {}),
    })
    .eq("id", reservationId)
    .eq("status", "reserved")
  if (error) throw new Error(`RESERVATION_UPDATE_FAILED:${error.message}`)
}

/**
 * Días de gracia después del vencimiento antes de considerar abandonada una
 * ejecución client-assisted.
 *
 * No se libera al vencer el paquete porque `refreshPromptPackage` REVIVE paquetes
 * vencidos sin cobrar: liberar ahí le quitaría al cliente cuota que todavía puede
 * usar legítimamente. Con la gracia, tuvo el TTL completo más una semana.
 */
const CLIENT_RESEARCH_GRACE_DAYS = 7

/**
 * Devuelve la cuota de los research client-assisted que el cliente nunca terminó.
 *
 * `prepare_account_research` cobra al preparar, porque ahí se arma el paquete y se
 * hace el trabajo de servidor. El problema es que si el cliente IA nunca manda el
 * submit —se cortó la sesión, el modelo abandonó el loop, el usuario cerró Claude—
 * la unidad quedaba consumida para siempre. Sobre un lote de 10 cuentas eso son 10
 * lugares del plan perdidos por una sesión que se cayó.
 *
 * Se cobra solo lo que efectivamente se completó: si de 10 cuentas se terminaron 3,
 * quedan cobradas 3 y se devuelven 7. Es idempotente y se ejecuta de forma perezosa
 * al consultar consumo, así que no necesita cron.
 */
export async function reclaimAbandonedClientResearch(workspaceId: string): Promise<number> {
  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - CLIENT_RESEARCH_GRACE_DAYS * 86400000).toISOString()

  const { data: candidates } = await admin
    .schema("v3")
    .from("mcp_usage_reservations")
    .select("id,units")
    .eq("workspace_id", workspaceId)
    .eq("pool", "research_client")
    .eq("status", "committed")
    .gte("created_at", new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString())

  if (!candidates?.length) return 0

  let reclaimed = 0
  for (const reservation of candidates) {
    const { data: executions } = await admin
      .schema("v3")
      .from("client_ai_executions")
      .select("status,expires_at")
      .eq("reservation_id", reservation.id)

    if (!executions?.length) continue
    // Si alguna sigue viva (dentro de gracia), no se toca la reserva: el lote está
    // en curso y bajarle las unidades ahora liberaría cuota que aún puede usarse.
    const someStillUsable = executions.some(
      (execution) => execution.status !== "completed" && execution.expires_at > cutoff
    )
    if (someStillUsable) continue

    const completed = executions.filter((execution) => execution.status === "completed").length
    if (completed >= reservation.units) continue

    // No se usa commitReservationWithUnits: esa función filtra por status
    // 'reserved' y acá la reserva ya está 'committed'. Se ajusta en el lugar,
    // dejando rastro en metadata de qué se devolvió y por qué.
    const metadata = {
      reclaimed: true,
      reclaimedAt: new Date().toISOString(),
      originalUnits: reservation.units,
      completedExecutions: completed,
      reason: "client_assisted_abandoned",
    }
    const { error } = await admin
      .schema("v3")
      .from("mcp_usage_reservations")
      .update(
        completed === 0
          ? { status: "released", released_at: new Date().toISOString(), metadata }
          : { units: completed, metadata }
      )
      .eq("id", reservation.id)
      .eq("status", "committed")
    if (error) continue
    reclaimed += reservation.units - completed
  }
  return reclaimed
}

export async function getMcpUsage(principal: McpPrincipal) {
  const admin = createAdminClient()
  // Antes de medir, se devuelve lo que quedó colgado. Perezoso a propósito: la
  // consulta de consumo es el momento natural para reconciliar y evita un cron.
  await reclaimAbandonedClientResearch(principal.workspaceId).catch(() => 0)
  const [planUsage, reservations, aiUsage] = await Promise.all([
    getWorkspaceUsage(principal.workspaceId),
    admin.schema("v3").from("mcp_usage_reservations")
      .select("pool,units,status,created_at")
      .eq("workspace_id", principal.workspaceId)
      .eq("user_id", principal.userId)
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
    admin.schema("v3").from("ai_usage_log")
      .select("input_tokens,output_tokens,cost_usd,generation_mode,created_at")
      .eq("workspace_id", principal.workspaceId)
      .eq("user_id", principal.userId)
      .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString()),
  ])
  const byPool: Record<string, { reserved: number; committed: number; released: number }> = {}
  for (const row of reservations.data ?? []) {
    byPool[row.pool] ??= { reserved: 0, committed: 0, released: 0 }
    byPool[row.pool][row.status as "reserved" | "committed" | "released"] += row.units
  }
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
  const clientResearchUsed = await getMonthlyPoolUsage(principal.workspaceId, "research_client")

  return {
    plan: planUsage.plan,
    // `monthlyResearch` se llamaba así y contaba SOLO el research server-managed,
    // pero las tools decían "consume 1 unidad de cuota de research" sin aclarar
    // cuál. Resultado: el cliente corría 6 research client-assisted, veía este
    // contador clavado y reportaba un bug de facturación que no existía. Son dos
    // pools separados a propósito y ahora se nombran como tales.
    monthlyServerResearch: {
      used: planUsage.monthlyResearchCount,
      limit: planUsage.config.monthlyResearchCap,
      note: "Research ejecutado por ASCI (run_account_research). Consume tokens de AI Gateway de ASCI.",
    },
    monthlyClientResearch: {
      used: clientResearchUsed,
      limit: planUsage.config.monthlyResearchCap,
      note: "Research ejecutado por tu propio modelo (prepare_account_research). No consume tokens de ASCI; sí ocupa cupo del plan.",
    },
    // Alias del pool server-managed. Se mantiene para no romper a ningún cliente
    // que ya lea esta clave; usar los dos campos de arriba, que son explícitos.
    monthlyResearch: { used: planUsage.monthlyResearchCount, limit: planUsage.config.monthlyResearchCap },
    poolsNote:
      "Los dos pools son independientes: un research client-assisted no mueve monthlyServerResearch, y viceversa. Si preparaste research con tu modelo, mirá monthlyClientResearch.",
    monthStart,
    lastSevenDays: byPool,
    verifiedAi: (aiUsage.data ?? []).reduce((acc, row) => ({
      inputTokens: acc.inputTokens + row.input_tokens,
      outputTokens: acc.outputTokens + row.output_tokens,
      costUsd: acc.costUsd + Number(row.cost_usd),
    }), { inputTokens: 0, outputTokens: 0, costUsd: 0 }),
  }
}
