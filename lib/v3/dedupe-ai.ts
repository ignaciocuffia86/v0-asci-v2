import { generateObject, NoObjectGeneratedError } from "ai"
import { z } from 'zod/v3';
import { createAdminClient } from "@/lib/supabase/admin"
import { logAiUsage, estimateCostUsd } from "@/lib/v3/usage"

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
 * 5. La IA responde con INDICES CORTOS, no con UUIDs (ver abajo).
 *
 * La IA NUNCA ejecuta un merge: solo escribe su veredicto en la tabla cache.
 * Quien mergea es el server action, y siempre a traves de merge_companies.
 *
 * ── Por que indices y no UUIDs ────────────────────────────────────────────
 * Originalmente se le pedia al modelo que devolviera los UUIDs repartidos entre
 * "same" y "different". Un UUID cuesta ~20 tokens de salida, asi que un lote de
 * 20 grupos gastaba ~1000 tokens SOLO en repetir ids, mas el reasoning de cada
 * grupo. Con `maxOutputTokens: 4096` la respuesta se cortaba a mitad del array,
 * `JSON.parse` explotaba y el lote entero se perdia con el error "La IA devolvio
 * una respuesta ilegible" (confirmado en v3.ai_usage_log: output_tokens = 4096,
 * exactamente el techo).
 *
 * Ahora cada registro se numera y el modelo devuelve numeros. Ademas de recortar
 * la salida ~10x, hace imposible que aluciné un UUID que no estaba en el lote:
 * un indice invalido simplemente no existe en el mapa y se descarta.
 */

const MODEL = "google/gemini-2.5-flash-lite"

/**
 * Techo de salida. Con indices el costo real por grupo es de ~40 tokens, asi que
 * 40 grupos (el batch maximo) entran en ~1600. 8192 deja margen de sobra sin ser
 * un numero arbitrario que vuelva a cortar en silencio.
 */
const MAX_OUTPUT_TOKENS = 8192

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

/**
 * Veredicto por grupo, en indices.
 * `.passthrough()` no hace falta: lo que sobra se ignora.
 */
const verdictSchema = z.object({
  /** Numero de grupo (el `g` del prompt). */
  g: z.number().int(),
  /** Indices que SI son la misma empresa que el master. */
  same: z.array(z.number().int()),
  /** Indices que son empresas distintas y deben quedar separadas. */
  different: z.array(z.number().int()),
  confidence: z.number(),
  reasoningText: z.string(),
})

const resultsSchema = z.object({
  results: z.array(verdictSchema),
})

type Verdict = z.infer<typeof verdictSchema>

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

Ante la duda, es mas seguro NO unificar: poner el numero en "different" y bajar la confianza.

FORMATO DE SALIDA
Cada registro tiene un numero corto (#N). Responde SIEMPRE con esos NUMEROS, nunca con ids largos ni con nombres.
- "g": el numero de grupo.
- "same": numeros que son la misma empresa que el registro marcado MASTER. El MASTER siempre va incluido aca.
- "different": numeros del grupo que son otra empresa.
- Entre "same" y "different" tienen que estar TODOS los numeros del grupo, sin repetir.
- "confidence": entre 0 y 1, cuan seguro estas de esa separacion.
- "reasoning": UNA sola oracion corta en espanol (maximo 15 palabras).
- Un objeto por grupo, en el mismo orden en que aparecen.`

/**
 * Arma el bloque compacto del lote y devuelve el mapa indice -> uuid.
 *
 * La numeracion es GLOBAL y unica en todo el lote (no se reinicia por grupo):
 * asi un numero identifica un solo registro sin ambiguedad, y si el modelo mete
 * un numero de otro grupo se detecta al validar contra los del grupo.
 */
function renderBatch(candidates: (DupCandidate & { master_id: string })[]): {
  prompt: string
  /** indice global -> uuid de empresa */
  indexToId: Map<number, string>
  /** numero de grupo -> candidato */
  groupToCandidate: Map<number, DupCandidate & { master_id: string }>
  /** numero de grupo -> indices que le pertenecen */
  groupToIndexes: Map<number, Set<number>>
} {
  const indexToId = new Map<number, string>()
  const groupToCandidate = new Map<number, DupCandidate & { master_id: string }>()
  const groupToIndexes = new Map<number, Set<number>>()

  let n = 0
  const bloques: string[] = []

  candidates.forEach((c, gi) => {
    const g = gi + 1
    groupToCandidate.set(g, c)
    const propios = new Set<number>()

    const lines = c.payload.map((p) => {
      n += 1
      indexToId.set(n, p.id)
      propios.add(n)

      const campos = [
        `#${n}`,
        `nombre="${p.name}"`,
        p.id === c.master_id ? "MASTER" : null,
        p.country ? `pais=${p.country}` : null,
        p.industry ? `industria=${p.industry}` : null,
        p.website ? `web=${p.website}` : null,
        p.linkedin ? `linkedin=${p.linkedin}` : null,
        `datos=${p.jobs}v/${p.contacts}c/${p.news}n`,
      ].filter(Boolean)
      return `  - ${campos.join(" ")}`
    })

    groupToIndexes.set(g, propios)
    bloques.push(`g=${g} "${c.group_key}":\n${lines.join("\n")}`)
  })

  return {
    prompt: `${SYSTEM_RULES}

GRUPOS A RESOLVER:
${bloques.join("\n\n")}`,
    indexToId,
    groupToCandidate,
    groupToIndexes,
  }
}

/**
 * Rescata los veredictos COMPLETOS de una respuesta cortada a la mitad.
 *
 * Cuando el modelo se queda sin tokens, el JSON queda invalido y `generateObject`
 * tira NoObjectGeneratedError, pero el texto parcial suele traer varios grupos ya
 * resueltos enteros. Tirarlos seria pagar dos veces por el mismo trabajo.
 *
 * Escanea `{...}` de primer nivel dentro de "results" llevando la cuenta de
 * llaves, respetando strings y escapes (una llave dentro de un reasoning no
 * cuenta). El ultimo objeto, si quedo cortado, no cierra y se descarta.
 */
export function salvageVerdicts(text: string | undefined): Verdict[] {
  if (!text) return []

  const start = text.indexOf('"results"')
  if (start === -1) return []

  const abre = text.indexOf("[", start)
  if (abre === -1) return []

  const out: Verdict[] = []
  let depth = 0
  let objStart = -1
  let inString = false
  let escaped = false

  for (let i = abre + 1; i < text.length; i++) {
    const ch = text[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (ch === "\\") {
      if (inString) escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === "{") {
      if (depth === 0) objStart = i
      depth++
    } else if (ch === "}") {
      depth--
      if (depth === 0 && objStart !== -1) {
        const parsed = verdictSchema.safeParse(safeJson(text.slice(objStart, i + 1)))
        if (parsed.success) out.push(parsed.data)
        objStart = -1
      }
    } else if (ch === "]" && depth === 0) {
      break
    }
  }

  return out
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
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
  /** Grupos que quedaron sin resolver por un problema transitorio (reintentables). */
  retriable: number
  truncated: boolean
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
    return { processed: 0, same: 0, different: 0, unsure: 0, retriable: 0, truncated: false, costUsd: 0 }
  }

  const candidates = rows as unknown as (DupCandidate & { master_id: string })[]
  const { prompt, indexToId, groupToCandidate, groupToIndexes } = renderBatch(candidates)

  let verdicts: Verdict[] = []
  let inputTokens = 0
  let outputTokens = 0
  let truncated = false

  try {
    const { object, usage } = await generateObject({
      model: MODEL,
      schema: resultsSchema,
      prompt,
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    })
    verdicts = object.results
    inputTokens = usage?.inputTokens ?? 0
    outputTokens = usage?.outputTokens ?? 0
  } catch (e) {
    if (!NoObjectGeneratedError.isInstance(e)) throw e

    // El costo se registra igual: el modelo genero tokens y hay que pagarlos,
    // haya servido o no la respuesta.
    inputTokens = e.usage?.inputTokens ?? 0
    outputTokens = e.usage?.outputTokens ?? 0

    // finishReason 'length' = se quedo sin tokens. Es un problema de
    // configuracion nuestro, no un dato malo, y por eso los grupos que queden
    // sin resolver vuelven a 'pending' en vez de 'failed'.
    truncated = e.finishReason === "length"
    verdicts = salvageVerdicts(e.text)

    if (verdicts.length === 0) {
      await logAiUsage({
        feature: "dedupe",
        model: MODEL,
        inputTokens,
        outputTokens,
        userId: options?.userId ?? null,
        metadata: { groups: candidates.length, error: "sin_veredictos", finishReason: e.finishReason },
        // `workspaceId` va NULL a propósito: el dedupe corre sobre la tabla compartida de
        // empresas, no sobre datos de un tenant, así que es costo de plataforma y no se
        // imputa a ningún cliente. No es el bug de atribución que sí tenían radar/jobs.
        generationMode: "server_managed",
      })

      const detalle = truncated
        ? `la respuesta se corto por limite de tokens (${outputTokens})`
        : (e.message ?? "respuesta ilegible")

      // Truncado => transitorio: se dejan en 'pending' con el motivo anotado,
      // asi un techo mal puesto no entierra candidatos para siempre.
      // Cualquier otra cosa => el modelo devolvio algo que no sirve: 'failed'.
      await admin
        .schema("v3")
        .from("company_dup_candidates")
        .update({
          status: truncated ? "pending" : "failed",
          error_message: detalle,
          ai_checked_at: new Date().toISOString(),
        })
        .in(
          "id",
          candidates.map((c) => c.id),
        )

      throw new Error(
        truncated
          ? `La IA no alcanzo a responder: ${detalle}. Los grupos quedaron pendientes; reintenta con un lote mas chico.`
          : `La IA devolvio una respuesta ilegible: ${detalle}`,
      )
    }
  }

  await logAiUsage({
    feature: "dedupe",
    model: MODEL,
    inputTokens,
    outputTokens,
    userId: options?.userId ?? null,
    metadata: {
      groups: candidates.length,
      verdicts: verdicts.length,
      ...(truncated ? { truncated: true, rescatados: verdicts.length } : {}),
    },
    // `workspaceId` NULL a propósito: costo de plataforma, no de un tenant. Ver nota arriba.
    generationMode: "server_managed",
  })

  const byGroup = new Map(verdicts.map((v) => [v.g, v]))
  let same = 0
  let different = 0
  let unsure = 0
  let retriable = 0
  const ahora = new Date().toISOString()

  for (const [g, c] of groupToCandidate) {
    const v = byGroup.get(g)

    if (!v) {
      if (truncated) {
        // Se corto antes de llegar a este grupo. No se evaluo nunca, asi que
        // vuelve a la cola en lugar de quedar marcado como decidido.
        await admin
          .schema("v3")
          .from("company_dup_candidates")
          .update({
            status: "pending",
            error_message: "el lote se corto por limite de tokens antes de llegar a este grupo",
          })
          .eq("id", c.id)
        retriable++
      } else {
        // La respuesta vino completa y el modelo igual salteo el grupo: eso es
        // una decision suya, no un problema tecnico.
        await admin
          .schema("v3")
          .from("company_dup_candidates")
          .update({
            status: "ai_unsure",
            ai_reasoning: "La IA no devolvio veredicto para este grupo",
            ai_checked_at: ahora,
          })
          .eq("id", c.id)
        unsure++
      }
      continue
    }

    // Solo se aceptan indices que pertenecen a ESTE grupo: evita que un numero
    // inventado, o el de otro grupo del lote, termine mergeando una empresa
    // ajena. Es el mismo guardrail que antes filtraba UUIDs alucinados.
    const propios = groupToIndexes.get(g) ?? new Set<number>()
    const sameIds: string[] = []
    for (const idx of v.same ?? []) {
      if (!propios.has(idx)) continue
      const uuid = indexToId.get(idx)
      if (uuid && !sameIds.includes(uuid)) sameIds.push(uuid)
    }

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
        ai_reasoning: v.reasoningText?.slice(0, 500) ?? null,
        ai_checked_at: ahora,
        error_message: null,
        // Se deja en company_ids solo lo que la IA considera la misma empresa,
        // asi la aprobacion en bloque mergea exactamente eso.
        company_ids: hayMerge ? sameIds : c.company_ids,
      })
      .eq("id", c.id)
  }

  return {
    processed: candidates.length - retriable,
    same,
    different,
    unsure,
    retriable,
    truncated,
    costUsd: estimateCostUsd(MODEL, inputTokens, outputTokens),
  }
}
