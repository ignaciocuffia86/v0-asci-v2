/**
 * Actualiza docs/architecture-map.json con lo que entró entre el 24-ago-2026 (último
 * repaso, commit 1a7ee0c) y el 8-sep-2026 (último commit de código en main): 78 commits
 * sin merges, de los cuales 70 tocan app/, lib/, components/, supabase/migrations o
 * vercel.json. Se verificó cada afirmación contra el código de hoy, no contra el mensaje.
 *
 * Qué cambió y por qué entra al mapa:
 *
 *  - CUARTO SERVIDOR MCP, el perfil admin (#136-#143): ruta propia, pero las tools NO
 *    viven en la ruta. Estándar y admin llaman a createV3McpHandler (lib/v3/mcp-server-tools.ts)
 *    sobre UNA sola registración de 45 tools. Eso cierra en parte OPT-07 (dos de las
 *    cuatro rutas ya no copian el andamiaje; Explore y Perfiles sí).
 *  - LOTES MCP: screen_account_list, estimate_batch, create_batch_job, create_export y
 *    get_cost_summary, con sus tablas v3.mcp_screenings / mcp_batch_plans / mcp_batch_jobs /
 *    mcp_batch_job_items / mcp_exports.
 *  - APOLLO como gasto controlado: cron v3-apollo-org-enrichment (cola SEMBRADA, nunca
 *    descubierta: sembrar es lo que autoriza el gasto), cron v3-apollo-domain-lookup
 *    (PAUSADO el 8-sep, #154: salió de vercel.json), chequeo del caché antes de pagar
 *    (#149, 21,8% de las llamadas a people/match eran repetidas), teléfonos por webhook
 *    (#148, #150) y ledger de Apify por corrida (#142, v3.apify_runs).
 *  - IDENTIDAD DE PERSONA en el ETL (public.contact_identities, v3.contact_merges) y
 *    Fase 0 del ETL de empresas (migraciones 160000-163000).
 *  - Hallazgos existentes re-verificados: OPT-06 empeoró (13 -> 17), OPT-07 pasa a
 *    parcial, OPT-13 citaba un archivo borrado, DEAD-11 y DEAD-12 se corrigen.
 *
 * Se hace por SCRIPT y no con ediciones de texto: una edición de texto ya rompió este
 * JSON una vez (el autofix absorbió `edges` dentro de `nodes`). Idempotente.
 *
 * Correr:  node scripts/update-architecture-map-2026-10-26.mjs
 *          node scripts/build-architecture-map.mjs
 */
import { readFileSync, writeFileSync } from "node:fs"

const PATH = "docs/architecture-map.json"
const j = JSON.parse(readFileSync(PATH, "utf8"))
const before = { nodes: j.nodes.length, edges: j.edges.length, flows: j.flows.length, cps: j.contactPoints.length, opts: j.optimizations.length, dead: j.deadCode.length }

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
const addNodeAfter = (afterId, n) => {
  if (j.nodes.some((x) => x.id === n.id)) {
    Object.assign(node(n.id), n)
    return
  }
  const at = j.nodes.findIndex((x) => x.id === afterId)
  if (at < 0) throw new Error(`Nodo ancla inexistente: ${afterId}`)
  j.nodes.splice(at + 1, 0, n)
}
const addEdge = (e) => {
  const existing = j.edges.find((x) => x.id === e.id)
  if (existing) Object.assign(existing, e)
  else j.edges.push(e)
}
const addFlow = (f) => {
  const at = j.flows.findIndex((x) => x.id === f.id)
  if (at >= 0) j.flows[at] = f
  else j.flows.push(f)
}
const addContactPoint = (c) => {
  const at = j.contactPoints.findIndex((x) => x.id === c.id)
  if (at >= 0) j.contactPoints[at] = c
  else j.contactPoints.push(c)
}
const addOpt = (o) => {
  const at = j.optimizations.findIndex((x) => x.id === o.id)
  if (at >= 0) j.optimizations[at] = o
  else j.optimizations.push(o)
}

// ═══ meta ═══
j.meta.generatedAt = "2026-10-26"
j.meta.summary =
  j.meta.summary.split(" Actualización 2026-10-26")[0] +
  " Actualización 2026-10-26 (repaso de los 78 commits sin merges entre el 24-ago y el 8-sep; no entró código nuevo después del 8-sep): " +
  "(1) CUARTO SERVIDOR MCP, el perfil admin: ruta propia sobre la MISMA registración de 45 tools que el estándar (lib/v3/mcp-server-tools.ts); lo único propio es el texto de las instrucciones y las reglas de descripción, porque el prompt es por server y no por credencial. " +
  "(2) LOTES MCP: screen_account_list -> estimate_batch -> create_batch_job (batchPlanHash) -> create_export, y get_cost_summary para cerrar con el costo medido. " +
  "(3) APOLLO COMO GASTO CONTROLADO: el enrichment de companies drena una cola que sólo se SIEMBRA a mano (cron v3-apollo-org-enrichment); el barrido de dominio por nombre (v3-apollo-domain-lookup) está PAUSADO desde el 8-sep y ya no figura en vercel.json; antes de pagar se consulta el caché; los teléfonos llegan por webhook también a v3. " +
  "(4) IDENTIDAD DE PERSONA en el ETL (public.contact_identities, fusión reversible v3.contact_merges). " +
  "(5) Las 30 migraciones nuevas coinciden con las versiones registradas en la base (comprobado con list_migrations)."

// stats: medidos con comandos sobre origin/main (8-sep-2026); tablas contra la base real
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

// ═══ MCP ═══
const std = node("api_mcp_server")
std.label = "MCP estándar (45 tools)"
std.desc =
  "El PRIMERO de los servidores MCP y el que conversa con las señales ya interpretadas por el diccionario. Desde #139 la ruta es un cascarón: llama a createV3McpHandler({ profile: 'standard' }) y las 45 tools se registran UNA vez en lib/v3/mcp-server-tools.ts (compartidas con el perfil admin). Agrega al circuito original el de lotes: screen_account_list, estimate_batch, create_batch_job, get_batch_job, create_export, get_cost_summary y request_contact_phones. Scope base companies:read / signals:read / accounts:read; los scopes viven en lib/v3/mcp-key-scopes.ts."
std.files = ["app/api/v3/mcp/server/[transport]/route.ts", "lib/v3/mcp-server-tools.ts", "lib/v3/mcp-key-scopes.ts"]
std.risk =
  "La concentración se mudó de la ruta a lib/v3/mcp-server-tools.ts (45 tools en un archivo). El comentario de la ruta admin dice '44 tools' y el registro tiene 45: deriva menor de documentación (docs/mcp-inventario-y-perfiles.md sigue diciendo 54 tools en total; hoy son 56 registraciones)."

addNodeAfter("api_mcp_server", {
  id: "api_mcp_admin",
  label: "MCP admin (mismas 45 tools)",
  zone: "v3",
  layer: 2,
  kind: "mcp",
  desc: "Perfil del equipo de ASCI. NO tiene tools propias: usa la misma registración que el estándar. Existe aparte porque el prompt es por server, no por credencial: sin instrucciones propias el modelo pide confirmación operación por operación aunque los guards ya dejen pasar. createV3McpHandler rechaza en el handshake toda credencial sin el marcador `unrestricted`. Sin cupo mensual ni presupuesto de lote que frene; las dos excepciones que quedan son Apollo (se avisa el gasto, no se pide permiso) y lo destructivo (remove_workspace_account, confirm_document_analysis). Opera sobre el workspace admin (lib/v3/admin-workspace.ts).",
  files: ["app/api/v3/mcp/admin/[transport]/route.ts", "lib/v3/admin-workspace.ts"],
  risk: "El control es el flag `unrestricted` de la credencial más un texto: si una key unrestricted se filtra, no hay tope técnico de créditos de Apollo. Lo que lo hace defendible es que todo queda medido (get_cost_summary), no que esté limitado.",
})

const tools = node("svc_v3_mcp_tools")
tools.desc =
  "Implementación de las tools de lectura, ciclo de vida de cuenta y circuito client-assisted, más los servicios de lotes: screen-account-list (cruce de una lista de empresas contra señales), mcp-batch-estimate (cotización con una sola confirmación), mcp-batch-job (ejecución), mcp-export, mcp-cost-summary, mcp-contact-phones y spend-ledger."
tools.files = [
  "lib/v3/mcp-read-tools.ts",
  "lib/v3/mcp-account-lifecycle.ts",
  "lib/v3/mcp-client-ai.ts",
  "lib/v3/services/screen-account-list.ts",
  "lib/v3/services/mcp-batch-estimate.ts",
  "lib/v3/services/mcp-batch-job.ts",
  "lib/v3/services/mcp-export.ts",
  "lib/v3/services/mcp-cost-summary.ts",
  "lib/v3/services/mcp-contact-phones.ts",
  "lib/v3/services/spend-ledger.ts",
]

// ═══ Crons de Apollo ═══
addNodeAfter("cron_v3_enrich_linkedin", {
  id: "cron_v3_apollo_org_enrichment",
  label: "cron v3-apollo-org-enrichment (10m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Drena v3.apollo_company_enrichment (status='pending') contra Apollo organizations/bulk_enrich. La cola NO se llena sola: sembrar filas es el acto que autoriza el gasto (1 crédito por cuenta resuelta); con la cola vacía no llama a Apollo. Empareja el payload con la empresa por POSICIÓN, no por dominio (Apollo puede contestar arcor.com a un pedido de arcor.com.ar). Un lote que falla se reprograma a 30 minutos. Lock con TTL de 300 s.",
  files: ["app/api/cron/v3-apollo-org-enrichment/route.ts", "lib/apollo/org-enrichment-runner.ts", "lib/apollo/bulk-organizations.ts", "lib/apollo/company-writer.ts"],
  schedule: "*/10 * * * *",
})
addNodeAfter("cron_v3_apollo_org_enrichment", {
  id: "cron_v3_apollo_domain_lookup",
  label: "cron v3-apollo-domain-lookup (PAUSADO)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "PAUSADO el 8-sep-2026 (#154): su entrada salió del array `crons` de vercel.json, que es lo único que Vercel mira. La ruta sigue en pie y se corre a mano con el secreto de cron (?dryRun=1&limit=N). Resuelve el dominio de las ~420.750 companies sin website por organizations/search (endpoint gratuito, pero con cuota: 350 llamadas/hora de las 400 del plan). Sólo promueve a companies.website lo clasificado auto_ok y sólo sobre columnas vacías. Reanudar es devolver la entrada a vercel.json y desplegar; las filas siguen en 'pending'.",
  files: ["app/api/cron/v3-apollo-domain-lookup/route.ts", "lib/apollo/domain-lookup-runner.ts", "lib/apollo/domain-lookup.ts", "lib/apollo/rate-limits.ts"],
  notes: "No cuenta en meta.stats.crons (que es el largo del array de vercel.json). A 350/hora el barrido completo son ~50 días.",
})

// ═══ Tablas nuevas ═══
addNodeAfter("db_mcp_logs", {
  id: "db_mcp_batches",
  label: "v3.mcp_batch_* / mcp_screenings / mcp_exports",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Estado del circuito de lotes del MCP: screenings (resultado cacheado de screen_account_list), batch_plans (la cotización, identificada por batchPlanHash), batch_jobs y batch_job_items (la ejecución) y exports (el entregable). El hash del plan incluye Apollo desde #140: es lo que autoriza el gasto del lote.",
  tables: ["v3.mcp_screenings", "v3.mcp_batch_plans", "v3.mcp_batch_jobs", "v3.mcp_batch_job_items", "v3.mcp_exports"],
})
addNodeAfter("db_mcp_batches", {
  id: "db_apollo_queues",
  label: "v3.apollo_company_enrichment / apollo_domain_lookup",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Las dos colas de Apollo. apollo_company_enrichment se siembra a mano (autoriza créditos); apollo_domain_lookup está sembrada con las companies sin website y su drenaje está pausado, con checkpoint propio.",
  tables: ["v3.apollo_company_enrichment", "v3.apollo_domain_lookup"],
})
addNodeAfter("db_apollo_queues", {
  id: "db_apify_runs",
  label: "v3.apify_runs",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Una fila por corrida de Apify y única fuente del costo de scraping (usageTotalUsd medido, ~US$0,0004 por vacante; el 55% es proxy residencial). La unidad de atribución es la EMPRESA, no el usuario, porque el cron deduplica por empresa entre workspaces. No incluye el alquiler mensual del actor (US$29,99 fijos).",
  tables: ["v3.apify_runs"],
})
addNodeAfter("db_apify_runs", {
  id: "db_contact_identities",
  label: "public.contact_identities / v3.contact_merges",
  zone: "shared",
  layer: 4,
  kind: "table",
  desc: "Identidad de PERSONA en el ETL. contacts se deduplicaba con ON CONFLICT sobre la URL cruda de LinkedIn, que identifica a la URL y no a la persona (vanity URLs, slugs regenerados, URN ofuscados, placeholders). La fusión de duplicados es reversible (contact_merges).",
  tables: ["public.contact_identities", "v3.contact_merges"],
})

// ═══ Nodos existentes ═══
const apollo = node("svc_apollo")
apollo.label = "Apollo (18 módulos)"
apollo.desc =
  "Search, enrich, organizations, cache por hash de query, validación de títulos, parsers y dominio, más los runners de los crons de v3 (org-enrichment-runner, domain-lookup-runner), rate-limits, usage-stats y company-writer. Antes de salir a pagar, el enrichment consulta apollo_contacts_cache: una fila ahí significa que YA se pagó por esa persona (#149; 921 de 4.223 llamadas a people/match, el 21,8%, eran créditos repetidos). El pipeline de decisores vive en lib/shared/."
const webhook = node("api_apollo_webhook")
webhook.desc =
  "Callback de Apollo autenticado por secreto en el path. Desde #148 tiene dos caminos: v2 escribe en public.user_company_contacts y v3 en v3.account_contacts (lib/v3/services/contact-phone-inbox.ts), llamado en un solo punto antes de las tres salidas de la función. Los teléfonos pedidos por MCP aterrizan acá."
webhook.files = ["app/api/webhooks/apollo/[secret]/route.ts", "lib/v3/services/contact-phone-inbox.ts", "lib/shared/phone-status.ts"]
const ap = node("ext_apify")
ap.notes = "Desde #142 cada corrida deja una fila en v3.apify_runs, para los cuatro orígenes (cron de primera pasada, mensual, kick de la UI, explore)."

// ═══ Aristas (ids e193+) ═══
addEdge({ id: "e193", from: "ext_mcp_client", to: "api_mcp_admin", kind: "call", label: "perfil admin" })
addEdge({ id: "e194", from: "api_mcp_admin", to: "svc_v3_mcp_tools", kind: "call", label: "misma registración que el estándar" })
addEdge({ id: "e195", from: "api_mcp_admin", to: "svc_v3_mcp_auth", kind: "call", label: "exige credencial unrestricted" })
addEdge({ id: "e196", from: "svc_v3_mcp_tools", to: "db_mcp_batches", kind: "rw", label: "lotes y exports" })
addEdge({ id: "e197", from: "cron_v3_apollo_org_enrichment", to: "db_apollo_queues", kind: "rw", label: "drena cola sembrada" })
addEdge({ id: "e198", from: "cron_v3_apollo_org_enrichment", to: "ext_apollo", kind: "call", label: "bulk_enrich (1 crédito/cuenta)" })
addEdge({ id: "e199", from: "cron_v3_apollo_org_enrichment", to: "db_companies", kind: "write", label: "campos de alto valor" })
addEdge({ id: "e200", from: "cron_v3_apollo_domain_lookup", to: "db_apollo_queues", kind: "rw", label: "pausado" })
addEdge({ id: "e201", from: "cron_v3_apollo_domain_lookup", to: "ext_apollo", kind: "call", label: "organizations/search (gratis, con cuota)" })
addEdge({ id: "e202", from: "cron_v3_scrape_jobs", to: "db_apify_runs", kind: "write", label: "costo por corrida" })
addEdge({ id: "e203", from: "api_apollo_webhook", to: "db_account_contacts", kind: "write", label: "teléfonos (camino v3)" })
addEdge({ id: "e204", from: "svc_v3_mcp_tools", to: "db_apollo_cache", kind: "read", label: "revisa antes de pagar" })
addEdge({ id: "e205", from: "svc_v3_mcp_tools", to: "db_apify_runs", kind: "read", label: "get_cost_summary" })

// ═══ Flujo ═══
addFlow({
  id: "f_mcp_batch",
  name: "Lote de cuentas por MCP (screening, cotización, ejecución, export)",
  version: "v3",
  trigger: "Un agente recibe una lista de empresas y pide un informe sobre ellas",
  desc: "Reemplaza las N llamadas sueltas por un circuito de una cotización y una autorización. El batchPlanHash identifica lo cotizado; ejecutar con ese hash es la autorización, incluido el gasto de Apollo.",
  steps: [
    { n: 1, nodeId: "ext_mcp_client", edgeId: "e193", detail: "El perfil admin trabaja sobre el catálogo global; no pide confirmación cuenta por cuenta." },
    { n: 2, nodeId: "svc_v3_mcp_tools", edgeId: "e194", detail: "screen_account_list cruza la lista en UNA llamada (estados matched / matched_no_signal / no encontrada; clave propia de consolidación y localidad por señal)." },
    { n: 3, nodeId: "db_mcp_batches", edgeId: "e196", detail: "estimate_batch guarda el plan y devuelve su hash con los cuatro números de costo juntos." },
    { n: 4, nodeId: "ext_apollo", detail: "create_batch_job ejecuta; el enrichment de contactos y los teléfonos (request_contact_phones, 5 créditos contra 1 del email) salen con el hash como autorización." },
    { n: 5, nodeId: "db_apify_runs", edgeId: "e205", detail: "get_cost_summary cierra el informe: IA medida, Apollo estimado, Apify medido por corrida, con totalIsPartial si falta algo." },
    { n: 6, nodeId: "db_mcp_batches", detail: "create_export entrega el resultado por URL; no se transcribe la tabla al chat." },
  ],
})

addContactPoint({
  id: "cp_apollo_spend",
  title: "El gasto de Apollo cruza crons, MCP y webhook",
  severity: "alta",
  nodes: ["cron_v3_apollo_org_enrichment", "cron_v3_apollo_domain_lookup", "svc_v3_mcp_tools", "api_apollo_webhook", "db_apollo_cache", "ext_apollo"],
  desc: "Tres caminos distintos gastan créditos o cuota de la misma cuenta de Apollo: la cola de enrichment (créditos), el barrido de dominio (cuota horaria, hoy pausado) y las tools MCP (enrichment y teléfonos). Comparten el caché apollo_contacts_cache y la tabla apollo_api_calls.",
  impact: "Un cambio en el caché, en el contador de cuota o en el webhook afecta el gasto de los tres caminos a la vez. La reserva de 50 llamadas/hora para trabajo manual se calcula leyendo apollo_api_calls, no un contador propio.",
})

// ═══ Re-verificación de hallazgos abiertos (paso 2) ═══
const o6 = opt("OPT-06")
o6.title = "17 archivos instancian createClient crudo y saltean los helpers de Supabase (EMPEORÓ: eran 13)"
o6.evidence = [
  "17 archivos con import de @supabase/supabase-js fuera de lib/supabase/ (git grep, 8-sep-2026)",
  "Nuevos desde el 24-ago: app/api/cron/v3-apollo-org-enrichment, app/api/cron/v3-apollo-domain-lookup, lib/apollo/org-enrichment-runner.ts, lib/apollo/domain-lookup-runner.ts, lib/apollo/company-writer.ts",
]
o6.finding =
  "EMPEORÓ. El 24-ago el mapa contaba 13; hoy git grep cuenta 17. Cinco de esos archivos son del trabajo de Apollo de este período (dos crons, dos runners y company-writer): el patrón se copió en cada cron nuevo en vez de pasar por lib/supabase/admin.ts. La diferencia es 4 y no 5 porque la lista anterior no se había nombrado completa y no se pudo reconciliar archivo por archivo; el número de hoy sí está medido."

const o7 = opt("OPT-07")
o7.title = "PARCIAL: el andamiaje MCP se unificó para estándar y admin, pero Explore y Perfiles siguen con su copia"
o7.finding =
  "AVANZÓ A MEDIAS. Desde #139 las rutas estándar y admin no tienen andamiaje propio: las dos llaman a createV3McpHandler (lib/v3/mcp-server-tools.ts) y las tools se registran UNA vez. Quedan dos rutas (Explore, 8 tools; Perfiles, 3) con su propia copia de transporte, auth, rate limit y registro. Además la concentración se mudó: lib/v3/mcp-server-tools.ts tiene 45 tools en un archivo."
o7.fix = "Mover Explore y Perfiles a la misma fábrica de handlers. Partir mcp-server-tools.ts por dominio (lectura, lotes, costos, documentos) conservando UNA registración."

const o13 = opt("OPT-13")
o13.evidence = ["uso de .schema(\"v3\") disperso", "app/actions/v3/csv-import.ts ya no existe (DEAD-01): el ejemplo concreto se fue con el archivo; el patrón no se re-midió en este repaso"]

const d11 = dead("DEAD-11")
d11.verification =
  "El código sólo referencia APOLLO_WEBHOOK_SECRET (app/actions/apollo.ts:655 y app/api/webhooks/apollo/[secret]/route.ts:121); git grep de 'WEBHOOL' fuera de docs/ no devuelve nada. Que la variable con typo siga presente en el proyecto de Vercel NO se pudo verificar en este repaso (no se consultó el inventario de variables)."
d11.recommendation = "Es seguro borrar APOLLO_WEBHOOL_SECRET del proyecto: nada en el código la lee. Confirmar primero en Vercel que siga existiendo."

const d12 = dead("DEAD-12")
d12.title = "v3.bookmark_dedupe_log sin lector (dictionary_term_suggestions ya tiene uno)"
d12.evidence = ["v3.bookmark_dedupe_log", "lib/v3/services/dictionary.ts:304-325 lee y escribe v3.dictionary_term_suggestions"]
d12.finding =
  "CORREGIDO. El mapa afirmaba que dictionary_term_suggestions no tenía lector; lib/v3/services/dictionary.ts la lee y la escribe. bookmark_dedupe_log sigue sin aparecer en ningún .from() de app/ ni lib/."

// DEAD-03/04/05/10/13 y OPT-05: re-verificados sin cambios
const reverified = "Re-verificado el 2026-10-26: sigue vigente."
for (const id of ["DEAD-03", "DEAD-05", "DEAD-10", "DEAD-13"]) {
  const d = dead(id)
  if (!String(d.verification ?? "").includes("Re-verificado el 2026-10-26")) d.verification = `${d.verification ?? ""} ${reverified}`.trim()
}
const o5 = opt("OPT-05")
if (!String(o5.finding).includes("Re-verificado el 2026-10-26")) o5.finding += " Re-verificado el 2026-10-26: cleanup/route.ts no referencia cron_executions y ninguna migración nueva le agrega retención."

// ═══ Validación ═══
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
for (const c of j.contactPoints ?? []) for (const n of c.nodes ?? []) if (!ids.has(n)) errs.push(`contactPoint ${c.id}: nodo inexistente -> ${n}`)
const dup = (arr) => arr.filter((x, i, a) => a.indexOf(x) !== i)
if (dup(j.nodes.map((n) => n.id)).length) errs.push("nodos duplicados")
if (dup(j.edges.map((e) => e.id)).length) errs.push("aristas duplicadas")
if (dup(j.flows.map((f) => f.id)).length) errs.push("flujos duplicados")
if (errs.length) {
  console.error("[v0] VALIDACION FALLIDA, no se escribe nada:")
  for (const e of errs) console.error("  -", e)
  process.exit(1)
}
writeFileSync(PATH, JSON.stringify(j, null, 2) + "\n")
console.log("[v0] OK. Claves:", Object.keys(j).join(", "))
console.log(`[v0] nodes ${before.nodes} -> ${j.nodes.length} | edges ${before.edges} -> ${j.edges.length} | flows ${before.flows} -> ${j.flows.length} | contactPoints ${before.cps} -> ${j.contactPoints.length} | optimizations ${before.opts} -> ${j.optimizations.length} | deadCode ${before.dead} -> ${j.deadCode.length}`)
