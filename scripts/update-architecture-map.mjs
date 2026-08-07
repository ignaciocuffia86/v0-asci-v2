/**
 * Actualiza docs/architecture-map.json con los cambios de arquitectura del
 * 2026-08-07 (centralizacion del research + upgrade a ai@7 + tech_radar_runs).
 *
 * Se hace por SCRIPT y no con ediciones de texto porque el archivo son ~3.800
 * lineas y una edicion de texto ya rompio la estructura una vez: el autofix del
 * editor absorbio el array `edges` COMPLETO dentro de `nodes` (109 -> 252 nodos,
 * edges desaparecido) produciendo un JSON valido pero estructuralmente corrupto.
 * Manipular el objeto y reserializar preserva las claves de nivel superior.
 *
 * Idempotente: se puede correr mas de una vez sin duplicar nodos ni aristas.
 */
import { readFileSync, writeFileSync } from "node:fs"

const PATH = "docs/architecture-map.json"
const j = JSON.parse(readFileSync(PATH, "utf8"))
const before = { nodes: j.nodes.length, edges: j.edges.length, dead: j.deadCode.length }

const node = (id) => {
  const n = j.nodes.find((x) => x.id === id)
  if (!n) throw new Error(`nodo inexistente: ${id}`)
  return n
}
const edge = (id) => {
  const e = j.edges.find((x) => x.id === id)
  if (!e) throw new Error(`arista inexistente: ${id}`)
  return e
}

// ── meta ────────────────────────────────────────────────────────────────────
j.meta.generatedAt = "2026-08-07"
j.meta.summary =
  "Monorepo Next.js único donde conviven ASCI v2 (producción, schema public) y ASCI v3 (multitenant, schema v3) sobre la MISMA base Supabase. El aislamiento es por schema, no por proyecto ni por base. Actualización 2026-08-07: se cerró la centralización del research. El Tech Radar dejó de recolectar con Parallel y ahora usa collectStructured (collect+structure por bundle) del motor único, con costo atribuido a feature 'radar-tech'; public-docs enruta su búsqueda por el AI Gateway (gateway.tools.parallelSearch), así que YA NO queda ninguna llamada directa al SDK parallel-web ni uso de PARALLEL_API_KEY en la app. Además se subió todo el stack AI SDK a ai@7 (providers a v4) y se agregó v3.tech_radar_runs como índice de corridas del radar."
j.meta.stats.sqlScripts = 239
j.meta.stats.tablesV3 = 49

// ── ext_parallel: ya NO es una llamada directa ni usa PARALLEL_API_KEY ──────
const parallel = node("ext_parallel")
parallel.desc =
  "Búsqueda web estructurada, ahora SIEMPRE vía AI Gateway (gateway.tools.parallelSearch). Su único consumidor es la búsqueda de documentos públicos (lib/parallel.ts -> searchPublicDocsViaGateway). news migró al motor de research y tech-radar a collectStructured, así que dejó de ser el recolector universal."
parallel.env = []
parallel.risk =
  "CORRIGE la nota anterior ('no es enrutable por el AI Gateway'), que solo era cierta para Parallel como MODEL provider (/v1/models no lo lista). Como TOOL sí es enrutable: gateway.tools.parallelSearch existe en @ai-sdk/gateway@4 (el que trae ai@7), se factura por AI_GATEWAY_API_KEY y la app ya NO necesita PARALLEL_API_KEY. Trade-off vigente: es una tool provider-executed, así que el objective y las search_queries las genera el MODELO; el código solo puede pinear el sourcePolicy (includeDomains/excludeDomains/afterDate), que es lo que sostiene el anti-contaminación. Además publishDate suele venir null."

// ── svc_tech_radar: migrado a collectStructured ─────────────────────────────
const radar = node("svc_tech_radar")
radar.desc =
  "Investigacion de implementaciones tecnologicas por empresa: 17 micro-agentes mapeados a 4 bundles tematicos (+1 dinamico de keywords). Cada bundle corre collectStructured (collect+structure) del motor de research, en paralelo. Ya NO recolecta con Parallel: pasa por el AI Gateway y registra costo con feature 'radar-tech' + companyId/workspaceId, y agrega el uso para que el caller lo persista en v3.tech_radar_runs."
radar.files = ["lib/tech-radar.ts", "lib/tech-radar-constants.ts", "lib/v3/tech-radar-runs.ts"]
radar.risk =
  "Tres trampas ya pagadas. 1) Su schema es deliberadamente LAXO (micro_agent y evidence_level como string, sin z.enum) porque el mapeo valida item por item y descarta el malo con `continue`: endurecerlo haría fallar la respuesta COMPLETA por un solo item ('se pierde 1 de 30' pasaría a 'se pierden los 30'). 2) NO fusionar collect+structure en un turno (experimental_output + tools): con Anthropic el modelo se saltea el web_search y responde el JSON sin buscar (medido: 0 búsquedas, 0 fuentes). 3) El structure de cada bundle debe ver SOLO las fuentes de SU bundle: juntar las de los 4 (~144) desacopla el informe de su fuente, el source_index apunta mal y el guardrail descarta el hallazgo bueno, dejando el radar en 0 hallazgos."

// ── api_research_v2: los 3 caminos pasan por el Gateway ─────────────────────
const apiResearch = node("api_research_v2")
apiResearch.desc =
  "Implementaciones, noticias y documentos publicos de una empresa. Los tres caminos pasan por el AI Gateway: news e implementations recolectan y estructuran con el motor de research (implementations vía el Tech Radar con collectStructured), y public-docs busca con gateway.tools.parallelSearch. Ninguno le pega directo al SDK parallel-web."
apiResearch.risk =
  "public-docs sigue sin hacer research real: descubre documentos (título/tipo/URL) pero NO extrae su contenido, así que su ai_provider es 'none'. Tenía un estructurador definido que nunca se llamaba y aun así estampaba el modelo en la base (29/29 filas sin hallazgos declarando gemini-2.0-flash). Se eliminó en vez de engancharlo: pedir hallazgos citados sobre títulos da alucinaciones CON formato de cita, peor que no tener nada porque parecen verificables. Falta extracción de PDFs (lib/parallel-extract.ts es la base aspiracional, hoy sin importadores: ver DEAD-06). Su costo de búsqueda se atribuye con feature 'research-collect' + metadata.stage 'public-docs-search', porque 'public-docs' no está en el CHECK de feature de ai_usage_log."

// ── svc_research_engine: sumar collectStructured ────────────────────────────
const engine = node("svc_research_engine")
engine.desc =
  "Circuito único collect -> structure -> verify para todo el research de v2 y v3. collect busca en la web server-side (anthropic/claude-haiku-4.5) y devuelve solo las fuentes CITADAS; structure usa generateObject + Zod (google/gemini-2.5-flash-lite); verify chequea que las URLs estén vivas. Expone además collectStructured, que encadena collect+structure sobre un MISMO conjunto acotado de fuentes (lo que usa el Tech Radar por bundle)."
engine.risk =
  "Tres trampas ya pagadas y documentadas en el código. 1) NO fijar maxOutputTokens: un tope de salida fue el gatillo del incidente de noticias (el modelo gasta el presupuesto razonando y corta el JSON a medias). 2) NUNCA usar .default() en Zod: marca el campo como OPCIONAL en el JSON Schema, el modelo lo omite y Zod rellena el default en silencio; así el digest de noticias no se generó nunca (0 de 3.542 filas). Medido: .default() 0/3, nullable requerido 3/3. 3) NO fusionar collect y structure en un turno con experimental_output + tools: el modelo se saltea el web_search y responde el JSON sin buscar (medido: 0 búsquedas). Por eso collectStructured son DOS turnos, acotados por bundle."

// ── aristas obsoletas ───────────────────────────────────────────────────────
// e38 apuntaba svc_tech_radar -> ext_parallel: el radar ya no toca Parallel.
// Hoy el unico consumidor vivo de lib/parallel.ts es la ruta public-docs.
const e38 = edge("e38")
e38.from = "api_research_v2"
e38.label = "public-docs: busca vía Gateway"

const e137 = edge("e137")
e137.label = "collectStructured (1 por bundle)"

// ── nodo nuevo: v3.tech_radar_runs ──────────────────────────────────────────
if (!j.nodes.find((n) => n.id === "db_tech_radar_runs")) {
  const at = j.nodes.findIndex((n) => n.id === "db_ai_usage")
  j.nodes.splice(at + 1, 0, {
    id: "db_tech_radar_runs",
    label: "v3.tech_radar_runs",
    zone: "v3",
    layer: 4,
    kind: "table",
    desc: "Índice de CORRIDAS del Tech Radar (auditoría + costo + fuente para el MCP): quién la disparó, cuándo, con qué keywords, cuánto costó y cuántos hallazgos produjo. Los hallazgos siguen viviendo en public.company_implementations; esta tabla es la vista por corrida. El caller distingue 'drilldown' (v2, workspace_id NULL) de 'campaign' (v3).",
    tables: ["v3.tech_radar_runs"],
    files: ["lib/v3/tech-radar-runs.ts", "scripts/442_v3_tech_radar_runs.sql"],
    notes:
      "Existe porque el radar dejaba evidencia pero NINGÚN rastro de la ejecución, y su costo caía huérfano en ai_usage_log (feature 'research-structure', company_id NULL) porque el camino que alimenta la UI no pasaba tracking. Vive en v3 para no tocar nada de v2, aunque uno de sus dos callers es de v2.",
  })
}

// ── aristas nuevas hacia la tabla de corridas ───────────────────────────────
const maxEdge = Math.max(...j.edges.map((e) => Number.parseInt(String(e.id).replace(/\D/g, ""), 10) || 0))
const newEdges = [
  {
    id: `e${maxEdge + 1}`,
    from: "api_research_v2",
    to: "db_tech_radar_runs",
    kind: "write",
    label: "corrida del radar (drilldown)",
  },
  {
    id: `e${maxEdge + 2}`,
    from: "svc_tech_radar",
    to: "db_ai_usage",
    kind: "write",
    label: "costo 'radar-tech' por bundle",
  },
]
for (const ne of newEdges) {
  if (!j.edges.find((e) => e.from === ne.from && e.to === ne.to && e.label === ne.label)) j.edges.push(ne)
}

// ── deadCode: parallelSearch y los builders ya se borraron ──────────────────
if (!j.deadCode.find((d) => d.id === "DEAD-14")) {
  j.deadCode.push({
    id: "DEAD-14",
    title: "RESUELTO: parallelSearch y los builders de queries de Parallel",
    severity: "resuelta",
    loc: 215,
    evidence: [
      "lib/parallel.ts ya no importa parallel-web",
      "buildNewsSearchParams y buildImplementationsSearchParams sin callers tras las migraciones",
    ],
    finding:
      "Al migrar news al motor de research y el Tech Radar a collectStructured, quedaron huérfanos la llamada directa parallelSearch, el cliente parallel-web y los dos builders de queries. Se borraron; sobreviven solo los tipos, buildPublicDocsSearchParams y searchPublicDocsViaGateway.",
    verification:
      "Grep de cada símbolo en todo el repo: sin referencias vivas. Borrar parallelSearch además bajó el baseline de tsc de 62 a 61 errores, porque su tipado de warnings era uno de los errores preexistentes.",
    recommendation:
      "Nada pendiente. Se conservan a propósito lib/parallel-extract.ts (DEAD-06) y lib/search/search-provider.ts (DEAD-07): el primero es la base aspiracional para extraer PDFs en public-docs.",
  })
}

// ── validacion de integridad referencial ────────────────────────────────────
const ids = new Set(j.nodes.map((n) => n.id))
const errs = []
for (const e of j.edges) {
  if (!ids.has(e.from)) errs.push(`arista ${e.id}: 'from' inexistente -> ${e.from}`)
  if (!ids.has(e.to)) errs.push(`arista ${e.id}: 'to' inexistente -> ${e.to}`)
}
const edgeIds = new Set(j.edges.map((e) => e.id))
for (const f of j.flows ?? []) {
  for (const s of f.steps ?? []) {
    if (s.nodeId && !ids.has(s.nodeId)) errs.push(`flujo ${f.id}: nodeId inexistente -> ${s.nodeId}`)
    if (s.edgeId && !edgeIds.has(s.edgeId)) errs.push(`flujo ${f.id}: edgeId inexistente -> ${s.edgeId}`)
  }
}
const dupNodes = j.nodes.map((n) => n.id).filter((id, i, a) => a.indexOf(id) !== i)
const dupEdges = j.edges.map((e) => e.id).filter((id, i, a) => a.indexOf(id) !== i)
if (dupNodes.length) errs.push(`nodos duplicados: ${dupNodes.join(", ")}`)
if (dupEdges.length) errs.push(`aristas duplicadas: ${dupEdges.join(", ")}`)

if (errs.length) {
  console.error("[v0] VALIDACION FALLIDA, no se escribe nada:")
  for (const e of errs) console.error("  -", e)
  process.exit(1)
}

writeFileSync(PATH, JSON.stringify(j, null, 2) + "\n")
console.log("[v0] OK. Claves:", Object.keys(j).join(", "))
console.log(`[v0] nodes ${before.nodes} -> ${j.nodes.length} | edges ${before.edges} -> ${j.edges.length} | deadCode ${before.dead} -> ${j.deadCode.length}`)
console.log("[v0] Integridad referencial: sin referencias rotas ni ids duplicados.")
