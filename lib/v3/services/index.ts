// ═══════════════════════════════════════════════════════════
// Capa de servicios v3 (cuenta-céntrico).
// Consumida por: chat web (AI SDK tools), MCP server y cron mensual.
// Todos los servicios usan el admin client (service_role); la autorización
// por workspace se resuelve en la capa de entrada (API/MCP/cron).
// ═══════════════════════════════════════════════════════════

export * from "./types"
export * from "./dictionary"
export * from "./radar"
export * from "./jobs-interpreter"
export * from "./company-resolver"
export * from "./accounts"
export * from "./scoring"
export * from "./icebreakers"
export * from "./research-pipeline"
