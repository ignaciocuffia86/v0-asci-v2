/**
 * Constantes y tipos del Tech Radar SEGUROS PARA CLIENTE.
 *
 * Este modulo NO importa nada server-only (parallel, supabase server, fetch
 * con API keys, etc.) para que pueda ser bundled en componentes "use client".
 *
 * El orquestador completo vive en lib/tech-radar.ts (server-only) que re-exporta
 * estos simbolos para el codigo del backend.
 */

// ── Catalogo de micro-agentes ──────────────────────────────────────────
export const MICRO_AGENTS = [
  "bi_analytics",
  "cloud",
  "ipaas",
  "ciberseguridad",
  "workplace",
  "devops",
  "erp",
  "ia_rpa",
  "hardware",
  "crm",
  "telco",
  "procurement_it",
  "observabilidad",
  "pagos",
  "logistica",
  "health_it",
  "consultoria",
] as const

export type MicroAgent = (typeof MICRO_AGENTS)[number]

export const MICRO_AGENT_LABELS: Record<MicroAgent, string> = {
  bi_analytics: "BI / Analytics / Data",
  cloud: "Cloud / IaaS / PaaS",
  ipaas: "Integración / APIs / iPaaS",
  ciberseguridad: "Ciberseguridad",
  workplace: "Digital Workplace / Colaboración",
  devops: "Desarrollo / Software / DevOps",
  erp: "ERP / Gestión Empresarial",
  ia_rpa: "IA / RPA / Automatización",
  hardware: "Hardware / Infraestructura",
  crm: "CRM / Customer Experience",
  telco: "Telecomunicaciones",
  procurement_it: "Procurement IT",
  observabilidad: "Monitoreo / Observabilidad",
  pagos: "Pagos / Fintech / POS",
  logistica: "Logística / WMS / RFID",
  health_it: "Health IT / Salud Digital",
  consultoria: "Consultoría / Servicios IT",
}

// Niveles de evidencia (alineado con migracion 161)
export type EvidenceLevel = "directa" | "convergente" | "inferencia" | "sin_evidencia"
