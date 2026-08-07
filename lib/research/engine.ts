/**
 * Motor unificado de research: recolectar -> estructurar -> verificar.
 *
 * ── Por que existe ──
 * Habia CUATRO caminos que hacian lo mismo con codigo distinto
 * (`/api/research/news`, `/api/research/public-docs`, `lib/tech-radar.ts` y
 * `lib/v3/services/radar.ts`). Repetian las mismas etapas y, lo importante,
 * cada uno tenia su propia idea de que hacer cuando el modelo falla. Esa
 * divergencia es exactamente lo que dejo pasar 2 meses de noticias degradadas:
 * v2 acotaba la salida y parseaba JSON a mano, asi que un JSON truncado caia a
 * un fallback silencioso; v3 no acotaba y no fallaba. Mismo bug latente, dos
 * comportamientos, y arreglar uno no arreglaba el otro.
 *
 * ── Las tres decisiones de diseño ──
 *
 * 1. ESTRUCTURAR CON `generateObject` + Zod, no con `generateText` + JSON.parse.
 *    Esto no es cosmetico: ELIMINA LA CLASE DE BUG. Con parseo a mano, una
 *    respuesta truncada es un string invalido que alguien tiene que acordarse de
 *    manejar (y el manejo era "devolver algo degradado y seguir"). Con un schema,
 *    el SDK valida y LANZA: no existe el camino silencioso.
 *
 * 2. SIN `maxOutputTokens` por defecto. El tope de 4000 de v2 fue el gatillo del
 *    incidente: un modelo de razonamiento se comio el presupuesto "pensando" y
 *    corto el JSON a mitad. Si hace falta acotar, se pasa explicito y se asume.
 *
 * 3. SOLO URLs CITADAS. Se toma `sources` del proveedor, no las URLs que el
 *    modelo escribe en el texto. Es el patron anti-alucinacion que v3 ya tenia y
 *    que v2 no: evita publicar links inventados que parecen plausibles.
 *
 * Todas las etapas registran gasto en `v3.ai_usage_log` de forma incondicional,
 * porque el costo se paga aunque la etapa despues falle.
 */

import { anthropic } from "@ai-sdk/anthropic"
import { generateObject, generateText, NoObjectGeneratedError, Output, stepCountIs } from "ai"
import type { z } from "zod"

import { RESEARCH_MODEL, STRUCTURER_MODEL } from "@/lib/ai-models"
import { checkUrlsAlive, filterRelevantToCompany } from "@/lib/ai-structurer"
import { logAiUsage, type UsageFeature } from "@/lib/v3/usage"

/** Fuente efectivamente citada por el modelo. */
export type VerifiedSource = { url: string; title: string | null }

/** Atribucion de costo. Opcional: sin esto el gasto igual se registra. */
export type ResearchTracking = {
  workspaceId?: string | null
  userId?: string | null
  companyId?: string | null
  researchJobId?: string | null
  feature?: UsageFeature
  /**
   * Callback opcional que recibe el uso de CADA etapa apenas se conoce, en
   * paralelo al `logAiUsage` que ya persiste la fila. Existe para que un
   * orquestador (ej. el Tech Radar) pueda AGREGAR costo/tokens de varias
   * llamadas `collect`/`structure` en una sola corrida sin tener que releer
   * `ai_usage_log`. No reemplaza el logueo: es adicional y no debe lanzar.
   */
  onUsage?: (usage: { model: string; inputTokens: number; outputTokens: number }) => void
}

export type CollectResult = {
  text: string
  sources: VerifiedSource[]
  searchCount: number
}

/**
 * Etapa 1 — RECOLECTAR con busqueda web server-side.
 *
 * Reemplaza a Parallel, que no es enrutable por el AI Gateway (verificado
 * contra el catalogo: no figura entre los 34 providers, y usa su propio SDK).
 * Medido en `scripts/bench-search-providers.mts`: este camino trae mas URLs
 * vivas y mas dominios distintos que el baseline de Parallel.
 */
export async function collect({
  prompt,
  companyName,
  countryISO,
  maxSearches = 5,
  model = RESEARCH_MODEL,
  temperature = 0.3,
  context = "collect",
  tracking,
}: {
  prompt: string
  companyName: string
  /** ISO-2 para sesgar la busqueda a la region (ej. "AR"). */
  countryISO?: string | null
  maxSearches?: number
  model?: string
  temperature?: number
  context?: string
  tracking?: ResearchTracking
}): Promise<CollectResult> {
  const userLocation = countryISO
    ? ({ type: "approximate" as const, country: countryISO })
    : undefined

  const { text, usage, sources, steps } = await generateText({
    model,
    prompt,
    temperature,
    tools: {
      // Busqueda server-side de Anthropic: se ejecuta y cita en el proveedor,
      // atravesando el Gateway. El cast salva un desajuste de generics entre
      // versiones de @ai-sdk/*; el runtime es correcto.
      web_search: anthropic.tools.webSearch_20250305({
        maxUses: maxSearches,
        ...(userLocation ? { userLocation } : {}),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // Varias rondas de busqueda + la sintesis final.
    stopWhen: stepCountIs(maxSearches + 2),
  })

  // Solo las URLs REALMENTE citadas por el modelo, deduplicadas.
  //
  // Deliberadamente NO se parsean URLs del texto: un modelo escribe links
  // plausibles que no visito, y publicarlos es peor que no traer nada porque
  // el usuario no tiene forma de distinguirlos de los buenos.
  const seen = new Set<string>()
  const verified: VerifiedSource[] = []
  for (const s of sources ?? []) {
    if (s.sourceType !== "url" || !s.url || seen.has(s.url)) continue
    seen.add(s.url)
    verified.push({ url: s.url, title: s.title ?? null })
  }

  let searchCount = 0
  for (const step of steps ?? []) {
    for (const call of step.toolCalls ?? []) {
      if (call.toolName === "web_search") searchCount++
    }
  }

  // Callback de agregacion (no persiste; corre junto al logAiUsage de abajo).
  try {
    tracking?.onUsage?.({
      model,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    })
  } catch {
    /* el tracking no debe romper la recoleccion */
  }

  void logAiUsage({
    workspaceId: tracking?.workspaceId ?? null,
    userId: tracking?.userId ?? null,
    companyId: tracking?.companyId ?? null,
    researchJobId: tracking?.researchJobId ?? null,
    feature: tracking?.feature ?? "research-collect",
    model,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    metadata: {
      stage: "collect",
      context,
      company: companyName,
      web_searches: searchCount,
      sources: verified.length,
    },
  })

  console.log(
    `[v0][research][${context}] collect: ${searchCount} busquedas, ${verified.length} fuentes citadas, ${text.length} chars`
  )

  return { text, sources: verified, searchCount }
}

/**
 * Etapa 1+2 FUSIONADAS — buscar Y estructurar en UN SOLO turno.
 *
 * ── Por que existe (el bug que resuelve) ──
 * El patron collect()->structure() desacopla al modelo que ENCONTRO la evidencia
 * del que la ESTRUCTURA. `collect` devuelve un informe en prosa + una lista de
 * URLs citadas, pero la prosa ya perdio el anclaje "esta afirmacion sale de esta
 * URL". Cuando el structurer despues elige una fuente por indice, adivina: el
 * hallazgo bueno ("usa AWS, caso CloudHesive") termina apuntando a una fuente de
 * directorio generica, y el guardrail anti-contaminacion lo descarta. Resultado
 * medido en el Tech Radar: informe excelente -> 0 hallazgos.
 *
 * Aca el MISMO turno que corre web_search emite los hallazgos ya estructurados
 * con su `source_url` real (via `experimental_output`, que `generateObject` no
 * permite junto con tools). El modelo atribuye cada hallazgo a la URL que
 * efectivamente recupero: no hay indice que adivinar. Es el mismo principio que
 * ya usa Noticias, llevado a un unico paso.
 *
 * Devuelve `object: null` si el modelo no logra una salida valida; el gasto se
 * registra igual (los tokens se pagaron).
 */
export async function collectStructured<S extends z.ZodType>({
  schema,
  systemPrompt,
  prompt,
  companyName,
  countryISO,
  maxSearches = 5,
  model = RESEARCH_MODEL,
  temperature = 0.3,
  context = "collect-structured",
  tracking,
}: {
  schema: S
  systemPrompt: string
  prompt: string
  companyName: string
  /** ISO-2 para sesgar la busqueda a la region (ej. "AR"). */
  countryISO?: string | null
  maxSearches?: number
  model?: string
  temperature?: number
  context?: string
  tracking?: ResearchTracking
}): Promise<{ object: z.infer<S> | null; sources: VerifiedSource[]; searchCount: number }> {
  const userLocation = countryISO
    ? ({ type: "approximate" as const, country: countryISO })
    : undefined

  let object: z.infer<S> | null = null
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  let sources: { sourceType?: string; url?: string; title?: string | null }[] = []
  let steps: { toolCalls?: { toolName?: string }[] }[] = []

  try {
    const res = await generateText({
      model,
      system: systemPrompt,
      prompt,
      temperature,
      tools: {
        // Mismo web_search server-side de Anthropic que `collect`: se ejecuta y
        // cita en el proveedor, atravesando el Gateway.
        web_search: anthropic.tools.webSearch_20250305({
          maxUses: maxSearches,
          ...(userLocation ? { userLocation } : {}),
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // Rondas de busqueda + el turno final que produce el objeto.
      stopWhen: stepCountIs(maxSearches + 2),
      // La salida estructurada del turno final. `generateObject` NO admite tools,
      // por eso va por aca: es la unica forma de fusionar busqueda + schema.
      experimental_output: Output.object({ schema }),
    })
    object = res.experimental_output as z.infer<S>
    usage = res.usage
    sources = (res.sources as typeof sources) ?? []
    steps = (res.steps as typeof steps) ?? []
  } catch (err) {
    // Con experimental_output, una salida invalida lanza. No es silencioso: se
    // loguea, se devuelve object=null y el caller decide (tipicamente, 0 hallazgos
    // de ese bundle sin voltear toda la corrida).
    console.error(`[v0][research][${context}] collectStructured error:`, err)
    if (NoObjectGeneratedError.isInstance(err)) {
      usage = err.usage
    }
  }

  // Solo las URLs REALMENTE citadas por el modelo, deduplicadas (mismo criterio
  // anti-alucinacion que collect: no se parsean URLs del texto).
  const seen = new Set<string>()
  const verified: VerifiedSource[] = []
  for (const s of sources) {
    if (s.sourceType !== "url" || !s.url || seen.has(s.url)) continue
    seen.add(s.url)
    verified.push({ url: s.url, title: s.title ?? null })
  }

  let searchCount = 0
  for (const step of steps) {
    for (const call of step.toolCalls ?? []) {
      if (call.toolName === "web_search") searchCount++
    }
  }

  try {
    tracking?.onUsage?.({
      model,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    })
  } catch {
    /* el tracking no debe romper la recoleccion */
  }

  void logAiUsage({
    workspaceId: tracking?.workspaceId ?? null,
    userId: tracking?.userId ?? null,
    companyId: tracking?.companyId ?? null,
    researchJobId: tracking?.researchJobId ?? null,
    feature: tracking?.feature ?? "research-collect",
    model,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    metadata: {
      stage: "collect-structured",
      context,
      company: companyName,
      web_searches: searchCount,
      sources: verified.length,
    },
  })

  console.log(
    `[v0][research][${context}] collectStructured: ${searchCount} busquedas, ${verified.length} fuentes citadas, object=${object ? "ok" : "null"}`
  )

  return { object, sources: verified, searchCount }
}

/**
 * Etapa 2 — ESTRUCTURAR texto libre a un objeto validado por schema.
 *
 * Esta es la etapa que elimina el bug de los 2 meses. Comparar con el patron
 * viejo de `structureWithLLM`:
 *
 *   viejo: generateText -> stripMarkdownFences -> JSON.parse -> try/catch ->
 *          fallback degradado en silencio
 *   nuevo: generateObject(schema) -> objeto tipado, o LANZA
 *
 * `NoObjectGeneratedError` se re-lanza con contexto util (que modelo, que causa,
 * cuanto texto se le paso) en vez de degradarse, porque un informe vacio que
 * nadie mira es peor que un error que alguien ve.
 */
export async function structure<S extends z.ZodType>({
  schema,
  systemPrompt,
  userPrompt,
  model = STRUCTURER_MODEL,
  temperature = 0.2,
  maxOutputTokens,
  context = "structure",
  tracking,
}: {
  schema: S
  systemPrompt: string
  userPrompt: string
  model?: string
  temperature?: number
  /**
   * Sin tope por defecto A PROPOSITO. El tope de 4000 de v2 fue el gatillo del
   * incidente: el modelo gasto el presupuesto razonando y el JSON salio cortado.
   * Pasarlo es opt-in y hay que asumir el riesgo.
   */
  maxOutputTokens?: number
  context?: string
  tracking?: ResearchTracking
}): Promise<z.infer<S>> {
  try {
    const { object, usage } = await generateObject({
      model,
      schema,
      system: systemPrompt,
      prompt: userPrompt,
      temperature,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
    })

    // Callback de agregacion (no persiste; corre junto al logAiUsage de abajo).
    try {
      tracking?.onUsage?.({
        model,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
      })
    } catch {
      /* el tracking no debe romper la estructuracion */
    }

    // Se loguea apenas vuelve el modelo: estos tokens ya se pagaron, pase lo
    // que pase despues con la validacion.
    void logAiUsage({
      workspaceId: tracking?.workspaceId ?? null,
      userId: tracking?.userId ?? null,
      companyId: tracking?.companyId ?? null,
      researchJobId: tracking?.researchJobId ?? null,
      feature: tracking?.feature ?? "research-structure",
      model,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      metadata: { stage: "structure", context, source: "research-engine" },
    })

    return object as z.infer<S>
  } catch (err) {
    // El SDK expone el texto crudo y el usage incluso cuando la validacion
    // falla, asi que se aprovecha para (a) no perder el costo de la llamada
    // fallida y (b) dejar en el log QUE devolvio el modelo.
    if (NoObjectGeneratedError.isInstance(err)) {
      try {
        tracking?.onUsage?.({
          model,
          inputTokens: err.usage?.inputTokens ?? 0,
          outputTokens: err.usage?.outputTokens ?? 0,
        })
      } catch {
        /* el tracking no debe romper el manejo de error */
      }
      void logAiUsage({
        workspaceId: tracking?.workspaceId ?? null,
        userId: tracking?.userId ?? null,
        companyId: tracking?.companyId ?? null,
        researchJobId: tracking?.researchJobId ?? null,
        feature: tracking?.feature ?? "research-structure",
        model,
        inputTokens: err.usage?.inputTokens ?? 0,
        outputTokens: err.usage?.outputTokens ?? 0,
        metadata: {
          stage: "structure",
          context,
          source: "research-engine",
          failed: true,
          finishReason: err.finishReason ?? null,
        },
      })

      const cortado = err.finishReason === "length"
      console.error(
        `[v0][research][${context}] structure FALLO (finishReason=${err.finishReason}). ` +
          `Texto crudo (400): ${String(err.text ?? "").slice(0, 400)}`
      )
      throw new Error(
        `[research-engine][${context}] El modelo "${model}" no produjo un objeto valido ` +
          `(finishReason=${err.finishReason}).` +
          (cortado
            ? ` La salida se CORTO por limite de tokens: subir o quitar maxOutputTokens.`
            : ` Revisar que el schema coincida con lo que pide el prompt.`)
      )
    }
    throw err
  }
}

/**
 * Etapa 3 — VERIFICAR: descarta lo irrelevante y lo que apunta a URLs muertas.
 *
 * Reusa los helpers de `lib/ai-structurer.ts` en vez de reimplementarlos: ahi
 * vive el detalle de por que un timeout NO descarta una fuente (solo un fallo
 * de DNS o un 404/410 lo hacen) y el bug de `err.cause.code` de undici.
 */
export async function verify<T extends Record<string, any>>({
  items,
  companyName,
  textFields,
  urlField,
  context = "verify",
}: {
  items: T[]
  companyName: string
  /** Campos donde buscar el nombre de la empresa. */
  textFields: (keyof T)[]
  /** Campo con la URL a chequear. Si se omite, no se chequea liveness. */
  urlField?: keyof T
  context?: string
}): Promise<{ items: T[]; descartadosPorRelevancia: number; descartadosPorUrl: number }> {
  const total = items.length

  const relevantes = filterRelevantToCompany(items, companyName, textFields)
  const descartadosPorRelevancia = total - relevantes.length

  if (!urlField) {
    if (descartadosPorRelevancia > 0) {
      console.log(
        `[v0][research][${context}] verify: -${descartadosPorRelevancia} por relevancia, ${relevantes.length} quedan`
      )
    }
    return { items: relevantes, descartadosPorRelevancia, descartadosPorUrl: 0 }
  }

  const urls = relevantes.map((i) => String(i[urlField] ?? "")).filter(Boolean)
  const vivas = await checkUrlsAlive(urls, { context })
  const finales = relevantes.filter((i) => vivas.has(String(i[urlField] ?? "")))
  const descartadosPorUrl = relevantes.length - finales.length

  console.log(
    `[v0][research][${context}] verify: ${total} -> ${finales.length} ` +
      `(-${descartadosPorRelevancia} relevancia, -${descartadosPorUrl} URL muerta)`
  )

  return { items: finales, descartadosPorRelevancia, descartadosPorUrl }
}

/**
 * Orquesta las tres etapas. Es azucar: los caminos que necesiten control fino
 * (por ejemplo cachear entre recolectar y estructurar) pueden llamar a las
 * etapas por separado.
 */
export async function runResearch<S extends z.ZodType, T extends Record<string, any>>({
  companyName,
  countryISO,
  collectPrompt,
  schema,
  systemPrompt,
  buildUserPrompt,
  pickItems,
  textFields,
  urlField,
  maxSearches,
  context = "research",
  tracking,
}: {
  companyName: string
  countryISO?: string | null
  collectPrompt: string
  schema: S
  systemPrompt: string
  /** Arma el prompt de estructuracion con el texto y las fuentes recolectadas. */
  buildUserPrompt: (collected: CollectResult) => string
  /** Extrae del objeto validado la lista de items a verificar. */
  pickItems: (obj: z.infer<S>) => T[]
  textFields: (keyof T)[]
  urlField?: keyof T
  maxSearches?: number
  context?: string
  tracking?: ResearchTracking
}): Promise<{ collected: CollectResult; structured: z.infer<S> | null; items: T[] }> {
  const collected = await collect({
    prompt: collectPrompt,
    companyName,
    countryISO,
    maxSearches,
    context,
    tracking,
  })

  // Cortar temprano si no hay con que estructurar: llamar al structurer con
  // texto vacio gasta tokens para que el schema falle igual.
  //
  // `structured` viaja como null y NO como `schema.parse({})`: inventar un
  // objeto vacio para cumplir el tipo lanzaria en cualquier schema con campos
  // requeridos, y ademas le mentiria al llamador diciendo "esto lo produjo el
  // modelo". null es explicito y obliga a manejar el caso.
  if (!collected.text.trim() || collected.sources.length === 0) {
    console.log(
      `[v0][research][${context}] collect no trajo nada util (${collected.sources.length} fuentes); se saltea structure`
    )
    return { collected, structured: null, items: [] }
  }

  const structured = await structure({
    schema,
    systemPrompt,
    userPrompt: buildUserPrompt(collected),
    context,
    tracking,
  })

  const { items } = await verify({
    items: pickItems(structured),
    companyName,
    textFields,
    urlField,
    context,
  })

  return { collected, structured, items }
}
