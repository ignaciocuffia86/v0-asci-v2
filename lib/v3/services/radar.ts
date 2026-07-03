import { createHash } from "node:crypto"
import { generateText, generateObject } from "ai"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadDictionary, resolveProductByName, resolveProcessByName, suggestDictionaryTerm } from "./dictionary"
import { MODELS, type RadarType } from "./types"

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

/** Bundles temáticos (máx 5 corridas de Opus por cuenta). */
const BUNDLES: { key: string; radarType: RadarType; focus: string }[] = [
  {
    key: "tech-stack",
    radarType: "tech",
    focus: `Stack tecnológico y sistemas empresariales de la empresa:
- ERP, CRM, plataformas de datos/BI, cloud providers, sistemas core
- Implementaciones o migraciones tecnológicas anunciadas o en curso
- Partners tecnológicos e integradores con los que trabaja
- Modernización de sistemas legacy`,
  },
  {
    key: "news-business",
    radarType: "news",
    focus: `Noticias de negocio recientes (últimos 6 meses):
- Anuncios de inversión, resultados financieros relevantes
- Nuevos productos, servicios o líneas de negocio
- Cambios ejecutivos (CIO, CTO, CDO, CFO, gerencias de tecnología/operaciones)
- Fusiones, adquisiciones, alianzas estratégicas`,
  },
  {
    key: "expansion-timing",
    radarType: "news",
    focus: `Señales de expansión y timing comercial:
- Aperturas de plantas, oficinas, centros de distribución, nuevos mercados
- Proyectos de transformación digital anunciados con fechas
- Licitaciones o RFPs públicos de tecnología
- Regulaciones nuevas del sector que fuercen inversión en sistemas`,
  },
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
        url: z.string().nullable().describe("URL de la fuente si está disponible en el texto, sino null"),
        source_name: z.string().nullable().describe("Nombre del medio o fuente, sino null"),
        source_date: z
          .string()
          .nullable()
          .describe("Fecha de la fuente en formato YYYY-MM-DD si se conoce, sino null"),
        evidence_level: z
          .enum(["explicit", "inferred"])
          .describe("'explicit' si el texto lo afirma directamente con fuente; 'inferred' si es una deducción"),
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

/** Etapa A: investigación en texto libre con Opus. */
async function researchBundle(input: RadarBundleInput, focus: string): Promise<string> {
  const context = [
    `Empresa: ${input.companyName}`,
    input.domain ? `Sitio web: ${input.domain}` : null,
    input.country ? `País: ${input.country}` : null,
    input.industry ? `Industria: ${input.industry}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const { text } = await generateText({
    model: MODELS.RESEARCH,
    prompt: `Sos un analista de inteligencia comercial B2B. Investigá a fondo la siguiente empresa usando tu conocimiento y capacidad de búsqueda. Escribí un informe en texto libre, rico en detalles, citando fuentes y fechas cuando las conozcas.

${context}

FOCO DE ESTA INVESTIGACIÓN:
${focus}

REGLAS:
- Escribí en español.
- Incluí URLs de fuentes cuando las tengas; si no tenés certeza de una URL, no la inventes.
- Marcá claramente qué es un hecho verificable y qué es una inferencia tuya.
- Si no encontrás información sobre algún punto, decilo explícitamente en una línea y seguí.
- Priorizá información de los últimos 6-12 meses.`,
    temperature: 0.3,
    maxOutputTokens: 4096,
  })

  return text
}

/** Etapa B: estructuración con Gemini + generateObject. */
async function structureResearch(raw: string, radarType: RadarType) {
  const { object } = await generateObject({
    model: MODELS.STRUCTURER,
    schema: findingSchema,
    prompt: `Extraé los hallazgos concretos del siguiente informe de inteligencia comercial. Cada hallazgo debe ser un hecho o inferencia accionable sobre la empresa investigada. Descartá relleno, disclaimers y secciones donde el informe dice que no encontró información.

INFORME:
---
${raw.slice(0, 40000)}
---

REGLAS:
- Máximo 15 hallazgos, priorizá los más relevantes comercialmente.
- evidence_level 'explicit' SOLO si el informe cita una fuente concreta.
- Las URLs deben venir del informe; nunca las inventes (si no hay, usá null).
- technologies y processes: nombres de mercado estándar (ej: "SAP S/4HANA", no "el ERP de SAP").`,
    temperature: 0,
  })
  return object.findings
}

function dedupeHash(companyId: string, title: string, url: string | null): string {
  return createHash("sha256")
    .update(`${companyId}|${(url || title).toLowerCase().trim()}`)
    .digest("hex")
    .slice(0, 32)
}

/**
 * Corre un bundle de radar para una empresa: investiga (Opus), estructura
 * (Gemini), canoniza contra diccionario y persiste en el cache global.
 */
export async function runRadarBundle(
  input: RadarBundleInput,
  bundleKey: string
): Promise<RadarRunSummary> {
  const bundle = BUNDLES.find((b) => b.key === bundleKey)
  if (!bundle) throw new Error(`Bundle desconocido: ${bundleKey}`)

  const admin = createAdminClient()
  const dictionary = await loadDictionary()

  try {
    const raw = await researchBundle(input, bundle.focus)
    const findings = await structureResearch(raw, bundle.radarType)

    // Persistir la corrida cruda (re-estructurable sin re-investigar)
    const { data: run } = await admin
      .from("radar_research_runs")
      .insert({
        company_id: input.companyId,
        radar_type: bundle.radarType,
        bundle: bundle.key,
        model: MODELS.RESEARCH,
        raw_research: raw,
        structured: { findings },
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
            evidence: { companyId: input.companyId, source: bundle.key, snippet: f.title },
            agent: `radar:${bundle.key}`,
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
          radar_type: bundle.radarType,
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
          payload: { technologies: f.technologies, processes: f.processes },
          dedupe_hash: dedupeHash(input.companyId, f.title, f.url),
        },
        { onConflict: "company_id,dedupe_hash", ignoreDuplicates: true }
      )
      if (!error) newFindings++
    }

    return {
      bundle: bundle.key,
      radarType: bundle.radarType,
      findingsCount: findings.length,
      newFindings,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    await admin.from("radar_research_runs").insert({
      company_id: input.companyId,
      radar_type: bundle.radarType,
      bundle: bundle.key,
      model: MODELS.RESEARCH,
      status: "failed",
      error: message,
    })
    return { bundle: bundle.key, radarType: bundle.radarType, findingsCount: 0, newFindings: 0, error: message }
  }
}

/** Corre todos los bundles de radar para una empresa (secuencial, respeta rate limits). */
export async function runAllRadarBundles(
  input: RadarBundleInput,
  onProgress?: (bundle: string, index: number, total: number) => Promise<void>
): Promise<RadarRunSummary[]> {
  const results: RadarRunSummary[] = []
  for (let i = 0; i < BUNDLES.length; i++) {
    if (onProgress) await onProgress(BUNDLES[i].key, i, BUNDLES.length)
    results.push(await runRadarBundle(input, BUNDLES[i].key))
  }
  return results
}

/** Lista los bundles disponibles (para progreso en UI). */
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
  return (count ?? 0) >= BUNDLES.length
}
