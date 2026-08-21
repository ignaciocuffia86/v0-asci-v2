/**
 * Actualiza docs/architecture-map.json con el retiro de Parallel (21-ago-2026).
 *
 * El mapa seguía describiendo a Parallel como una dependencia externa VIVA
 * ("su único consumidor es la búsqueda de documentos públicos"), y esa era la
 * última información de Parallel que quedaba en el repo. Con public-docs
 * migrado a `collect`, el nodo pasa a estado retirado en vez de borrarse: el
 * mapa documenta por qué existió y qué lo reemplazó, que es lo que evita que
 * alguien lo reintroduzca dentro de seis meses.
 *
 * Idempotente: correrlo dos veces deja el mismo resultado.
 */
import { readFileSync, writeFileSync } from "node:fs"

const PATH = "docs/architecture-map.json"
const j = JSON.parse(readFileSync(PATH, "utf8"))

const node = (id) => {
  const n = j.nodes.find((x) => x.id === id)
  if (!n) throw new Error(`Nodo inexistente: ${id}`)
  return n
}

// ── meta ────────────────────────────────────────────────────────────────────
j.meta.generatedAt = "2026-08-21"
j.meta.summary =
  "Monorepo Next.js único donde conviven ASCI v2 (producción, schema public) y ASCI v3 (multitenant, schema v3) sobre la MISMA base Supabase. El aislamiento es por schema, no por proyecto ni por base. Actualización 2026-08-21: Parallel quedó RETIRADO por completo. public-docs, su último consumidor, migró a `collect` del motor de research, y se borró lib/parallel.ts. Además la búsqueda de noticias se unificó en lib/shared/news-search.ts (dos bundles profundos con haiku, ~US$0,20 por cuenta, sin cupo ni confirmación de costo), que usan tanto /api/research/news de v2 como el bookmark de v3; y company_news.source dejó de estampar 'parallel' para todo: ahora dice 'research' y la procedencia real vive en produced_by + ai_provider."

// ── ext_parallel: retirado, no borrado ──────────────────────────────────────
const parallel = node("ext_parallel")
parallel.label = "Parallel.ai (retirado)"
parallel.desc =
  "RETIRADO el 21-ago-2026. Fue el recolector web del research de v2 y del Tech Radar. Su último consumidor (public-docs) migró a `collect` del motor de research y lib/parallel.ts se borró: hoy NINGÚN camino del código lo llama, ni directo ni vía gateway.tools.parallelSearch."
parallel.files = []
parallel.env = []
parallel.risk =
  "Queda en el mapa para que no se lo reintroduzca por error. Por qué se fue: (1) como tool provider-executed, el objective y las search_queries las generaba el MODELO y el código solo podía pinear el sourcePolicy, así que el anti-contaminación dependía de config y no del prompt; (2) publishDate venía null casi siempre; (3) sus URLs indexadas incluían links ya muertos (~79% vivas contra 96-100% del camino nativo, medido en scripts/bench-search-providers.mts). Su rastro sucio más caro fue company_news.source, que estampó 'parallel' durante meses para filas producidas por cinco motores distintos y hacía imposible medir quién generó qué."

// ── api_research_v2 ─────────────────────────────────────────────────────────
const apiResearch = node("api_research_v2")
apiResearch.desc =
  "Implementaciones, noticias y documentos publicos de una empresa. Los tres caminos pasan por el AI Gateway y ninguno usa Parallel: news busca con lib/shared/news-search.ts (los mismos dos bundles que el bookmark de v3) y persiste con recordEvidenceBatch; implementations va via el Tech Radar con collectStructured; public-docs recolecta con `collect` a partir de buildPublicDocsPrompt."

// ── svc_tech_radar ──────────────────────────────────────────────────────────
const radar = node("svc_tech_radar")
radar.desc = radar.desc.replace(
  "Ya NO recolecta con Parallel: pasa por el AI Gateway",
  "Recolecta por el AI Gateway (Parallel está retirado)",
)

// ── flujo de research ───────────────────────────────────────────────────────
const flow = j.flows[4]
flow.desc =
  "Investiga evidencia externa de que la empresa usa una tecnología. La recolección ya NO está partida: tech-radar, public-docs y news recolectan los tres con el motor de research (collect / collectStructured). La estructuración también es única para los tres."
const step = flow.steps.find((s) => s.nodeId === "ext_parallel")
if (step) {
  step.nodeId = "svc_research_engine"
  step.detail =
    "Recolecta con búsqueda web server-side de Anthropic y devuelve SOLO las fuentes que el modelo citó. Antes este paso era Parallel (y antes de eso figuraba como Perplexity, que el código nunca llamó desde acá)."
}

// La arista al nodo retirado deja de describir una llamada viva.
const edge = j.edges.find((e) => e.to === "ext_parallel")
if (edge) {
  edge.kind = "retired"
  edge.label = "retirado: public-docs migró a collect"
}

// ── deadCode: lib/parallel-extract.ts ya no tiene un hermano vivo ────────────
const dead = j.deadCode.find((d) => d.title?.includes("parallel-extract"))
if (dead) {
  dead.evidence = ["ningun import de lib/parallel-extract", "lib/parallel.ts fue borrado el 21-ago-2026"]
  dead.finding =
    "Segundo módulo para Parallel.ai. El activo era lib/parallel.ts, que ya no existe: con Parallel retirado, este archivo quedó sin propósito y se puede borrar."
  dead.recommendation =
    "Borrar. Era la base aspiracional para extraer contenido de PDFs con Parallel; con Parallel retirado, si algún día se extrae PDF va a ser por otro camino."
}

writeFileSync(PATH, JSON.stringify(j, null, 2) + "\n")
console.log("architecture-map.json actualizado: Parallel retirado")
