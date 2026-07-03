import { createHash } from "node:crypto"
import { generateObject } from "ai"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { loadDictionary, matchTextAgainstDictionary, resolveProductByName, suggestDictionaryTerm } from "./dictionary"
import { MODELS } from "./types"
import type { DictionaryMatch } from "./types"

// ═══════════════════════════════════════════════════════════
// Intérprete de vacantes en 2 capas:
//   Capa 2 (gratis): matching determinístico de cada posting contra el
//     diccionario global — anota productos/procesos con snippet de evidencia.
//   Capa 3 (IA): lectura COLECTIVA de todas las vacantes activas de la
//     empresa para inferir qué está construyendo/migrando/adoptando.
// La salida va al cache global public.radar_findings con
// radar_type='jobs-interpretation'.
// ═══════════════════════════════════════════════════════════

export interface JobPostingAnnotated {
  id: string
  title: string
  description: string | null
  location: string | null
  posted_at: string | null
  job_url: string | null
  matches: DictionaryMatch[]
}

export interface JobsInterpretationResult {
  postingsAnalyzed: number
  annotatedPostings: JobPostingAnnotated[]
  inferences: number
  error?: string
}

const jobsInferenceSchema = z.object({
  inferences: z
    .array(
      z.object({
        category: z
          .string()
          .describe("Categoría, ej: 'hiring-wave', 'tech-adoption', 'team-buildout', 'migration-signal', 'new-capability'"),
        title: z.string().describe("Título conciso de la inferencia en español"),
        summary: z
          .string()
          .describe("Qué está haciendo la empresa según el patrón de contrataciones, en 1-3 oraciones"),
        confidence: z.number().min(0).max(1),
        technologies: z.array(z.string()).describe("Tecnologías/productos implicados (nombres de mercado)"),
        supporting_job_titles: z
          .array(z.string())
          .describe("Títulos EXACTOS de las vacantes que sustentan esta inferencia (copiados de la lista)"),
      })
    )
    .max(8),
})

/**
 * Capa 2: anota los postings activos de una empresa contra el diccionario.
 * Determinístico y gratis — no consume IA.
 */
export async function annotateJobPostings(companyId: string): Promise<JobPostingAnnotated[]> {
  const admin = createAdminClient()
  const dictionary = await loadDictionary()

  const { data: postings } = await admin
    .from("job_postings")
    .select("id, title, description, location, posted_at, job_url")
    .eq("company_id", companyId)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .limit(50)

  return (postings ?? []).map((p) => ({
    ...p,
    matches: matchTextAgainstDictionary(`${p.title}\n${p.description ?? ""}`, dictionary),
  }))
}

/**
 * Capa 3: interpretación colectiva de las vacantes con IA.
 * Lee TODOS los postings juntos y deduce qué está construyendo la empresa.
 * Persiste inferencias en radar_findings (jobs-interpretation).
 */
export async function interpretJobPostings(
  companyId: string,
  companyName: string
): Promise<JobsInterpretationResult> {
  const admin = createAdminClient()
  const dictionary = await loadDictionary()
  const annotated = await annotateJobPostings(companyId)

  if (annotated.length === 0) {
    return { postingsAnalyzed: 0, annotatedPostings: [], inferences: 0 }
  }

  // Compactar postings para el prompt (títulos + extracto + matches Capa 2)
  const postingsText = annotated
    .map((p, i) => {
      const matched = p.matches.map((m) => `${m.name} (${m.type})`).join(", ")
      const desc = (p.description ?? "").slice(0, 600)
      return `${i + 1}. "${p.title}"${p.location ? ` — ${p.location}` : ""}${p.posted_at ? ` — publicado ${p.posted_at}` : ""}
${matched ? `   Diccionario: ${matched}` : ""}
${desc ? `   Extracto: ${desc}` : ""}`
    })
    .join("\n\n")

  try {
    const { object } = await generateObject({
      model: MODELS.STRUCTURER,
      schema: jobsInferenceSchema,
      prompt: `Sos un analista de inteligencia comercial B2B. A continuación tenés TODAS las vacantes activas de la empresa "${companyName}". Leelas EN CONJUNTO (no una por una) y deducí qué está construyendo, migrando o adoptando la empresa.

VACANTES (${annotated.length}):
---
${postingsText.slice(0, 35000)}
---

REGLAS:
- Buscá PATRONES: múltiples vacantes del mismo equipo, stack repetido, seniorities que indican equipo nuevo vs mantenimiento.
- Cada inferencia debe citar los títulos exactos de las vacantes que la sustentan.
- No repitas lo obvio ("la empresa está contratando"): inferí QUÉ implica comercialmente.
- Máximo 8 inferencias, priorizá las más accionables para venta B2B de tecnología.
- Escribí en español.`,
      temperature: 0.1,
    })

    // Persistir inferencias en el cache global
    const titleToId = new Map(annotated.map((p) => [p.title.toLowerCase().trim(), p.id]))
    let saved = 0

    for (const inf of object.inferences) {
      const productIds: string[] = []
      for (const techName of inf.technologies) {
        const resolved = resolveProductByName(techName, dictionary)
        if (resolved) {
          productIds.push(resolved.id)
        } else {
          await suggestDictionaryTerm({
            term: techName,
            type: "product",
            evidence: { companyId, source: "jobs-interpretation", snippet: inf.title },
            agent: "jobs-interpreter",
          })
        }
      }

      const supportingIds = inf.supporting_job_titles
        .map((t) => titleToId.get(t.toLowerCase().trim()))
        .filter((id): id is string => Boolean(id))

      const hash = createHash("sha256")
        .update(`${companyId}|jobs|${inf.title.toLowerCase().trim()}`)
        .digest("hex")
        .slice(0, 32)

      const { error } = await admin.from("radar_findings").upsert(
        {
          company_id: companyId,
          radar_type: "jobs-interpretation",
          category: inf.category,
          title: inf.title,
          summary: inf.summary,
          evidence_level: "inferred",
          confidence: inf.confidence,
          dictionary_product_ids: productIds,
          supporting_job_posting_ids: supportingIds,
          payload: { technologies: inf.technologies, supporting_job_titles: inf.supporting_job_titles },
          dedupe_hash: hash,
        },
        { onConflict: "company_id,dedupe_hash", ignoreDuplicates: true }
      )
      if (!error) saved++
    }

    return { postingsAnalyzed: annotated.length, annotatedPostings: annotated, inferences: saved }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[v3] Error interpretando vacantes:", message)
    return { postingsAnalyzed: annotated.length, annotatedPostings: annotated, inferences: 0, error: message }
  }
}
