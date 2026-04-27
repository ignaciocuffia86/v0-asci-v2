/**
 * Tech Radar — orquestador de los 17 micro-agentes del prompt de Claude
 * mapeados a 4 bundles tematicos (1 Parallel call por bundle, ejecutados en
 * paralelo). Despues 1 sola llamada Gemini consolidada clasifica cada hallazgo
 * en uno de los 17 micro-agentes.
 *
 * Diseño:
 *   17 micro-agentes -> 4 bundles tematicos (4 Parallel calls en paralelo)
 *   N excerpts agrupados -> 1 Gemini call -> M hallazgos clasificados
 *
 * Esto es ~80% mas eficiente que ejecutar 17 busquedas independientes y nos
 * da un payload manejable para Gemini.
 */

import { parallelSearch, type ParallelSearchOptions, type ParallelSearchResponse } from "@/lib/parallel"
import { structureWithLLM, checkUrlsAlive } from "@/lib/ai-structurer"

// Constantes y tipos client-safe viven en lib/tech-radar-constants.ts
// para no contaminar bundles del cliente con imports server-only.
// Re-exportamos para compatibilidad con codigo del backend que ya los usa.
import {
  MICRO_AGENTS,
  type MicroAgent,
  MICRO_AGENT_LABELS,
  type EvidenceLevel,
} from "@/lib/tech-radar-constants"

export { MICRO_AGENTS, MICRO_AGENT_LABELS }
export type { MicroAgent, EvidenceLevel }

// ── Bundles tematicos ──────────────────────────────────────────────────
type Bundle = {
  key: "datos" | "negocio" | "seguridad" | "vertical"
  label: string
  agents: MicroAgent[]
  queries: (companyName: string) => string[]
}

const BUNDLES: Bundle[] = [
  {
    key: "datos",
    label: "Datos & Plataforma",
    agents: ["bi_analytics", "cloud", "devops", "ia_rpa", "observabilidad"],
    queries: (c) => [
      `"${c}" AWS OR Azure OR "Google Cloud" OR "GCP" infraestructura cloud`,
      `"${c}" Tableau OR PowerBI OR Looker OR Snowflake OR Databricks data warehouse`,
      `"${c}" DevOps OR Kubernetes OR Docker OR Jenkins OR GitLab pipeline CI CD`,
      `"${c}" "inteligencia artificial" OR "machine learning" OR RPA OR UiPath automatización`,
      `"${c}" Datadog OR "New Relic" OR Dynatrace OR Splunk monitoreo observabilidad`,
    ],
  },
  {
    key: "negocio",
    label: "Procesos de Negocio",
    agents: ["ipaas", "erp", "crm", "pagos", "logistica"],
    queries: (c) => [
      `"${c}" SAP OR Oracle OR "Microsoft Dynamics" OR Workday ERP gestión`,
      `"${c}" Salesforce OR HubSpot OR Zendesk CRM customer experience`,
      `"${c}" MuleSoft OR Boomi OR "Azure Logic Apps" iPaaS integración API`,
      `"${c}" "medios de pago" OR POS OR fintech procesador transacciones`,
      `"${c}" WMS OR "warehouse management" OR RFID OR SAP TMS logística`,
    ],
  },
  {
    key: "seguridad",
    label: "Seguridad & Workplace",
    agents: ["ciberseguridad", "workplace", "hardware", "telco"],
    queries: (c) => [
      `"${c}" "Microsoft 365" OR "Google Workspace" OR Slack OR Teams colaboración`,
      `"${c}" Okta OR CrowdStrike OR Palo Alto OR Fortinet ciberseguridad SOC IAM`,
      `"${c}" Cisco OR Telefónica OR Movistar OR Claro telecomunicaciones red corporativa`,
      `"${c}" Dell OR HP OR Lenovo servidores datacenter hardware infraestructura`,
      `"${c}" empleos jobs LinkedIn "experiencia en" stack tecnológico requisitos`,
    ],
  },
  {
    key: "vertical",
    label: "Procurement & Verticales",
    agents: ["procurement_it", "health_it", "consultoria"],
    queries: (c) => [
      `"${c}" licitación contratación pública IT informática tecnología`,
      `"${c}" Accenture OR Deloitte OR "McKinsey" OR Globant OR IBM consultora implementación`,
      `"${c}" partner case study "caso de éxito" cliente`,
      `"${c}" historia clínica electrónica HIS LIS PACS telemedicina`,
      `"${c}" RFP procurement compras tecnología proveedor IT`,
    ],
  },
]

// ── Build params helper ───────────────────────────────────────────────
function buildBundleParams(bundle: Bundle, companyName: string, country?: string): ParallelSearchOptions {
  const threeYearsAgo = new Date()
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3)
  const afterDate = threeYearsAgo.toISOString().split("T")[0]

  const countryCtx = country ? ` (operaciones en ${country})` : ""
  const agentLabels =
    bundle.agents.length > 0
      ? bundle.agents.map((a) => MICRO_AGENT_LABELS[a]).join(", ")
      : "cualquier area tecnologica relevante (clasificar segun corresponda)"

  return {
    objective:
      `Bundle [${bundle.label}] sobre la empresa "${companyName}"${countryCtx}. ` +
      `Buscar EVIDENCIA TECNICA Y DE NEGOCIO en estas areas: ${agentLabels}. ` +
      `Fuentes priorizadas: sitio oficial, casos de exito de vendors, blogs corporativos, ` +
      `licitaciones publicas, PDFs tecnicos, avisos de empleo, perfiles de ejecutivos, prensa especializada. ` +
      `EXCLUIR prensa generalista no tecnologica (esa va a la pestaña Noticias).`,
    search_queries: bundle.queries(companyName),
    max_results: 8,
    source_policy: {
      exclude_domains: [
        "facebook.com",
        "twitter.com",
        "x.com",
        "instagram.com",
        "tiktok.com",
        "youtube.com",
        "reddit.com",
        "pinterest.com",
        // prensa generalista (va a Noticias)
        "infobae.com",
        "clarin.com",
        "lanacion.com.ar",
        "perfil.com",
        "ambito.com",
        "ambito.com.ar",
        "eldiarioar.com",
        "mdzol.com",
        "diariohoy.net",
        "lavoz.com.ar",
        "pagina12.com.ar",
        "iprofesional.com",
        "cronista.com",
      ],
      after_date: afterDate,
    },
    excerpts: { max_chars_per_result: 6000 },
  }
}

// ── Resultado tipado ──────────────────────────────────────────────────
export interface TechRadarFinding {
  micro_agent: MicroAgent
  title: string
  summary: string
  technology: string | null
  provider_name: string | null
  area: string | null
  results: string | null
  evidence_level: EvidenceLevel
  evidence_detail: string | null // frase / fecha / referencia que sustenta
  source_url: string
  source_name: string
  supporting_source_urls: string[]
  convergent_sources: number
  published_at: string | null
}

export interface TechRadarRunResult {
  findings: TechRadarFinding[]
  digest: string | null
  bundle_stats: {
    bundle: string
    parallel_results: number
    excerpts_chars: number
  }[]
  ai_provider: string
}

// ── Gemini system prompt ───────────────────────────────────────────────
const TECH_RADAR_SYSTEM = `Eres un investigador senior de inteligencia tecnologica empresarial.
Recibis excerpts de paginas web sobre la empresa objetivo, agrupados en 4 bundles tematicos.
Tu tarea es producir una RADIOGRAFIA TECNOLOGICA: lista de hallazgos verificables sobre tecnologias,
procesos, integraciones, vendors, partners y skills que usa la empresa.

REGLAS DE RELEVANCIA (CRITICAS):
A. La empresa objetivo (te la indico abajo entre comillas) debe ser la USUARIA / CLIENTA / IMPLEMENTADORA de la tecnologia descripta.
B. EXCLUIR cualquier excerpt donde la empresa solo se mencione al pasar como ejemplo, en una lista o en contexto historico tangencial.
C. Si tenes dudas, EXCLUI el item. Mejor 0 hallazgos que 1 ruidoso.
D. El "title" y "summary" DEBEN mencionar el nombre de la empresa objetivo.
E. NO inventes URLs ni proveedores. Si un dato no esta en los excerpts, no lo pongas.

REGLAS ANTI-OBVIEDAD (CRITICAS - causa principal de mala calidad):
F. RECHAZAR hallazgos que solo afirmen la EXISTENCIA de un area / equipo / departamento sin tecnologia concreta.
   Ejemplos PROHIBIDOS: "tiene departamento de seguridad", "cuenta con un equipo de IT", "posee area de sistemas",
   "dispone de infraestructura tecnologica", "maneja datos de clientes". Toda empresa mediana tiene esto;
   no aporta valor a un vendedor B2B.
G. RECHAZAR hallazgos genericos del tipo "usa internet", "tiene sitio web", "vende online", "usa email",
   "procesa pagos con tarjeta", "tiene sistema de gestion" sin nombrar el vendor/producto especifico.
H. CADA hallazgo VALIDO debe identificar al menos UNA de estas evidencias concretas:
   - Nombre del vendor/producto especifico (ej. "Microsoft Dynamics 365", "Salesforce Sales Cloud", "AWS RDS")
   - Numero de licencias / usuarios / nodos / volumen
   - Fecha o version de implementacion / migracion / upgrade
   - Resultado cuantificado (% reduccion, $ ahorro, X horas, etc.)
   - Nombre del partner / consultora que ejecuto
   - Caso de exito, comunicado oficial o licitacion publica con titulo identificable
   Si NO podes citar ninguna de estas, NO incluyas el hallazgo.

REGLAS SOBRE LINKEDIN (CRITICAS):
I. Los perfiles PERSONALES de LinkedIn (linkedin.com/in/...) NO son evidencia valida de tecnologia que usa la empresa.
   Que alguien tenga el cargo "CISO at Empresa X" o "Salesforce Admin at Empresa X" en su perfil personal NO es prueba
   de que la empresa "tenga un area de ciberseguridad" o "use Salesforce". RECHAZAR estos excerpts.
J. SI son fuente valida: avisos de empleo de la empresa (linkedin.com/jobs/, careers pages, computrabajo, etc.) que
   listan stack tecnologico requerido. En ese caso clasificar como "inferencia" porque el aviso pide la skill pero no
   confirma uso productivo. El evidence_detail debe citar el texto del aviso.

REGLAS ANTI-CONTAMINACION CRUZADA (CRITICAS - causa frecuente de errores):
K. Un mismo excerpt PUEDE mencionar a varias empresas. Caso tipico: REPORTES DE SUSTENTABILIDAD / ESG / informes
   anuales / reportes sectoriales que pertenecen a OTRA empresa pero mencionan a la empresa objetivo como
   cliente, proveedor, filial, ejemplo o competidor. La tecnologia descrita en ese reporte NO PERTENECE a la
   empresa objetivo salvo que la oracion sea EXPLICITA (ej. "Arcos Dorados implemento SAP S/4HANA en 2023" SI;
   "el sector incluyendo Arcos Dorados ha adoptado tecnologias cloud" NO).
L. Para cada hallazgo, mentalmente respondete: "¿la oracion del excerpt que cito como evidence_detail tiene
   a {empresa objetivo} como SUJETO de la accion (implementar, contratar, migrar, adoptar, usar)?"
   - SI: incluir el hallazgo.
   - NO (la empresa solo se menciona en una lista, comparacion, o como contexto): EXCLUIR.
M. El campo "evidence_detail" DEBE ser una CITA LITERAL del excerpt (entre 30 y 200 chars) que contenga
   AL MISMO TIEMPO: (1) el nombre de la empresa objetivo o un fragmento inequivoco de el, y (2) la tecnologia,
   vendor, partner, fecha, numero o resultado especifico del hallazgo. Si no podes citar una oracion que
   contenga ambos, NO incluyas el hallazgo.
N. Si el TITULO de la fuente sugiere que el documento pertenece a OTRA empresa (ej. "Informe Anual Femsa 2024",
   "Reporte ESG Ambev", "Sustainability Report McDonald's Corporation") y la empresa objetivo solo se menciona
   en el cuerpo, sube los criterios: el evidence_detail debe ser una oracion donde la empresa objetivo
   sea SUJETO inequivoco. Si no, EXCLUIR.

REGLAS DE CLASIFICACION:
1. Cada hallazgo debe asignarse a exactamente UN micro-agente de la siguiente lista (usa el slug exacto):
   - bi_analytics: BI, analytics, data warehouses, lakes, dashboards
   - cloud: AWS, Azure, GCP, IaaS, PaaS, Kubernetes-managed
   - ipaas: integracion, APIs, MuleSoft, Boomi, middleware
   - ciberseguridad: SOC, IAM, EDR, firewalls, MFA, certificaciones
   - workplace: Office365, Workspace, Slack, Teams, colaboracion
   - devops: CI/CD, Git, Jenkins, GitLab, infra como codigo
   - erp: SAP, Oracle, Dynamics, Workday, gestion empresarial
   - ia_rpa: ML, IA, UiPath, RPA, modelos predictivos
   - hardware: servidores, datacenters, equipos de usuario
   - crm: Salesforce, HubSpot, Zendesk, customer success
   - telco: redes corporativas, MPLS, SD-WAN, conectividad
   - procurement_it: licitaciones IT, RFP, compras de tecnologia
   - observabilidad: monitoreo, APM, logs, Datadog, NewRelic
   - pagos: POS, fintech, gateways, procesadores
   - logistica: WMS, TMS, RFID, supply chain
   - health_it: HIS, LIS, PACS, telemedicina
   - consultoria: consultoras, partners, servicios IT, casos de exito

2. NIVELES DE EVIDENCIA (usa estos slugs exactos):
   - "directa": case study oficial, comunicado de la empresa, anuncio del vendor sobre este cliente
   - "convergente": multiples fuentes independientes confirman el dato
   - "inferencia": indicio fuerte (ej. aviso de empleo que pide skill X) pero sin confirmacion explicita
   - "sin_evidencia": el dato es plausible pero no esta sustentado; NO incluir items con este nivel salvo que sean criticos

3. Para CADA hallazgo:
   - "source_index" (>=1) primario: fuente principal del hallazgo. OBLIGATORIO.
   - "supporting_source_indexes": array de otros indices de Fuente que TAMBIEN confirman el mismo hallazgo (puede ser []).
   - "evidence_detail": cita textual breve o referencia especifica del excerpt que sustenta el hallazgo (max 200 chars).
   - "convergent_sources": numero entero = 1 + length(supporting_source_indexes).

4. AREA del negocio impactada (texto libre): finanzas | ventas | logistica | rrhh | it | ciberseguridad | ecommerce | operaciones | atencion_cliente.

5. Si no hay hallazgos relevantes, devolve {"findings":[], "digest": null}.

REGLAS DE FORMATO:
- Responde UNICAMENTE con JSON valido (sin markdown, sin texto extra).
- Resume con TUS PROPIAS PALABRAS, NO copies texto literal salvo en evidence_detail.
- Maximo 30 hallazgos en total. Prioriza calidad y diversidad de micro-agentes.
- Las fechas YYYY-MM-DD; si no se infiere, null.

DIGEST:
Genera un digest de 2-4 oraciones en ESPAÑOL que responda:
- Que stack/vendors usa la empresa (lo destacado).
- Que micro-agentes tienen mas evidencia.
- Como puede usar esta info un vendedor B2B para posicionarse.

FORMATO JSON:
{
  "findings": [
    {
      "source_index": 1,
      "supporting_source_indexes": [3, 5],
      "micro_agent": "cloud",
      "title": "string",
      "summary": "string (2-3 oraciones)",
      "technology": "string o null",
      "provider_name": "string o null (vendor)",
      "area": "string o null",
      "results": "string o null",
      "evidence_level": "directa | convergente | inferencia",
      "evidence_detail": "string (cita o referencia)",
      "source_name": "string",
      "published_at": "YYYY-MM-DD o null"
    }
  ],
  "digest": "string o null"
}`

// ── Public API ─────────────────────────────────────────────────────────
export async function runTechRadar(input: {
  companyName: string
  country?: string
  industry?: string
  keywords?: string[]
  /** Aliases adicionales (subsidiarias, marca comercial, nombre corto). */
  aliases?: string[]
  /** Ticker de bolsa, si la empresa cotiza. */
  ticker?: string | null
  /** Slug de LinkedIn (suele ser un alias estable). */
  linkedinSlug?: string | null
}): Promise<TechRadarRunResult> {
  const { companyName, country, keywords, aliases, ticker, linkedinSlug } = input

  // Construir tokens de match para detectar menciones a la empresa.
  // Incluye: tokens del nombre legal, nombre sin sufijos legales, primera palabra,
  // ticker, linkedin slug y aliases provistos por el caller.
  const matchTokens = buildCompanyMatchTokens({
    name: companyName,
    aliases,
    ticker,
    linkedinSlug,
  })
  console.log(`[v0][tech-radar] match tokens for "${companyName}":`, matchTokens.join(", "))

  // Bundles a ejecutar: los 4 estandar + uno dinamico de "Bookmark signals"
  // si el bookmark tiene keywords. El bundle dinamico empuja queries muy
  // especificas que combinan empresa + keyword + verbo de accion (implemento,
  // migro, contrato, partner). Tipicamente devuelve los hallazgos mas relevantes.
  const bundlesToRun: Bundle[] = [...BUNDLES]
  if (keywords && keywords.length > 0) {
    bundlesToRun.push(buildKeywordsBundle(keywords))
  }

  // Paso 1: ejecutar bundles en paralelo
  console.log(`[v0][tech-radar] running ${bundlesToRun.length} bundles in parallel for "${companyName}"`)
  const bundlePromises = bundlesToRun.map(async (bundle) => {
    const params = buildBundleParams(bundle, companyName, country)
    try {
      const res = await parallelSearch(params)
      console.log(`[v0][tech-radar][${bundle.key}] ${res.results.length} results`)
      return { bundle, response: res as ParallelSearchResponse }
    } catch (err) {
      console.error(`[v0][tech-radar][${bundle.key}] parallel error:`, err)
      return { bundle, response: { search_id: "", results: [], warnings: null } as ParallelSearchResponse }
    }
  })
  const bundleResults = await Promise.all(bundlePromises)

  // Paso 2: aplanar excerpts en un solo listado numerado (compartido entre bundles)
  // El index 1-based del listado FINAL es el que vamos a pedirle a Gemini.
  type FlatExcerpt = {
    bundle_key: string
    url: string
    title: string
    publish_date: string | null
    content: string
  }
  const flat: FlatExcerpt[] = []
  const bundleStats = bundleResults.map(({ bundle, response }) => {
    let chars = 0
    for (const r of response.results) {
      const content = r.excerpts.join("\n")
      flat.push({
        bundle_key: bundle.key,
        url: r.url,
        title: r.title,
        publish_date: r.publish_date,
        content,
      })
      chars += content.length
    }
    return { bundle: bundle.label, parallel_results: response.results.length, excerpts_chars: chars }
  })

  if (flat.length === 0) {
    return { findings: [], digest: null, bundle_stats: bundleStats, ai_provider: "no-results" }
  }

  // Paso 3: 1 sola llamada a Gemini con TODOS los excerpts numerados.
  // Limitamos a 50 fuentes y truncamos cada excerpt para que entre en el context.
  const MAX_SOURCES = 50
  const truncated = flat.slice(0, MAX_SOURCES)
  const excerptText = truncated
    .map(
      (e, i) =>
        `--- Fuente ${i + 1} [bundle: ${e.bundle_key}] ${e.title} (${e.url}) [fecha: ${e.publish_date ?? "desconocida"}] ---\n${e.content.slice(0, 4500)}`,
    )
    .join("\n\n")

  const keywordsCtx = keywords?.length ? `\nSeñales de interes (priorizar): ${keywords.join(", ")}` : ""
  const userPrompt = `Empresa objetivo: "${companyName}"${keywordsCtx}\n\nExcerpts agrupados por bundle:\n\n${excerptText}\n\nExtrae los hallazgos en JSON segun el formato indicado.`

  let parsed: { findings?: any[]; digest?: string | null } = { findings: [], digest: null }
  let aiProvider = "gemini-2.0-flash"
  try {
    parsed = await structureWithLLM<{ findings?: any[]; digest?: string | null }>({
      systemPrompt: TECH_RADAR_SYSTEM,
      userPrompt,
      maxOutputTokens: 6000,
      temperature: 0.2,
      context: "tech-radar",
    })
  } catch (err) {
    console.error("[v0][tech-radar] gemini structuring failed, returning empty:", err)
    return { findings: [], digest: null, bundle_stats: bundleStats, ai_provider: "gemini-failed" }
  }

  const rawFindings = parsed.findings ?? []
  const digest = parsed.digest ?? null

  // Paso 4: guardrail de relevancia (mencion explicita de la empresa
  // en title o summary). Usa matchTokens para reconocer aliases, ticker,
  // linkedin slug y nombre sin sufijos legales.
  const beforeRelevance = rawFindings.length
  const relevantFindings = filterByCompanyTokens(rawFindings, matchTokens, ["title", "summary"])
  if (rawFindings.length !== relevantFindings.length) {
    console.log(`[v0][tech-radar][guardrail] dropped ${beforeRelevance - relevantFindings.length} sin mencion explicita`)
  }

  // Paso 4b: anti-obviedad. Descartar findings genericos cuyo "valor" sea solo
  // afirmar que la empresa tiene un area/departamento/equipo, o que usa categorias
  // de tecnologia sin nombrar producto especifico. Estos son los "fake insights"
  // tipicos que produce el LLM cuando se basa en perfiles personales de LinkedIn.
  const nonObviousFindings = relevantFindings.filter((f) => isNonObviousFinding(f))
  if (nonObviousFindings.length !== relevantFindings.length) {
    console.log(
      `[v0][tech-radar][anti-obviedad] dropped ${relevantFindings.length - nonObviousFindings.length} obviedades`,
    )
  }

  // NOTA: el filtro previo "anti-cross" sobre evidence_detail era demasiado
  // estricto y mataba findings legitimos donde el LLM citaba una oracion sin
  // repetir el nombre exacto de la empresa (ej. "la cadena portuguesa migro
  // a SAP"). Ahora usamos un DOBLE CHECK en el Paso 5 que combina la cita
  // y el documento fuente.

  // Paso 5: mapear source_index -> URL real, validar micro_agent / evidence_level
  // y aplicar doble check de pertenencia a la empresa.
  type Mapped = { item: any; primary: FlatExcerpt; supportingExcerpts: FlatExcerpt[] }
  const mapped: Mapped[] = []
  const validAgents = new Set<string>(MICRO_AGENTS)
  const validLevels = new Set<EvidenceLevel>(["directa", "convergente", "inferencia", "sin_evidencia"])
  let droppedByLinkedInProfile = 0
  let droppedByOrphanFinding = 0 // cuando ni evidence_detail NI fuente mencionan empresa

  for (const item of nonObviousFindings) {
    const idx1 = Number(item.source_index)
    if (!Number.isFinite(idx1) || idx1 < 1 || idx1 > truncated.length) continue
    const primary = truncated[idx1 - 1]

    // Anti-LinkedIn-personal: si la fuente PRIMARIA es un perfil personal de LinkedIn,
    // descartamos. Job postings (linkedin.com/jobs/...) o paginas de empresa
    // (linkedin.com/company/...) si son validas.
    if (isPersonalLinkedInProfile(primary.url)) {
      droppedByLinkedInProfile++
      continue
    }

    // DOBLE CHECK anti-contaminacion cruzada (mas permisivo que la version anterior):
    // El finding sobrevive si AL MENOS UNA de estas evidencias menciona a la empresa:
    //   1. evidence_detail (cita literal del LLM)
    //   2. titulo de la fuente primaria
    //   3. URL de la fuente primaria (cubre slugs tipo /arcosdorados/...)
    // Si NINGUNA menciona la empresa, es highly likely que sea un cross-mention.
    // Como capa adicional: si el documento fuente NO menciona la empresa,
    // exigimos al menos un marcador concreto (vendor whitelist, numero, fecha).
    const detail = String(item.evidence_detail ?? "")
    const mentionsInDetail = textMentionsAnyToken(detail, matchTokens)
    const mentionsInSourceTitle = textMentionsAnyToken(primary.title ?? "", matchTokens)
    const mentionsInSourceUrl = textMentionsAnyToken(primary.url ?? "", matchTokens)

    if (!mentionsInDetail && !mentionsInSourceTitle && !mentionsInSourceUrl) {
      droppedByOrphanFinding++
      continue
    }

    // Si la fuente NO es claramente sobre la empresa (ni titulo ni URL la
    // mencionan), y el LLM solo logro citarla en evidence_detail, exigimos
    // marcador concreto para evitar alucinaciones. Reportes ESG/sectoriales
    // que mencionan a la empresa al pasar caen aca.
    if (!mentionsInSourceTitle && !mentionsInSourceUrl) {
      if (!hasConcreteEvidenceMarker(detail)) {
        droppedByOrphanFinding++
        continue
      }
    }

    const agent = String(item.micro_agent ?? "").toLowerCase()
    if (!validAgents.has(agent)) continue

    const level = String(item.evidence_level ?? "").toLowerCase() as EvidenceLevel
    if (!validLevels.has(level)) continue
    if (level === "sin_evidencia") continue // no publicamos esos por default

    const supportingIdx = Array.isArray(item.supporting_source_indexes)
      ? item.supporting_source_indexes
          .map((n: any) => Number(n))
          .filter((n: number) => Number.isFinite(n) && n >= 1 && n <= truncated.length && n !== idx1)
      : []
    // Filtramos tambien los supporting que sean perfiles personales
    const supportingExcerpts = supportingIdx
      .map((n: number) => truncated[n - 1])
      .filter((e: FlatExcerpt) => !isPersonalLinkedInProfile(e.url))

    mapped.push({ item, primary, supportingExcerpts })
  }

  if (droppedByLinkedInProfile > 0) {
    console.log(`[v0][tech-radar][anti-linkedin] dropped ${droppedByLinkedInProfile} con fuente primaria = perfil personal`)
  }
  if (droppedByOrphanFinding > 0) {
    console.log(`[v0][tech-radar][anti-orphan] dropped ${droppedByOrphanFinding} sin mencion en detail/title/url o sin marcador concreto cuando la fuente no era clara`)
  }
  console.log(`[v0][tech-radar][mapping] ${mapped.length}/${nonObviousFindings.length} hallazgos validos`)

  // Retry con prompt relajado (capa H del relevamiento). Si rawFindings tenia
  // contenido pero los filtros lo dejaron en 0, le damos a Gemini un segundo
  // intento con un prompt mas permisivo. Los filtros de codigo (anti-obviedad,
  // anti-LinkedIn-personal, doble check) siguen aplicandose, asi que el riesgo
  // de ruido es controlado.
  if (mapped.length === 0 && rawFindings.length > 0) {
    console.log(`[v0][tech-radar][retry] rawFindings tenia ${rawFindings.length} items pero todos cayeron por filtros. Reintentando con prompt relajado...`)
    const retried = await retryWithRelaxedPrompt({
      userPrompt,
      truncated,
      matchTokens,
      bundleStats,
      digest,
      aiProvider,
    })
    if (retried.mapped.length > 0) {
      mapped.push(...retried.mapped)
      aiProvider = retried.aiProvider
      console.log(`[v0][tech-radar][retry] recuperados ${retried.mapped.length} findings con prompt relajado`)
    } else {
      console.log("[v0][tech-radar][retry] tambien devolvio 0 - rendimos.")
    }
  }

  if (mapped.length === 0) {
    return { findings: [], digest, bundle_stats: bundleStats, ai_provider: aiProvider }
  }

  // Paso 6: liveness check de URLs primarias
  const candidateUrls = mapped.map((m) => m.primary.url)
  const aliveUrls = await checkUrlsAlive(candidateUrls, { context: "tech-radar" })
  const aliveMapped = mapped.filter((m) => aliveUrls.has(m.primary.url))
  if (aliveMapped.length !== mapped.length) {
    console.log(`[v0][tech-radar][mapping] dropped ${mapped.length - aliveMapped.length} por links muertos`)
  }

  // Paso 7: armar output final
  const findings: TechRadarFinding[] = aliveMapped.map(({ item, primary, supportingExcerpts }) => {
    let hostname = "fuente"
    try {
      hostname = new URL(primary.url).hostname.replace(/^www\./, "")
    } catch {}

    const supportingUrls = Array.from(new Set(supportingExcerpts.map((e) => e.url).filter(Boolean)))

    return {
      micro_agent: item.micro_agent as MicroAgent,
      title: String(item.title ?? "").slice(0, 240),
      summary: String(item.summary ?? "").slice(0, 1200),
      technology: item.technology ? String(item.technology).slice(0, 240) : null,
      provider_name: item.provider_name ? String(item.provider_name).slice(0, 240) : null,
      area: item.area ? String(item.area).slice(0, 80) : null,
      results: item.results ? String(item.results).slice(0, 800) : null,
      evidence_level: item.evidence_level as EvidenceLevel,
      evidence_detail: item.evidence_detail ? String(item.evidence_detail).slice(0, 400) : null,
      source_url: primary.url,
      source_name: item.source_name ? String(item.source_name).slice(0, 120) : hostname,
      supporting_source_urls: supportingUrls,
      convergent_sources: 1 + supportingUrls.length,
      published_at: sanitizeDate(item.published_at) || sanitizeDate(primary.publish_date),
    }
  })

  return { findings, digest, bundle_stats: bundleStats, ai_provider: aiProvider }
}

// ── Anti-obviedad ──────────────────────────────────────────────────────
/**
 * Patrones de "fake insight" tipicos cuando el LLM se basa en perfiles
 * personales o pagina corporativa generica.
 *
 * El finding se RECHAZA si su title+summary matchea alguno de estos patrones
 * Y NO incluye al menos una evidencia concreta (vendor especifico, numero,
 * fecha de implementacion, etc.).
 */
const OBVIOUS_PATTERNS: RegExp[] = [
  // "tiene/posee/cuenta con un departamento/equipo/area/division de X"
  /\b(tiene|posee|cuenta\s+con|dispone\s+de|opera|maneja|mantiene)\s+(un|una|el|la|su|sus|los|las)?\s*(departamento|equipo|area|área|division|división|sector|grupo)\s+de\b/i,
  // "tiene infraestructura/sistema/plataforma" sin nombrar producto
  /\b(tiene|posee|cuenta\s+con)\s+(un|una|sus?)\s*(infraestructura|sistema|plataforma|solucion|solución|capacidad|recursos)\s+(tecnologic|de\s+gestion|de\s+gestión|propia|robusta|moderna)/i,
  // genericidades
  /\b(usa|utiliza|emplea)\s+(internet|email|correo\s+electronico|computadoras|tecnologia)\b/i,
  /\b(tiene|posee)\s+(sitio\s+web|presencia\s+online|presencia\s+digital|pagina\s+web)\b/i,
  /\b(invierte|invirtio|invirtió)\s+en\s+(tecnologia|innovacion|innovación|transformacion\s+digital|transformación\s+digital)\b/i,
  /\b(esta|está)\s+(en|atravesando)\s+(proceso\s+de\s+transformacion|proceso\s+de\s+transformación|transformacion\s+digital|transformación\s+digital)\b/i,
  // "se preocupa por la seguridad", "prioriza la innovacion"
  /\b(se\s+preocupa|prioriza|valora|apuesta)\s+(la\s+|por\s+la\s+|el\s+|por\s+el\s+)/i,
]

/**
 * Indicios de evidencia concreta. Si el title o summary los contiene, el item
 * sobrevive aunque haya matcheado un OBVIOUS_PATTERN (porque al menos da algo
 * accionable junto con la afirmacion generica).
 */
const CONCRETE_EVIDENCE_PATTERNS: RegExp[] = [
  // vendors / productos especificos. Lista ampliada para cubrir el ecosistema
  // LATAM/Iberia/EEUU completo. Incluye plataformas, suites, RPA, observabilidad,
  // contact center, identity, MDM, industria, fintech, ecommerce, y consultoras.
  /\b(SAP(?:\s+(?:S\/4HANA|HANA|Ariba|SuccessFactors|BW|Fiori|Concur|Hybris))?|Oracle(?:\s+(?:Cloud|EBS|NetSuite|Hyperion|Fusion|WMS))?|NetSuite|JD\s+Edwards|Salesforce(?:\s+(?:Sales|Service|Marketing|Commerce|Pardot|Tableau|MuleSoft|Slack))?|Microsoft\s+(?:Dynamics(?:\s+365)?|Azure|365|Office|Teams|Power\s*Apps|Power\s*Automate|Power\s*Platform|Power\s*BI|Fabric|Sentinel|Defender|Intune|Copilot|Viva|SharePoint|Sentinel|Synapse|Purview)|AWS|Amazon\s+(?:Web\s+Services|RDS|S3|EC2|EKS|ECS|Aurora|Redshift|DynamoDB|SageMaker|Lambda|CloudFront|Athena)|GCP|Google\s+(?:Cloud|Workspace|Vertex\s+AI|BigQuery|Looker|Looker\s+Studio|Anthos|Apigee|Firebase)|Workday|SuccessFactors|Bamboo\s*HR|Cornerstone|Workato|Boomi|MuleSoft|Informatica|Talend|Fivetran|dbt|Airbyte|HubSpot|Zendesk|ServiceNow|Freshdesk|Intercom|Genesys|Five9|NICE|Avaya|Twilio|Talkdesk|Snowflake|Databricks|Cloudera|Confluent|Kafka|Tableau|Power\s*BI|PowerBI|Looker|Qlik|MicroStrategy|Sigma|ThoughtSpot|Datadog|New\s+Relic|Dynatrace|Splunk|Grafana|Elastic|ELK|Sumo\s+Logic|AppDynamics|Honeycomb|Sentry|Okta|Auth0|Ping|OneLogin|SailPoint|CyberArk|CrowdStrike|SentinelOne|Palo\s+Alto(?:\s+Networks)?|Fortinet|Check\s+Point|Trellix|McAfee|Symantec|Sophos|Trend\s+Micro|Kaspersky|Bitdefender|Tenable|Qualys|Rapid7|Cisco(?:\s+(?:Meraki|Umbrella|Webex))?|Aruba|Juniper|Dell(?:\s+(?:EMC|VMware|PowerStore))?|HP(?:E)?|Lenovo|NetApp|Pure\s+Storage|VMware|Citrix|Nutanix|UiPath|Automation\s+Anywhere|Blue\s+Prism|Slack|GitHub|GitLab|Bitbucket|Jenkins|CircleCI|Travis|ArgoCD|Jira|Confluence|Atlassian|Asana|Notion|Monday|Trello|Kubernetes|OpenShift|Docker|Rancher|Terraform|Ansible|Puppet|Chef|MongoDB|PostgreSQL|MySQL|MariaDB|Redis|Cassandra|DynamoDB|Couchbase|Elasticsearch|OpenSearch|RabbitMQ|ActiveMQ|Globant|Accenture|Deloitte|McKinsey|BCG|Bain|EY|KPMG|PwC|IBM(?:\s+Consulting)?|Capgemini|TCS|Infosys|Wipro|Cognizant|HCL|NTT\s+Data|Atos|DXC|Stefanini|BairesDev|VTEX|Magento|Shopify|WooCommerce|BigCommerce|Adobe(?:\s+(?:Experience|Commerce|Analytics|Target|Campaign|Sign|Marketo))?|Marketo|Eloqua|Mailchimp|SendGrid|Klaviyo|Braze|Iterable|Veeva|Epic|Cerner|Allscripts|Sage|Infor|Epicor|Adempiere|Odoo|Zoho|Coupa|Ariba|Concur|Stripe|Mercado\s+Pago|MercadoLibre|MercadoLibre\s+Marketplace|PayPal|Square|Adyen|Worldpay|Cybersource|dLocal|Ualá|Modo|Naranja|Visa|Mastercard|American\s+Express|Verifone|Ingenico|Clover|Toast|Aloha|NCR|Olo|Manhattan|Blue\s+Yonder|JDA|Korber|Manhattan\s+Associates|TGW|Dematic|Honeywell|Zebra|RFID|Symbol|Datalogic|AS\/?400|IBM\s+i|iSeries|COBOL|Mainframe|Z\/?OS|GitHub\s+Copilot|ChatGPT(?:\s+Enterprise)?|OpenAI|Anthropic(?:\s+Claude)?|Claude|Gemini|Llama|Mistral|Hugging\s+Face|LangChain|Pinecone|Weaviate|Vertex\s+AI|SageMaker|Bedrock|Azure\s+OpenAI)\b/i,
  // numeros con unidad
  /\b\d+\s*(licencias?|usuarios?|empleados?|tiendas?|sucursales?|nodos?|servidores?|millones?|mil)\b/i,
  // porcentajes
  /\b\d+\s*%/,
  // fechas explicitas
  /\b(en|desde|durante|hacia)\s+(20\d{2}|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i,
  // dinero
  /(USD|US\$|U\$S|\$ARS|AR\$|EUR|€)\s*[\d.,]+/i,
  // referencias a documentos / casos
  /\b(case\s+study|caso\s+de\s+exito|caso\s+de\s+éxito|comunicado|press\s+release|licitaci[oó]n|RFP|contrato\s+adjudicado)\b/i,
]

function isNonObviousFinding(item: any): boolean {
  const text = `${item?.title ?? ""} ${item?.summary ?? ""} ${item?.evidence_detail ?? ""}`.toLowerCase()

  // Si nombra un vendor/numero/fecha/caso concreto, el finding es valido
  // aun si tambien tiene frases genericas.
  const hasConcrete = CONCRETE_EVIDENCE_PATTERNS.some((re) => re.test(text))
  if (hasConcrete) return true

  // Si NO tiene evidencia concreta y matchea algun patron de obviedad: descartar.
  const isObvious = OBVIOUS_PATTERNS.some((re) => re.test(text))
  if (isObvious) return false

  // Validacion adicional: si NO matchea ningun OBVIOUS_PATTERN pero TAMPOCO
  // tiene technology o provider_name, es un item demasiado vago. Lo dejamos
  // pasar solo si tiene evidence_detail con algo de sustancia (>50 chars).
  const hasTech = item?.technology && String(item.technology).trim().length >= 3
  const hasProvider = item?.provider_name && String(item.provider_name).trim().length >= 3
  const hasEvidenceDetail = item?.evidence_detail && String(item.evidence_detail).trim().length >= 50
  if (!hasTech && !hasProvider && !hasEvidenceDetail) return false

  return true
}

/**
 * Verifica que el evidence_detail tenga al menos un MARCADOR concreto: vendor
 * conocido, numero, porcentaje, fecha, dinero o referencia a documento.
 * Reusa los CONCRETE_EVIDENCE_PATTERNS ya definidos para anti-obviedad.
 */
function hasConcreteEvidenceMarker(text: string): boolean {
  if (!text || text.trim().length < 20) return false
  return CONCRETE_EVIDENCE_PATTERNS.some((re) => re.test(text))
}

/**
 * Detecta perfiles personales de LinkedIn. Mantiene job postings y company pages.
 */
function isPersonalLinkedInProfile(url: string): boolean {
  try {
    const u = new URL(url)
    if (!u.hostname.includes("linkedin.com")) return false
    return /^\/in\//i.test(u.pathname)
  } catch {
    return false
  }
}

// ── Date helper local (igual al de los routes) ─────────────────────────
function sanitizeDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  if (/XX|TBD|unknown/i.test(dateStr)) return null
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return null
  const now = new Date()
  const threeYearsAgo = new Date()
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3)
  if (date > now || date < threeYearsAgo) return null
  return date.toISOString().split("T")[0]
}

// ── Aliases / match tokens (B del relevamiento) ──────────────────────────
/**
 * Tira los sufijos legales tipicos del nombre de la empresa.
 * Ej. "Jeronimo Martins SGPS S.A." → "Jeronimo Martins"
 */
const LEGAL_SUFFIX_PATTERNS: RegExp[] = [
  /\b(s\.?\s*a\.?(?:\s*b\.?)?(?:\s*de\s*c\.?\s*v\.?)?)\b\.?$/i,
  /\b(s\.?\s*l\.?(?:\s*u\.?)?)\b\.?$/i,
  /\b(s\.?\s*r\.?\s*l\.?)\b\.?$/i,
  /\b(s\.?\s*a\.?\s*s\.?)\b\.?$/i,
  /\b(c\.?\s*a\.?)\b\.?$/i,
  /\b(ltda?\.?)\b\.?$/i,
  /\b(inc\.?)\b\.?$/i,
  /\b(corp(?:oration)?\.?)\b\.?$/i,
  /\b(co\.?)\b\.?$/i,
  /\b(plc\.?)\b\.?$/i,
  /\b(gmbh)\b\.?$/i,
  /\b(ag)\b\.?$/i,
  /\b(holdings?)\b\.?$/i,
  /\b(group)\b\.?$/i,
  /\b(sgps)\b\.?$/i,
  /\b(spa)\b\.?$/i,
  /\b(nv)\b\.?$/i,
  /\b(bv)\b\.?$/i,
]

function stripLegalSuffix(name: string): string {
  let result = String(name ?? "").trim()
  // Aplicamos hasta 3 veces para sacar combinaciones tipo "X SGPS S.A."
  for (let i = 0; i < 3; i++) {
    const before = result
    for (const re of LEGAL_SUFFIX_PATTERNS) {
      result = result.replace(re, "").trim()
      result = result.replace(/[,;]+$/, "").trim()
    }
    if (result === before) break
  }
  return result
}

const STOPWORDS_TOKEN = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "que",
  "del",
  "los",
  "las",
  "una",
  "uno",
  "por",
  "para",
  "como",
  "este",
  "esta",
  "more",
  "less",
  "group",
  "grupo",
  "company",
  "compania",
  "compañia",
  "compañía",
  "holding",
  "holdings",
])

function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOPWORDS_TOKEN.has(t))
}

/**
 * Construye los tokens que usamos para detectar menciones a la empresa.
 * Combina:
 *  - tokens del nombre legal
 *  - nombre sin sufijos legales
 *  - primera palabra (si tiene >=4 chars)
 *  - aliases provistos
 *  - ticker
 *  - linkedin slug
 */
export function buildCompanyMatchTokens(input: {
  name: string
  aliases?: string[]
  ticker?: string | null
  linkedinSlug?: string | null
}): string[] {
  const tokens = new Set<string>()

  // Nombre completo
  for (const t of tokenize(input.name)) tokens.add(t)

  // Nombre sin sufijos legales
  const stripped = stripLegalSuffix(input.name)
  if (stripped && stripped !== input.name) {
    for (const t of tokenize(stripped)) tokens.add(t)
  }

  // Primera palabra (suele ser la mas distintiva: "Jeronimo" en "Jeronimo Martins")
  const firstWord = stripped.trim().split(/\s+/)[0]
  if (firstWord) {
    const norm = firstWord
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
    if (norm.length >= 4 && !STOPWORDS_TOKEN.has(norm)) tokens.add(norm)
  }

  // Aliases provistos
  for (const alias of input.aliases ?? []) {
    for (const t of tokenize(alias)) tokens.add(t)
  }

  // Ticker (>=3 chars). Lo agregamos como string entero, normalizado.
  if (input.ticker) {
    const t = input.ticker.toLowerCase().trim()
    if (t.length >= 3) tokens.add(t)
  }

  // LinkedIn slug
  if (input.linkedinSlug) {
    const slug = input.linkedinSlug
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]/g, "")
    if (slug.length >= 3) tokens.add(slug)
  }

  return Array.from(tokens)
}

/**
 * True si `text` contiene alguno de los `tokens` (case-insensitive, normalizado).
 */
export function textMentionsAnyToken(text: string, tokens: string[]): boolean {
  if (!text || tokens.length === 0) return false
  const haystack = String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  return tokens.some((t) => haystack.includes(t))
}

/**
 * Filtra items dejando solo los que mencionan al menos un token de empresa
 * en alguno de los `fields`. Reemplazo de filterRelevantToCompany cuando
 * tenemos tokens precomputados (con aliases, ticker, etc.).
 */
function filterByCompanyTokens<T>(items: T[], tokens: string[], fields: (keyof T)[]): T[] {
  if (tokens.length === 0) return items
  return items.filter((item) =>
    fields.some((f) => {
      const v = item[f]
      return typeof v === "string" && textMentionsAnyToken(v, tokens)
    }),
  )
}

// ── Bundle dinamico de keywords del bookmark (C del relevamiento) ────────
/**
 * Cuando el bookmark tiene señales (ej. "ERP", "ciberseguridad"), agregamos
 * un 5to bundle que combina empresa + keyword + verbos de accion. Estas
 * queries tienden a traer la evidencia mas accionable.
 */
function buildKeywordsBundle(keywords: string[]): Bundle {
  const top = keywords.slice(0, 5)
  return {
    key: "bookmark",
    label: "Senales del bookmark",
    agents: [], // dejamos que Gemini clasifique segun corresponda
    queries: (c) =>
      top.map(
        (kw) =>
          `"${c}" "${kw}" implementación OR migración OR contrato OR partner OR proyecto OR licitación`,
      ),
  }
}

// ── Retry con prompt relajado (H del relevamiento) ───────────────────────
/**
 * Prompt mas permisivo: mantiene anti-obviedad y exige cita literal pero
 * NO requiere que la cita contenga el nombre de la empresa (el filtro de
 * codigo se encarga de validar que la fuente sea relevante).
 */
const TECH_RADAR_SYSTEM_RELAXED = `Eres un investigador de inteligencia tecnologica empresarial.
Recibis excerpts de paginas web sobre la empresa objetivo y tu output anterior fue rechazado por
filtros de calidad. Reintenta extrayendo hallazgos manteniendo SOLO estas reglas estrictas:

1. La empresa objetivo (entre comillas) debe ser USUARIA / CLIENTA / IMPLEMENTADORA de la tecnologia.
2. RECHAZAR hallazgos genericos sin tecnologia concreta (ej. "tiene departamento de IT", "usa internet").
3. CADA hallazgo debe identificar AL MENOS UNA evidencia: vendor especifico, numero, fecha, % o partner.
4. NO inventes URLs ni datos. Si no esta en los excerpts, no lo pongas.
5. evidence_detail: cita literal o cuasi-literal del excerpt (entre 30 y 200 chars). NO necesita repetir
   el nombre de la empresa textualmente — usa anaforas ("la empresa", "la cadena") si la fuente lo hace.
6. source_index OBLIGATORIO. NO mezcles fuentes.

Mismo JSON schema:
{
  "findings": [
    {
      "source_index": <int>,
      "supporting_source_indexes": [<int>...],
      "micro_agent": "bi_analytics|cloud|ipaas|ciberseguridad|workplace|devops|erp|ia_rpa|hardware|crm|telco|procurement_it|observabilidad|pagos|logistica|health_it|consultoria",
      "title": "<string>",
      "summary": "<string 2-3 oraciones>",
      "technology": "<string|null>",
      "provider_name": "<string|null>",
      "area": "<string|null>",
      "results": "<string|null>",
      "evidence_level": "directa|convergente|inferencia",
      "evidence_detail": "<cita literal>",
      "source_name": "<string>",
      "published_at": "<YYYY-MM-DD|null>"
    }
  ],
  "digest": "<string|null>"
}`

type FlatExcerptForRetry = {
  bundle_key: string
  url: string
  title: string
  publish_date: string | null
  content: string
}

async function retryWithRelaxedPrompt(args: {
  userPrompt: string
  truncated: FlatExcerptForRetry[]
  matchTokens: string[]
  bundleStats: { bundle: string; parallel_results: number; excerpts_chars: number }[]
  digest: string | null
  aiProvider: string
}): Promise<{ mapped: { item: any; primary: FlatExcerptForRetry; supportingExcerpts: FlatExcerptForRetry[] }[]; aiProvider: string }> {
  let parsed: { findings?: any[]; digest?: string | null } = { findings: [] }
  try {
    parsed = await structureWithLLM<{ findings?: any[]; digest?: string | null }>({
      systemPrompt: TECH_RADAR_SYSTEM_RELAXED,
      userPrompt: args.userPrompt,
      maxOutputTokens: 6000,
      temperature: 0.3,
      context: "tech-radar-retry",
    })
  } catch (err) {
    console.error("[v0][tech-radar][retry] gemini relaxed failed:", err)
    return { mapped: [], aiProvider: "gemini-failed-on-retry" }
  }

  const rawRetry = parsed.findings ?? []
  if (rawRetry.length === 0) return { mapped: [], aiProvider: "gemini-2.0-flash-relaxed" }

  // Aplicamos los mismos filtros que en el flow normal:
  // 1) anti-obviedad (sin cambios)
  // 2) doble check de pertenencia a la empresa (en mapping loop)
  const nonObvious = rawRetry.filter((f) => isNonObviousFinding(f))

  const validAgents = new Set<string>(MICRO_AGENTS)
  const validLevels = new Set<EvidenceLevel>(["directa", "convergente", "inferencia"])
  const mapped: { item: any; primary: FlatExcerptForRetry; supportingExcerpts: FlatExcerptForRetry[] }[] = []

  for (const item of nonObvious) {
    const idx1 = Number(item.source_index)
    if (!Number.isFinite(idx1) || idx1 < 1 || idx1 > args.truncated.length) continue
    const primary = args.truncated[idx1 - 1]
    if (isPersonalLinkedInProfile(primary.url)) continue

    const detail = String(item.evidence_detail ?? "")
    const mentionsInDetail = textMentionsAnyToken(detail, args.matchTokens)
    const mentionsInSourceTitle = textMentionsAnyToken(primary.title ?? "", args.matchTokens)
    const mentionsInSourceUrl = textMentionsAnyToken(primary.url ?? "", args.matchTokens)
    if (!mentionsInDetail && !mentionsInSourceTitle && !mentionsInSourceUrl) continue
    if (!mentionsInSourceTitle && !mentionsInSourceUrl && !hasConcreteEvidenceMarker(detail)) continue

    const agent = String(item.micro_agent ?? "").toLowerCase()
    if (!validAgents.has(agent)) continue
    const level = String(item.evidence_level ?? "").toLowerCase() as EvidenceLevel
    if (!validLevels.has(level)) continue

    const supportingIdx = Array.isArray(item.supporting_source_indexes)
      ? item.supporting_source_indexes
          .map((n: any) => Number(n))
          .filter((n: number) => Number.isFinite(n) && n >= 1 && n <= args.truncated.length && n !== idx1)
      : []
    const supportingExcerpts = supportingIdx
      .map((n: number) => args.truncated[n - 1])
      .filter((e: FlatExcerptForRetry) => !isPersonalLinkedInProfile(e.url))

    mapped.push({ item, primary, supportingExcerpts })
  }

  return { mapped, aiProvider: "gemini-2.0-flash-relaxed" }
}
