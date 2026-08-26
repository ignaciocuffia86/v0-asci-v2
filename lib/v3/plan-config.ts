// Configuración PURA de planes por workspace: sin imports de servidor, para que
// tanto el backend (lib/v3/plans.ts, que la re-exporta) como los client
// components (el panel de workspaces) lean LA MISMA fuente y los cupos no
// puedan desincronizarse.
//
// Regla de producto (ago 2026): el cupo mensual de research va ALINEADO al de
// cuentas seguidas (followedCap) — dos números distintos eran confusos.
// El trial además tiene tope de por vida igual a su cupo.

export type WorkspacePlan = "trial" | "silver" | "gold" | "platinum"

export interface PlanConfig {
  label: string
  /** Máximo de cuentas seguidas activas (cap del plan). */
  followedCap: number
  /** Researches nuevos por mes calendario (empresas no investigadas antes por el workspace). */
  monthlyResearchCap: number
  /** Trial: researches totales de por vida del workspace. */
  lifetimeResearchCap: number | null
  /** Usuarios (miembros activos + invitaciones pendientes) por workspace. */
  maxUsers: number | null
  /** El cron mensual refresca las cuentas seguidas de este plan. */
  allowsCron: boolean
  /** Permite crear y usar API keys (MCP). */
  allowsApiKeys: boolean
  /** Permite re-investigar (refresh manual) una empresa existente. */
  allowsManualRefresh: boolean
  /** Días de cooldown entre researches de la misma empresa. */
  refreshCooldownDays: number

  // ─── Enrichment de contactos (Apollo, créditos absorbidos por ASCI) ───
  /** Permite buscar tomadores de decisión vía Apollo desde la app y el MCP. */
  allowsContactEnrichment: boolean
  /** Unidades de enrichment de contactos por mes calendario (1 unidad = 1 contacto). */
  monthlyContactEnrichmentUnits: number
  /** Máximo de cargos (recomendados + manuales) por ejecución de enrichment. */
  maxRolesPerEnrichment: number
  /** Máximo de contactos devueltos por ejecución de enrichment. */
  maxContactsPerEnrichment: number
  /** Días tras los cuales un dato de contacto se considera obsoleto (por campo). */
  contactFreshnessDays: number
}

export const PLAN_CONFIG: Record<WorkspacePlan, PlanConfig> = {
  trial: {
    label: "Trial",
    followedCap: 10,
    monthlyResearchCap: 10,
    lifetimeResearchCap: 10,
    maxUsers: 1,
    allowsCron: false,
    allowsApiKeys: false,
    allowsManualRefresh: false,
    refreshCooldownDays: 30,
    allowsContactEnrichment: false,
    monthlyContactEnrichmentUnits: 0,
    maxRolesPerEnrichment: 0,
    maxContactsPerEnrichment: 0,
    contactFreshnessDays: 90,
  },
  silver: {
    label: "Silver",
    followedCap: 60,
    monthlyResearchCap: 60,
    lifetimeResearchCap: null,
    maxUsers: 3,
    allowsCron: true,
    allowsApiKeys: true,
    allowsManualRefresh: true,
    refreshCooldownDays: 30,
    allowsContactEnrichment: true,
    monthlyContactEnrichmentUnits: 150,
    maxRolesPerEnrichment: 10,
    maxContactsPerEnrichment: 10,
    contactFreshnessDays: 90,
  },
  gold: {
    label: "Gold",
    followedCap: 120,
    monthlyResearchCap: 120,
    lifetimeResearchCap: null,
    maxUsers: 10,
    allowsCron: true,
    allowsApiKeys: true,
    allowsManualRefresh: true,
    refreshCooldownDays: 30,
    allowsContactEnrichment: true,
    monthlyContactEnrichmentUnits: 400,
    maxRolesPerEnrichment: 10,
    maxContactsPerEnrichment: 10,
    contactFreshnessDays: 90,
  },
  platinum: {
    label: "Platinum",
    followedCap: 240,
    monthlyResearchCap: 240,
    lifetimeResearchCap: null,
    maxUsers: null,
    allowsCron: true,
    allowsApiKeys: true,
    allowsManualRefresh: true,
    refreshCooldownDays: 30,
    allowsContactEnrichment: true,
    monthlyContactEnrichmentUnits: 1000,
    maxRolesPerEnrichment: 10,
    maxContactsPerEnrichment: 10,
    contactFreshnessDays: 90,
  },
}

/**
 * Precio del crédito de Apollo: 1.000 créditos = US$ 10.
 *
 * Vive acá, con la configuración de planes, y no en la tool que reporta costos,
 * porque es un dato comercial que va a cambiar cuando cambie el contrato — y
 * cuando cambie tiene que cambiar en UN lugar.
 *
 * OJO con qué se multiplica: el crédito NO es la unidad de consumo. Apollo cobra
 * 1 crédito por email y **5 por teléfono** (ver docs/plan-mcp-admin.md §8). Hoy
 * `contact_enrichment_runs.credits_spent` es un entero sin desglose y el código
 * solo revela emails, así que multiplicar el total por este precio es correcto
 * MIENTRAS no se revelen teléfonos. Cuando entre `includePhone`, hace falta el
 * desglose por tipo antes de que este número siga siendo cierto.
 */
export const APOLLO_USD_PER_CREDIT = 0.01

export const PLAN_ORDER: WorkspacePlan[] = ["trial", "silver", "gold", "platinum"]
