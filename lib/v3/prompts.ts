import { createAdminClient } from "@/lib/supabase/admin"
import { PROMPT_DEFAULTS } from "./prompt-defaults"

// ═══════════════════════════════════════════════════════════
// Resolución de prompts de IA en runtime:
//  1. Override en v3.ai_prompts (editado desde el panel admin)
//  2. Fallback al default hardcodeado (prompt-defaults.ts)
//
// Cache in-process de 60s para no pegarle a la DB en cada
// llamada de IA. renderPrompt reemplaza los placeholders
// {{var}} con las variables inyectadas por código; los
// placeholders desconocidos se dejan intactos (defensivo).
// ═══════════════════════════════════════════════════════════

const CACHE_TTL_MS = 60 * 1000
let cache: { byKey: Map<string, string>; loadedAt: number } | null = null

async function loadOverrides(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.byKey
  const byKey = new Map<string, string>()
  try {
    const admin = createAdminClient()
    const { data } = await admin.schema("v3").from("ai_prompts").select("key, content")
    for (const row of data ?? []) {
      if (row.key && typeof row.content === "string" && row.content.trim()) {
        byKey.set(row.key, row.content)
      }
    }
  } catch (err) {
    console.error("[v3] Error cargando overrides de prompts (uso defaults):", err instanceof Error ? err.message : err)
  }
  cache = { byKey, loadedAt: Date.now() }
  return byKey
}

/** Invalida el cache (llamar al guardar desde el panel). */
export function invalidatePromptCache(): void {
  cache = null
}

/** Contenido vigente de un prompt: override de DB o default del código. */
export async function getPrompt(key: string): Promise<string> {
  const overrides = await loadOverrides()
  const override = overrides.get(key)
  if (override) return override
  const def = PROMPT_DEFAULTS[key]
  if (!def) throw new Error(`Prompt desconocido: ${key}`)
  return def.content
}

/**
 * Resuelve un prompt y reemplaza sus placeholders {{var}}.
 * Placeholders sin variable provista quedan como texto vacío;
 * variables sin placeholder en el contenido se ignoran.
 */
export async function renderPrompt(key: string, vars: Record<string, string | number | null | undefined> = {}): Promise<string> {
  const template = await getPrompt(key)
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name]
    return value === null || value === undefined ? "" : String(value)
  })
}
