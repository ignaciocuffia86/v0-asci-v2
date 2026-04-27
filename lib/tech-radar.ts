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
import {
  structureWithLLM,
  filterRelevantToCompany,
  checkUrlsAlive,
  companyNameTokens,
} from "@/lib/ai-structurer"

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
  const agentLabels = bundle.agents.map((a) => MICRO_AGENT_LABELS[a]).join(", ")

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
}): Promise<TechRadarRunResult> {
  const { companyName, country, keywords } = input

  // Paso 1: ejecutar 4 bundles en paralelo
  console.log("[v0][tech-radar] running 4 bundles in parallel for", companyName)
  const bundlePromises = BUNDLES.map(async (bundle) => {
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

  // Paso 4: guardrail de relevancia (mencion explicita de la empresa)
  const beforeRelevance = rawFindings.length
  const relevantFindings = filterRelevantToCompany(rawFindings, companyName, ["title", "summary"])
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

  // Paso 4c: anti-contaminacion cruzada. Validar que el evidence_detail mencione
  // literalmente al nombre de la empresa objetivo. Si la "cita" no contiene
  // la empresa, es una alucinacion donde el LLM mezclo info de otra empresa
  // (tipico cuando un excerpt es un reporte ESG que pertenece a otra empresa
  // pero menciona a la nuestra como cliente/proveedor).
  const evidenceDetailFiltered = filterRelevantToCompany(
    nonObviousFindings,
    companyName,
    ["evidence_detail"],
  )
  if (evidenceDetailFiltered.length !== nonObviousFindings.length) {
    console.log(
      `[v0][tech-radar][anti-cross] dropped ${nonObviousFindings.length - evidenceDetailFiltered.length} sin empresa en evidence_detail`,
    )
  }

  // Paso 5: mapear source_index -> URL real, validar micro_agent y evidence_level
  type Mapped = { item: any; primary: FlatExcerpt; supportingExcerpts: FlatExcerpt[] }
  const mapped: Mapped[] = []
  const validAgents = new Set<string>(MICRO_AGENTS)
  const validLevels = new Set<EvidenceLevel>(["directa", "convergente", "inferencia", "sin_evidencia"])
  let droppedByLinkedInProfile = 0

  let droppedByCrossCompanyTitle = 0

  for (const item of evidenceDetailFiltered) {
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

    // Anti-contaminacion cruzada (capa 3): si el TITULO del documento fuente NO
    // contiene el nombre de la empresa objetivo, exigir que el evidence_detail
    // mencione la empresa Y al menos una pista de evidencia concreta (tecnologia,
    // vendor, partner, numero, fecha, %). Cubre los reportes ESG/sectoriales que
    // pertenecen a otra empresa pero mencionan a la nuestra de pasada.
    if (!sourceTitleMentionsCompany(primary.title, companyName)) {
      const detail = String(item.evidence_detail ?? "")
      if (!hasConcreteEvidenceMarker(detail)) {
        droppedByCrossCompanyTitle++
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
  if (droppedByCrossCompanyTitle > 0) {
    console.log(`[v0][tech-radar][anti-cross-title] dropped ${droppedByCrossCompanyTitle} con fuente cuyo titulo no menciona empresa y evidence_detail sin marcador concreto`)
  }
  console.log(`[v0][tech-radar][mapping] ${mapped.length}/${evidenceDetailFiltered.length} hallazgos validos`)

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
  // vendors / productos especificos comunes
  /\b(SAP|Oracle|Salesforce|Microsoft\s+(Dynamics|Azure|365|Office|Teams)|AWS|Amazon\s+Web|GCP|Google\s+Cloud|Workday|HubSpot|Zendesk|ServiceNow|Snowflake|Databricks|Tableau|PowerBI|Power\s*BI|Looker|Datadog|New\s+Relic|Dynatrace|Splunk|MuleSoft|Boomi|Okta|CrowdStrike|Palo\s+Alto|Fortinet|Cisco|Dell|HP|Lenovo|UiPath|Automation\s+Anywhere|Workato|Slack|GitHub|GitLab|Jenkins|Kubernetes|Docker|MongoDB|PostgreSQL|MySQL|Redis|Kafka|Globant|Accenture|Deloitte|McKinsey|IBM|Capgemini|Genesys|NICE|Twilio|VTEX|Magento|Shopify)\b/i,
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
 * Verifica si el TITULO de la fuente menciona el nombre de la empresa objetivo.
 * Si el titulo NO la menciona, el documento es probablemente sobre otra empresa
 * (reporte ESG cruzado, articulo sectorial, etc.) y los hallazgos requieren
 * mayor escrutinio.
 */
function sourceTitleMentionsCompany(title: string, companyName: string): boolean {
  const tokens = companyNameTokens(companyName)
  if (tokens.length === 0) return true // sin tokens utiles, no podemos juzgar
  const haystack = String(title ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  return tokens.some((t) => haystack.includes(t))
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
