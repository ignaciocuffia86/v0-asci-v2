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
  keyId: string
  scopes: string[]
  allowedModes: string[]
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
  const { data, error } = await admin.schema("v3").rpc("reserve_mcp_usage", {
    p_workspace_id: params.principal.workspaceId,
    p_user_id: params.principal.userId,
    p_api_key_id: params.principal.keyId,
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

export async function getMcpUsage(principal: McpPrincipal) {
  const admin = createAdminClient()
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
  return {
    plan: planUsage.plan,
    monthlyResearch: { used: planUsage.monthlyResearchCount, limit: planUsage.config.monthlyResearchCap },
    lastSevenDays: byPool,
    verifiedAi: (aiUsage.data ?? []).reduce((acc, row) => ({
      inputTokens: acc.inputTokens + row.input_tokens,
      outputTokens: acc.outputTokens + row.output_tokens,
      costUsd: acc.costUsd + Number(row.cost_usd),
    }), { inputTokens: 0, outputTokens: 0, costUsd: 0 }),
  }
}
