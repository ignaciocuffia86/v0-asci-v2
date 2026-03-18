import { generateGeminiContent } from "@/lib/ai-service"
import { createClient as createServerClient } from "@/lib/supabase/server"

export interface DocumentAnalysis {
  summary: string
  key_results: string[]
  tags: {
    type: "industry" | "technology" | "process"
    value: string
    reference_id: string | null
    confidence: number
  }[]
}

/**
 * Analyze document text with Gemini to extract summary and tags
 * Tags are matched against existing dictionaries (dictionary_products, dictionary_processes)
 * and known industries from the companies table.
 */
export async function analyzeDocument(extractedText: string): Promise<DocumentAnalysis> {
  const supabase = await createServerClient()

  // Fetch dictionaries for matching
  const [{ data: products }, { data: processes }, { data: industries }] = await Promise.all([
    supabase.from("dictionary_products").select("id, name").limit(500),
    supabase.from("dictionary_processes").select("id, name").limit(500),
    supabase.rpc("get_distinct_industries"),
  ])

  const productList = (products || []).map((p: any) => p.name).join(", ")
  const processList = (processes || []).map((p: any) => p.name).join(", ")

  // Get distinct industries - fallback to manual query if RPC doesn't exist
  let industryList = ""
  if (industries) {
    industryList = industries.map((i: any) => i.industry).filter(Boolean).join(", ")
  } else {
    const { data: companiesData } = await supabase
      .from("companies")
      .select("industry")
      .not("industry", "is", null)
      .limit(1000)
    const uniqueIndustries = [...new Set((companiesData || []).map((c: any) => c.industry).filter(Boolean))]
    industryList = uniqueIndustries.join(", ")
  }

  const prompt = `Analiza el siguiente texto de un documento comercial de una empresa de tecnologia / servicios / consultoría.

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

=== INSTRUCCIONES PARA KEY_RESULTS ===
Extrae entre 0 y 5 resultados CONCRETOS y CUANTIFICABLES del documento.
SOLO incluye datos que sean medibles: porcentajes, tiempos, cantidades, montos, ratios.
NO incluyas beneficios genericos como "mayor eficiencia" o "mejor rendimiento".
Si el documento no tiene datos cuantificables (ej: brochure generico), devuelve array vacio [].
Ejemplos validos: "Reduccion del 60% en tiempo de gestion", "Migracion de 100+ activos", "Ahorro de $2M anuales", "Tiempo de cierre reducido de 5 dias a 8 horas"
Ejemplos INVALIDOS: "Mayor eficiencia operativa", "Mejor experiencia de usuario", "Reduccion de costos"

=== INSTRUCCIONES PARA EL SUMMARY SEGUN TIPO ===

SI ES CASO DE EXITO, el summary DEBE incluir estos elementos en 3-5 oraciones:
1. QUIEN fue el cliente (nombre y breve descripcion)
2. QUE industria tiene el cliente
3. CUAL era el problema o necesidad del cliente
4. QUE solucion se implemento (tecnologias, procesos, metodologia)
5. QUE resultados concretos se obtuvieron (metricas, porcentajes, mejoras cuantificables)
Ejemplo: "Proyecto para Arcor (multinacional argentina de alimentos/consumo masivo). El cliente necesitaba modernizar su gestion de activo fijo que operaba con sistemas legacy desactualizados. Se implemento una solucion de automatizacion que digitalizo el proceso de altas, bajas y transferencias de activos. Como resultado se redujo el tiempo de gestion en un 60% y se elimino el uso de planillas manuales."

SI ES BROCHURE/PROPUESTA, el summary debe describir en 2-4 oraciones:
1. Que ofrece/vende la empresa
2. En que industrias o verticales se especializa
3. Que tecnologias o capacidades principales tiene

=== REGLAS CRITICAS PARA TAGS ===

CONTEXTO CRITICO - TODOS LOS USUARIOS SON EMPRESAS DE TECNOLOGIA:
Los documentos son materiales de venta/marketing de empresas de software, IT o consultoria tecnologica.
Por definicion, TODOS sus documentos involucran tecnologia, innovacion y eficiencia operativa.
Estos conceptos son universales y NO aportan valor diferencial como tags.

TAGS COMPLETAMENTE PROHIBIDOS - NUNCA los incluyas aunque aparezcan explicitamente en el texto:
  "Innovacion Tecnologica", "Transformacion Digital", "Innovacion y Transformacion",
  "Eficiencia Operativa", "Mejora Continua", "Gestion del Cambio", "Estrategia Digital",
  "Liderazgo IT", "Adopcion Tecnologica", "Calidad y Procesos", "Sostenibilidad",
  "Sustentabilidad", "Continuidad Operativa", "Optimizacion de Procesos"
  RAZON: aplican a absolutamente cualquier solucion tecnologica, no describen la propuesta de valor especifica.

EN CAMBIO, busca tags que respondan: "¿para QUE CASO DE NEGOCIO o INDUSTRIA ESPECIFICA sirve este documento?"
  - ¿Que problema de negocio concreto resuelve? → Ej: "Prediccion de Demanda", "Deteccion de Fraude", "Gestion de Riesgo Crediticio", "Cierre Financiero"
  - ¿En que industria especifica tiene impacto? → Ej: "Retail", "Banking", "Manufacturing", "Insurance"
  - ¿Que tecnologia puntual implementa? → Ej: SAP ERP, Salesforce, AWS (nunca "tecnologia en general")
  - ¿Que proceso de negocio especifico automatiza? → Ej: "Planificacion de Inventario", "Conciliacion Bancaria", "Onboarding de Clientes"

REGLA PRINCIPAL - TEMA DIRECTO VS BENEFICIO LATERAL:
Un tag SOLO debe incluirse si describe el TEMA CENTRAL o CAPACIDAD PRINCIPAL del documento.
PREGUNTA CLAVE: "¿Todos los documentos tecnologicos serian igualmente relevantes para este tag?" Si la respuesta es SI, el tag es demasiado generico, NO lo incluyas.

EJEMPLOS CORRECTOS:
  - Migracion a AWS → SI: AWS, "Infraestructura y Bases de Datos", "Seguridad IT". NO: "Transformacion Digital", "Innovacion Tecnologica"
  - SAP en retail → SI: SAP ERP, Retail, "Gestion de Inventario". NO: "Gestion del Cambio", "Eficiencia Operativa"
  - Prediccion de demanda con ML → SI: "Prediccion de Demanda", Retail, Python. NO: "Innovacion Tecnologica"
  - RPA para banca → SI: "Automatizacion de Procesos", RPA, Banking. NO: "Mejora Continua"

LIMITE DE TAGS: maximo 3 technologies y maximo 4 processes. Prioriza los mas especificos y diferenciales. Menos tags de alta calidad > muchos tags genericos.

REGLAS ADICIONALES:
- Para technologies: SOLO incluye nombres que existan TEXTUALMENTE en el DICCIONARIO DE TECNOLOGIAS. Busca cuidadosamente.
  - Si el documento menciona un servicio de una plataforma (ej: "EC2", "Lambda") busca si la plataforma madre existe (ej: "AWS").
  - Si el documento menciona "SAP S/4HANA" y en el diccionario existe "SAP ERP", incluye "SAP ERP".
  - Si una tecnologia mencionada NO tiene ningun equivalente en el diccionario, NO la incluyas.
- Para processes: misma logica, SOLO nombres del diccionario. Omite los prohibidos aunque esten en el diccionario.
- Para industries: SOLO nombres de la lista de industrias. SI ES CASO DE EXITO, usa la industria del CLIENTE, no del vendor.
- Confidence: 0.9-1.0 = tema central del documento. 0.7-0.89 = tema relevante secundario. Menos de 0.7 = no incluyas el tag.
- El summary debe ser en espanol.`

  const responseText = await generateGeminiContent(prompt, "gemini-2.5-flash", 0.2)

  // Parse JSON response
  let parsed: any
  try {
    // Try to extract JSON from possible markdown code blocks
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error("No JSON found in response")
    parsed = JSON.parse(jsonMatch[0])
  } catch (err) {
    console.error("[v0] Failed to parse Gemini analysis response:", responseText.slice(0, 500))
    return { summary: "", key_results: [], tags: [] }
  }

  // Build tag array with reference IDs
  const tags: DocumentAnalysis["tags"] = []

  // Match industries
  for (const ind of parsed.industries || []) {
    tags.push({
      type: "industry",
      value: ind.name,
      reference_id: null, // industries don't have a dictionary table
      confidence: ind.confidence || 0.7,
    })
  }

  // Match technologies against dictionary_products
  // Strict: only save if we find a match in the dictionary
  const usedTechIds = new Set<string>()
  for (const tech of parsed.technologies || []) {
    const techName = (tech.name || "").toLowerCase().trim()
    // 1. Exact match
    let match = (products || []).find(
      (p: any) => p.name.toLowerCase() === techName
    )
    // 2. Normalized match (ignore case, extra spaces)
    if (!match) {
      match = (products || []).find(
        (p: any) => p.name.toLowerCase().trim() === techName.replace(/\s+/g, " ")
      )
    }
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

  // Match processes against dictionary_processes
  const usedProcIds = new Set<string>()
  for (const proc of parsed.processes || []) {
    const procName = (proc.name || "").toLowerCase().trim()
    let match = (processes || []).find(
      (p: any) => p.name.toLowerCase() === procName
    )
    if (!match) {
      match = (processes || []).find(
        (p: any) => p.name.toLowerCase().trim() === procName.replace(/\s+/g, " ")
      )
    }
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

  return {
    summary: parsed.summary || "",
    key_results: Array.isArray(parsed.key_results) ? parsed.key_results.filter((r: any) => typeof r === "string" && r.trim().length > 0).slice(0, 5) : [],
    tags,
  }
}
