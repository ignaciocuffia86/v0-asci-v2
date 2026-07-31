import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { checkUrlsAlive, filterRelevantToCompany } from "@/lib/ai-structurer"
import { toSignalDirection, toV2EvidenceLevel, toEvidenceLevel, type SignalDirection } from "./evidence-level"

// ═══════════════════════════════════════════════════════════
// Drilldown externo: casos de éxito y noticias buscados por el CLIENTE.
//
// El panorama de la Fase 1 es 100% interno (señales y vacantes ya en la base).
// Cuando el usuario elige una tecnología o proceso concreto, recién ahí se sale
// a buscar afuera, y la búsqueda la hace el cliente MCP con SUS tokens.
//
// Por qué los guardrails son obligatorios y no opcionales: acá el contenido lo
// produce un modelo que NO controlamos, sobre una búsqueda que no vimos. Un
// modelo puede inventar una URL con forma perfecta. Sin verificación estaríamos
// persistiendo alucinaciones en una tabla que v2 lee en producción.
// ═══════════════════════════════════════════════════════════

/** Resultado de validar un lote antes de persistir. */
export interface GuardrailReport {
  accepted: number
  rejected: Array<{ title: string; reason: "url_muerta" | "no_menciona_empresa" | "fuera_de_ventana" | "sin_url" }>
}

/**
 * Ventana temporal por defecto para noticias, en días.
 * Se hace explícita porque "noticias recientes" sin ventana es una invitación a
 * que el modelo traiga una nota de 2019 como si fuera novedad.
 */
export const DEFAULT_NEWS_WINDOW_DAYS = 180

export interface ClientSuccessCase {
  title: string
  providerName: string | null
  technology: string | null
  summary: string | null
  results: string | null
  sourceUrl: string
  sourceName: string | null
  publishedAt: string | null
  /** Nivel declarado por el cliente; se recalcula según lo que se pueda verificar. */
  evidenceLevel?: string | null
  supportingSourceUrls?: string[]
}

export interface ClientNewsItem {
  title: string
  summary: string | null
  category: string
  direction?: string | null
  sourceUrl: string
  sourceName: string | null
  publishedAt: string | null
}

/**
 * Aplica los guardrails compartidos por casos de éxito y noticias.
 *
 * Orden deliberado: primero relevancia (barato, local), después URLs vivas
 * (costoso, va a la red). Filtrar antes reduce los HEAD que se disparan.
 */
async function applyGuardrails<T extends { title: string; sourceUrl: string }>(
  items: T[],
  params: {
    companyName: string
    textFields: (keyof T)[]
    windowDays?: number
    dateOf?: (item: T) => string | null
    context: string
  }
): Promise<{ kept: T[]; report: GuardrailReport }> {
  const rejected: GuardrailReport["rejected"] = []

  const withUrl = items.filter((item) => {
    if (item.sourceUrl?.trim()) return true
    // Sin URL no hay nada que verificar ni que citar: no se persiste.
    rejected.push({ title: item.title, reason: "sin_url" })
    return false
  })

  // Guardrail 1: la nota tiene que mencionar a la empresa. Descarta lo tangencial
  // ("el sector agroindustrial invierte en SAP" no es evidencia de la cuenta).
  const relevant = filterRelevantToCompany(withUrl, params.companyName, params.textFields)
  const relevantSet = new Set(relevant)
  for (const item of withUrl) {
    if (!relevantSet.has(item)) rejected.push({ title: item.title, reason: "no_menciona_empresa" })
  }

  // Guardrail 2: ventana temporal explícita. Solo si se pidió.
  let inWindow = relevant
  if (params.windowDays && params.dateOf) {
    const cutoff = Date.now() - params.windowDays * 24 * 60 * 60 * 1000
    inWindow = relevant.filter((item) => {
      const raw = params.dateOf!(item)
      // Sin fecha no se puede afirmar que esté en ventana, pero tampoco que no.
      // Se conserva: descartar por falta de fecha perdería notas legítimas.
      if (!raw) return true
      const parsed = new Date(raw).getTime()
      if (Number.isNaN(parsed)) return true
      if (parsed >= cutoff) return true
      rejected.push({ title: item.title, reason: "fuera_de_ventana" })
      return false
    })
  }

  // Guardrail 3: la URL tiene que existir. Es el que atrapa la alucinación pura.
  const alive = await checkUrlsAlive(
    inWindow.map((item) => item.sourceUrl),
    { context: params.context }
  )
  const kept = inWindow.filter((item) => {
    if (alive.has(item.sourceUrl)) return true
    rejected.push({ title: item.title, reason: "url_muerta" })
    return false
  })

  return { kept, report: { accepted: kept.length, rejected } }
}

/**
 * Persiste casos de éxito traídos por el cliente en `company_implementations`.
 *
 * Reusa la tabla de v2 en vez de crear una paralela: el modelo ya existe, la UI
 * de v2 ya lo muestra y el caché por `search_context` ya funciona. Duplicar la
 * tabla obligaría a mantener dos verdades sobre el mismo hecho.
 */
export async function persistClientSuccessCases(params: {
  companyId: string
  companyName: string
  userId: string
  searchContext: string
  cases: ClientSuccessCase[]
}): Promise<GuardrailReport> {
  const { kept, report } = await applyGuardrails(params.cases, {
    companyName: params.companyName,
    textFields: ["title", "summary", "results", "technology", "providerName"],
    context: "client-success-cases",
  })

  if (!kept.length) return report

  const admin = createAdminClient()
  const rows = kept.map((item) => {
    const supporting = (item.supportingSourceUrls ?? []).filter(Boolean)
    // El nivel NO se toma tal cual del cliente: un modelo no puede autoadjudicarse
    // evidencia directa por afirmarlo. Se deriva de lo que quedó verificado.
    // La URL principal ya está viva (pasó el guardrail), así que:
    //   - con al menos una fuente de respaldo → Confirmado (hay convergencia)
    //   - con una sola fuente viva → Probable, como techo
    // El nivel declarado por el cliente solo puede BAJAR el resultado, nunca subirlo.
    const declared = toEvidenceLevel(item.evidenceLevel)
    const ceiling = supporting.length >= 1 ? "Confirmado" as const : "Probable" as const
    const canonical = declared === "Inferido" ? "Inferido" as const : ceiling
    return {
      company_id: params.companyId,
      user_id: params.userId,
      title: item.title.slice(0, 300),
      provider_name: item.providerName?.slice(0, 240) ?? null,
      technology: item.technology?.slice(0, 240) ?? null,
      summary: item.summary?.slice(0, 2000) ?? null,
      results: item.results?.slice(0, 800) ?? null,
      source_url: item.sourceUrl,
      source_name: item.sourceName?.slice(0, 120) ?? null,
      published_at: item.publishedAt,
      // Traducido al vocabulario de v2: la UI de v2 lee esta columna.
      evidence_level: toV2EvidenceLevel(canonical),
      search_context: params.searchContext,
      convergent_sources: 1 + supporting.length,
      supporting_source_urls: supporting,
      ai_provider: "client_mcp",
      prompt_version: "v3-client",
    }
  })

  const { error } = await admin.from("company_implementations").insert(rows)
  if (error) throw new Error(`No se pudieron guardar los casos de éxito: ${error.message}`)
  return report
}

/**
 * Persiste noticias traídas por el cliente en `company_news`.
 *
 * Las columnas de procedencia (`source`, `sourced_by_workspace`, `verified_at`,
 * `direction`) son aditivas: v2 sigue leyendo todas las noticias de la empresa
 * sin cambios, y queda auditable quién trajo cada nota para poder revertir en
 * bloque si el contenido del cliente resultara malo.
 */
export async function persistClientNews(params: {
  companyId: string
  companyName: string
  workspaceId: string
  userId: string
  windowDays?: number
  items: ClientNewsItem[]
}): Promise<
  GuardrailReport & {
    directions: Record<SignalDirection, number>
    /** Cuántas se guardaron de verdad. */
    saved?: number
    /** Cuántas ya estaban (misma company_id + source_url) y se omitieron. */
    duplicates?: number
  }
> {
  const { kept, report } = await applyGuardrails(params.items, {
    companyName: params.companyName,
    textFields: ["title", "summary"],
    windowDays: params.windowDays ?? DEFAULT_NEWS_WINDOW_DAYS,
    dateOf: (item) => item.publishedAt,
    context: "client-news",
  })

  const directions: Record<SignalDirection, number> = { expansion: 0, contraccion: 0, neutro: 0 }
  if (!kept.length) return { ...report, directions }

  const admin = createAdminClient()
  const verifiedAt = new Date().toISOString()
  const rows = kept.map((item) => {
    const direction = toSignalDirection(item.direction)
    directions[direction] += 1
    return {
      company_id: params.companyId,
      user_id: params.userId,
      title: item.title.slice(0, 500),
      summary: item.summary?.slice(0, 2000) ?? null,
      category: item.category.slice(0, 100),
      // La columna de v2 se llama source_url, no url.
      source_url: item.sourceUrl,
      source_name: item.sourceName?.slice(0, 120) ?? null,
      published_at: item.publishedAt,
      direction,
      source: "client_mcp",
      sourced_by_workspace: params.workspaceId,
      // Marca de que las URLs pasaron por checkUrlsAlive en este momento.
      verified_at: verifiedAt,
    }
  })

  // Un `insert` plano fallaba entero cuando UNA sola nota ya estaba guardada:
  // `idx_company_news_unique_source` (company_id, source_url) tiraba un 23505 y se
  // perdían también las notas nuevas del mismo lote. Reencontrar una noticia ya
  // conocida es lo NORMAL cuando se re-investiga una cuenta, no un error del
  // cliente. Con ignoreDuplicates el lote entra igual y las repetidas se omiten.
  const { data: inserted, error } = await admin
    .from("company_news")
    .upsert(rows, { onConflict: "company_id,source_url", ignoreDuplicates: true })
    .select("id")
  if (error) throw new Error(`No se pudieron guardar las noticias: ${error.message}`)

  const saved = inserted?.length ?? 0
  const duplicates = rows.length - saved
  // Si una nota no se insertó, su `direction` no debe contarse como novedad.
  if (duplicates > 0 && saved === 0) {
    for (const key of Object.keys(directions) as SignalDirection[]) directions[key] = 0
  }
  return { ...report, directions, saved, duplicates }
}
