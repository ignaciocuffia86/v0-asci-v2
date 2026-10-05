/**
 * Actualiza docs/architecture-map.json con lo que entró entre el 24-ago-2026 (última
 * pasada) y el 5-oct-2026: 78 commits sin merges sobre código real, revisados contra el
 * estado ACTUAL del repo (no contra el mensaje del commit).
 *
 * Qué cambió y por qué entra al mapa:
 *
 *  1. CUARTO SERVIDOR MCP (#136-#143, #147): /api/v3/mcp/admin. Registra las MISMAS tools
 *     que el estándar (lib/v3/mcp-server-tools.ts, una sola registración) y solo cambia
 *     instrucciones y descripciones. Efecto sobre OPT-07: el andamiaje estándar+admin ya
 *     está compartido; explore y profiles siguen con copia propia.
 *  2. CRONS DE APOLLO (#151, #154 y 934beef): v3-apollo-org-enrichment corre cada 10 min
 *     sobre una cola SEMBRADA (no descubre trabajo). v3-apollo-domain-lookup existe como
 *     ruta pero se SACÓ de vercel.json el 27-ago (#154): está pausado, no activo. El mapa
 *     no tenía ninguno de los dos.
 *  3. LOTES, SCREENING Y GASTO del MCP (Fase 3, #124-#145): tablas v3.mcp_screenings,
 *     mcp_exports, mcp_batch_plans/jobs/job_items y apify_runs; servicios de estimación,
 *     ejecución y costo (get_cost_summary).
 *  4. WEBHOOK DE APOLLO con camino v3 (#148): ya no escribe solo en public.user_company_contacts;
 *     el teléfono va al caché compartido y el estado a v3.account_contacts.
 *  5. Re-verificación de optimizations/deadCode abiertos: OPT-06 EMPEORÓ (13 -> 17
 *     archivos con createClient crudo), OPT-13 perdió su evidencia (csv-import.ts ya no
 *     existe), DEAD-12 quedó a medias (dictionary_term_suggestions ahora tiene lector),
 *     y se agrega OPT-17 por conteos de tools desactualizados.
 *
 * Stats medidos con comandos el 2026-10-05; tablesPublic/tablesV3 salen de
 * information_schema vía MCP de Supabase (solo lectura, proyecto grenlquhexbyneubtdub).
 *
 * Idempotente. Si la validación referencial falla no escribe nada y sale con código 1.
 *
 * Correr:  node scripts/update-architecture-map-2026-10-05.mjs
 *          node scripts/build-architecture-map.mjs
 */
import { readFileSync, writeFileSync } from "node:fs"

const PATH = "docs/architecture-map.json"
const j = JSON.parse(readFileSync(PATH, "utf8"))
const before = {
  nodes: j.nodes.length,
  edges: j.edges.length,
  flows: j.flows.length,
  cps: j.contactPoints.length,
  opts: j.optimizations.length,
  dead: j.deadCode.length,
}

const node = (id) => {
  const n = j.nodes.find((x) => x.id === id)
  if (!n) throw new Error(`Nodo inexistente: ${id}`)
  return n
}
const opt = (id) => {
  const o = j.optimizations.find((x) => x.id === id)
  if (!o) throw new Error(`Optimizacion inexistente: ${id}`)
  return o
}
const dead = (id) => {
  const d = j.deadCode.find((x) => x.id === id)
  if (!d) throw new Error(`DeadCode inexistente: ${id}`)
  return d
}
const cp = (id) => {
  const c = j.contactPoints.find((x) => x.id === id)
  if (!c) throw new Error(`ContactPoint inexistente: ${id}`)
  return c
}
/** Inserta un nodo despues de otro, sin duplicar si ya existe. */
const addNodeAfter = (afterId, n) => {
  if (j.nodes.some((x) => x.id === n.id)) {
    Object.assign(node(n.id), n)
    return
  }
  const at = j.nodes.findIndex((x) => x.id === afterId)
  j.nodes.splice(at + 1, 0, n)
}
/** Agrega una arista con id explicito, sin duplicar. */
const addEdge = (e) => {
  const existing = j.edges.find((x) => x.id === e.id)
  if (existing) Object.assign(existing, e)
  else j.edges.push(e)
}
/** Agrega un flujo, sin duplicar. */
const addFlow = (f) => {
  const at = j.flows.findIndex((x) => x.id === f.id)
  if (at >= 0) j.flows[at] = f
  else j.flows.push(f)
}
/** Agrega un punto de contacto, sin duplicar. */
const addContactPoint = (c) => {
  const at = j.contactPoints.findIndex((x) => x.id === c.id)
  if (at >= 0) j.contactPoints[at] = c
  else j.contactPoints.push(c)
}
/** Agrega una entrada de deadCode, sin duplicar. */
const addDead = (d) => {
  const at = j.deadCode.findIndex((x) => x.id === d.id)
  if (at >= 0) j.deadCode[at] = d
  else j.deadCode.push(d)
}

/** Agrega una optimizacion, sin duplicar. */
const addOpt = (o) => {
  const at = j.optimizations.findIndex((x) => x.id === o.id)
  if (at >= 0) j.optimizations[at] = o
  else j.optimizations.push(o)
}


// ═══════════════════════════════════════════════════════════════════════════
// meta
// ═══════════════════════════════════════════════════════════════════════════
const PREV_SUMMARY_MARK = "Actualización 2026-10-05"
j.meta.generatedAt = "2026-10-05"
if (!j.meta.summary.includes(PREV_SUMMARY_MARK)) {
  j.meta.summary +=
    " " + PREV_SUMMARY_MARK + " (78 commits desde el 24-ago): " +
    "(7) CUARTO SERVIDOR MCP, el perfil admin (/api/v3/mcp/admin), que comparte las 45 tools del estándar y solo cambia instrucciones y descripciones; el flujo de lotes (screen_account_list, estimate_batch, create_batch_job) y get_cost_summary están en esas tools. " +
    "(8) APOLLO CON COLAS SEMBRADAS: un cron nuevo (v3-apollo-org-enrichment) drena v3.apollo_company_enrichment sin descubrir trabajo por su cuenta; el barrido por nombre (v3-apollo-domain-lookup) existe pero está PAUSADO desde el 27-ago. " +
    "(9) El webhook de Apollo ahora también aterriza teléfonos en v3. " +
    "(10) Re-verificación: OPT-06 empeoró (17 archivos con createClient crudo, eran 13)."
}
j.meta.stats = {
  tsFiles: 490,
  apiRoutes: 58,
  pages: 50,
  crons: 13,
  sqlScripts: 268,
  migrations: 49,
  tablesPublic: 58,
  tablesV3: 68,
  mcpServers: 4,
  mcpTools: 56,
}

// ═══════════════════════════════════════════════════════════════════════════
// MCP admin y registración compartida
// ═══════════════════════════════════════════════════════════════════════════
const std = node("api_mcp_server")
std.label = "MCP estándar (45 tools)"
std.desc =
  "Perfil STANDARD, el que usa un cliente. Las 45 tools se registran UNA vez en lib/v3/mcp-server-tools.ts (registerV3Tools) y las comparte con el perfil admin; la ruta solo aporta sus instrucciones. Es el único server que conversa con las señales ya interpretadas por el diccionario. Instrumenta cada tool con auditoría y cuota vía proxy sobre server.tool. Scope base companies:read / signals:read / accounts:read."
std.files = ["app/api/v3/mcp/server/[transport]/route.ts", "lib/v3/mcp-server-tools.ts"]
std.risk =
  "La registración ya no está en la ruta (OPT-07 parcial), pero lib/v3/mcp-server-tools.ts tiene 681 líneas con casi todas las tools en una sola función. Los comentarios de las rutas dicen '44 tools' y se registran 45 (OPT-17)."

addNodeAfter("api_mcp_server", {
  id: "api_mcp_admin",
  label: "MCP admin (45 tools, mismas)",
  zone: "v3",
  layer: 2,
  kind: "mcp",
  desc:
    "Perfil del equipo de ASCI, ruta /api/v3/mcp/admin. No tiene tools propias: llama a createV3McpHandler con profile 'admin' y registra las mismas 45. Lo que cambia es el TEXTO (instrucciones + ADMIN_DESCRIPTION_RULES) porque el prompt es por server y no por credencial, y el comportamiento: una credencial sin el marcador unrestricted se rechaza en el handshake. Sin cupo mensual ni presupuesto de lote que frene; las dos excepciones son el gasto de Apollo (se avisa, no se pide permiso) y lo destructivo (remove_workspace_account, confirm_document_analysis). Todo queda medido con get_cost_summary.",
  files: ["app/api/v3/mcp/admin/[transport]/route.ts", "lib/v3/admin-workspace.ts"],
  notes:
    "Fase A-C del plan MCP admin (#136-#143). El workspace admin es una excepción declarada, no un hueco: ver docs/plan-mcp-admin.md.",
})
node("svc_v3_mcp_tools").files = [
  "lib/v3/mcp-read-tools.ts",
  "lib/v3/mcp-server-tools.ts",
  "lib/v3/mcp-account-lifecycle.ts",
  "lib/v3/mcp-client-ai.ts",
  "lib/v3/mcp-key-scopes.ts",
]
node("svc_v3_mcp_tools").desc =
  "Implementación de las tools de lectura, ciclo de vida de cuenta y circuito client-assisted. Los scopes por tipo de key viven en mcp-key-scopes.ts como fuente única (antes estaban duplicados y una key standard no alcanzaba nueve tools)."

addEdge({ id: "e-oct-170", from: "ext_mcp_client", to: "api_mcp_admin", kind: "call", label: "perfil admin (unrestricted)" })
addEdge({ id: "e-oct-171", from: "api_mcp_admin", to: "svc_v3_mcp_auth", kind: "call", label: "rechaza credencial no unrestricted" })
addEdge({ id: "e-oct-172", from: "api_mcp_admin", to: "svc_v3_usage", kind: "call", label: "auditoría" })
addEdge({ id: "e-oct-173", from: "api_mcp_admin", to: "svc_v3_mcp_tools", kind: "call", label: "mismas tools que el estándar" })

// ═══════════════════════════════════════════════════════════════════════════
// Lotes, screening y gasto del MCP
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_v3_mcp_tools", {
  id: "svc_v3_mcp_batch",
  label: "Lotes, screening y costo (MCP)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "screen_account_list (cruce de una lista de empresas contra el catálogo, con estado matched_no_signal explícito), estimate_batch (cotización con batchPlanHash), create_batch_job (ejecución autorizada por ese hash, que incluye los créditos de Apollo), create_export y get_cost_summary (cada número declara su calidad: IA medido, Apollo estimado, Apify medido por corrida). Spend ledger por empresa en lib/v3/services/spend-ledger.ts.",
  files: [
    "lib/v3/services/screen-account-list.ts",
    "lib/v3/services/mcp-batch-estimate.ts",
    "lib/v3/services/mcp-batch-job.ts",
    "lib/v3/services/mcp-export.ts",
    "lib/v3/services/mcp-cost-summary.ts",
    "lib/v3/services/spend-ledger.ts",
    "lib/v3/services/mcp-contact-phones.ts",
  ],
})
addNodeAfter("db_mcp_logs", {
  id: "db_mcp_batches",
  label: "v3.mcp_screenings / mcp_batch_*",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Screenings, planes de lote (hash), jobs e ítems, exports y corridas de Apify. Se midieron como existentes en las migraciones 20260824-20260826; sus columnas no se re-auditaron en esta pasada.",
  tables: ["v3.mcp_screenings", "v3.mcp_exports", "v3.mcp_batch_plans", "v3.mcp_batch_jobs", "v3.mcp_batch_job_items", "v3.apify_runs"],
})
addEdge({ id: "e-oct-174", from: "svc_v3_mcp_tools", to: "svc_v3_mcp_batch", kind: "call", label: "screen / estimate / batch / costo" })
addEdge({ id: "e-oct-175", from: "svc_v3_mcp_batch", to: "db_mcp_batches", kind: "write", label: "planes, jobs, exports" })

// ═══════════════════════════════════════════════════════════════════════════
// Apollo: crons, colas y webhook
// ═══════════════════════════════════════════════════════════════════════════
const apollo = node("svc_apollo")
apollo.label = "Apollo (18 módulos)"
apollo.desc =
  "Search, enrich, organizations (enrich y bulk_enrich), cache por hash de query, validación de títulos, parsers, dominio, y desde fines de agosto: runners de enrichment de organizaciones y de dominio por nombre, company-writer (qué columnas se escriben y solo sobre vacías), rate-limits y usage-stats. El pipeline de decisores vive en lib/shared/. Costo medido: organizations/enrich cuesta 1 crédito por empresa resuelta (la doc anterior decía que era gratis)."

addNodeAfter("db_apollo_cache", {
  id: "db_apollo_queues",
  label: "v3.apollo_company_enrichment / apollo_domain_lookup",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Colas SEMBRADAS de trabajo contra Apollo: los crons procesan solo filas pending y nunca salen a buscar candidatas. Autorizar otro lote es un INSERT, a propósito: barrer ~61.300 empresas con website sin resolver son ~38.000 créditos y esa decisión no le toca a un cron.",
  tables: ["v3.apollo_company_enrichment", "v3.apollo_domain_lookup"],
})
addNodeAfter("cron_v3_enrich_linkedin", {
  id: "cron_v3_apollo_org",
  label: "cron v3-apollo-org-enrichment (10m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Enrichment de companies contra Apollo drenando la cola v3.apollo_company_enrichment. El payload se empareja con la empresa por POSICIÓN y no por dominio (Apollo puede contestar arcor.com a un pedido de arcor.com.ar). Un lote que falla se reprograma a 30 min en vez de reintentarse, freno preventivo de cuota con margen 20 y lock con lease como process-queue. Con la cola vacía no llama a Apollo y gasta cero.",
  files: ["app/api/cron/v3-apollo-org-enrichment/route.ts", "lib/apollo/org-enrichment-runner.ts"],
})
addNodeAfter("cron_v3_apollo_org", {
  id: "cron_v3_apollo_domain",
  label: "cron v3-apollo-domain-lookup (PAUSADO)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Resuelve el dominio por nombre de las 420.753 companies sin website con el endpoint organizations/search, a 350 llamadas/hora. PAUSADO desde #154 (27-ago): su entrada salió de vercel.json, que es lo único que Vercel mira. La ruta, el runner y la cola siguen; reanudar es devolver la entrada al schedule y desplegar. No cuenta en stats.crons.",
  files: ["app/api/cron/v3-apollo-domain-lookup/route.ts", "lib/apollo/domain-lookup-runner.ts"],
  notes: "Solo se promueve a companies.website lo clasificado auto_ok, y solo sobre columnas vacías.",
})
addEdge({ id: "e-oct-176", from: "cron_v3_apollo_org", to: "svc_apollo", kind: "call", label: "bulk_enrich de organizaciones" })
addEdge({ id: "e-oct-177", from: "cron_v3_apollo_org", to: "db_apollo_queues", kind: "read", label: "filas pending" })
addEdge({ id: "e-oct-178", from: "cron_v3_apollo_domain", to: "svc_apollo", kind: "call", label: "organizations/search" })
addEdge({ id: "e-oct-179", from: "cron_v3_apollo_domain", to: "db_apollo_queues", kind: "read", label: "cola de dominios" })
addEdge({ id: "e-oct-180", from: "svc_apollo", to: "ext_apollo", kind: "call", label: "enrich / bulk_enrich / search" })

const hook = node("api_apollo_webhook")
hook.desc =
  "Callback de Apollo autenticado por secreto en el path. Desde #148 tiene dos caminos: v2 escribe en public.user_company_contacts y v3 (contact-phone-inbox.ts, llamado en un solo punto antes de las tres salidas) deja el número en el caché COMPARTIDO apollo_contacts_cache y el estado en v3.account_contacts. Dos reglas opuestas con test propio: el ESTADO solo se toca en filas pending (pedir es por workspace) y la FECHA de verificación se toca en todas las filas de esa persona (describe el dato, no el pedido)."
hook.files = ["app/api/webhooks/apollo/[secret]/route.ts", "lib/v3/services/contact-phone-inbox.ts"]
addEdge({ id: "e-oct-181", from: "api_apollo_webhook", to: "db_account_contacts", kind: "write", label: "estado del teléfono (v3)" })
addEdge({ id: "e-oct-182", from: "api_apollo_webhook", to: "db_apollo_cache", kind: "write", label: "teléfono al caché compartido" })

// ═══════════════════════════════════════════════════════════════════════════
// Re-verificación de optimizations / deadCode abiertos (5-oct-2026)
// ═══════════════════════════════════════════════════════════════════════════
const o5 = opt("OPT-05")
if (!o5.finding.includes("5-oct-2026")) {
  o5.finding += " Re-verificado el 5-oct-2026: sigue abierto. Ninguna migración posterior a la de RLS referencia cron_executions con un DELETE, y entró un cron más (v3-apollo-org-enrichment) que también registra ejecuciones; el conteo de filas (~1,3M) NO se re-midió en esta pasada."
}

const o6 = opt("OPT-06")
o6.title = "17 archivos instancian createClient crudo y saltean los helpers de Supabase (EMPEORÓ: eran 13)"
o6.evidence = [
  "17 archivos con import de @supabase/supabase-js fuera de lib/supabase/ (grep del 5-oct-2026)",
  "9 rutas de cron, app/actions/dictionary.ts, app/api/ingest/upload, app/api/landing-stats, app/api/v3/admin/normalize-country-phase5, components/v3/navbar.tsx",
  "NUEVOS desde el 24-ago: cron v3-apollo-org-enrichment, cron v3-apollo-domain-lookup, lib/apollo/{company-writer,domain-lookup-runner,org-enrichment-runner}.ts, lib/v3/services/account-brief-row.ts",
]
o6.finding =
  "Pasó de 13 a 17 archivos que instancian createClient de @supabase/supabase-js en vez de pasar por lib/supabase/{server,client,admin}.ts. La tendencia se invirtió: la baja anterior venía de borrados incidentales y esta alza viene de código nuevo (los dos crons de Apollo y sus runners copiaron el patrón). Nada lo impide: ni lint ni convención escrita."

const o7 = opt("OPT-07")
o7.title = "Las rutas MCP duplican el andamiaje — mejoró para estándar+admin, no para explore y profiles"
o7.evidence = [
  "lib/v3/mcp-server-tools.ts (681 líneas, createV3McpHandler + registerV3Tools, 45 tools)",
  "app/api/v3/mcp/explore/[transport]/route.ts (499 líneas, 8 tools)",
  "app/api/v3/mcp/profiles/[transport]/route.ts (307 líneas, 3 tools)",
]
o7.finding =
  "AVANZÓ A MEDIAS. El perfil estándar y el admin ya comparten una sola registración y un solo factory (createV3McpHandler en lib/v3/mcp-server-tools.ts), así que un arreglo de manejo de errores ahí se hace una vez. Explore (499 líneas) y Perfiles (307) siguen con su propia copia de transporte, auth, rate limit y mapa de nextAction. Un arreglo en esa parte hay que hacerlo tres veces, no cuatro."
o7.fix =
  "Hacer que Explore y Perfiles pasen por el mismo factory (recibiendo scope y lista de tools) y dejar en cada ruta solo sus tools e instrucciones. El factory ya existe y resolvió el caso estándar/admin."

const o13 = opt("OPT-13")
o13.evidence = [
  "79 archivos de app/lib/components usan .schema('v3')",
  "app/actions/v3/csv-import.ts YA NO EXISTE: el ejemplo citado antes desapareció",
]
o13.finding =
  "El acceso a v3 sigue dependiendo de recordar .schema('v3') en cada consulta, ahora en 79 archivos. El caso que ilustraba el hallazgo (csv-import.ts mezclando .from('csv_imports') con y sin schema) ya no está en el código —ningún archivo de app/ o lib/ referencia csv_imports—, pero el riesgo de fondo no cambió. El conteo de 79 es de archivos, no de llamadas."

const d3 = dead("DEAD-03")
d3.loc = 369
d3.finding = "Reemplazado por lib/v3/services/radar.ts y radar-agents.ts, que son los que usa el pipeline. Re-verificado el 5-oct-2026: el archivo existe (369 líneas, antes 340) y ningún archivo de app/, lib/ o components/ lo importa."

const d12 = dead("DEAD-12")
d12.title = "Tabla de v3 sin lector: bookmark_dedupe_log (dictionary_term_suggestions ya tiene lector)"
d12.evidence = ["v3.bookmark_dedupe_log", "lib/v3/services/dictionary.ts:304 lee v3.dictionary_term_suggestions"]
d12.finding =
  "dictionary_term_suggestions dejó de estar huérfana: lib/v3/services/dictionary.ts la lee y la escribe. bookmark_dedupe_log sigue sin aparecer en ningún .from() de app/, lib/ ni components/ (grep del 5-oct-2026). No se verificó si algo fuera del repo, como una función SQL o un script, la usa."

for (const [id, what] of [
  ["DEAD-04", "lib/v3/digest.ts (398 líneas)"],
  ["DEAD-05", "app/actions/search.ts (78 líneas)"],
  ["DEAD-09", "contacts-tab.tsx, news-tab.tsx y public-docs-tab.tsx"],
  ["DEAD-10", "components/theme-provider.tsx (11 líneas)"],
  ["DEAD-13", "lib/ai-structurer.ts (la única mención de structureWithLLM es un comentario en lib/research/engine.ts)"],
]) {
  const d = dead(id)
  if (!d.verification.includes("5-oct-2026"))
    d.verification += " Re-verificado el 5-oct-2026: " + what + " existe y no tiene importadores."
}
const d11 = dead("DEAD-11")
if (!d11.finding.includes("NO VERIFICADO"))
  d11.finding += " NO VERIFICADO el 5-oct-2026: es una variable del proyecto de Vercel, no está en el repo (solo se menciona en docs/), y esta pasada no la consultó."

addOpt({
  id: "OPT-17",
  title: "Los conteos de tools MCP en comentarios y docs no coinciden con el código",
  severity: "baja",
  area: "documentación",
  evidence: [
    "lib/v3/mcp-server-tools.ts: 45 server.tool( con nombre único (conteo del 5-oct-2026)",
    "app/api/v3/mcp/{server,admin}/[transport]/route.ts: comentarios dicen '44 tools'",
    "docs/mcp-inventario-y-perfiles.md: encabezado dice 54 tools y 39 para asci-v3",
  ],
  finding:
    "Se registran 45 tools estándar/admin + 8 de Explore + 3 de Perfiles = 56 únicas, y los comentarios y el inventario dicen otros números. No es un bug de ejecución, pero es el mismo tipo de dato viejo que este mapa existe para evitar: alguien que cuente las tools con el inventario va a encontrar una de menos o diez de menos.",
  why: "Un test ya lee las tools del código para que el catálogo de scopes no se desactualice (mcp-key-scopes); el conteo de los comentarios no tiene esa red.",
  fix: "Quitar el número de los comentarios de ruta (el código es la fuente) y regenerar el encabezado del inventario. No se corrigió acá porque esta rutina no toca app/ ni docs de MCP.",
})

// ═══════════════════════════════════════════════════════════════════════════
// Validacion de integridad referencial
// ═══════════════════════════════════════════════════════════════════════════
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
for (const c of j.contactPoints ?? []) {
  for (const n of c.nodes ?? []) if (!ids.has(n)) errs.push(`contactPoint ${c.id}: nodo inexistente -> ${n}`)
}
const dupNodes = j.nodes.map((n) => n.id).filter((id, i, a) => a.indexOf(id) !== i)
const dupEdges = j.edges.map((e) => e.id).filter((id, i, a) => a.indexOf(id) !== i)
const dupFlows = j.flows.map((f) => f.id).filter((id, i, a) => a.indexOf(id) !== i)
if (dupNodes.length) errs.push(`nodos duplicados: ${dupNodes.join(", ")}`)
if (dupEdges.length) errs.push(`aristas duplicadas: ${dupEdges.join(", ")}`)
if (dupFlows.length) errs.push(`flujos duplicados: ${dupFlows.join(", ")}`)

if (errs.length) {
  console.error("[v0] VALIDACION FALLIDA, no se escribe nada:")
  for (const e of errs) console.error("  -", e)
  process.exit(1)
}

writeFileSync(PATH, JSON.stringify(j, null, 2) + "\n")
console.log("[v0] OK. Claves:", Object.keys(j).join(", "))
console.log(
  `[v0] nodes ${before.nodes} -> ${j.nodes.length} | edges ${before.edges} -> ${j.edges.length} | ` +
    `flows ${before.flows} -> ${j.flows.length} | contactPoints ${before.cps} -> ${j.contactPoints.length} | ` +
    `optimizations ${before.opts} -> ${j.optimizations.length} | deadCode ${before.dead} -> ${j.deadCode.length}`,
)
console.log("[v0] Integridad referencial: sin referencias rotas ni ids duplicados.")
