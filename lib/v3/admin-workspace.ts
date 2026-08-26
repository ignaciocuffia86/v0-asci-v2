import "server-only"

// ═══════════════════════════════════════════════════════════════════════════
// EL WORKSPACE ADMIN — la excepción, declarada en UN solo lugar.
//
// Hay exactamente un workspace en el que ASCI arma informes on-demand para
// clientes. Ese workspace queda fuera de las reglas que existen para proteger a
// un cliente de un gasto que no autorizó, porque acá el que gasta y el que paga
// son la misma persona.
//
// Se declara acá y no en cada lugar que lo consulta, a propósito: una excepción
// repartida en cinco archivos es una excepción que nadie puede auditar. Si
// mañana hay que agregar otra regla a la lista, se agrega en esta lista.
//
// ── QUÉ DEJA DE APLICAR EN ESTE WORKSPACE ──────────────────────────────────
//
// 1. EL CRON DE REFRESH MENSUAL (`app/api/cron/v3-refresh-accounts`).
//    Esta es la que de verdad importa y la razón por la que este módulo existe.
//    El cron re-investiga TODA cuenta seguida activa de un plan pago. Un informe
//    admin puede guardar cientos de cuentas para armar una base; sin esta
//    exclusión, cada una entraría al ciclo mensual y gastaría IA todos los meses,
//    para siempre, sin que nadie lo haya decidido. El `followedCap` contenía eso
//    por accidente —60 cuentas es poco— y `unrestricted` lo levanta.
//
// 2. LOS TOPES DE CUENTA Y CUPO, vía la key `admin` que solo se emite acá
//    (`app/actions/v3/api-keys.ts`). El workspace es la segunda de las dos
//    llaves; la primera es ser superadmin global.
//
// ── QUÉ SIGUE APLICANDO, ACÁ TAMBIÉN ───────────────────────────────────────
//
// - La confirmación explícita de Apollo (`prepare` → `planHash` → `run`). El
//   crédito de un tercero es irreversible y eso no depende del workspace.
// - TODO el registro: reservas, `ai_usage_log`, `mcp_request_logs`. La regla del
//   perfil admin es "sin bloqueo", nunca "sin medición".
//
// ── FALLA CERRADO ──────────────────────────────────────────────────────────
//
// Sin la variable configurada no hay workspace admin: no se puede emitir la key
// y el cron no excluye a nadie. Un despliegue mal configurado tiene que quedarse
// sin la función, no repartirla.
// ═══════════════════════════════════════════════════════════════════════════

/** Nombre de la variable, exportado para poder nombrarla en los mensajes de error. */
export const ADMIN_WORKSPACE_ENV_VAR = "ASCI_ADMIN_WORKSPACE_ID"

/** El workspace admin, o null si no está configurado. */
export function adminWorkspaceId(): string | null {
  const value = process.env[ADMIN_WORKSPACE_ENV_VAR]?.trim()
  return value ? value : null
}

/**
 * Si este workspace es EL workspace admin.
 *
 * Devuelve false cuando no hay variable configurada y cuando el id viene vacío:
 * sin esa guarda, un `workspaceId` undefined contra un env var también vacío
 * daría true y convertiría a cualquier workspace en la excepción.
 */
export function isAdminWorkspace(workspaceId: string | null | undefined): boolean {
  const admin = adminWorkspaceId()
  return Boolean(admin && workspaceId && workspaceId === admin)
}
