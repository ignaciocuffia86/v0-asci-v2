import { generateText } from "ai"
import { logAiUsage, type UsageFeature } from "@/lib/v3/usage"

/**
 * Generate content using Vercel AI Gateway
 * Uses google/gemini-2.5-flash-lite by default - cheapest option with good quality
 * 
 * Pricing (per million tokens):
 * - gemini-2.5-flash-lite: $0.075 input / $0.30 output (cheapest)
 * - gemini-2.0-flash: $0.15 / $0.60
 * - gpt-4o-mini: $0.15 / $0.60
 */
export async function generateContent(
  prompt: string,
  options?: {
    model?: string
    temperature?: number
    maxOutputTokens?: number
    /**
     * Atribución del costo. Sin esto la llamada igual queda registrada (como
     * 'other', sin workspace), porque el objetivo es que ningún gasto de IA
     * quede fuera de `v3.ai_usage_log`.
     */
    tracking?: {
      feature?: UsageFeature
      workspaceId?: string | null
      userId?: string | null
      companyId?: string | null
      metadata?: Record<string, unknown>
    }
  }
): Promise<string> {
  const model = options?.model || "google/gemini-2.5-flash-lite"
  
  try {
    const { text, usage } = await generateText({
      model,
      prompt,
      temperature: options?.temperature ?? 0.2,
      maxOutputTokens: options?.maxOutputTokens ?? 4096,
    })

    // Este wrapper no registraba nada, así que todo lo que pasa por acá
    // (análisis de documentos, que manda hasta 30.000 caracteres por doc) era
    // gasto invisible. Fire-and-forget: `logAiUsage` nunca lanza y no queremos
    // sumarle latencia a la respuesta.
    void logAiUsage({
      workspaceId: options?.tracking?.workspaceId ?? null,
      userId: options?.tracking?.userId ?? null,
      companyId: options?.tracking?.companyId ?? null,
      feature: options?.tracking?.feature ?? "other",
      model,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      metadata: { source: "generateContent", ...(options?.tracking?.metadata ?? {}) },
    })

    return text
  } catch (err: any) {
    console.error(`[v3] AI Gateway error (${model}):`, err.message)
    throw new Error(`AI generation failed: ${err.message}`)
  }
}

/**
 * Analyze document text to extract value proposition, KPIs, and tags
 * Returns structured JSON with summary, key_results, and matched tags
 */
export async function analyzeDocumentV3(
  extractedText: string,
  dictionaries: {
    technologies: { id: string; name: string }[]
    processes: { id: string; name: string }[]
    industries: { id: string; name: string }[]
    // Curated alias -> master_industry_id rules (same source of truth as companies).
    // original_value is the raw industry text (e.g. "Software Development"), master_industry_id is the slug.
    industryMappings?: { original_value: string; master_industry_id: string }[]
  }
): Promise<{
  document_type: "CASO_DE_EXITO" | "BROCHURE" | "OTRO"
  summary: string
  key_results: string[]
  insights: string[]
  persona: {
    name: string
    type: "buyer" | "user"
    description: string
    pains: string[]
    goals: string[]
    target_company_profile: {
      industries: string[]
      processes: string[]
      signals: string[]
    }
  } | null
  recommended_job_titles: string[]
  tags: {
    type: "industry" | "technology" | "process"
    value: string
    reference_id: string | null
    confidence: number
  }[]
}> {
  const productList = dictionaries.technologies.map(p => p.name).join(", ")
  const processList = dictionaries.processes.map(p => p.name).join(", ")
  const industryList = dictionaries.industries.map(i => i.name).join(", ")

  const prompt = `Analiza el siguiente texto de un documento comercial de una empresa de tecnologia / servicios / consultoria.

TEXTO DEL DOCUMENTO:
---
${extractedText.slice(0, 30000)}
---

DICCIONARIO DE TECNOLOGIAS DISPONIBLES (usa EXACTAMENTE estos nombres):
${productList}

DICCIONARIO DE PROCESOS DE NEGOCIO DISPONIBLES (usa EXACTAMENTE estos nombres):
${processList}

TAXONOMIA CERRADA DE INDUSTRIAS (usa EXACTAMENTE y SOLO estos nombres, nunca inventes otros):
${industryList}

PRIMERO: Determina el TIPO de documento. Puede ser:
- CASO DE EXITO: describe un proyecto realizado para un cliente especifico
- BROCHURE/PROPUESTA: describe servicios o capacidades generales del vendor
- OTRO: cualquier otro tipo

Responde en formato JSON estricto (sin markdown, sin backticks):
{
  "document_type": "CASO_DE_EXITO" | "BROCHURE" | "OTRO",
  "summary": "Ver instrucciones segun tipo de documento abajo",
  "key_results": ["Resultado concreto 1", "Resultado concreto 2"],
  "insights": ["Aprendizaje o contexto cualitativo 1", "Insight 2"],
  "persona": {
    "name": "Titulo corto del perfil objetivo, ej: 'Director Financiero en empresas de Retail'",
    "type": "buyer" | "user",
    "description": "1-2 oraciones describiendo el perfil de persona a prospectar EN OTRAS COMPANIAS similares",
    "pains": ["Dolor o problema concreto 1", "Dolor 2"],
    "goals": ["Objetivo o meta 1", "Objetivo 2"],
    "target_company_profile": {
      "industries": ["Industria/vertical objetivo 1", "Industria 2"],
      "processes": ["Proceso de negocio relevante 1", "Proceso 2"],
      "signals": ["Senal o caracteristica que indica buen fit, ej: 'opera multiples plantas', 'alto volumen de SKUs'"]
    }
  },
  "recommended_job_titles": ["CFO", "Head of Supply Chain", "VP Finance"],
  "industries": [
    {"name": "nombre EXACTO de la lista de industrias", "confidence": 0.9}
  ],
  "technologies": [
    {"name": "nombre EXACTO del diccionario de tecnologias", "confidence": 0.85}
  ],
  "processes": [
    {"name": "nombre EXACTO del diccionario de procesos", "confidence": 0.8}
  ]
}

=== CONCEPTO CLAVE: PARA QUE SIRVE ESTE DOCUMENTO ===
Este documento es EVIDENCIA de lo que el vendor sabe hacer. Lo vamos a usar para PROSPECTAR EN FRIO a tomadores de decision de OTRAS COMPANIAS (no la del documento).
Si es un CASO DE EXITO de una empresa-cliente (ej: ARCOR), la empresa-cliente es solo la PRUEBA/REFERENCIA. El perfil objetivo NO es gente de ARCOR: es gente PARECIDA a los decisores/usuarios de ARCOR pero en OTRAS companias de la misma vertical o con el mismo proceso de negocio.
Usa los procesos e industrias mapeados del diccionario como indicio fuerte de a quien apuntar.

=== INSTRUCCIONES PARA PERSONA, TARGET_COMPANY_PROFILE Y RECOMMENDED_JOB_TITLES ===
Define el PERFIL DE CLIENTE IDEAL (ICP) a prospectar en OTRAS companias, derivado de lo que muestra este documento.
- "type": usa "buyer" si el perfil es quien DECIDE/COMPRA (ejecutivo, decisor presupuestario); usa "user" si es quien USA la solucion en el dia a dia.
- "name": titulo corto del perfil, expresado de forma GENERICA y aplicable a multiples companias (ej: "Director de Supply Chain en manufactura de consumo masivo"). NUNCA uses el nombre de la empresa del documento.
- "description": a quien prospectar en otras companias, en 1-2 oraciones. NUNCA nombres a la empresa del caso como objetivo.
- "pains": entre 1 y 4 dolores/problemas que este perfil suele tener (los mismos que el documento muestra resueltos).
- "goals": entre 1 y 4 objetivos de ese perfil.
- "target_company_profile": describe QUE TIPO DE COMPANIA prospectar:
    - "industries": verticales/industrias objetivo. Usa EXACTAMENTE los nombres de la TAXONOMIA CERRADA DE INDUSTRIAS de arriba (nunca inventes otros).
    - "processes": procesos de negocio relevantes (usa preferentemente los del diccionario mapeado).
    - "signals": senales o caracteristicas observables que indican buen fit (tamano, complejidad operativa, etc).
- "recommended_job_titles": entre 2 y 8 CARGOS REALES a buscar EN OTRAS companias del ICP. Usa titulos estandar de mercado (ej: "CFO", "VP of Engineering", "Head of Supply Chain"). NUNCA personas especificas ni la empresa del caso.
Si el documento no permite inferir un ICP con confianza, devuelve "persona": null y "recommended_job_titles": [].

=== INSTRUCCIONES PARA KEY_RESULTS (cuantitativos) ===
Extrae entre 0 y 5 resultados CONCRETOS y CUANTIFICABLES del documento.
SOLO incluye datos que sean medibles: porcentajes, tiempos, cantidades, montos, ratios.
NO incluyas beneficios genericos como "mayor eficiencia" o "mejor rendimiento".
Si el documento no tiene datos cuantificables (ej: brochure generico), devuelve array vacio [].
Ejemplos validos: "Reduccion del 60% en tiempo de gestion", "Migracion de 100+ activos", "Ahorro de $2M anuales"
Ejemplos INVALIDOS: "Mayor eficiencia operativa", "Mejor experiencia de usuario"

=== INSTRUCCIONES PARA INSIGHTS (cualitativos) ===
Extrae entre 0 y 5 aprendizajes o piezas de CONTEXTO CUALITATIVO utiles para personalizar un mensaje de cold outreach a un perfil similar.
A diferencia de key_results (metricas duras), los insights son cualitativos: por que el cliente eligio esta solucion, que desafio de negocio enfrentaba, como se resolvio, que cambio en su operacion, que objeciones se superaron.
Ejemplos validos: "El cliente necesitaba unificar datos de 12 plantas que operaban en silos", "La adopcion se logro con un piloto de 90 dias antes del rollout completo", "El principal driver fue cumplir una nueva regulacion del sector".
Si no hay contexto cualitativo util, devuelve array vacio [].

=== INSTRUCCIONES PARA EL SUMMARY SEGUN TIPO ===

SI ES CASO DE EXITO, el summary DEBE incluir en 3-5 oraciones:
1. QUIEN fue el cliente (nombre y breve descripcion)
2. QUE industria tiene el cliente
3. CUAL era el problema o necesidad del cliente
4. QUE solucion se implemento (tecnologias, procesos, metodologia)
5. QUE resultados concretos se obtuvieron (metricas, porcentajes, mejoras cuantificables)

SI ES BROCHURE/PROPUESTA, el summary debe describir en 2-4 oraciones:
1. Que ofrece/vende la empresa
2. En que industrias o verticales se especializa
3. Que tecnologias o capacidades principales tiene

=== REGLAS CRITICAS PARA TAGS ===

CONTEXTO: Todos los usuarios son empresas de tecnologia. Por definicion, TODOS sus documentos involucran tecnologia e innovacion.

TAGS PROHIBIDOS - NUNCA los incluyas:
"Innovacion Tecnologica", "Transformacion Digital", "Eficiencia Operativa", "Mejora Continua", 
"Gestion del Cambio", "Estrategia Digital", "Adopcion Tecnologica", "Sostenibilidad", "Optimizacion de Procesos"

EN CAMBIO, busca tags que respondan: "¿para QUE CASO DE NEGOCIO ESPECIFICO sirve?"
- ¿Que problema de negocio concreto resuelve? ��� Ej: "Prediccion de Demanda", "Deteccion de Fraude", "Cierre Financiero"
- ¿En que industria especifica tiene impacto? → Ej: "Retail", "Banking", "Manufacturing"
- ¿Que tecnologia puntual implementa? → Ej: SAP ERP, Salesforce, AWS (nunca "tecnologia en general")
- ¿Que proceso de negocio especifico automatiza? → Ej: "Planificacion de Inventario", "Conciliacion Bancaria"

LIMITE: maximo 3 technologies y maximo 4 processes. Prioriza los mas especificos.

REGLAS:
- Para technologies: SOLO nombres que existan TEXTUALMENTE en el DICCIONARIO.
- Para processes: misma logica, SOLO nombres del diccionario.
- Para industries: SOLO nombres de la lista. En casos de exito, usa la industria del CLIENTE.
- Confidence: 0.9-1.0 = tema central. 0.7-0.89 = tema secundario. Menos de 0.7 = no incluyas.
- El summary debe ser en espanol.`

  const responseText = await generateContent(prompt, {
    temperature: 0.2,
    tracking: {
      feature: "doc-analysis",
      metadata: { chars_enviados: Math.min(extractedText.length, 30000) },
    },
  })

  // Parse JSON response
  let parsed: any
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("No JSON found in response")
    parsed = JSON.parse(jsonMatch[0])
  } catch (err) {
    console.error("[v3] Failed to parse AI analysis response:", responseText.slice(0, 500))
    return { document_type: "OTRO", summary: "", key_results: [], insights: [], persona: null, recommended_job_titles: [], tags: [] }
  }

  // Build tag array with reference IDs
  const tags: {
    type: "industry" | "technology" | "process"
    value: string
    reference_id: string | null
    confidence: number
  }[] = []

  // Index of curated industry_mappings rules (lower(original_value) -> master_industry_id slug).
  const mappingsIndex = new Map<string, string>(
    (dictionaries.industryMappings || []).map(m => [m.original_value.toLowerCase().trim(), m.master_industry_id])
  )
  const industryById = new Map<string, { id: string; name: string }>(
    dictionaries.industries.map(i => [i.id, i])
  )

  // Helper: resolve a free-text industry name to a canonical { id (slug), name (name_es) }.
  // Resolution order (same source of truth as companies):
  //   1) curated industry_mappings rule (authority shared with companies / v2 docs)
  //   2) exact match against the closed master_industries taxonomy (fallback)
  //   3) contains match for minor wording differences (fallback)
  //   -> null when nothing matches (tag is discarded).
  const matchIndustry = (raw: string): { id: string; name: string } | null => {
    const name = (raw || "").toLowerCase().trim()
    if (!name) return null
    // 1) Curated mapping rule first
    const mappedId = mappingsIndex.get(name)
    if (mappedId && industryById.has(mappedId)) return industryById.get(mappedId)!
    // 2) Exact match on canonical name
    let m = dictionaries.industries.find(i => i.name.toLowerCase().trim() === name)
    if (m) return m
    // 3) Contains match (either direction) for minor wording differences
    m = dictionaries.industries.find(
      i => i.name.toLowerCase().includes(name) || name.includes(i.name.toLowerCase())
    )
    return m || null
  }

  // Match industries against the canonical master_industries taxonomy.
  // reference_id = slug (e.g. "manufacturing"), value = canonical name_es.
  const usedIndustryIds = new Set<string>()
  for (const ind of parsed.industries || []) {
    const match = matchIndustry(ind.name)
    if (match && !usedIndustryIds.has(match.id)) {
      usedIndustryIds.add(match.id)
      tags.push({
        type: "industry",
        value: match.name,
        reference_id: match.id,
        confidence: ind.confidence || 0.7,
      })
    }
  }

  // Match technologies against dictionary
  const usedTechIds = new Set<string>()
  for (const tech of parsed.technologies || []) {
    const techName = (tech.name || "").toLowerCase().trim()
    const match = dictionaries.technologies.find(
      p => p.name.toLowerCase() === techName || 
           p.name.toLowerCase().trim() === techName.replace(/\s+/g, " ")
    )
    if (match && !usedTechIds.has(match.id)) {
      usedTechIds.add(match.id)
      tags.push({
        type: "technology",
        value: match.name,
        reference_id: match.id,
        confidence: tech.confidence || 0.7,
      })
    }
  }

  // Match processes against dictionary
  const usedProcIds = new Set<string>()
  for (const proc of parsed.processes || []) {
    const procName = (proc.name || "").toLowerCase().trim()
    const match = dictionaries.processes.find(
      p => p.name.toLowerCase() === procName ||
           p.name.toLowerCase().trim() === procName.replace(/\s+/g, " ")
    )
    if (match && !usedProcIds.has(match.id)) {
      usedProcIds.add(match.id)
      tags.push({
        type: "process",
        value: match.name,
        reference_id: match.id,
        confidence: proc.confidence || 0.7,
      })
    }
  }

  // Helper to clean a string array (trim, dedupe, drop empties, cap)
  const cleanArr = (arr: any, cap: number): string[] =>
    Array.isArray(arr)
      ? [...new Set(
          arr.filter((x: any) => typeof x === "string" && x.trim().length > 0).map((x: string) => x.trim())
        )].slice(0, cap)
      : []

  // Normalize persona / ICP (only keep if it has a usable name)
  let persona: {
    name: string
    type: "buyer" | "user"
    description: string
    pains: string[]
    goals: string[]
    target_company_profile: { industries: string[]; processes: string[]; signals: string[] }
  } | null = null
  const rawPersona = parsed.persona
  if (rawPersona && typeof rawPersona.name === "string" && rawPersona.name.trim().length > 0) {
    const rawTcp = rawPersona.target_company_profile || {}
    // Normalize ICP industries to the canonical master_industries taxonomy (name_es),
    // dedupe, and drop any that don't map to a known industry so it stays filterable.
    const icpIndustries = [...new Set(
      (Array.isArray(rawTcp.industries) ? rawTcp.industries : [])
        .map((i: any) => (typeof i === "string" ? matchIndustry(i)?.name : null))
        .filter((n: any): n is string => typeof n === "string" && n.length > 0)
    )].slice(0, 6) as string[]
    persona = {
      name: rawPersona.name.trim(),
      type: rawPersona.type === "user" ? "user" : "buyer",
      description: typeof rawPersona.description === "string" ? rawPersona.description.trim() : "",
      pains: cleanArr(rawPersona.pains, 4),
      goals: cleanArr(rawPersona.goals, 4),
      target_company_profile: {
        industries: icpIndustries,
        processes: cleanArr(rawTcp.processes, 6),
        signals: cleanArr(rawTcp.signals, 6),
      },
    }
  }

  // Normalize recommended job titles (dedupe, trim, cap at 8)
  const recommended_job_titles = cleanArr(parsed.recommended_job_titles, 8)

  return {
    document_type: parsed.document_type || "OTRO",
    summary: parsed.summary || "",
    key_results: cleanArr(parsed.key_results, 5),
    insights: cleanArr(parsed.insights, 5),
    persona,
    recommended_job_titles,
    tags,
  }
}
