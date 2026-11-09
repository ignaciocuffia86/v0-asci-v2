/**
 * Actualiza docs/architecture-map.json con lo que entró desde la pasada del
 * 24-ago-2026 hasta el 8-sep-2026 (HEAD de main al 9-nov-2026). Revisión de
 * ~70 commits sin merges, PRs #123-#154.
 *
 * Por qué hacía falta: el mapa decía "TRES servidores MCP, 48 tools", "12 crons",
 * "19 migraciones" y no conocía nada de lo que pasó con Apollo, el gasto, los
 * lotes y las listas. Medido hoy: 4 rutas MCP (standard y admin comparten las
 * mismas 45 tools), 13 crons en vercel.json, 49 migraciones.
 *
 * Qué cubre, por orden de peso:
 *   - MCP admin (#136 #138 #139 #140 #143): cuarta ruta /api/v3/mcp/admin; las
 *     tools se registran UNA vez en lib/v3/mcp-server-tools.ts y las comparten
 *     standard y admin. Cierra en buena parte OPT-07 (standard+admin); explore y
 *     profiles siguen con su propio andamiaje.
 *   - Listas y lotes (#124 #145 estimate_batch, create_batch_job, create_export,
 *     screen_account_list): mcp_screenings, mcp_exports, mcp_batch_*.
 *   - Gasto (#138 #142 #144): v3.apify_runs, get_cost_summary, batchPlanHash que
 *     autoriza créditos de Apollo.
 *   - Apollo: cola v3.apollo_company_enrichment drenada por un cron nuevo;
 *     barrido de dominio por nombre (cron creado en #151 y PAUSADO en #154: la
 *     ruta existe, vercel.json no la invoca); caché antes de pagar (#149);
 *     teléfonos por MCP (#147 #148 #150) y webhook con camino v3.
 *   - Identidad de contactos: contact_identities y contact_merges.
 *
 * Re-verificado (PASO 2): OPT-05 y OPT-06 EMPEORARON (se reescriben), OPT-07 pasa
 * a parcial; DEAD-03/04/05/09/10/13 siguen ciertos (sin importadores, archivos
 * presentes). Sin verificar: DEAD-11, DEAD-12 y OPT-08/09/11/13 (requieren
 * variables de entorno de Vercel o inspección de DB que no se hizo a fondo).
 *
 * Por script y no a mano: ver update-architecture-map-2026-08-24.mjs.
 * Idempotente. Valida integridad referencial antes de escribir; si falla, sale 1.
 *
 * Correr:  node scripts/update-architecture-map-2026-11-09.mjs
 *          node scripts/build-architecture-map.mjs
 */
import { readFileSync, writeFileSync } from "node:fs"

const PATH = "docs/architecture-map.json"
const j = JSON.parse(readFileSync(PATH, "utf8"))

const find = (arr, id, what) => {
  const x = arr.find((y) => y.id === id)
  if (!x) throw new Error(`${what} inexistente: ${id}`)
  return x
}
const node = (id) => find(j.nodes, id, "Nodo")
const opt = (id) => find(j.optimizations, id, "Optimizacion")
const dead = (id) => find(j.deadCode, id, "DeadCode")
const addNodeAfter = (afterId, n) => {
  const cur = j.nodes.find((x) => x.id === n.id)
  if (cur) return void Object.assign(cur, n)
  const at = j.nodes.findIndex((x) => x.id === afterId)
  if (at < 0) throw new Error(`Nodo ancla inexistente: ${afterId}`)
  j.nodes.splice(at + 1, 0, n)
}
const addEdge = (e) => {
  const cur = j.edges.find((x) => x.id === e.id)
  if (cur) Object.assign(cur, e)
  else j.edges.push(e)
}
const addFlow = (f) => {
  const at = j.flows.findIndex((x) => x.id === f.id)
  if (at >= 0) j.flows[at] = f
  else j.flows.push(f)
}

// ─── meta ───────────────────────────────────────────────────────────────────
const MARK = " Actualización 2026-11-09:"
j.meta.generatedAt = "2026-11-09"
j.meta.summary =
  j.meta.summary.split(MARK)[0] +
  MARK +
  " repaso de ~70 commits (#123-#154) desde la pasada del 24-ago. (1) CUATRO rutas MCP, no tres: se sumó /api/v3/mcp/admin (perfil del equipo, sin topes por el scope admin:unrestricted); standard y admin registran las MISMAS 45 tools desde lib/v3/mcp-server-tools.ts (56 tools únicas entre las cuatro rutas, contando Explore 8 y Perfiles 3). " +
  "(2) LISTAS Y LOTES por MCP: screen_account_list, estimate_batch, create_batch_job, create_export, con batchPlanHash que autoriza créditos de Apollo. " +
  "(3) EL GASTO SE MIDE: v3.apify_runs (una fila por corrida de Apify) y get_cost_summary; antes el costo de scraping del cron y de explore no quedaba registrado en ningún lado. " +
  "(4) APOLLO crece: cola v3.apollo_company_enrichment drenada por un cron nuevo (la cola se SIEMBRA, el cron no descubre trabajo), caché consultado antes de pagar (21,8% de las llamadas a people/match repetían una persona ya pagada), teléfonos por MCP con webhook con camino v3; el barrido de dominio por nombre existe pero está PAUSADO desde el 8-sep (ruta en pie, sin entrada en vercel.json). " +
  "(5) Identidad de contactos: contact_identities y fusión reversible (contact_merges). " +
  "(6) Hallazgos que EMPEORARON: OPT-05 (public.cron_executions pasó de ~1,3M a 1.969.363 filas sin retención) y OPT-06 (17 archivos con createClient crudo, 4 más que los 13 citados). Stats de tablas medidas en la base de producción (58 public, 68 v3)."
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

// ─── MCP: cuarta ruta, tools compartidas ────────────────────────────────────
const std = node("api_mcp_server")
std.label = "MCP estándar (45 tools)"
std.files = ["app/api/v3/mcp/server/[transport]/route.ts", "lib/v3/mcp-server-tools.ts"]
std.risk =
  "Ya no es una ruta monolítica: la ruta tiene 33 líneas y el registro de tools vive en lib/v3/mcp-server-tools.ts (681 líneas), compartido con el perfil admin. El andamiaje duplicado que queda está en Explore y Perfiles (ver OPT-07)."
std.notes =
  (std.notes || "").replace(/ Desde 2026-11-09.*$/s, "") +
  " Desde 2026-11-09: 45 tools (medido: 45 `server.tool(` en mcp-server-tools.ts, todas con nombre distinto). Se sumaron screen_account_list, estimate_batch, create_batch_job, get_batch_job, create_export, get_cost_summary y request_contact_phones. Los comentarios del código todavía dicen '44 tools'."
std.desc = std.desc.replace("El PRIMERO de los tres servidores MCP", "El PRIMERO de los cuatro servidores MCP")

addNodeAfter("api_mcp_server", {
  id: "api_mcp_admin",
  label: "MCP Admin (mismas 45 tools)",
  zone: "v3",
  layer: 2,
  kind: "mcp",
  desc: "Perfil del equipo de ASCI sobre el catálogo global. No tiene tools propias: llama a createV3McpHandler con profile 'admin' y registra las mismas 45 de lib/mcp-server-tools.ts. Lo propio son las `instructions` y ADMIN_DESCRIPTION_RULES (nueve reglas que reescriben descripciones: sin 'pedí confirmación', sin 'guardá la cuenta primero'). El acceso lo cierra el handshake: una credencial sin el marcador admin:unrestricted se rechaza; conocer la URL no alcanza. Sigue aplicando la confirmación de Apollo (prepare → planHash → run) y todo el registro de gasto.",
  files: ["app/api/v3/mcp/admin/[transport]/route.ts", "lib/v3/mcp-server-tools.ts", "lib/v3/mcp-key-scopes.ts", "lib/v3/admin-workspace.ts"],
  risk: "El flag unrestricted levanta los topes de cuenta y cupo. Falla cerrado: sin la variable del workspace admin no se puede emitir la key. Verificado en código, no probado contra producción en esta pasada.",
})
node("api_mcp_admin").desc = node("api_mcp_admin").desc.replace("lib/mcp-server-tools.ts", "lib/v3/mcp-server-tools.ts")

// ─── crons nuevos ───────────────────────────────────────────────────────────
addNodeAfter("cron_v3_enrich_linkedin", {
  id: "cron_v3_apollo_org",
  label: "cron v3-apollo-org-enrichment (10m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Drena v3.apollo_company_enrichment (status='pending') contra Apollo organizations/bulk_enrich: 1 crédito por cuenta resuelta. La cola NO se llena sola: sembrarla es el acto que autoriza el gasto; con la cola vacía no llama a Apollo. El payload se empareja con la empresa por POSICIÓN, no por dominio (Apollo puede contestar arcor.com a un pedido de arcor.com.ar). Lock con lease; un lote fallido se reprograma a 30 min.",
  files: ["app/api/cron/v3-apollo-org-enrichment/route.ts", "lib/apollo/org-enrichment-runner.ts", "lib/apollo/bulk-organizations.ts", "lib/apollo/company-writer.ts"],
})
addNodeAfter("cron_v3_apollo_org", {
  id: "cron_v3_apollo_domain",
  label: "cron v3-apollo-domain-lookup (PAUSADO)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Resuelve el dominio por nombre (organizations/search, gratuito) para las ~420.750 companies sin website, a 350 llamadas/hora de una cuota de 400. PAUSADO desde el 8-sep-2026 (#154): su entrada salió de vercel.json, así que Vercel no lo invoca. La ruta, el runner y la cola v3.apollo_domain_lookup siguen en pie (las filas quedan en pending); se corre a mano con el secreto de cron y ?dryRun=1&limit=N. Reanudar es devolver la entrada (cada 10 min) a vercel.json y desplegar. Solo promueve a companies.website lo clasificado auto_ok y solo sobre columnas vacías.",
  files: ["app/api/cron/v3-apollo-domain-lookup/route.ts", "lib/apollo/domain-lookup-runner.ts", "lib/apollo/domain-lookup.ts", "lib/apollo/rate-limits.ts"],
})

// ─── servicios nuevos ───────────────────────────────────────────────────────
addNodeAfter("svc_v3_icebreakers", {
  id: "svc_v3_lists_batches",
  label: "Listas y lotes por MCP",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "Ejecución directa sobre listas de cuentas: screen_account_list (cruza una lista con el catálogo y las señales), estimate_batch (cotiza con una sola confirmación y devuelve batchPlanHash), create_batch_job / get_batch_job (ejecutan el lote) y create_export. El batchPlanHash autoriza también los créditos de Apollo del lote (#140/#144): sin él cada cuenta pediría su propia confirmación. El icebreaker de lote es determinístico, sin IA.",
  files: ["lib/v3/services/screen-account-list.ts", "lib/v3/services/mcp-batch-estimate.ts", "lib/v3/services/mcp-batch-job.ts", "lib/v3/services/mcp-export.ts", "lib/v3/services/icebreaker-deterministic.ts", "lib/v3/services/icebreaker-template.ts", "lib/v3/services/icebreaker-register.ts"],
})
addNodeAfter("svc_v3_usage", {
  id: "svc_v3_spend",
  label: "Gasto: ledger y resumen de costos",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "get_cost_summary declara la calidad de cada número. spend-ledger registra una fila por corrida de Apify en v3.apify_runs: la unidad es la EMPRESA, no el usuario (el cron deduplica entre workspaces). Medido: US$0,0004 por vacante, 55% proxy residencial; usageTotalUsd NO incluye el alquiler fijo del actor (US$29,99). Para credenciales sin topes suma una vista compartida porque el 78% del gasto de IA no tiene workspace_id. usage-stats cuenta llamadas de Apollo desde apollo_api_calls.",
  files: ["lib/v3/services/spend-ledger.ts", "lib/v3/services/mcp-cost-summary.ts", "lib/apollo/usage-stats.ts"],
})
addNodeAfter("svc_v3_contacts", {
  id: "svc_v3_phones",
  label: "Teléfonos de contactos por MCP",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "request_contact_phones pide a Apollo los teléfonos que faltan. El webhook de Apollo ahora tiene camino v3 (contact-phone-inbox), llamado en UN punto antes de sus tres salidas: el número va al caché COMPARTIDO apollo_contacts_cache y el estado a v3.account_contacts, solo en filas 'pending' (si A pagó el reveal, B no queda 'received'). Backfill de 80 personas con teléfono ya pagado en v2. phone_status habla el vocabulario de v2 (lib/shared/phone-status.ts).",
  files: ["lib/v3/services/mcp-contact-phones.ts", "lib/v3/services/contact-phone-inbox.ts", "lib/shared/phone-status.ts"],
})
addNodeAfter("db_tech_radar_runs", {
  id: "db_mcp_batches",
  label: "v3.mcp_screenings / mcp_exports / mcp_batch_*",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "mcp_screenings, mcp_exports, mcp_batch_plans, mcp_batch_jobs y mcp_batch_job_items. Sin políticas: se leen y escriben solo con service role.",
  files: ["supabase/migrations/20260825015932_mcp_screenings_and_exports.sql", "supabase/migrations/20260825020834_mcp_batch_jobs.sql", "supabase/migrations/20260824210819_mcp_batch_plans.sql"],
})
addNodeAfter("db_mcp_batches", {
  id: "db_apify_runs",
  label: "v3.apify_runs",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Una fila por corrida de Apify con su costo. Única fuente del costo de scraping; cubre cron de primera pasada, mensual, kick de UI y explore.",
  files: ["supabase/migrations/20260826203230_ledger_de_gasto_por_empresa.sql"],
})
addNodeAfter("db_apify_runs", {
  id: "db_apollo_queues",
  label: "v3.apollo_company_enrichment / apollo_domain_lookup",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Colas sembradas que drenan los dos crons de Apollo. apollo_company_enrichment autoriza gasto al sembrarse; apollo_domain_lookup (~420.750 companies sin website) es gratuita pero consume cuota, y hoy no se drena (cron pausado).",
  files: ["supabase/migrations/20260826120000_apollo_enrichment_columnas_y_checkpoint.sql", "supabase/migrations/20260827205412_checkpoint_de_dominio_por_nombre.sql"],
})
addNodeAfter("db_apollo_queues", {
  id: "db_contact_identity",
  label: "public.contact_identities / v3.contact_merges",
  zone: "shared",
  layer: 4,
  kind: "table",
  desc: "Identidad de persona en el ETL: contacts ya no se deduplica solo por la URL cruda de LinkedIn (vanity que cambia, URN ofuscado en 6.386 filas, placeholders). contact_merges hace reversible la fusión de duplicados.",
  files: ["supabase/migrations/20260825000000_contact_identity_resolution.sql", "supabase/migrations/20260825001000_contact_merge.sql"],
})

node("api_apollo_webhook").desc =
  "Callback de Apollo autenticado por secreto en el path. Desde #148 escribe en v2 (user_company_contacts) y, en un único punto antes de sus tres salidas, delega el camino v3 a contact-phone-inbox."
node("svc_apollo").label = "Apollo (17 módulos)"
node("svc_apollo").desc = (node("svc_apollo").desc || "").split(" Medido 2026-11-09")[0] + " Medido 2026-11-09: 17 archivos en lib/apollo/. Antes de salir a Apollo se consulta apollo_contacts_cache: una fila significa que YA se pagó, tenga email o no (#149)."

// ─── aristas ────────────────────────────────────────────────────────────────
const E = [
  ["e_n01", "ext_mcp_client", "api_mcp_admin", "call", "tool call (admin:unrestricted)"],
  ["e_n02", "api_mcp_admin", "svc_v3_mcp_auth", "call", "rechaza credenciales sin el marcador"],
  ["e_n03", "api_mcp_admin", "svc_v3_mcp_tools", "call", "mismas 45 tools que standard"],
  ["e_n04", "api_mcp_admin", "svc_v3_usage", "call", "registro completo, sin topes"],
  ["e_n05", "api_mcp_server", "svc_v3_lists_batches", "call", "screen_account_list / lotes"],
  ["e_n06", "api_mcp_admin", "svc_v3_lists_batches", "call"],
  ["e_n07", "svc_v3_lists_batches", "db_mcp_batches", "write"],
  ["e_n08", "svc_v3_lists_batches", "svc_apollo", "call", "créditos autorizados por batchPlanHash"],
  ["e_n09", "cron_v3_apollo_org", "ext_apollo", "call", "organizations/bulk_enrich"],
  ["e_n10", "cron_v3_apollo_org", "db_apollo_queues", "read"],
  ["e_n11", "cron_v3_apollo_org", "db_companies", "write"],
  ["e_n12", "cron_v3_apollo_domain", "ext_apollo", "call", "organizations/search (pausado)"],
  ["e_n13", "cron_v3_apollo_domain", "db_apollo_queues", "read"],
  ["e_n14", "cron_v3_apollo_domain", "db_companies", "write", "solo website vacío y auto_ok"],
  ["e_n15", "svc_v3_spend", "db_apify_runs", "read"],
  ["e_n16", "svc_v3_jobs", "db_apify_runs", "write", "una fila por corrida"],
  ["e_n17", "api_mcp_server", "svc_v3_spend", "call", "get_cost_summary"],
  ["e_n18", "svc_v3_phones", "db_apollo_cache", "write", "número al caché compartido"],
  ["e_n19", "svc_v3_phones", "db_account_contacts", "write", "estado, solo filas pending"],
  ["e_n20", "api_apollo_webhook", "svc_v3_phones", "call", "camino v3"],
  ["e_n21", "api_mcp_server", "svc_v3_phones", "call", "request_contact_phones"],
  ["e_n22", "svc_etl", "db_contact_identity", "write"],
]
for (const [id, from, to, kind, label] of E) addEdge(label ? { id, from, to, kind, label } : { id, from, to, kind })

// ─── flujo ──────────────────────────────────────────────────────────────────
j.flows.find((f) => f.id === "f_mcp_tool").trigger = "Un agente IA invoca una de las 45 tools (standard o admin)"
addFlow({
  id: "f_batch_apollo",
  name: "Lote por MCP con créditos de Apollo",
  version: "v3",
  trigger: "Un agente pide procesar una lista de cuentas",
  desc: "Cotizar primero, ejecutar después, con UNA confirmación para todo el lote. El batchPlanHash liga lo cotizado a lo ejecutado; el crédito de un tercero es irreversible y la confirmación no se levanta ni en el perfil admin.",
  steps: [
    { n: 1, nodeId: "ext_mcp_client", detail: "screen_account_list cruza la lista con el catálogo; estimate_batch cotiza." },
    { n: 2, nodeId: "api_mcp_server", edgeId: "e_n05", detail: "Standard o admin llaman al servicio de lotes." },
    { n: 3, nodeId: "svc_v3_lists_batches", edgeId: "e_n07", detail: "Persiste plan y job; devuelve batchPlanHash." },
    { n: 4, nodeId: "svc_apollo", edgeId: "e_n08", detail: "run_contact_enrichment devuelve authorizedBy derivado de batch_job_id." },
    { n: 5, nodeId: "db_mcp_batches", detail: "Estado por ítem; el tope de cargos ya no recorta en silencio." },
  ],
})

// ─── hallazgos re-verificados ───────────────────────────────────────────────
const o5 = opt("OPT-05")
o5.severity = "alta"
o5.title = "EMPEORÓ: cron_executions ya tiene RLS, pero sigue sin retención y creció de ~1,3M a 1.969.363 filas"
o5.evidence = ["public.cron_executions: 1.969.363 filas (consulta de solo lectura a producción, 2026-11-09)", "RLS habilitada en supabase/migrations/20260818220610_security_advisor_errors_rls_and_invoker_views.sql", "No encontré ningún DELETE sobre cron_executions en app/api/cron/cleanup ni en las migraciones"]
o5.finding = "El crecimiento es de ~0,67M filas desde que se midió ~1,3M. Con 13 crons, dos de ellos cada minuto, la tabla sigue creciendo sin tope."
const o6 = opt("OPT-06")
o6.title = "EMPEORÓ: 17 archivos instancian createClient crudo y saltean los helpers de Supabase (eran 13)"
o6.evidence = ["Medido 2026-11-09: 17 archivos importan @supabase/supabase-js fuera de lib/supabase/", "Nuevos desde la última pasada: app/api/cron/v3-apollo-org-enrichment, v3-apollo-domain-lookup, lib/apollo/{domain-lookup-runner,org-enrichment-runner,company-writer}.ts"]
o6.finding = "Cada cron nuevo copió el mismo `admin()` local. Los tres módulos de lib/apollo/ nuevos lo repiten. Sin cambio en el riesgo (service role fuera del helper), pero el patrón se sigue replicando."
const o7 = opt("OPT-07")
o7.severity = "media"
o7.title = "PARCIAL: standard y admin comparten un factory; Explore y Perfiles siguen con su andamiaje propio"
o7.finding = "#139 extrajo createV3McpHandler a lib/v3/mcp-server-tools.ts: la ruta standard pasó a 33 líneas y la admin a 41, con las 45 tools registradas una sola vez. Explore (499 líneas) y Perfiles (307) siguen importando createMcpHandler/withMcpAuth cada una, así que un arreglo de manejo de errores todavía hay que hacerlo en tres sitios en vez de uno."
o7.fix = "Pendiente: llevar Explore y Perfiles al mismo factory. Lo cerrado (standard+admin): PR #139, 2026-08-26."
o7.evidence = ["app/api/v3/mcp/server/[transport]/route.ts (33 líneas)", "app/api/v3/mcp/admin/[transport]/route.ts (41)", "lib/v3/mcp-server-tools.ts (681)", "app/api/v3/mcp/explore/[transport]/route.ts (499) y profiles (307) con createMcpHandler propio"]
dead("DEAD-04").verification = "Re-verificado 2026-11-09: lib/v3/digest.ts (398 loc) existe y sigue sin importadores; el `export * from './digest'` de lib/v3/services/index.ts apunta a services/digest.ts. Verificado: DEAD-03/05/09/10/13 siguen presentes y sin importadores."

// ─── validación referencial ─────────────────────────────────────────────────
const err = []
const ids = new Set()
for (const n of j.nodes) (ids.has(n.id) ? err.push(`nodo duplicado ${n.id}`) : ids.add(n.id))
const eids = new Set()
for (const e of j.edges) {
  if (eids.has(e.id)) err.push(`arista duplicada ${e.id}`)
  eids.add(e.id)
  if (!ids.has(e.from)) err.push(`${e.id}.from ${e.from}`)
  if (!ids.has(e.to)) err.push(`${e.id}.to ${e.to}`)
}
for (const f of j.flows) for (const s of f.steps) {
  if (s.nodeId && !ids.has(s.nodeId)) err.push(`${f.id} paso ${s.n} nodo ${s.nodeId}`)
  if (s.edgeId && !eids.has(s.edgeId)) err.push(`${f.id} paso ${s.n} arista ${s.edgeId}`)
}
for (const c of j.contactPoints) for (const n of c.nodes) if (!ids.has(n)) err.push(`${c.id} nodo ${n}`)
if (err.length) {
  console.error("Integridad referencial rota:\n" + err.join("\n"))
  process.exit(1)
}

writeFileSync(PATH, JSON.stringify(j, null, 2) + "\n")
console.log(`OK nodos=${j.nodes.length} aristas=${j.edges.length} flujos=${j.flows.length}`)
