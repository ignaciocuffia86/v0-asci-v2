import { generateText } from "ai"

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
  }
): Promise<string> {
  const model = options?.model || "google/gemini-2.5-flash-lite"
  
  try {
    const { text } = await generateText({
      model,
      prompt,
      temperature: options?.temperature ?? 0.2,
      maxOutputTokens: options?.maxOutputTokens ?? 4096,
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
    industries: string[]
  }
): Promise<{
  document_type: "CASO_DE_EXITO" | "BROCHURE" | "OTRO"
  summary: string
  key_results: string[]
  persona: {
    name: string
    type: "buyer" | "user"
    description: string
    pains: string[]
    goals: string[]
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
  const industryList = dictionaries.industries.join(", ")

  const prompt = `Analiza el siguiente texto de un documento comercial de una empresa de tecnologia / servicios / consultoria.

TEXTO DEL DOCUMENTO:
---
${extractedText.slice(0, 30000)}
---

DICCIONARIO DE TECNOLOGIAS DISPONIBLES (usa EXACTAMENTE estos nombres):
${productList}

DICCIONARIO DE PROCESOS DE NEGOCIO DISPONIBLES (usa EXACTAMENTE estos nombres):
${processList}

INDUSTRIAS CONOCIDAS EN NUESTRA BASE:
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
  "persona": {
    "name": "Titulo corto del perfil objetivo, ej: 'Director Financiero de Retail'",
    "type": "buyer" | "user",
    "description": "1-2 oraciones describiendo quien es el perfil al que apunta esta solucion",
    "pains": ["Dolor o problema concreto 1", "Dolor 2"],
    "goals": ["Objetivo o meta 1", "Objetivo 2"]
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

=== INSTRUCCIONES PARA PERSONA Y RECOMMENDED_JOB_TITLES ===
Inferi a QUIEN dentro de la empresa-cliente le sirve o le interesa esta solucion (el perfil objetivo / buyer o user persona).
- "type": usa "buyer" si el perfil es quien DECIDE/COMPRA (ejecutivo, decisor presupuestario); usa "user" si es quien USA la solucion en el dia a dia.
- "name": un titulo corto y representativo del perfil (cargo + contexto de industria si aplica).
- "description": quien es, en 1-2 oraciones.
- "pains": entre 1 y 4 dolores/problemas concretos que este perfil tiene y que la solucion resuelve.
- "goals": entre 1 y 4 objetivos o metas de ese perfil.
- "recommended_job_titles": entre 2 y 8 CARGOS REALES (job titles) que conviene buscar/prospectar para vender esta solucion. Usa titulos estandar de mercado (ej: "CFO", "VP of Engineering", "Head of Supply Chain", "Director de Operaciones"). NO inventes cargos genericos vagos.
Si el documento no permite inferir un perfil con confianza, devuelve "persona": null y "recommended_job_titles": [].

=== INSTRUCCIONES PARA KEY_RESULTS ===
Extrae entre 0 y 5 resultados CONCRETOS y CUANTIFICABLES del documento.
SOLO incluye datos que sean medibles: porcentajes, tiempos, cantidades, montos, ratios.
NO incluyas beneficios genericos como "mayor eficiencia" o "mejor rendimiento".
Si el documento no tiene datos cuantificables (ej: brochure generico), devuelve array vacio [].
Ejemplos validos: "Reduccion del 60% en tiempo de gestion", "Migracion de 100+ activos", "Ahorro de $2M anuales"
Ejemplos INVALIDOS: "Mayor eficiencia operativa", "Mejor experiencia de usuario"

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
- ¿Que problema de negocio concreto resuelve? → Ej: "Prediccion de Demanda", "Deteccion de Fraude", "Cierre Financiero"
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

  const responseText = await generateContent(prompt, { temperature: 0.2 })

  // Parse JSON response
  let parsed: any
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("No JSON found in response")
    parsed = JSON.parse(jsonMatch[0])
  } catch (err) {
    console.error("[v3] Failed to parse AI analysis response:", responseText.slice(0, 500))
    return { document_type: "OTRO", summary: "", key_results: [], persona: null, recommended_job_titles: [], tags: [] }
  }

  // Build tag array with reference IDs
  const tags: {
    type: "industry" | "technology" | "process"
    value: string
    reference_id: string | null
    confidence: number
  }[] = []

  // Match industries
  for (const ind of parsed.industries || []) {
    tags.push({
      type: "industry",
      value: ind.name,
      reference_id: null,
      confidence: ind.confidence || 0.7,
    })
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

  // Normalize persona (only keep if it has a usable name)
  let persona: {
    name: string
    type: "buyer" | "user"
    description: string
    pains: string[]
    goals: string[]
  } | null = null
  const rawPersona = parsed.persona
  if (rawPersona && typeof rawPersona.name === "string" && rawPersona.name.trim().length > 0) {
    persona = {
      name: rawPersona.name.trim(),
      type: rawPersona.type === "user" ? "user" : "buyer",
      description: typeof rawPersona.description === "string" ? rawPersona.description.trim() : "",
      pains: Array.isArray(rawPersona.pains)
        ? rawPersona.pains.filter((p: any) => typeof p === "string" && p.trim().length > 0).slice(0, 4)
        : [],
      goals: Array.isArray(rawPersona.goals)
        ? rawPersona.goals.filter((g: any) => typeof g === "string" && g.trim().length > 0).slice(0, 4)
        : [],
    }
  }

  // Normalize recommended job titles (dedupe, trim, cap at 8)
  const recommended_job_titles = Array.isArray(parsed.recommended_job_titles)
    ? [...new Set(
        parsed.recommended_job_titles
          .filter((t: any) => typeof t === "string" && t.trim().length > 0)
          .map((t: string) => t.trim())
      )].slice(0, 8) as string[]
    : []

  return {
    document_type: parsed.document_type || "OTRO",
    summary: parsed.summary || "",
    key_results: Array.isArray(parsed.key_results) 
      ? parsed.key_results.filter((r: any) => typeof r === "string" && r.trim().length > 0).slice(0, 5) 
      : [],
    persona,
    recommended_job_titles,
    tags,
  }
}
