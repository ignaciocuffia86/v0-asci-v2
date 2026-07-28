import { generateText } from "ai"
import { createAdminClient } from "@/lib/supabase/admin"
import { logAiUsage } from "@/lib/v3/usage"

/**
 * Fase 2 — Resolucion de duplicados ambiguos con IA.
 *
 * COMO SE MANTIENE BARATO
 * 1. La IA solo ve los grupos que SQL marco como 'ambiguo'. Los 'seguro' se
 *    mergean gratis, sin pagar un token.
 * 2. Se manda un LOTE de grupos por request (default 20), asi el prompt de
 *    instrucciones se amortiza entre muchas decisiones en lugar de repetirse.
 * 3. El payload viene precalculado y recortado en SQL: sin `description`, y del
 *    LinkedIn solo el slug. Son los campos que deciden identidad, nada mas.
 * 4. Modelo gemini-2.5-flash-lite ($0.075 / $0.30 por millon de tokens).
 *
 * La IA NUNCA ejecuta un merge: solo escribe su veredicto en la tabla cache.
 * Quien mergea es el server action, y siempre a traves de merge_companies.
 */

const MODEL = "google/gemini-2.5-flash-lite"

/** Un grupo ambiguo tal como lo devuelve la cache. */
interface DupCandidate {
  id: string
  group_key: string
  company_ids: string[]
  payload: {
    id: string
    name: string
    country: string | null
    industry: string | null
    linkedin: string | null
    website: string | null
    jobs: number
    contacts: number
    news: number
  }[]
}

/** Veredicto por grupo. */
interface Verdict {
  group: string
  /** Ids que SI son la misma empresa que el master. */
  same: string[]
  /** Ids que son empresas distintas y deben quedar separadas. */
  different: string[]
  confidence: number
  reasoning: string
}

const SYSTEM_RULES = `Sos un analista de datos B2B que decide si registros de empresas son LA MISMA entidad o entidades DISTINTAS.

Cada grupo trae varios registros con el mismo nombre nucleo. Tu tarea es separar, dentro del grupo, cuales son la misma empresa y cuales no.

SON LA MISMA EMPRESA:
- Diferencias de forma societaria o prefijo: "ARCOR" = "Grupo Arcor" = "ARCOR S.A.I.C" = "ARCOR SAIC".
- Siglas o abreviaturas de la misma razon social: "YPF" = "Y.P.F.", "Telecom" = "Telecom Argentina".
- Errores de tipeo, espacios, acentos o mayusculas del mismo nombre.

SON EMPRESAS DISTINTAS:
- Homonimos en industrias o paises que no se corresponden. Ejemplo critico: "Arcor" con website arcor.de e industria Telecommunications en Alemania es una TELCO ALEMANA, y NO es la alimenticia argentina "Grupo Arcor" (arcor.com, Food & Beverages). El nombre coincide por casualidad.
- Filial y casa matriz: "Accenture Argentina" es DISTINTA de "Accenture". La operacion por pais se mantiene separada.
- Mismo nombre en paises distintos: son operaciones distintas, salvo que todo lo demas (dominio, industria) indique que es un unico registro duplicado.
- Marca y franquiciado o licenciatario: son entidades legales distintas.

SENALES, DE MAS FUERTE A MAS DEBIL:
1. Dominio del website: dominios raiz distintos (arcor.de vs arcor.com) son fuerte indicio de empresas distintas.
2. Slug de LinkedIn: dos slugs distintos suelen ser dos entidades para LinkedIn, pero pueden ser duplicados legitimos de la misma empresa.
3. Industria: industrias incompatibles (Telecommunications vs Food & Beverages) indican empresas distintas.
4. Pais.

Ante la duda, es mas seguro NO unificar: poner el id en "different" y bajar la confianza.

Responde SOLO JSON valido, sin markdown ni backticks:
{"results":[{"group":"<group_key>","same":["<id>"],"different":["<id>"],"confidence":0.0,"reasoning":"<una oracion en espanol>"}]}

Reglas de salida:
- Incluye TODOS los ids de cada grupo, repartidos entre "same" y "different".
- "same" son los que son la misma empresa que el MASTER indicado.
- El master siempre va en "same".
- "confidence" entre 0 y 1: cuan seguro estas de esa separacion.`

/** Arma el bloque compacto de un grupo para el prompt. */
function renderGroup(c: DupCandidate, masterId: string): string {
  const lines = c.payload.map((p) => {
    const campos = [
      `id=${p.id}`,
      `nombre="${p.name}"`,
      p.id === masterId ? "MASTER" : null,
      p.country ? `pais=${p.country}` : null,
      p.industry ? `industria=${p.industry}` : null,
      p.website ? `web=${p.website}` : null,
      p.linkedin ? `linkedin=${p.linkedin}` : null,
      `datos=${p.jobs}v/${p.contacts}c/${p.news}n`,
    ].filter(Boolean)
    return `  - ${campos.join(" ")}`
  })
  return `grupo "${c.group_key}":\n${lines.join("\n")}`
}

function parseVerdicts(text: string): Verdict[] {
  // El modelo puede envolver el JSON en backticks a pesar de la instruccion.
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error("La IA no devolvio JSON")
  const parsed = JSON.parse(match[0])
  return Array.isArray(parsed?.results) ? parsed.results : []
}

/**
 * Clasifica un lote de grupos ambiguos y guarda el veredicto en la cache.
 * Devuelve el resumen de lo procesado y el costo estimado.
 */
export async function classifyAmbiguousDuplicates(options?: {
  batchSize?: number
  userId?: string | null
}): Promise<{
  processed: number
  same: number
  different: number
  unsure: number
  costUsd: number
}> {
  const batchSize = Math.min(Math.max(options?.batchSize ?? 20, 1), 40)
  const admin = createAdminClient()

  const { data: rows, error } = await admin
    .schema("v3")
    .from("company_dup_candidates")
    .select("id, group_key, company_ids, master_id, payload")
    .eq("classification", "ambiguo")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(batchSize)

  if (error) throw new Error(`No se pudieron leer los candidatos: ${error.message}`)
  if (!rows?.length) {
    return { processed: 0, same: 0, different: 0, unsure: 0, costUsd: 0 }
  }

  const candidates = rows as unknown as (DupCandidate & { master_id: string })[]

  const prompt = `${SYSTEM_RULES}

GRUPOS A RESOLVER:
${candidates.map((c) => renderGroup(c, c.master_id)).join("\n\n")}`

  const { text, usage } = await generateText({
    model: MODEL,
    prompt,
    temperature: 0,
    maxOutputTokens: 4096,
  })

  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0

  await logAiUsage({
    feature: "dedupe",
    model: MODEL,
    inputTokens,
    outputTokens,
    userId: options?.userId ?? null,
    metadata: { groups: candidates.length },
  })

  let verdicts: Verdict[] = []
  try {
    verdicts = parseVerdicts(text)
  } catch (e) {
    // Si el lote entero falla se marcan como 'failed' para no reintentar en
    // loop y no volver a pagar por lo mismo.
    const msg = e instanceof Error ? e.message : "Respuesta ilegible de la IA"
    await admin
      .schema("v3")
      .from("company_dup_candidates")
      .update({ status: "failed", error_message: msg, ai_checked_at: new Date().toISOString() })
      .in(
        "id",
        candidates.map((c) => c.id),
      )
    throw new Error(`La IA devolvio una respuesta ilegible: ${msg}`)
  }

  const byGroup = new Map(verdicts.map((v) => [v.group, v]))
  let same = 0
  let different = 0
  let unsure = 0

  for (const c of candidates) {
    const v = byGroup.get(c.group_key)

    if (!v) {
      await admin
        .schema("v3")
        .from("company_dup_candidates")
        .update({
          status: "ai_unsure",
          ai_reasoning: "La IA no devolvio veredicto para este grupo",
          ai_checked_at: new Date().toISOString(),
        })
        .eq("id", c.id)
      unsure++
      continue
    }

    // Solo se consideran los ids que realmente pertenecen al grupo: evita que
    // una alucinacion de id termine mergeando una empresa ajena.
    const validos = new Set(c.company_ids)
    const sameIds = (v.same ?? []).filter((id) => validos.has(id))

    // El master tiene que estar del lado 'same' para que haya algo que unificar.
    if (!sameIds.includes(c.master_id)) sameIds.push(c.master_id)

    const confidence = typeof v.confidence === "number" ? v.confidence : 0
    // Con 2+ ids del lado same hay merge para proponer; si no, quedan separadas.
    const hayMerge = sameIds.length >= 2
    const status = !hayMerge ? "ai_different" : confidence < 0.7 ? "ai_unsure" : "ai_same"

    if (status === "ai_same") same++
    else if (status === "ai_different") different++
    else unsure++

    await admin
      .schema("v3")
      .from("company_dup_candidates")
      .update({
        status,
        ai_confidence: confidence,
        ai_reasoning: v.reasoning ?? null,
        ai_checked_at: new Date().toISOString(),
        // Se deja en company_ids solo lo que la IA considera la misma empresa,
        // asi la aprobacion en bloque mergea exactamente eso.
        company_ids: hayMerge ? sameIds : c.company_ids,
      })
      .eq("id", c.id)
  }

  const { estimateCostUsd } = await import("@/lib/v3/usage")

  return {
    processed: candidates.length,
    same,
    different,
    unsure,
    costUsd: estimateCostUsd(MODEL, inputTokens, outputTokens),
  }
}
