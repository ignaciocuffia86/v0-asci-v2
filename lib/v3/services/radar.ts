import { createHash } from "node:crypto"
import { generateText, generateObject, stepCountIs } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadDictionary, resolveProductByName, resolveProcessByName, suggestDictionaryTerm } from "./dictionary"
import { MODELS, type RadarType } from "./types"
import { logAiUsage } from "@/lib/v3/usage"
import { getPrompt, renderPrompt } from "@/lib/v3/prompts"

/** Fuente web verificada (viene de una búsqueda real de Claude, no del modelo). */
export interface VerifiedSource {
  url: string
  title: string | null
}

/** Máximo de búsquedas web por corrida (acota costo/latencia). */
const MAX_WEB_SEARCHES = 5

// ═══════════════════════════════════════════════════════════
// Radar de dos etapas:
//   Etapa A — Opus investiga en texto libre (bundles temáticos).
//   Etapa B — Gemini + generateObject estructura contra schema Zod,
//             canonizando tecnologías/procesos contra el diccionario.
// La salida se persiste en el cache global de public:
//   - radar_research_runs (texto crudo, re-estructurable)
//   - radar_findings (hallazgos tipados, dedupe por hash)
// ═══════════════════════════════════════════════════════════

export interface RadarBundleInput {
  companyId: string
  companyName: string
  domain?: string | null
  country?: string | null
  industry?: string | null
}

export interface RadarRunSummary {
  bundle: string
  radarType: RadarType
  findingsCount: number
  newFindings: number
  error?: string
}

/**
 * Bundles temáticos (máx 5 corridas de Opus por cuenta).
 * El texto del foco vive en v3.ai_prompts (editable desde /v3/admin/prompts)
 * con fallback a los defaults de lib/v3/prompt-defaults.ts.
 */
const BUNDLES: { key: string; radarType: RadarType; promptKey: string }[] = [
  { key: "tech-stack", radarType: "tech", promptKey: "radar.focus.tech" },
  { key: "news-business", radarType: "news", promptKey: "radar.focus.news" },
  { key: "expansion-timing", radarType: "news", promptKey: "radar.focus.expansion" },
]

const findingSchema = z.object({
  findings: z
    .array(
      z.object({
        category: z
          .string()
          .describe("Categoría corta del hallazgo, ej: 'erp-migration', 'executive-change', 'expansion', 'cloud-adoption', 'partnership'"),
        title: z.string().describe("Título conciso del hallazgo en español"),
        summary: z.string().describe("Resumen de 1-3 oraciones con el contexto del hallazgo"),
        source_urls: z
          .array(z.string())
          .describe(
            "URLs EXACTAS de las fuentes web que respaldan este hallazgo, copiadas literalmente del listado FUENTES DISPONIBLES. Array vacío si el hallazgo es una inferencia sin fuente directa. NUNCA inventes URLs."
          ),
        source_name: z.string().nullable().describe("Nombre del medio o fuente principal, sino null"),
        source_date: z
          .string()
          .nullable()
          .describe("Fecha de la fuente en formato YYYY-MM-DD si se conoce, sino null"),
        evidence_level: z
          .enum(["explicit", "inferred"])
          .describe("'explicit' si hay al menos una URL de fuente que lo respalda; 'inferred' si es una deducción sin fuente directa"),
        confidence: z.number().min(0).max(1).describe("Confianza del hallazgo entre 0 y 1"),
        technologies: z
          .array(z.string())
          .describe("Nombres de tecnologías/productos mencionados o implicados (ej: 'SAP S/4HANA', 'Salesforce', 'AWS')"),
        processes: z
          .array(z.string())
          .describe("Procesos de negocio implicados (ej: 'Supply Chain', 'Finanzas')"),
      })
    )
    .max(15),
})

/**
 * Etapa A: investigación con Opus + búsqueda web REAL (server-side tool de
 * Anthropic vía AI Gateway). Devuelve el informe en texto y el set de fuentes
 * verificadas efectivamente citadas por el modelo (URLs reales, no inventadas).
 */
async function researchBundle(
  input: RadarBundleInput,
  focus: string,
  radarType: RadarType
): Promise<{ text: string; sources: VerifiedSource[]; searchCount: number }> {
  const context = [
    `Empresa: ${input.companyName}`,
    input.domain ? `Sitio web: ${input.domain}` : null,
    input.country ? `País: ${input.country}` : null,
    input.industry ? `Industria: ${input.industry}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const prompt = await renderPrompt("radar.base", { context, focus })

  const userLocation = input.country
    ? ({ type: "approximate" as const, country: countryToISO(input.country) })
    : undefined

  const { text, usage, sources, steps } = await generateText({
    model: MODELS.RESEARCH,
    prompt,
    temperature: 0.3,
    maxOutputTokens: 4096,
    tools: {
      // Server-side web search de Anthropic (se ejecuta y cita en el proveedor,
      // atravesando el AI Gateway). El cast salva un desajuste de generics del
      // tipo Tool entre las versiones de @ai-sdk/* — el runtime es correcto.
      web_search: anthropic.tools.webSearch_20250305({
        maxUses: MAX_WEB_SEARCHES,
        ...(userLocation ? { userLocation } : {}),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // Permitir varias rondas de búsqueda + síntesis final.
    stopWhen: stepCountIs(MAX_WEB_SEARCHES + 2),
  })

  // Sólo URLs realmente citadas por Claude (dedup por URL).
  const seen = new Set<string>()
  const verifiedSources: VerifiedSource[] = []
  for (const s of sources ?? []) {
    if (s.sourceType !== "url" || !s.url || seen.has(s.url)) continue
    seen.add(s.url)
    verifiedSources.push({ url: s.url, title: s.title ?? null })
  }

  // Contar cuántas búsquedas web se ejecutaron (para métricas de costo).
  let searchCount = 0
  for (const step of steps ?? []) {
    for (const call of step.toolCalls ?? []) {
      if (call.toolName === "web_search") searchCount++
    }
  }

  await logAiUsage({
    feature: radarType === "news" ? "radar-news" : "radar-tech",
    model: MODELS.RESEARCH,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    companyId: input.companyId,
    metadata: { stage: "research", web_searches: searchCount, sources: verifiedSources.length },
  })

  return { text, sources: verifiedSources, searchCount }
}

/** Mapea nombres de país comunes a código ISO-2 para userLocation de web_search. */
function countryToISO(country: string): string {
  const c = country.trim().toLowerCase()
  const map: Record<string, string> = {
    argentina: "AR",
    "estados unidos": "US",
    "united states": "US",
    usa: "US",
    méxico: "MX",
    mexico: "MX",
    españa: "ES",
    spain: "ES",
    chile: "CL",
    colombia: "CO",
    perú: "PE",
    peru: "PE",
    brasil: "BR",
    brazil: "BR",
    uruguay: "UY",
    paraguay: "PY",
    ecuador: "EC",
    bolivia: "BO",
    venezuela: "VE",
  }
  if (map[c]) return map[c]
  // Si ya es un ISO-2 válido, respetarlo.
  if (/^[a-z]{2}$/.test(c)) return c.toUpperCase()
  return "US"
}

/**
 * Etapa B: estructuración con Gemini + generateObject.
 * Recibe el set blanco de fuentes verificadas (URLs reales citadas por Claude)
 * y sólo acepta URLs que pertenezcan a ese set; el resto se descarta.
 */
async function structureResearch(
  raw: string,
  radarType: RadarType,
  sources: VerifiedSource[],
  companyId?: string
) {
  const sourcesBlock =
    sources.length > 0
      ? sources.map((s, i) => `[${i + 1}] ${s.url}${s.title ? ` — ${s.title}` : ""}`).join("\n")
      : "(No hubo fuentes web verificadas en esta corrida. Todos los hallazgos deben marcarse como inferencia con source_urls vacío.)"

  const { object, usage } = await generateObject({
    model: MODELS.STRUCTURER,
    schema: findingSchema,
    prompt: `Extraé los hallazgos concretos del siguiente informe de inteligencia comercial. Cada hallazgo debe ser un hecho o inferencia accionable sobre la empresa investigada. Descartá relleno, disclaimers y secciones donde el informe dice que no encontró información.

INFORME:
---
${raw.slice(0, 40000)}
---

FUENTES DISPONIBLES (URLs verificadas de búsquedas web reales — son las ÚNICAS URLs que podés usar):
${sourcesBlock}

REGLAS:
- Máximo 15 hallazgos, priorizá los más relevantes comercialmente.
- source_urls: copiá LITERALMENTE una o más URLs del listado FUENTES DISPONIBLES que respalden el hallazgo. Si ninguna fuente lo respalda directamente, dejá source_urls vacío ([]).
- PROHIBIDO inventar URLs o usar URLs que no estén en FUENTES DISPONIBLES. Cualquier URL fuera del listado será descartada.
- evidence_level 'explicit' SOLO si source_urls tiene al menos una URL del listado; en cualquier otro caso 'inferred'.
- technologies y processes: nombres de mercado estándar (ej: "SAP S/4HANA", no "el ERP de SAP").`,
    temperature: 0,
  })

  await logAiUsage({
    feature: radarType === "news" ? "radar-news" : "radar-tech",
    model: MODELS.STRUCTURER,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    companyId: companyId ?? null,
    metadata: { stage: "structure" },
  })

  // ── Validación dura: sólo URLs del set blanco de fuentes verificadas ──
  const allowed = new Map(sources.map((s) => [s.url, s]))
  return object.findings.map((f) => {
    const verified = (f.source_urls ?? []).filter((u) => allowed.has(u))
    const isExplicit = verified.length > 0
    const supporting = verified.map((u) => ({
      url: u,
      title: allowed.get(u)?.title ?? null,
      date: f.source_date ?? null,
    }))
    return {
      ...f,
      // La fuente primaria es la primera URL verificada.
      url: isExplicit ? verified[0] : null,
      source_name: isExplicit ? f.source_name ?? hostnameOf(verified[0]) : null,
      supporting_sources: supporting,
      convergent_sources: verified.length,
      evidence_level: (isExplicit ? "explicit" : "inferred") as "explicit" | "inferred",
    }
  })
}

/** Extrae el hostname de una URL para usar como nombre de fuente por defecto. */
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

function dedupeHash(companyId: string, title: string, url: string | null): string {
  return createHash("sha256")
    .update(`${companyId}|${(url || title).toLowerCase().trim()}`)
    .digest("hex")
    .slice(0, 32)
}

/**
 * Micro-agente resuelto listo para correr. Puede venir del catálogo editable
 * (v3.radar_micro_agents) o de los bundles legacy (fallback).
 */
export interface ResolvedMicroAgent {
  key: string
  label: string
  radarType: RadarType
  focus: string
}

/**
 * Corre un micro-agente para una empresa: investiga con búsqueda web real
 * (Opus + web_search), estructura (Gemini), valida las fuentes contra el set
 * verificado, canoniza contra el diccionario y persiste en el cache global.
 */
export async function runMicroAgent(
  input: RadarBundleInput,
  agent: ResolvedMicroAgent
): Promise<RadarRunSummary> {
  const admin = createAdminClient()
  const dictionary = await loadDictionary()

  try {
    const { text: raw, sources } = await researchBundle(input, agent.focus, agent.radarType)
    const findings = await structureResearch(raw, agent.radarType, sources, input.companyId)

    // Persistir la corrida cruda (re-estructurable sin re-investigar)
    const { data: run } = await admin
      .from("radar_research_runs")
      .insert({
        company_id: input.companyId,
        radar_type: agent.radarType,
        bundle: agent.key,
        model: MODELS.RESEARCH,
        raw_research: raw,
        structured: { findings, sources },
        status: "completed",
      })
      .select("id")
      .single()

    let newFindings = 0
    for (const f of findings) {
      // Canonizar tecnologías/procesos contra el diccionario
      const productIds: string[] = []
      const processIds: string[] = []
      for (const techName of f.technologies) {
        const resolved = resolveProductByName(techName, dictionary)
        if (resolved) {
          productIds.push(resolved.id)
        } else {
          // Término no reconocido → sugerencia para el super-admin
          await suggestDictionaryTerm({
            term: techName,
            type: "product",
            evidence: { companyId: input.companyId, source: agent.key, snippet: f.title },
            agent: `radar:${agent.key}`,
          })
        }
      }
      for (const procName of f.processes) {
        const resolved = resolveProcessByName(procName, dictionary)
        if (resolved) processIds.push(resolved.id)
      }

      const { error } = await admin.from("radar_findings").upsert(
        {
          company_id: input.companyId,
          run_id: run?.id ?? null,
          radar_type: agent.radarType,
          micro_agent: agent.key,
          category: f.category,
          title: f.title,
          summary: f.summary,
          url: f.url,
          source_name: f.source_name,
          source_date: f.source_date,
          evidence_level: f.evidence_level,
          confidence: f.confidence,
          dictionary_product_ids: productIds,
          dictionary_process_ids: processIds,
          supporting_sources: f.supporting_sources,
          convergent_sources: f.convergent_sources,
          payload: { technologies: f.technologies, processes: f.processes },
          dedupe_hash: dedupeHash(input.companyId, f.title, f.url),
        },
        { onConflict: "company_id,dedupe_hash", ignoreDuplicates: true }
      )
      if (!error) newFindings++
    }

    return {
      bundle: agent.key,
      radarType: agent.radarType,
      findingsCount: findings.length,
      newFindings,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    await admin.from("radar_research_runs").insert({
      company_id: input.companyId,
      radar_type: agent.radarType,
      bundle: agent.key,
      model: MODELS.RESEARCH,
      status: "failed",
      error: message,
    })
    return { bundle: agent.key, radarType: agent.radarType, findingsCount: 0, newFindings: 0, error: message }
  }
}

/**
 * Bundles legacy como fallback cuando no hay micro-agentes seleccionables
 * (catálogo vacío o workspace sin propuesta de valor). Resuelven su foco desde
 * v3.ai_prompts con fallback a prompt-defaults.ts.
 */
async function resolveLegacyBundles(): Promise<ResolvedMicroAgent[]> {
  return Promise.all(
    BUNDLES.map(async (b) => ({
      key: b.key,
      label: b.key,
      radarType: b.radarType,
      focus: await getPrompt(b.promptKey),
    }))
  )
}

/**
 * Corre los micro-agentes seleccionados para una empresa (secuencial, respeta
 * rate limits). Si no se pasan agentes, cae a los bundles legacy.
 */
export async function runMicroAgents(
  input: RadarBundleInput,
  agents: ResolvedMicroAgent[],
  onProgress?: (agentKey: string, index: number, total: number) => Promise<void>
): Promise<RadarRunSummary[]> {
  const list = agents.length > 0 ? agents : await resolveLegacyBundles()
  const results: RadarRunSummary[] = []
  for (let i = 0; i < list.length; i++) {
    if (onProgress) await onProgress(list[i].key, i, list.length)
    results.push(await runMicroAgent(input, list[i]))
  }
  return results
}

/**
 * Corre todos los micro-agentes/bundles por defecto (legacy). Se mantiene para
 * compatibilidad; el pipeline usa la selección dinámica por workspace.
 */
export async function runAllRadarBundles(
  input: RadarBundleInput,
  onProgress?: (bundle: string, index: number, total: number) => Promise<void>
): Promise<RadarRunSummary[]> {
  const legacy = await resolveLegacyBundles()
  return runMicroAgents(input, legacy, onProgress)
}

/** Lista los bundles legacy disponibles (para progreso en UI). */
export function listRadarBundles(): { key: string; radarType: RadarType }[] {
  return BUNDLES.map((b) => ({ key: b.key, radarType: b.radarType }))
}

/** Lee los hallazgos frescos de una empresa del cache global. */
export async function getRadarFindings(
  companyId: string,
  options?: { sinceDays?: number; limit?: number }
) {
  const admin = createAdminClient()
  let query = admin
    .from("radar_findings")
    .select("*")
    .eq("company_id", companyId)
    .order("detected_at", { ascending: false })
    .limit(options?.limit ?? 100)

  if (options?.sinceDays) {
    const since = new Date(Date.now() - options.sinceDays * 24 * 60 * 60 * 1000).toISOString()
    query = query.gte("detected_at", since)
  }

  const { data, error } = await query
  if (error) {
    console.error("[v3] Error leyendo radar_findings:", error.message)
    return []
  }
  return data ?? []
}

/** Determina si el cache de radar de una empresa está fresco (< ttlDays). */
export async function isRadarCacheFresh(companyId: string, ttlDays: number): Promise<boolean> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString()
  const { count } = await admin
    .from("radar_research_runs")
    .select("*", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "completed")
    .gte("created_at", since)
  // Con selección dinámica de micro-agentes la cantidad varía; al menos una
  // corrida completada dentro del TTL indica que hay cache utilizable.
  return (count ?? 0) >= 1
}
