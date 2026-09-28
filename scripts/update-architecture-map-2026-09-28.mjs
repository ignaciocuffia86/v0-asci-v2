/**
 * Actualiza docs/architecture-map.json con lo que entró entre el 24-ago-2026
 * (último repaso, commit 1a7ee0c) y el 28-sep-2026 (HEAD de main, f513468).
 *
 * Son 78 commits (72 tocan app/, lib/, components/, supabase/migrations/,
 * vercel.json o scripts/*.sql), pero casi ninguno es un PR "temático" propio:
 * es un solo arco de trabajo — MCP admin — que atraviesa todo. Por peso:
 *
 *   (1) CUARTO SERVIDOR MCP — /api/v3/mcp/admin (Fases A/B2/C, 22d3f2f,
 *       e0f424f, 8001842): comparte las 45 tools de lib/v3/mcp-server-tools.ts
 *       con el standard (que subió de 37 a 45) a través de un factory nuevo,
 *       createV3McpHandler. Ese factory es EXACTAMENTE lo que OPT-07 pedía,
 *       así que pasa a PARCIAL: standard y admin ya no duplican el andamiaje,
 *       pero explore y profiles siguen con su propia copia.
 *   (2) GASTO MEDIDO DE VERDAD — v3.mcp_batch_plans/jobs/job_items (cotización
 *       de un lote con un solo hash) + v3.mcp_screenings/mcp_exports (37a5bca,
 *       0dbf411, 434fc39) + v3.apify_runs como ledger por corrida (ba2bbbb):
 *       antes de esto el costo de un informe no se podía cerrar con un número.
 *   (3) APOLLO EN v3 — dos colas nuevas que DRENAN, no barren: organization
 *       enrichment (cron cada 10', 934beef) y domain lookup (bb0b8cf, PAUSADO
 *       el 08-sep por f513468: la ruta y la cola siguen vivas, la entrada de
 *       vercel.json no). Detrás, 7 módulos nuevos en lib/apollo/ y 9 fixes
 *       encontrados solo contra producción (628ddb1..06d0c23).
 *   (4) IDENTIDAD DE PERSONA, capa 1/2 — canonical-signals.ts define que una
 *       señal es (empresa, entrada de diccionario, persona), no una fila de
 *       signals (66e3121); contact_identities + trigger SQL y contact_merges
 *       reversible (12cd806, c0a65ff, 3750a1e); linkedin-profile.ts es el
 *       gemelo TS de las funciones SQL de slug, y si diverge de ellas la UI
 *       pliega mal a una persona.
 *   (5) TELÉFONOS — un solo vocabulario de phone_status, gana v2 porque es el
 *       que habla el webhook de Apollo (7a4d4a6); ese webhook ahora también
 *       escribe v3.account_contacts (583bc4e), así que deja de ser puramente
 *       v2. request_contact_phones es tool nueva (fc25cba).
 *   (6) DICCIONARIO — taxonomía de tres ejes + co-ocurrencia, siete lotes
 *       (07b8afd..528a204): todo son columnas sobre las 6 tablas que ya
 *       existían en el mapa, ninguna tabla nueva.
 *
 * PASO 2 de la rutina (re-verificación de lo ya escrito) encontró además:
 * OPT-05 empeoró en volumen (cron_executions: 1,3M -> 1.686.884 filas, sigue
 * sin retención), OPT-06/09/12/13 siguen abiertas tal cual con evidencia
 * actualizada, y DEAD-12 se parte en dos: dictionary_term_suggestions ya
 * tiene lector (RESUELTA esa mitad) pero bookmark_dedupe_log sigue sin uno.
 *
 * Metodología: dos agentes de solo lectura cruzaron cada commit y cada
 * hallazgo abierto contra el código y la base de HOY (no contra lo que dice
 * el mensaje del commit), más verificación directa de esta sesión sobre los
 * cuatro archivos route.ts de MCP, vercel.json, supabase/migrations/ y
 * Supabase (grenlquhexbyneubtdub, solo lectura) para tablesPublic/tablesV3.
 *
 * Por qué por SCRIPT: son ~4.000 líneas de JSON y una edición de texto ya
 * rompió la estructura una vez. Manipular el objeto y reserializar preserva
 * las claves de nivel superior.
 *
 * Idempotente: correrlo dos veces deja el mismo resultado.
 *
 * Correr:  node scripts/update-architecture-map-2026-09-28.mjs
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
const flow = (id) => {
  const f = j.flows.find((x) => x.id === id)
  if (!f) throw new Error(`Flujo inexistente: ${id}`)
  return f
}
/** Inserta un nodo despues de otro, sin duplicar si ya existe. */
const addNodeAfter = (afterId, n) => {
  if (j.nodes.some((x) => x.id === n.id)) {
    Object.assign(node(n.id), n)
    return
  }
  const at = j.nodes.findIndex((x) => x.id === afterId)
  if (at < 0) throw new Error(`addNodeAfter: ancla inexistente -> ${afterId}`)
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

// ═══════════════════════════════════════════════════════════════════════════
// meta
// ═══════════════════════════════════════════════════════════════════════════
j.meta.generatedAt = "2026-09-28"
j.meta.summary =
  "Monorepo Next.js único donde conviven ASCI v2 (producción, schema public) y ASCI v3 (multitenant, schema v3) sobre la MISMA base Supabase. El aislamiento es por schema, no por proyecto ni por base. " +
  "Actualización 2026-09-28, repaso de los 72 commits que tocaron código desde el 24-ago (última pasada completa). A diferencia de las actualizaciones anteriores, esta vez casi todo el rango es UN SOLO arco de trabajo, no PRs temáticos sueltos. Por orden de peso: " +
  "(1) CUARTO SERVIDOR MCP — /api/v3/mcp/admin (26-ago, #136-#139) es el perfil que usa el equipo de ASCI: la credencial trae el marcador 'unrestricted', que lo exime del cupo mensual y del tope de lote, pero NO de las dos excepciones que siguen pidiendo confirmación (borrar cuenta, persistir documento). Comparte las 45 tools (subieron de 37) del standard a través de un factory nuevo, createV3McpHandler en lib/v3/mcp-server-tools.ts — que es EXACTAMENTE lo que OPT-07 venía pidiendo: standard y admin ya no duplican transporte+auth+cuota, aunque Explore y Perfiles siguen duplicándolo cada uno por su cuenta. " +
  "(2) GASTO QUE SE PUEDE CERRAR CON UN NÚMERO — v3.mcp_batch_plans/mcp_batch_jobs/mcp_batch_job_items cotizan un lote con un batchPlanHash antes de correrlo, v3.mcp_screenings/mcp_exports respaldan screen_account_list y create_export, y v3.apify_runs es el ledger de costo por corrida (antes solo Apollo entraba en v3.ai_usage_log; ahora Apify también queda medido). get_cost_summary cierra un batchJobId con IA + Apollo + Apify, declarando cuál de los tres es medido y cuál estimado. " +
  "(3) APOLLO APRENDE A DRENAR COLAS EN VEZ DE BARRER — v3.apollo_company_enrichment (cron cada 10 minutos, activo) y v3.apollo_domain_lookup (PAUSADO el 08-sep: la ruta y la tabla siguen operativas, pero salieron de vercel.json) sólo procesan lo que se siembra explícitamente, porque barrer las ~61.300 empresas sin resolver son ~38.000 créditos y esa decisión de gasto no la toma un cron. lib/apollo/ pasó de 11 a 18 módulos; nueve bugs de esta pasada sólo aparecieron probando contra producción, la misma lección que ya había costado cara con el matching de empresas. " +
  "(4) IDENTIDAD DE PERSONA, capas 1 y 2 — una señal pasa a definirse como (empresa, entrada de diccionario, persona resuelta) y no como una fila de `signals` (lib/shared/canonical-signals.ts, compartido por v2 y v3); contact_identities (trigger SQL) y contact_merges dan de baja duplicados de forma reversible; linkedin-profile.ts es el gemelo TypeScript de las funciones SQL de slug de perfil — si uno de los dos cambia sin el otro, la UI pliega una persona que la base cree que son dos. " +
  "(5) UN SOLO VOCABULARIO DE TELÉFONO — phone_status tenía tres dialectos incompatibles entre v2, v3 y el código; gana v2 porque es el que habla el webhook de Apollo, la única pieza que ninguna de las dos plataformas controla del todo. Ese webhook ahora también escribe v3.account_contacts, así que deja de ser un nodo puramente v2. " +
  "(6) DICCIONARIO — taxonomía de tres ejes y co-ocurrencia de keywords en siete lotes: son columnas nuevas sobre las 6 tablas que ya estaban en el mapa, ninguna tabla nueva. " +
  "PASO 2 de esta rutina (re-verificar lo ya escrito) encontró que OPT-05 empeoró en volumen (cron_executions: de ~1,3M a 1.686.884 filas, sigue sin retención) y que DEAD-12 se resolvió a medias: dictionary_term_suggestions ya tiene lector, bookmark_dedupe_log sigue sin uno."
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
// GAP 1/2 — cuarto servidor MCP (admin) y el standard sube de 37 a 45 tools
// ═══════════════════════════════════════════════════════════════════════════
const mcpServer = node("api_mcp_server")
mcpServer.label = "MCP estándar (45 tools)"
mcpServer.desc =
  "El PRIMERO de los cuatro servidores MCP, y el único (junto con admin, que comparte su registro) que conversa con las señales ya interpretadas por el diccionario. Punto de entrada único para lectura de cuentas, research, contactos, documentos y, desde el 24/25-ago, screening y lotes por batchPlanHash. Scope base companies:read / signals:read / accounts:read."
mcpServer.risk =
  "Ruta monolítica muy grande: concentra registro de tools, auth, cuota y transporte. Desde el 26-ago (#139) ese andamiaje vive en createV3McpHandler (lib/v3/mcp-server-tools.ts) y lo comparte con admin — OPT-07 pasó a PARCIAL, ver esa entrada. Explore y Perfiles siguen con su propia copia."
mcpServer.notes =
  "Las 45 tools son las 37 del 24-ago más 8 nuevas de esta pasada: screen_account_list, estimate_batch, create_batch_job, get_batch_job, create_export, build_evidence_icebreaker, get_cost_summary y request_contact_phones (ver svc_v3_mcp_batch). Dos tools cambiaron de contrato el 21-ago (sin cambios desde entonces): get_company_signal_summary con detail compact/full, y get_company_profile con firmographics null-explícito."

addNodeAfter("api_mcp_profiles", {
  id: "api_mcp_admin",
  label: "MCP admin (45 tools, comparte registro con standard)",
  zone: "v3",
  layer: 2,
  kind: "mcp",
  desc: "CUARTO servidor MCP, agregado el 26-ago-2026 (#136-#139): el perfil que usa el equipo de ASCI. No registra tools propias — llama al mismo createV3McpHandler({ profile: 'admin' }) que expone las 45 tools de lib/v3/mcp-server-tools.ts, y lo único suyo es el texto de instructions (nueve reglas en ADMIN_DESCRIPTION_RULES) y el flag 'unrestricted'.",
  files: ["app/api/v3/mcp/admin/[transport]/route.ts", "lib/v3/mcp-server-tools.ts"],
  env: ["ASCI_ADMIN_WORKSPACE_ID"],
  risk:
    "El permiso lo cierra el handshake: createV3McpHandler rechaza cualquier credencial sin el marcador 'unrestricted', así que conocer la URL no alcanza. Sin cupo mensual ni tope de lote para esta credencial — lo único que la hace defendible es que get_cost_summary deja todo medido. Dos operaciones siguen pidiendo confirmación pase lo que pase: remove_workspace_account y confirm_document_analysis.",
  notes:
    "Por qué hace falta una ruta aparte si el flag ya levanta los topes: el prompt es por SERVIDOR, no por credencial. Sin este texto, el modelo seguiría preguntando 42 veces y guardando cuentas que no hacía falta guardar — el permiso sin el texto no cambia el comportamiento.",
})

addEdge({ id: "e193", from: "ext_mcp_client", to: "api_mcp_admin", kind: "call", label: "tool call (unrestricted)" })
addEdge({ id: "e194", from: "api_mcp_admin", to: "svc_v3_mcp_auth", kind: "call", label: "mismo auth, exige marcador unrestricted" })
addEdge({ id: "e195", from: "api_mcp_admin", to: "svc_v3_usage", kind: "call", label: "auditoría, sin tope de cuota" })
addEdge({ id: "e196", from: "api_mcp_admin", to: "svc_v3_mcp_tools", kind: "call", label: "mismo registro de 45 tools que el standard" })

const mcpAuth = node("svc_v3_mcp_auth")
mcpAuth.desc =
  "OAuth, API keys y resolución de acceso/plan por request, para los CUATRO servidores MCP (standard, admin, explore, perfiles). Cada uno tiene su tipo de key y su scope; el consentimiento OAuth los ofrece por separado."
mcpAuth.files = ["lib/v3/mcp-auth.ts", "lib/v3/mcp-oauth.ts", "lib/v3/api-key-access.ts", "lib/v3/mcp-key-scopes.ts", "lib/v3/admin-workspace.ts"]
mcpAuth.notes =
  "Dos bugs del mismo origen, corregidos el 13-ago: explore:read y profiles:read existían como scope de API key pero NO en el catálogo OAuth, así que sanitizeScopes los descartaba y ningún token OAuth podía usar esos servidores. La lección: el catálogo OAuth y el de API keys son dos listas y hay que tocar las dos. " +
  "Se repitió el 24-ago con la API key standard: 9 tools nuevas quedaron inalcanzables porque su scope no estaba en lib/v3/mcp-key-scopes.ts (7d11403), que desde entonces es la fuente ÚNICA de scopes por tipo de key. lib/v3/admin-workspace.ts declara ASCI_ADMIN_WORKSPACE_ID como la excepción explícita del workspace admin."

const mcpTools = node("svc_v3_mcp_tools")
mcpTools.desc =
  "Implementación de las tools de lectura, ciclo de vida de cuenta, circuito client-assisted y, desde el 24/25-ago, el registro CENTRAL de las 45 tools que comparten standard y admin (lib/v3/mcp-server-tools.ts)."
mcpTools.files = ["lib/v3/mcp-read-tools.ts", "lib/v3/mcp-account-lifecycle.ts", "lib/v3/mcp-client-ai.ts", "lib/v3/mcp-server-tools.ts"]

// ═══════════════════════════════════════════════════════════════════════════
// GAP: screening, lotes y costo — la infraestructura nueva de gasto medido
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_v3_mcp_tools", {
  id: "svc_v3_mcp_batch",
  label: "Screening, lotes y costo",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "Las ocho tools que se sumaron a las 37 del 24-ago: screen_account_list (screening de una lista pegada), estimate_batch (cotiza el lote entero con un batchPlanHash), create_batch_job/get_batch_job (ejecuta y sigue el progreso), create_export (entregable por URL), get_cost_summary (cierra un batchJobId con IA + Apollo + Apify).",
  files: [
    "lib/v3/services/screen-account-list.ts",
    "lib/v3/services/mcp-batch-estimate.ts",
    "lib/v3/services/mcp-batch-job.ts",
    "lib/v3/services/mcp-export.ts",
    "lib/v3/services/mcp-cost-summary.ts",
  ],
  notes:
    "get_cost_summary declara la CALIDAD de cada número en vez de sumarlos como si fueran iguales: el de IA sale medido de v3.ai_usage_log, el de Apollo es ESTIMADO (Apollo no expone costo por llamada) y el de Apify sale medido corrida por corrida de v3.apify_runs, sin el alquiler mensual del actor. Si totalIsPartial es true, la tool lo dice en vez de presentar un total falso.",
  risk:
    "Para la credencial admin (ceiling.source = 'unrestricted') no hay cupo ni tope de lote: lo único que sostiene el perfil es que get_cost_summary deja todo medido. batchJobId es ATRIBUCIÓN, no autorización — el presupuesto agotado no corta nada para esta credencial.",
})
addEdge({ id: "e200", from: "svc_v3_mcp_tools", to: "svc_v3_mcp_batch", kind: "call" })
addEdge({ id: "e201", from: "svc_v3_mcp_batch", to: "db_mcp_batch", kind: "rw" })
addEdge({ id: "e202", from: "svc_v3_mcp_batch", to: "db_companies", kind: "read", label: "screen_account_list / estimate_batch" })
addEdge({ id: "e203", from: "svc_v3_mcp_batch", to: "db_ai_usage", kind: "read", label: "costo de IA, medido" })
addEdge({ id: "e204", from: "svc_v3_mcp_batch", to: "db_apify_runs", kind: "read", label: "costo de Apify, medido" })

addNodeAfter("db_mcp_logs", {
  id: "db_mcp_batch",
  label: "v3.mcp_batch_plans / mcp_batch_jobs / mcp_batch_job_items / mcp_screenings / mcp_exports",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Cotización, ejecución y entregable de un lote pedido por MCP: mcp_batch_plans guarda el batchPlanHash con el que se cierra el compromiso de créditos, mcp_batch_jobs/mcp_batch_job_items el progreso por cuenta, mcp_screenings el resultado de screen_account_list y mcp_exports lo que arma create_export.",
  tables: ["v3.mcp_batch_plans", "v3.mcp_batch_jobs", "v3.mcp_batch_job_items", "v3.mcp_screenings", "v3.mcp_exports"],
  files: [
    "supabase/migrations/20260824210819_mcp_batch_plans.sql",
    "supabase/migrations/20260825020834_mcp_batch_jobs.sql",
    "supabase/migrations/20260825015932_mcp_screenings_and_exports.sql",
    "supabase/migrations/20260826191459_apollo_en_el_batch_plan_hash.sql",
  ],
})

addNodeAfter("db_linkedin_enrichment", {
  id: "db_apollo_v3_enrichment",
  label: "v3.apollo_company_enrichment / apollo_domain_lookup",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Las dos colas de Apollo que se DRENAN, nunca se barren solas: apollo_company_enrichment para organizations/bulk_enrich (activa, cron cada 10') y apollo_domain_lookup para el barrido de dominio por nombre (código y tabla vivos, cron PAUSADO desde f513468 el 08-sep-2026). Sembrar una fila es el acto explícito que autoriza el gasto.",
  tables: ["v3.apollo_company_enrichment", "v3.apollo_domain_lookup"],
  files: [
    "supabase/migrations/20260826120000_apollo_enrichment_columnas_y_checkpoint.sql",
    "supabase/migrations/20260827205412_checkpoint_de_dominio_por_nombre.sql",
    "lib/apollo/org-enrichment-runner.ts",
    "lib/apollo/domain-lookup-runner.ts",
  ],
  notes:
    "Con la cola vacía el cron corre, no encuentra nada y gasta cero: autorizar otro lote es un INSERT, no una decisión que tome el cron. Tope de 3 intentos por fila (MAX_ATTEMPTS): sin él, una fila que falla siempre reintentaría cada 30 minutos para siempre, resolviendo la cuenta en Apollo (1 crédito) antes de fallar al escribir.",
})

addNodeAfter("db_apollo_v3_enrichment", {
  id: "db_apify_runs",
  label: "v3.apify_runs",
  zone: "shared",
  layer: 4,
  kind: "table",
  desc: "Ledger de gasto de Apify por corrida: quién la disparó (cron, MCP admin/standard o Explore), cuántos créditos costó y de qué compañía. Es lo que permite que get_cost_summary mida Apify y no lo deje afuera de la contabilidad, como pasaba antes con todo lo que no fuera IA.",
  tables: ["v3.apify_runs"],
  files: ["lib/v3/services/spend-ledger.ts"],
  notes: "No incluye el alquiler MENSUAL fijo del actor de Apify: get_cost_summary lo aclara aparte para no presentar un total que parece completo y no lo es.",
})
addEdge({ id: "e205", from: "svc_v3_jobs", to: "db_apify_runs", kind: "write", label: "recordApifyRun" })

// ═══════════════════════════════════════════════════════════════════════════
// GAP 6/11 — cron de enrichment de organizaciones contra Apollo (activo)
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("cron_v3_enrich_linkedin", {
  id: "cron_v3_apollo_org_enrichment",
  label: "cron v3-apollo-org-enrichment (10m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Drena v3.apollo_company_enrichment con status='pending': resuelve organizations/bulk_enrich contra Apollo (1 crédito por cuenta resuelta) y escribe las columnas de alto valor sobre public.companies. Lote chico (100 dominios) para que el gasto quede repartido y un fallo puntual se recupere en 10 minutos.",
  files: ["app/api/cron/v3-apollo-org-enrichment/route.ts", "lib/apollo/org-enrichment-runner.ts", "lib/apollo/bulk-organizations.ts", "lib/apollo/company-writer.ts"],
  notes:
    "Nueve fixes de esta pasada sólo aparecieron probando contra producción (628ddb1..06d0c23): bulk_enrich no devolvía tecnologías y rompía la guarda de caché, el enrichment SÍ cuesta créditos y el ledger lo anotaba en cero, el tope de tecnologías truncaba en silencio a 500. Misma lección que ya había costado cara con el matching de empresas: sintético no alcanza.",
})
addEdge({ id: "e197", from: "cron_v3_apollo_org_enrichment", to: "db_apollo_v3_enrichment", kind: "rw", label: "drena v3.apollo_company_enrichment" })
addEdge({ id: "e198", from: "cron_v3_apollo_org_enrichment", to: "ext_apollo", kind: "call", label: "organizations/bulk_enrich" })
addEdge({ id: "e199", from: "cron_v3_apollo_org_enrichment", to: "db_companies", kind: "write", label: "campos genéricos + apollo_*" })

addFlow({
  id: "f_apollo_org_enrichment_v3",
  name: "Enrichment de organizaciones de Apollo (v3, por cola)",
  version: "v3",
  trigger: "Cron cada 10 minutos sobre v3.apollo_company_enrichment con status='pending'",
  desc: "A diferencia de f_apollo (v2, por búsqueda), acá no se descubre trabajo: se siembra. Barrer las ~61.300 empresas sin resolver son ~38.000 créditos, una decisión de gasto que toma el dueño del proyecto con un INSERT, no el cron.",
  steps: [
    { n: 1, nodeId: "cron_v3_apollo_org_enrichment", detail: "Toma hasta 100 filas pendientes con attempts < 3, ordenadas por next_attempt_at." },
    { n: 2, nodeId: "ext_apollo", edgeId: "e198", detail: "bulkEnrichOrganizations, en chunks. Se corta antes del budget (45s) o del límite de rate." },
    { n: 3, nodeId: "db_companies", edgeId: "e199", detail: "company-writer.ts aplica la regla: apollo_* siempre, genéricas solo si están vacías, industry/is_public nunca." },
    { n: 4, nodeId: "db_apollo_v3_enrichment", edgeId: "e197", detail: "Marca found/not_found/error. Al tercer intento fallido la fila queda 'failed', terminal." },
  ],
})

// ═══════════════════════════════════════════════════════════════════════════
// GAP 10 — svc_apollo: 11 -> 18 módulos, y nota del cron pausado
// ═══════════════════════════════════════════════════════════════════════════
const svcApollo = node("svc_apollo")
svcApollo.label = "Apollo (18 módulos)"
svcApollo.desc =
  "Search, enrich, organizations, cache por hash de query, validación de títulos, parsers, dominio y, desde el 26-ago, dos runners de cola (organization enrichment y domain lookup). El pipeline de búsqueda de decisores salió de acá a lib/shared/ el 21-ago para que lo usen las dos versiones; v2 quedó como wrapper."
svcApollo.notes =
  "El cron de domain lookup (bb0b8cf) se PAUSÓ el 08-sep-2026 (f513468): salió de la lista de crons de vercel.json, pero lib/apollo/domain-lookup-runner.ts, su ruta y v3.apollo_domain_lookup siguen operativos y se pueden invocar a mano. No es código muerto — es una decisión de gasto en pausa, igual que el resto de las colas de Apollo."

// ═══════════════════════════════════════════════════════════════════════════
// GAP 5 — el webhook de Apollo cruza a v3
// ═══════════════════════════════════════════════════════════════════════════
const apolloWebhook = node("api_apollo_webhook")
apolloWebhook.zone = "shared"
apolloWebhook.desc =
  "Callback de Apollo autenticado por secreto en el path. Desde el 27-ago (583bc4e) ya no es puramente v2: también resuelve teléfonos pedidos por request_contact_phones (MCP) y los escribe en v3.account_contacts."
apolloWebhook.files = ["app/api/webhooks/apollo/[secret]/route.ts", "lib/v3/services/contact-phone-inbox.ts"]
addEdge({ id: "e206", from: "api_apollo_webhook", to: "db_apollo_cache", kind: "write", label: "teléfono recibido" })
addEdge({ id: "e207", from: "api_apollo_webhook", to: "db_account_contacts", kind: "write", label: "vocabulario phone_status de v2" })

const contactsSvc = node("svc_v3_contacts")
contactsSvc.files = [
  "lib/v3/services/contacts.ts",
  "lib/v3/services/contact-provider.ts",
  "lib/v3/services/mcp-contact-enrichment.ts",
  "lib/v3/mcp-contact-coverage.ts",
  "lib/v3/services/mcp-contact-phones.ts",
]
contactsSvc.notes =
  "phone_status habla el vocabulario de v2 desde el 27-ago (lib/shared/phone-status.ts): había tres dialectos incompatibles (v2, el CHECK de v3 y lo que el código de v3 realmente escribía/leía), y gana v2 porque es el que habla el webhook de Apollo — la pieza que ninguna de las dos plataformas controla del todo. request_contact_phones (mcp-contact-phones.ts) sólo pide teléfono para contactos con email verificado y cargo que matchea, porque cuesta 5 créditos contra 1 del email; no espera la respuesta, Apollo entrega por webhook (57% de las veces) y el número se lee después con get_company_contacts."

// ═══════════════════════════════════════════════════════════════════════════
// GAP 4 — identidad de persona (capas 1/2): canonical-signals + linkedin-profile
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_shared_news", {
  id: "svc_shared_identity",
  label: "Identidad de señal y de persona",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc: "Dos piezas de la misma capa de identidad, compartidas por v2 y v3. canonical-signals.ts define que UNA SEÑAL es (empresa, entrada de diccionario, persona resuelta) y agrupa en LECTURA sin tocar datos ni ETL, para que el mismo término no aparezca dos veces como si fueran dos señales distintas cuando en realidad es el mismo perfil scrapeado dos veces con URLs distintas. linkedin-profile.ts calcula el slug canónico de un perfil y es el GEMELO en TypeScript de contact_profile_slug()/contact_profile_suffix() (SQL): si un lado cambia sin el otro, la UI pliega como una persona lo que la base sigue creyendo que son dos.",
  files: ["lib/shared/canonical-signals.ts", "lib/shared/linkedin-profile.ts"],
  notes:
    "Medido antes de escribir la definición: 88.891 slugs de contacts con acentos, 299 percent-encoded, 1.682 con guión colgado, 6.386 con el URN ofuscado en vez del slug (544.808 filas relevadas). La identidad que resuelve es CONSERVADORA a propósito: ante la duda no fusiona — el merge real de duplicados en contacts (2.737 grupos medidos) es un trabajo aparte, análogo a merge_companies/v3.company_merges.",
})
addEdge({ id: "e208", from: "ui_v2_search", to: "svc_shared_identity", kind: "call", label: "company-drawer agrupa señales por entrada de diccionario" })
addEdge({ id: "e209", from: "svc_v3_signals", to: "svc_shared_identity", kind: "call", label: "company-signal-summary" })
addEdge({ id: "e210", from: "svc_v3_contacts", to: "svc_shared_identity", kind: "call", label: "contact-provider normaliza el slug" })

addNodeAfter("db_contacts", {
  id: "db_contact_identity",
  label: "public.contact_identities / v3.contact_merges",
  zone: "shared",
  layer: 4,
  kind: "table",
  desc: "Capa 1/2 de identidad de persona: contact_identities se puebla con un trigger SQL (trg_sync_contact_identities) en cada escritura de contacts, y contact_merges/revert_contact_merge dan de baja duplicados de forma REVERSIBLE — análogo a company_merges pero para personas.",
  tables: ["public.contact_identities", "v3.contact_merges"],
  files: ["supabase/migrations/20260825000000_contact_identity_resolution.sql", "supabase/migrations/20260825001000_contact_merge.sql"],
  notes: "Sin lector directo en TypeScript: la resolución vive en SQL (trigger + funciones). El único consumidor en código de aplicación es el gemelo de lectura, lib/shared/linkedin-profile.ts (ver svc_shared_identity).",
})

// ═══════════════════════════════════════════════════════════════════════════
// GAP: icebreakers sin IA (Fase 3, 0dbf411) y contención de texto de terceros
// ═══════════════════════════════════════════════════════════════════════════
const icebreakers = node("svc_v3_icebreakers")
icebreakers.files = [
  "lib/v3/services/icebreakers.ts",
  "lib/v3/services/icebreaker-deterministic.ts",
  "lib/v3/services/icebreaker-register.ts",
  "lib/v3/services/icebreaker-template.ts",
  "lib/v3/services/untrusted-text.ts",
]
icebreakers.notes =
  "icebreaker-deterministic.ts arma el icebreaker SIN IA cuando hay evidencia suficiente (Fase 3, 0dbf411): más barato y sin el riesgo de alucinar sobre datos que ya están confirmados. untrusted-text.ts contiene el texto de terceros (vacantes, noticias, perfiles) para que una instrucción inyectada ahí no se cuele en el prompt del icebreaker con IA."

// ═══════════════════════════════════════════════════════════════════════════
// f_mcp_tool — el trigger seguía diciendo "36 tools" y sólo mencionaba un server
// ═══════════════════════════════════════════════════════════════════════════
const fMcpTool = flow("f_mcp_tool")
fMcpTool.trigger = "Un agente IA invoca una tool de cualquiera de los CUATRO servidores MCP (standard, admin, explore o perfiles)"
fMcpTool.desc =
  "Todo pasa por un proxy sobre server.tool que instrumenta auditoría y cuota sin perder tipado. mcp_request_logs es a la vez auditoría y contador de rate limit. Standard y admin comparten exactamente este camino desde createV3McpHandler (26-ago); Explore y Perfiles lo repiten con su propia copia del andamiaje (ver OPT-07)."

// ═══════════════════════════════════════════════════════════════════════════
// f_jobs_apify — falta el paso del ledger de gasto (ba2bbbb)
// ═══════════════════════════════════════════════════════════════════════════
const fJobsApify = flow("f_jobs_apify")
fJobsApify.steps = [
  { n: 1, nodeId: "cron_v3_scrape_jobs", detail: "Toma las cuentas seguidas que tocan y MARCA EL INTENTO antes de gastar." },
  { n: 2, nodeId: "svc_v3_jobs", detail: "Arma la query: companyId si la compañía tiene linkedin_company_id, variantes de nombre si no. publishedAt es un enum cerrado." },
  { n: 3, nodeId: "ext_apify", edgeId: "e74", detail: "bebity/linkedin-jobs-scraper." },
  { n: 4, nodeId: "db_apify_runs", edgeId: "e205", detail: "recordApifyRun deja el costo de ESTA corrida en el ledger, sea cron, MCP admin/standard o Explore quien la disparó (ba2bbbb, 26-ago)." },
  { n: 5, nodeId: "db_job_postings", edgeId: "e75", detail: "CONTACTO con v2: belongsToCompany descarta lo ajeno ANTES de insertar y el resultado dice cuántas se cayeron. Sin URL no se inserta: no se podría deduplicar." },
  { n: 6, nodeId: "svc_v3_dictionary", edgeId: "e128", detail: "Interpreta la vacante contra el diccionario." },
]

// ═══════════════════════════════════════════════════════════════════════════
// PASO 2 — re-verificación de optimizations abiertas
// ═══════════════════════════════════════════════════════════════════════════
opt("OPT-05").finding =
  "La tabla de log de crons ya NO está expuesta (RLS desde 20260818220610), pero sigue creciendo sin tope: cleanup_old_import_data no la referencia y hay dos crons corriendo cada minuto. Recontada el 28-sep-2026: 1.686.884 filas (eran ~1,3M el 24-ago) — el problema no se movió, empeoró en volumen."
opt("OPT-05").evidence = ["public.cron_executions (relrowsecurity=true, 1.686.884 filas al 28-sep-2026)", "cleanup_old_import_data no la referencia"]

opt("OPT-06").title = "12-15 archivos siguen instanciando createClient crudo y salteando los helpers de Supabase"
opt("OPT-06").finding =
  "components/v3/navbar.tsx se corrigió (ya usa lib/supabase/client, sólo importa el *type* User). Pero en el mismo rango aparecieron archivos nuevos con el mismo patrón: los tres crons de Apollo v3 (org-enrichment, domain-lookup) y normalize-country-phase5. Recontado el 28-sep-2026: 12 en app/+lib/+components, +3 en scripts/ si se cuentan. Neto: no bajó, se mantiene en el mismo orden de magnitud. Sigue sin regla de lint que lo impida."
opt("OPT-06").evidence = [
  "12 archivos con createClient real (no import type) fuera de lib/supabase/ en app/+lib/+components al 28-sep-2026",
  "dictionary.ts, 6 rutas de cron previas + v3-apollo-domain-lookup, v3-apollo-org-enrichment, v3-enrich-companies-linkedin, ingest/upload, landing-stats, normalize-country-phase5",
]

opt("OPT-07").title = "PARCIAL: el factory ya existe y lo usan standard+admin, pero explore y profiles siguen duplicando el andamiaje"
opt("OPT-07").finding =
  "El 26-ago (#139, 8001842) se extrajo exactamente el factory que este hallazgo pedía: createV3McpHandler en lib/v3/mcp-server-tools.ts concentra createMcpHandler+withMcpAuth+cuota+mapa de nextAction, y hoy lo llaman DOS de las cuatro rutas MCP — server (33 líneas) y el admin nuevo (41 líneas), ambas sólo con su propio texto de instructions. Explore (499 líneas) y Perfiles (307 líneas) siguen con su copia completa del andamiaje, importando createMcpHandler/withMcpAuth directo de mcp-handler."
opt("OPT-07").fix =
  "Falta la mitad: extender explore y profiles para que llamen a createV3McpHandler en vez de armar su propio transporte+auth. El patrón ya está probado en producción por dos rutas — migrar las otras dos es mecánico, no de diseño."

opt("OPT-09").evidence = [
  "índices únicos con indpred no nulo en public y v3",
  "40 llamadas a .upsert(..., onConflict) medidas en app/+lib/ al 28-sep-2026",
]
opt("OPT-09").finding =
  "Existen índices únicos parciales y 40 llamadas a .upsert({ onConflict }) medidas hoy. El cliente no permite expresar el predicado WHERE del índice, así que Postgres no puede usarlo como árbitro. El caso puntual que ya había roto esto (v3.account_contacts) hoy tiene un índice único NO parcial (account_contacts_ws_company_person_uniq) que sí es árbitro válido — ese caso está resuelto, pero el patrón de riesgo general sigue sin auditoría sistemática ni regla."

opt("OPT-13").evidence = ["uso de .schema(\"v3\") disperso: 431 ocurrencias medidas en app/+lib/ al 28-sep-2026", "sin ningún v3Db() helper (grep sin resultados)"]
opt("OPT-13").finding =
  "El acceso a v3 sigue dependiendo de recordar .schema('v3') en cada consulta. El ejemplo original (app/actions/v3/csv-import.ts) ya no existe — se borró como parte de DEAD-01 el 19-ago — pero el problema de fondo es más grande hoy: 431 ocurrencias dispersas de .schema('v3') y ningún helper que lo centralice."

// ═══════════════════════════════════════════════════════════════════════════
// PASO 2 — re-verificación de deadCode abierto
// ═══════════════════════════════════════════════════════════════════════════
const d12 = dead("DEAD-12")
d12.title = "PARCIAL: dictionary_term_suggestions ya tiene lector; bookmark_dedupe_log sigue sin uno"
d12.evidence = ["v3.bookmark_dedupe_log: 21 filas, sin lector en TypeScript", "v3.dictionary_term_suggestions: 769 filas, CON lector desde el 24-ago"]
d12.finding =
  "dictionary_term_suggestions dejó de ser código muerto: lib/v3/services/dictionary.ts (líneas 304/315/325) la lee desde el commit d546629 (24-ago-2026, 'diccionario: lote de datos y BI aplicado'). bookmark_dedupe_log sigue sin ningún lector en TypeScript — pero tampoco es un olvido: sus 21 filas son el snapshot de una operación de dedupe ya corrida (scripts/417_bookmark_dedupe_legacy.sql, scripts/419_test_dedupe_legacy.sql), no una feature a medio construir."
d12.verification =
  "Grep de dictionary_term_suggestions sobre lib/v3: 3 usos reales en dictionary.ts. Conteo de filas por SQL contra grenlquhexbyneubtdub el 28-sep-2026: bookmark_dedupe_log=21, dictionary_term_suggestions=769."
d12.recommendation =
  "Cerrar la mitad de dictionary_term_suggestions: ya no aplica el diagnóstico de 'sin lector'. bookmark_dedupe_log se CONSERVA a propósito como historial de la operación de dedupe — no borrar sin revisar antes si algún script de auditoría futuro la necesita."

const d11 = dead("DEAD-11")
const d11Note =
  "28-sep-2026: en código sólo se referencia APOLLO_WEBHOOK_SECRET (bien escrito); ningún archivo lee la variante con el typo. NO VERIFICADO si la variable vieja sigue configurada en Vercel — sin permiso para listar env vars del proyecto en esta pasada (filter_project_envs devolvió 403)."
if (!d11.verification.includes(d11Note)) d11.verification = d11.verification + " " + d11Note

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
