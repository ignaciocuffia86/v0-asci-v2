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
import { structureWithLLM, filterRelevantToCompany, checkUrlsAlive } from "@/lib/ai-structurer"

// ── Catalogo de micro-agentes ──────────────────────────────────────────
export const MICRO_AGENTS = [
  "bi_analytics",
  "cloud",
  "ipaas",
  "ciberseguridad",
  "workplace",
  "devops",
  "erp",
  "ia_rpa",
  "hardware",
  "crm",
  "telco",
  "procurement_it",
  "observabilidad",
  "pagos",
  "logistica",
  "health_it",
  "consultoria",
] as const

export type MicroAgent = (typeof MICRO_AGENTS)[number]

export const MICRO_AGENT_LABELS: Record<MicroAgent, string> = {
  bi_analytics: "BI / Analytics / Data",
  cloud: "Cloud / IaaS / PaaS",
  ipaas: "Integración / APIs / iPaaS",
  ciberseguridad: "Ciberseguridad",
  workplace: "Digital Workplace / Colaboración",
  devops: "Desarrollo / Software / DevOps",
  erp: "ERP / Gestión Empresarial",
  ia_rpa: "IA / RPA / Automatización",
  hardware: "Hardware / Infraestructura",
  crm: "CRM / Customer Experience",
  telco: "Telecomunicaciones",
  procurement_it: "Procurement IT",
  observabilidad: "Monitoreo / Observabilidad",
  pagos: "Pagos / Fintech / POS",
  logistica: "Logística / WMS / RFID",
  health_it: "Health IT / Salud Digital",
  consultoria: "Consultoría / Servicios IT",
}

// Niveles de evidencia segun prompt de Claude (alineado con migracion 161)
export type EvidenceLevel = "directa" | "convergente" | "inferencia" | "sin_evidencia"

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

  // Paso 5: mapear source_index -> URL real, validar micro_agent y evidence_level
  type Mapped = { item: any; primary: FlatExcerpt; supportingExcerpts: FlatExcerpt[] }
  const mapped: Mapped[] = []
  const validAgents = new Set<string>(MICRO_AGENTS)
  const validLevels = new Set<EvidenceLevel>(["directa", "convergente", "inferencia", "sin_evidencia"])

  for (const item of relevantFindings) {
    const idx1 = Number(item.source_index)
    if (!Number.isFinite(idx1) || idx1 < 1 || idx1 > truncated.length) continue
    const primary = truncated[idx1 - 1]

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
    const supportingExcerpts = supportingIdx.map((n: number) => truncated[n - 1])

    mapped.push({ item, primary, supportingExcerpts })
  }

  console.log(`[v0][tech-radar][mapping] ${mapped.length}/${relevantFindings.length} hallazgos validos`)

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
