/**
 * Actualiza docs/architecture-map.json con lo que entró entre el 24-ago-2026
 * (último repaso, commit 1a7ee0c) y el 02-nov-2026: 78 commits sin merges.
 *
 * Por qué hace falta: el mapa decía "3 servidores MCP, 48 tools, 12 crons" y hoy
 * hay 4 servidores (el perfil admin), 56 tools registradas, 13 crons en
 * vercel.json y un crawler propio de Apollo. Además dos hallazgos abiertos
 * dejaron de ser ciertos tal como estaban escritos (OPT-13, DEAD-12), uno
 * empeoró (OPT-06) y uno avanzó (OPT-07).
 *
 * Cobertura (todo medido contra el código de origin/main, no contra los mensajes):
 *   #136-#143  MCP admin (flag unrestricted, get_cost_summary, una sola
 *              registración de tools en lib/v3/mcp-server-tools.ts, ruta /admin)
 *   #140-#144  batchPlanHash autoriza créditos de Apollo; lotes, screening,
 *              export y ledger de gasto (lib/v3/services/mcp-*, spend-ledger)
 *   #142       instrumentación del costo de Apify (v3.apify_runs)
 *   #145-#147  screening con clave propia, panorama de señales, perfil admin
 *   #148,#150  teléfonos: webhook de Apollo aprende el camino v3 + tool request_contact_phones
 *   #149       caché de personas antes de salir a Apollo
 *   934beef…   cron v3-apollo-org-enrichment (cola sembrada) y campos de alto valor
 *   #151,#154  barrido de dominio por nombre (cron escrito y PAUSADO)
 *   capa 2 / Fase 0 / 443-459  identidad de persona y de empresa, merge reversible
 *
 * Se hace por SCRIPT (no a mano): una edición de texto ya rompió este JSON una vez.
 * Idempotente; valida integridad referencial antes de escribir.
 *
 * Correr:  node scripts/update-architecture-map-2026-11-02.mjs
 *          node scripts/build-architecture-map.mjs
 */
import { readFileSync, writeFileSync } from "node:fs"

const PATH = "docs/architecture-map.json"
const j = JSON.parse(readFileSync(PATH, "utf8"))
const before = { n: j.nodes.length, e: j.edges.length, f: j.flows.length, o: j.optimizations.length, d: j.deadCode.length }

const find = (arr, id, what) => {
  const x = arr.find((y) => y.id === id)
  if (!x) throw new Error(`${what} inexistente: ${id}`)
  return x
}
const node = (id) => find(j.nodes, id, "Nodo")
const opt = (id) => find(j.optimizations, id, "Optimizacion")
const dead = (id) => find(j.deadCode, id, "DeadCode")
const addNodeAfter = (afterId, n) => {
  if (j.nodes.some((x) => x.id === n.id)) return void Object.assign(node(n.id), n)
  j.nodes.splice(j.nodes.findIndex((x) => x.id === afterId) + 1, 0, n)
}
const addEdge = (e) => {
  const x = j.edges.find((y) => y.id === e.id)
  if (x) Object.assign(x, e)
  else j.edges.push(e)
}
const addFlow = (f) => {
  const at = j.flows.findIndex((x) => x.id === f.id)
  if (at >= 0) j.flows[at] = f
  else j.flows.push(f)
}

// ── meta ────────────────────────────────────────────────────────────────────
j.meta.generatedAt = "2026-11-02"
j.meta.summary =
  "Monorepo Next.js único donde conviven ASCI v2 (producción, schema public) y ASCI v3 (multitenant, schema v3) sobre la MISMA base Supabase; el aislamiento es por schema. " +
  "Actualización 2026-11-02, repaso de los 78 commits entrados desde el 24-ago. Por orden de peso: " +
  "(1) CUATRO servidores MCP: apareció el perfil ADMIN (/api/v3/mcp/admin), que expone las MISMAS tools que el estándar —ahora registradas una sola vez en lib/v3/mcp-server-tools.ts: 45 tools— pero sin cupos y con un solo freno declarado, la medición del gasto (get_cost_summary). Explore (8) y Perfiles (3) siguen con su propia ruta. " +
  "(2) LOTES CON PLAN: screen_account_list → estimate_batch → create_batch_job con un batchPlanHash que autoriza créditos de Apollo, más create_export (xlsx/csv por URL firmada) y un ledger de gasto por empresa (v3.apify_runs mide Apify por corrida). " +
  "(3) APOLLO ES MÁS QUE EL WEBHOOK: un cron drena una cola SEMBRADA de enrichment de organizaciones (v3-apollo-org-enrichment), existe un barrido de dominio por nombre (v3-apollo-domain-lookup) que está PAUSADO —su ruta sigue pero no está en vercel.json—, se revisa el caché de personas antes de pagar (21,8% de los créditos históricos eran repetidos) y los teléfonos tienen camino v3 (request_contact_phones → webhook → caché compartido). " +
  "(4) IDENTIDAD: el ETL resuelve identidad de persona y de empresa con merge reversible; varias migraciones de esta tanda (ver stats) NO se verificaron como aplicadas en producción desde este repaso. " +
  "Las cifras de tablas (public 58 / v3 68) se consultaron en la base el 2026-11-02."
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

// ── MCP ─────────────────────────────────────────────────────────────────────
const std = node("api_mcp_server")
std.label = "MCP estándar (45 tools)"
std.desc =
  "Perfil STANDARD, el que usa un cliente. Desde el refactor 'una sola registración' la ruta quedó en ~40 líneas: solo aporta sus `instructions` y llama a createV3McpHandler({profile:'standard'}). Las 45 tools viven en lib/v3/mcp-server-tools.ts y se comparten con el perfil admin. Sumó respecto del repaso anterior: screen_account_list, estimate_batch, create_batch_job, get_batch_job, create_export, request_contact_phones, get_cost_summary y build_evidence_icebreaker."
std.files = ["app/api/v3/mcp/server/[transport]/route.ts", "lib/v3/mcp-server-tools.ts"]
std.risk =
  "El andamiaje ya no se copia entre standard y admin (OPT-07 avanzó), pero Explore y Perfiles siguen con su copia propia. El comentario de la ruta dice '44 tools'; el conteo del código es 45 (server.tool( al inicio de línea en mcp-server-tools.ts)."

addNodeAfter("api_mcp_server", {
  id: "api_mcp_admin",
  label: "MCP Admin (45 tools, = estándar)",
  zone: "v3",
  layer: 2,
  kind: "mcp",
  desc:
    "CUARTO servidor MCP, para el equipo de ASCI. No define tools: reusa las 45 del estándar. Lo propio es el TEXTO (instructions y nueve reglas de descripción) y el acceso: createV3McpHandler rechaza en el handshake toda credencial sin el marcador admin:unrestricted, y un token OAuth nunca es unrestricted. Con ese flag se levantan cupo mensual, presupuesto de lote y el requisito de cuenta guardada; las excepciones declaradas son el aviso de créditos de Apollo y lo destructivo (remove_workspace_account, confirm_document_analysis).",
  files: ["app/api/v3/mcp/admin/[transport]/route.ts", "lib/v3/mcp-key-scopes.ts", "lib/v3/admin-workspace.ts"],
  risk:
    "Sin topes, lo único que hace defendible el perfil es la medición: get_cost_summary declara la calidad de cada número (IA medido, Apollo estimado, Apify medido por corrida sin el alquiler del actor) y marca totalIsPartial. Si una tool nueva gasta y no pasa por el ledger, el perfil queda ciego a ese gasto.",
})

const mcpTools = node("svc_v3_mcp_tools")
mcpTools.desc =
  "Registro único de las tools del estándar y el admin (registerV3Tools) más el handler compartido createV3McpHandler: auth, rate limit, auditoría por proxy sobre server.tool y mapa de nextAction por código de error."
mcpTools.files = ["lib/v3/mcp-server-tools.ts", "lib/v3/mcp-read-tools.ts", "lib/v3/mcp-account-lifecycle.ts", "lib/v3/mcp-client-ai.ts"]

addNodeAfter("svc_v3_mcp_tools", {
  id: "svc_v3_mcp_batch",
  label: "Lotes, screening, export y costos MCP",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "screen-account-list (cruza una lista pegada contra el catálogo con estados como matched_no_signal), mcp-batch-estimate (cotiza y emite el batchPlanHash), mcp-batch-job (ejecuta el lote autorizado), mcp-export (xlsx/csv a Storage con URL firmada), mcp-cost-summary y spend-ledger (gasto por empresa y por origen), mcp-contact-phones.",
  files: [
    "lib/v3/services/screen-account-list.ts",
    "lib/v3/services/mcp-batch-estimate.ts",
    "lib/v3/services/mcp-batch-job.ts",
    "lib/v3/services/mcp-export.ts",
    "lib/v3/services/mcp-cost-summary.ts",
    "lib/v3/services/spend-ledger.ts",
    "lib/v3/services/mcp-contact-phones.ts",
  ],
  tables: ["v3.mcp_batch_plans", "v3.mcp_screenings", "v3.mcp_exports", "v3.mcp_batch_jobs", "v3.mcp_batch_job_items"],
  notes:
    "El hash del plan liga la cotización a lo que se ejecuta: cambiar la lista invalida el hash. Verificado en código; la aplicación de estas migraciones en producción no se consultó en este repaso.",
})

addNodeAfter("db_mcp_logs", {
  id: "db_mcp_batch",
  label: "v3.mcp_batch_* / mcp_screenings / mcp_exports",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Estado de los lotes del MCP: planes cotizados, screenings, exports generados y los jobs con sus ítems.",
  tables: ["v3.mcp_batch_plans", "v3.mcp_screenings", "v3.mcp_exports", "v3.mcp_batch_jobs", "v3.mcp_batch_job_items"],
})

// ── Apollo ──────────────────────────────────────────────────────────────────
addNodeAfter("cron_v3_enrich_linkedin", {
  id: "cron_v3_apollo_org_enrichment",
  label: "cron v3-apollo-org-enrichment (10m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc:
    "Drena la cola v3.apollo_company_enrichment contra Apollo (bulk_enrich de organizaciones) con lock con lease, freno preventivo de cuota y reprogramación a 30 min ante falla. El trabajo NO se descubre, se SIEMBRA: con la cola vacía no llama a Apollo y gasta cero; autorizar otro lote es un INSERT. Empareja payload y empresa por posición, no por dominio.",
  files: ["app/api/cron/v3-apollo-org-enrichment/route.ts", "lib/apollo/org-enrichment-runner.ts", "lib/apollo/bulk-organizations.ts", "lib/apollo/company-writer.ts"],
  tables: ["v3.apollo_company_enrichment"],
  notes:
    "Se corrigió que las filas en error no volvían a la cola (ahora se reclaman pending y error con reintento vencido, con tope de intentos). El enrichment SÍ cuesta créditos; el ledger lo anotaba en cero y se arregló.",
})
addNodeAfter("cron_v3_apollo_org_enrichment", {
  id: "cron_v3_apollo_domain_lookup",
  label: "cron v3-apollo-domain-lookup (PAUSADO)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc:
    "Resuelve por nombre el dominio de las ~420.753 companies sin website (el 88% del catálogo, que no entra a enrich/bulk_enrich porque estos reciben dominios) usando organizations/search, a 350 llamadas/hora de una cuota de 400. Solo promueve a companies.website lo clasificado auto_ok y solo sobre columnas vacías. ESTADO: PAUSADO desde #154: su entrada salió de vercel.json, que es lo único que Vercel mira. La ruta, el runner y la cola v3.apollo_domain_lookup siguen en pie; reanudar es devolver la entrada al schedule.",
  files: ["app/api/cron/v3-apollo-domain-lookup/route.ts", "lib/apollo/domain-lookup-runner.ts", "lib/apollo/domain-lookup.ts", "lib/apollo/rate-limits.ts"],
  tables: ["v3.apollo_domain_lookup"],
  risk: "Una ruta de cron sin entrada en vercel.json no corre sola: no se la confunda con un cron activo al contar crons (13 en vercel.json, 14 rutas).",
})

const apollo = node("svc_apollo")
apollo.label = "Apollo (módulos de lib/apollo)"
apollo.desc = apollo.desc.split(" Desde el 24-ago")[0] +
  " Desde el 24-ago sumó bulk-organizations, company-writer (columnas de alto valor, solo sobre vacías), org-enrichment-runner, domain-lookup(-runner), rate-limits y usage-stats. Antes de pagar people/match se consulta apollo_contacts_cache: una fila significa que YA se pagó, tenga email o no."

const wh = node("api_apollo_webhook")
wh.desc =
  "Callback de Apollo autenticado por secreto en el path. Escribe en public.user_company_contacts (camino v2) y, en UN punto antes de sus tres salidas, llama a contact-phone-inbox (camino v3): el número va al caché compartido apollo_contacts_cache y el estado solo a las filas v3.account_contacts en pending."
wh.files = ["app/api/webhooks/apollo/[secret]/route.ts", "lib/v3/services/contact-phone-inbox.ts"]

addEdge({ id: "e300", from: "ext_mcp_client", to: "api_mcp_admin", kind: "call" })
addEdge({ id: "e301", from: "api_mcp_admin", to: "svc_v3_mcp_tools", kind: "call", label: "mismas 45 tools" })
addEdge({ id: "e302", from: "svc_v3_mcp_tools", to: "svc_v3_mcp_batch", kind: "call" })
addEdge({ id: "e303", from: "svc_v3_mcp_batch", to: "db_mcp_batch", kind: "rw" })
addEdge({ id: "e304", from: "svc_v3_mcp_batch", to: "ext_apollo", kind: "call", label: "créditos autorizados por batchPlanHash" })
addEdge({ id: "e305", from: "cron_v3_apollo_org_enrichment", to: "svc_apollo", kind: "call" })
addEdge({ id: "e306", from: "cron_v3_apollo_org_enrichment", to: "db_companies", kind: "write", label: "columnas vacías" })
addEdge({ id: "e307", from: "cron_v3_apollo_domain_lookup", to: "svc_apollo", kind: "call", label: "pausado" })
addEdge({ id: "e308", from: "api_apollo_webhook", to: "db_apollo_cache", kind: "write", label: "teléfono v3" })
addEdge({ id: "e309", from: "svc_v3_mcp_batch", to: "db_ai_usage", kind: "read", label: "get_cost_summary" })

addFlow({
  id: "f_mcp_batch",
  name: "Lote de cuentas por MCP admin",
  version: "v3",
  trigger: "Un usuario del equipo pega una lista de empresas en el cliente MCP admin",
  desc: "Una llamada de screening, una cotización, un lote autorizado por hash y el informe de costo. Nada de 42 llamadas sueltas.",
  steps: [
    { n: 1, nodeId: "ext_mcp_client", detail: "screen_account_list con la lista completa." },
    { n: 2, nodeId: "api_mcp_admin", edgeId: "e300", detail: "Handshake: se rechaza toda credencial sin admin:unrestricted." },
    { n: 3, nodeId: "svc_v3_mcp_batch", edgeId: "e302", detail: "estimate_batch devuelve el tamaño y el batchPlanHash; los slots vienen con enforced:false." },
    { n: 4, nodeId: "ext_apollo", edgeId: "e304", detail: "create_batch_job ejecuta el lote; el gasto de Apollo se anota en el ledger." },
    { n: 5, nodeId: "db_mcp_batch", edgeId: "e303", detail: "Job e ítems persistidos; create_export deja el xlsx/csv con URL firmada." },
    { n: 6, nodeId: "db_ai_usage", edgeId: "e309", detail: "get_cost_summary cierra el informe, declarando la calidad de cada número." },
  ],
})
addFlow({
  id: "f_apollo_org_enrichment",
  name: "Enrichment de organizaciones desde una cola sembrada",
  version: "v3",
  trigger: "Cron cada 10 minutos",
  desc: "No descubre candidatas: procesa filas pending sembradas a mano. Cola vacía = cero llamadas y cero créditos.",
  steps: [
    { n: 1, nodeId: "cron_v3_apollo_org_enrichment", detail: "Toma el lock con lease y verifica el freno de cuota." },
    { n: 2, nodeId: "svc_apollo", edgeId: "e305", detail: "bulk_enrich de organizaciones; empareja por posición." },
    { n: 3, nodeId: "db_companies", edgeId: "e306", detail: "company-writer completa solo columnas vacías (país, LinkedIn company ID, etc.)." },
  ],
})

// ── Hallazgos abiertos ──────────────────────────────────────────────────────
const o6 = opt("OPT-06")
o6.title = "EMPEORÓ: 19 archivos instancian createClient crudo y saltean los helpers de Supabase"
o6.evidence = [
  "git grep de import de @supabase/supabase-js fuera de lib/supabase/: 14 en 1a7ee0c (24-ago) → 19 hoy (17 en app/lib/components + 2 scripts)",
  "Nuevos: v3-apollo-org-enrichment, v3-apollo-domain-lookup, lib/apollo/{company-writer,domain-lookup-runner,org-enrichment-runner}.ts, lib/v3/services/account-brief-row.ts, app/api/v3/admin/normalize-country-phase5",
]
o6.finding =
  "Pasó de 14 a 19 con el mismo comando: el patrón se copió en la tanda nueva de Apollo (dos crons y tres módulos). Nota: el mapa anterior citaba 13; el comando equivalente da 14 en esa fecha, así que la cifra vieja tenía un archivo de diferencia de método. Sigue sin haber lint que lo impida."

const o7 = opt("OPT-07")
o7.title = "PARCIAL: estándar y admin comparten registración; Explore y Perfiles siguen duplicando el andamiaje"
o7.finding =
  "AVANZÓ: desde el refactor 'una sola registración' (Fase C, #139) las rutas standard y admin son ~40 líneas y comparten lib/v3/mcp-server-tools.ts (45 tools). Lo que NO se resolvió: Explore (8 tools) y Perfiles (3) conservan su propio bloque de transporte, auth, rate limit y nextAction. El problema se achicó de tres copias a dos más la compartida."
o7.fix = "Mover Explore y Perfiles a createV3McpHandler con su propio juego de tools, como hizo admin."

const o13 = opt("OPT-13")
o13.evidence = [
  "git grep de .schema('v3') en app/ y lib/: 79 archivos",
  "app/actions/v3/csv-import.ts ya NO existe (el ejemplo citado antes)",
]
o13.finding =
  "El acceso a v3 sigue dependiendo de recordar .schema('v3') en cada consulta (79 archivos). El ejemplo concreto de mezcla dentro de csv-import.ts dejó de existir porque el archivo se borró; si hay mezclas equivalentes en otro archivo, NO se verificó en este repaso."

const d12 = dead("DEAD-12")
d12.title = "Tabla de v3 sin lector: bookmark_dedupe_log (dictionary_term_suggestions SÍ tiene lector)"
d12.evidence = ["v3.bookmark_dedupe_log: cero referencias en app/, lib/ y components/", "v3.dictionary_term_suggestions: leída en lib/v3/services/dictionary.ts:304-325"]
d12.finding =
  "Corrección: la entrada anterior afirmaba que dictionary_term_suggestions no tenía lector, pero ya lo tenía en 1a7ee0c (lib/v3/services/dictionary.ts). Se retira del hallazgo. bookmark_dedupe_log sigue sin ninguna referencia en el código."

const o5 = opt("OPT-05")
o5.finding = o5.finding.split(" Revalidado el 2026")[0] +
  " Revalidado el 2026-11-02: cleanup_old_import_data sigue sin tocar cron_executions y no hay otra purga en migraciones; el número de filas actual no se volvió a medir."

// ── Validación ──────────────────────────────────────────────────────────────
const ids = new Set(j.nodes.map((n) => n.id))
const eids = new Set(j.edges.map((e) => e.id))
const errs = []
for (const e of j.edges) {
  if (!ids.has(e.from)) errs.push(`arista ${e.id}: from inexistente ${e.from}`)
  if (!ids.has(e.to)) errs.push(`arista ${e.id}: to inexistente ${e.to}`)
}
for (const f of j.flows) for (const s of f.steps ?? []) {
  if (s.nodeId && !ids.has(s.nodeId)) errs.push(`flujo ${f.id}: nodeId ${s.nodeId}`)
  if (s.edgeId && !eids.has(s.edgeId)) errs.push(`flujo ${f.id}: edgeId ${s.edgeId}`)
}
for (const c of j.contactPoints) for (const n of c.nodes ?? []) if (!ids.has(n)) errs.push(`contactPoint ${c.id}: ${n}`)
for (const [what, arr] of [["nodos", j.nodes], ["aristas", j.edges], ["flujos", j.flows]]) {
  const d = arr.map((x) => x.id).filter((id, i, a) => a.indexOf(id) !== i)
  if (d.length) errs.push(`${what} duplicados: ${d}`)
}
if (errs.length) {
  console.error("VALIDACION FALLIDA, no se escribe nada:\n - " + errs.join("\n - "))
  process.exit(1)
}
writeFileSync(PATH, JSON.stringify(j, null, 2) + "\n")
console.log(`OK. nodes ${before.n}->${j.nodes.length} edges ${before.e}->${j.edges.length} flows ${before.f}->${j.flows.length} opts ${before.o}->${j.optimizations.length} dead ${before.d}->${j.deadCode.length}`)
