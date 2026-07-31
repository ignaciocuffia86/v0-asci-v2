import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Campos compartidos del Account Brief final.
 *
 * Existían dos escrituras independientes a `v3.account_briefs`: la server-managed
 * (`services/final-account-brief.ts`) y la client-assisted (`mcp-client-ai.ts`). La
 * segunda escribía 9 columnas menos, así que el mismo entregable salía mutilado según
 * el modo: `recommended_contacts` llegaba vacío (0 contactos vs 4,9 del server) y
 * `coverage`, `freshness`, `warnings`, `status`, `scorecard_id`, `profile_version`,
 * `snapshot_version` y `supersedes_brief_id` quedaban en su default.
 *
 * Nada de eso era una limitación del modo cliente: los datos ya estaban disponibles
 * (en el payload del paquete, que es el mismo snapshot interno que consume el server).
 * Este módulo centraliza la forma de la fila para que las dos rutas no vuelvan a
 * divergir en silencio.
 */

/**
 * Un brief se marca `partial` cuando no tiene evidencia detrás.
 *
 * Deliberadamente NO mira `warnings`: el server-managed venía usando solo la evidencia,
 * y sumar los avisos habría convertido en `partial` briefs que hoy son `ready` en
 * producción (cualquier cuenta con un aviso de contactos), rompiendo a quien filtre por
 * `status`. Los avisos ya viajan en su propia columna; el status no necesita duplicarlos.
 */
export function resolveBriefStatus(input: { evidenceCount: number }): "ready" | "partial" {
  return input.evidenceCount > 0 ? "ready" : "partial"
}

/**
 * Id del brief preliminar que este final reemplaza.
 *
 * Se usa para `supersedes_brief_id`, que es lo que permite a la UI mostrar "esto
 * actualiza un análisis previo" en vez de dejar dos briefs sueltos sin relación.
 */
export async function findSupersededBriefId(
  admin: SupabaseClient,
  workspaceId: string,
  companyId: string
): Promise<string | null> {
  const { data } = await admin
    .schema("v3")
    .from("account_briefs")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("company_id", companyId)
    .eq("stage", "preliminary")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

/** Clave de conflicto del upsert. Debe coincidir con el índice único de la tabla. */
export const BRIEF_CONFLICT_TARGET = "workspace_id,company_id,stage,input_hash"

type EvidenceTag = { id?: unknown } & Record<string, unknown>

/**
 * Reconstruye la evidencia citada por el modelo a partir del snapshot que se le mandó.
 *
 * El cliente devuelve solo `evidenceIds` (strings). Guardarlos crudos hacía que el
 * brief client-assisted almacenara `["abc","def"]` mientras el server-managed guardaba
 * objetos con título, resumen, nivel y fecha: la UI que lee el brief no podía renderizar
 * el primero. Acá se rehidratan contra los tags del snapshot, que es la única fuente
 * autorizada (los ids ya se validaron contra `allowedEvidence` antes de llamar a esto).
 */
export function hydrateEvidenceFromSnapshot(snapshot: unknown, evidenceIds: string[]): Record<string, unknown>[] {
  if (!snapshot || typeof snapshot !== "object") return []
  const index = new Map<string, Record<string, unknown>>()
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    const record = value as EvidenceTag
    if (typeof record.id === "string" && !index.has(record.id)) index.set(record.id, record as Record<string, unknown>)
    for (const item of Object.values(record)) walk(item)
  }
  walk(snapshot)

  return evidenceIds.map((id) => {
    const tag = index.get(id)
    if (!tag) return { id, source: "client_model", missing: true }
    return {
      id,
      source: "client_model",
      type: tag.type ?? null,
      term: tag.term ?? null,
      title: tag.term ?? tag.title ?? null,
      count: tag.count ?? null,
      evidenceLevel: tag.evidenceLevel ?? null,
      occurredAt: tag.latestAt ?? null,
      formerEmployeeMentions: tag.formerEmployeeMentions ?? null,
    }
  })
}
