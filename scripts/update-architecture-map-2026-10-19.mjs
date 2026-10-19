/**
 * Actualiza docs/architecture-map.json con lo que entró entre el 24-ago-2026
 * (última pasada, 1a7ee0c) y el 8-sep-2026 (HEAD de main, f513468): 82 commits
 * sin merges, #123 a #154.
 *
 * Qué cubre y por qué entra cada cosa:
 *
 *   MCP ADMIN (#136-#140, #143, #144, #147)  Cuarta ruta MCP. No es un servidor
 *     nuevo con tools propias: las tools se extrajeron a lib/v3/mcp-server-tools.ts
 *     y las registran dos perfiles (standard y admin). El perfil admin existe
 *     porque el prompt es por SERVER y no por credencial. Entran el nodo, el
 *     flujo y el punto de contacto del flag `unrestricted`.
 *   LOTES Y COSTO (#124, #138, #142, d1e60cf...) screen_account_list ->
 *     estimate_batch -> create_batch_job -> create_export, el batchPlanHash que
 *     autoriza créditos de Apollo y el ledger de gasto (v3.apify_runs).
 *   ENRICHMENT DE APOLLO (934beef, #149, #151, #154)  Dos crons nuevos que
 *     drenan colas sembradas; el de dominio por nombre está PAUSADO desde el 8-sep
 *     (su entrada salió de vercel.json, la ruta sigue viva). Hay que decirlo: un
 *     nodo `cron` que no corre es exactamente el tipo de afirmación falsa que
 *     este mapa no puede tener.
 *   TELÉFONOS (#148, #150)  El webhook de Apollo aprende el camino v3.
 *   IDENTIDAD (capa 2, 12cd806, 3750a1e)  contact_identities / contact_merges y
 *     la Fase 0 del ETL de companies.
 *   RE-VERIFICACIÓN (PASO 2)  OPT-05 y OPT-06 EMPEORARON; OPT-07, OPT-12, OPT-13,
 *     DEAD-03 y DEAD-12 tenían evidencia vieja. Ninguno pasó a "resuelta".
 *
 * Stats medidos con comandos el 19-oct-2026 sobre origin/main; tablesPublic y
 * tablesV3 consultados a information_schema con el MCP de Supabase (solo lectura).
 *
 * Idempotente. Se hace por script y no a mano porque son ~4.600 líneas de JSON y
 * una edición de texto ya rompió la estructura una vez.
 *
 * Correr:  node scripts/update-architecture-map-2026-10-19.mjs
 *          node scripts/build-architecture-map.mjs
 */
import { readFileSync, writeFileSync } from "node:fs"

const PATH = "docs/architecture-map.json"
const j = JSON.parse(readFileSync(PATH, "utf8"))
const before = {
  nodes: j.nodes.length, edges: j.edges.length, flows: j.flows.length,
  cps: j.contactPoints.length, opts: j.optimizations.length, dead: j.deadCode.length,
}
const find = (arr, id, what) => {
  const x = arr.find((y) => y.id === id)
  if (!x) throw new Error(`${what} inexistente: ${id}`)
  return x
}
const node = (id) => find(j.nodes, id, "Nodo")
const opt = (id) => find(j.optimizations, id, "Optimizacion")
const dead = (id) => find(j.deadCode, id, "DeadCode")
const addNodeAfter = (afterId, n) => {
  if (j.nodes.some((x) => x.id === n.id)) { Object.assign(node(n.id), n); return }
  j.nodes.splice(j.nodes.findIndex((x) => x.id === afterId) + 1, 0, n)
}
const addEdge = (e) => {
  const ex = j.edges.find((x) => x.id === e.id)
  if (ex) Object.assign(ex, e); else j.edges.push(e)
}
const upsert = (arr, x) => {
  const at = arr.findIndex((y) => y.id === x.id)
  if (at >= 0) arr[at] = x; else arr.push(x)
}
const addFlow = (f) => upsert(j.flows, f)
const addContactPoint = (c) => upsert(j.contactPoints, c)
const addOpt = (o) => upsert(j.optimizations, o)

// ═══ meta ═══════════════════════════════════════════════════════════════════
j.meta.generatedAt = "2026-10-19"
j.meta.summary =
  "Monorepo Next.js único donde conviven ASCI v2 (producción, schema public) y ASCI v3 (multitenant, schema v3) sobre la MISMA base Supabase. El aislamiento es por schema, no por proyecto ni por base. " +
  "Actualización 2026-10-19, repaso de los 82 commits (#123 a #154, 24-ago a 8-sep) que entraron desde la pasada anterior. Por orden de peso: " +
  "(1) PERFIL MCP ADMIN — una cuarta ruta (/api/v3/mcp/admin) sobre la MISMA registración de tools que el estándar (lib/v3/mcp-server-tools.ts, 45 tools): la diferencia es el texto, no el código. Sin topes de cupo ni de lugares del plan; el único techo enforceable del gasto irreversible de Apollo es el presupuesto del lote (batchPlanHash), y todo se cierra con get_cost_summary. " +
  "(2) EJECUCIÓN SOBRE LISTAS — screen_account_list, estimate_batch, create_batch_job y create_export, con sus tablas v3.mcp_*. " +
  "(3) ENRICHMENT DE APOLLO POR COLA — dos crons que drenan colas SEMBRADAS (organizaciones con website; dominio por nombre para las ~420.750 companies sin website). El de dominio por nombre está PAUSADO desde el 8-sep: sale del schedule de vercel.json, la ruta sigue viva. " +
  "(4) GASTO MEDIDO — v3.apify_runs registra el costo de Apify por corrida, y el ledger de Apollo dejó de anotar en cero el enrichment de organizaciones (cuesta 1 crédito por cuenta resuelta). " +
  "(5) IDENTIDAD DE PERSONA Y EMPRESA — contact_identities, fusión reversible de contactos (v3.contact_merges) y la Fase 0 del ETL de companies. " +
  "(6) TELÉFONOS — el webhook de Apollo escribe también el camino v3 y los 80 teléfonos que v2 ya había pagado se movieron al caché compartido. " +
  "Re-verificación de lo abierto: OPT-05 (cron_executions: 1,83M filas, sin retención) y OPT-06 (17 archivos con createClient crudo) EMPEORARON; ningún hallazgo pasó a resuelto en este período. " +
  "NO VERIFICADO: las migraciones del período se escribieron en el repo pero este repaso no comprobó cuáles están aplicadas en producción."
j.meta.stats = {
  tsFiles: 490, apiRoutes: 58, pages: 50, crons: 13, sqlScripts: 268, migrations: 49,
  tablesPublic: 58, tablesV3: 68, mcpServers: 4, mcpTools: 56,
}
j.meta.statsNotes = {
  crons: "13 entradas en vercel.json. v3-apollo-domain-lookup tiene ruta pero NO está en vercel.json (pausado el 8-sep).",
  mcpTools: "45 (standard y admin comparten registración en lib/v3/mcp-server-tools.ts) + 8 Explore + 3 Perfiles = 56 tools distintas. El perfil admin no suma: expone las mismas 45.",
  mcpServers: "4 rutas MCP: server (standard), admin, explore, profiles. Tres registraciones de tools distintas.",
  tablesPublic: "information_schema.tables, BASE TABLE, medido el 19-oct-2026 contra asciv2-database (era 55).",
  tablesV3: "ídem (era 53).",
}

// ═══ nodos modificados ══════════════════════════════════════════════════════
Object.assign(node("api_mcp_server"), {
  label: "MCP estándar (45 tools)",
  desc:
    "El PRIMERO de los servidores MCP y el que conversa con las señales ya interpretadas por el diccionario. Desde #139 la ruta son 33 líneas: sus `instructions` y createV3McpHandler({profile:'standard'}). Las 45 tools viven en lib/v3/mcp-server-tools.ts y las comparte con el perfil admin; cada una pasa por withToolAudit (auditoría y cuota) vía proxy sobre server.tool. Scope base companies:read / signals:read / accounts:read.",
  files: ["app/api/v3/mcp/server/[transport]/route.ts", "lib/v3/mcp-server-tools.ts"],
  risk: "La ruta ya no es monolítica (el andamiaje se extrajo a createV3McpHandler), pero Explore y Perfiles siguen con su propia copia: ver OPT-07.",
})
node("api_mcp_explore").label = "MCP Explore (8 tools)"
Object.assign(node("svc_v3_mcp_tools"), {
  desc: "Registro único de las 45 tools del perfil standard y admin, más la implementación de lectura, ciclo de vida de cuenta y circuito client-assisted.",
  files: ["lib/v3/mcp-server-tools.ts", "lib/v3/mcp-read-tools.ts", "lib/v3/mcp-account-lifecycle.ts", "lib/v3/mcp-client-ai.ts"],
})
Object.assign(node("api_mcp_oauth"), {
  notes:
    "Desde #143 un token OAuth puede ser `unrestricted`: el marcador NO sale de los scopes (salen del consentimiento del usuario, que se puede manipular) sino de dos hechos del servidor: el workspace guardado en la fila del token y el rol global leído de profiles. Un superadmin que entra por el workspace de un cliente NO queda sin topes. Antes devolvía `false` literal y un conector de claude.ai al perfil admin veía cero tools sin error visible.",
})
Object.assign(node("api_apollo_webhook"), {
  zone: "shared",
  desc: "Callback de Apollo autenticado por secreto en el path. Desde #148 tiene dos caminos: el de v2 (user_company_contacts) y el de v3 (lib/v3/services/contact-phone-inbox.ts), que se llama en UN solo punto antes de las tres salidas de la función.",
  files: ["app/api/webhooks/apollo/[secret]/route.ts", "lib/v3/services/contact-phone-inbox.ts"],
  notes:
    "En v3 el número va al caché COMPARTIDO (apollo_contacts_cache) y el estado a v3.account_contacts. El estado se toca solo en filas `pending` (pedir es por workspace); la fecha de verificación se toca en todas las filas de la persona, porque describe el dato y no el pedido.",
})
node("svc_v3_contacts").files = [
  "lib/v3/services/contacts.ts", "lib/v3/services/contact-provider.ts", "lib/v3/services/mcp-contact-enrichment.ts",
  "lib/v3/services/mcp-contact-phones.ts", "lib/v3/services/contact-phone-inbox.ts", "lib/v3/mcp-contact-coverage.ts",
]
node("svc_apollo").label = "Apollo (lib/apollo/)"
node("svc_apollo").desc =
  "Search, enrich, organizations, cache por hash de query, validación de títulos, parsers y dominio. Desde 26-ago suma los runners de las colas (org-enrichment-runner, domain-lookup-runner), company-writer, bulk-organizations, rate-limits y usage-stats. El pipeline de búsqueda de decisores vive en lib/shared/ y v2 es wrapper."
node("svc_apollo").files = ["lib/apollo/"]
Object.assign(node("db_apollo_cache"), {
  notes:
    "Está indexado por dominio de la empresa, no por companyId. Desde #149 una fila significa 'YA pagamos por esta persona' y dentro de la ventana de frescura no se vuelve a pedir, tenga email o no (medido: 921 de 4.223 llamadas a people/match eran repetidas dentro de la ventana, 21,8%). Desde #150 también guarda teléfonos: los 80 que v2 había pagado se movieron acá; antes el caché tenía 4.416 personas y cero teléfonos. Ante un error de lectura del caché se pide todo (la dirección segura del error es gastar de más).",
})
node("ext_apify").notes =
  "Su costo se mide por corrida en v3.apify_runs (usageTotalUsd, verificado contra una corrida real: 35 vacantes, US$0,01425). No incluye el alquiler mensual del actor (US$29,99 fijos), que no se prorratea."
node("ext_apollo").desc =
  (node("ext_apollo").desc || "").replace(/ Organizations\/enrich cuesta.*$/, "") +
  " Organizations/enrich cuesta 1 crédito por cuenta resuelta (el ledger lo anotaba en cero hasta fcf40a4); organizations/search es gratuito pero consume cuota horaria del plan (400/h)."

// ═══ nodos nuevos ═══════════════════════════════════════════════════════════
addNodeAfter("api_mcp_server", {
  id: "api_mcp_admin", label: "MCP Admin (perfil, 45 tools)", zone: "v3", layer: 2, kind: "mcp",
  desc:
    "Perfil del equipo de ASCI. NO tiene tools propias: son las mismas 45 del estándar. La ruta aporta solo `instructions` y nueve reglas find/replace sobre las descripciones (ADMIN_DESCRIPTION_RULES). Existe aparte porque el prompt es por SERVER y no por credencial: sin el texto, el modelo pregunta 42 veces aunque el guard deje pasar. Una credencial sin el marcador `unrestricted` se rechaza en el handshake.",
  files: ["app/api/v3/mcp/admin/[transport]/route.ts", "lib/v3/mcp-server-tools.ts", "lib/v3/admin-workspace.ts", "lib/v3/mcp-key-scopes.ts"],
  risk: "Sin tope de cupo mensual ni de lugares del plan por diseño. El único techo enforceable del gasto de Apollo es el presupuesto del lote (enrichment_credits_authorized). Sin batchJobId sigue rigiendo el cupo mensual, para todos los perfiles.",
  notes:
    "Dos confirmaciones se conservan: Apollo (crédito de un tercero, irreversible) y lo destructivo (remove_workspace_account, confirm_document_analysis). Las instrucciones y los comentarios de las rutas dicen '44 tools' pero el código registra 45: deriva de documentación, no de comportamiento.",
})
addNodeAfter("cron_v3_enrich_linkedin", {
  id: "cron_v3_apollo_org", label: "cron v3-apollo-org-enrichment (10m)", zone: "v3", layer: 2, kind: "cron",
  desc:
    "Drena la cola SEMBRADA v3.apollo_company_enrichment (status pending, o error con reintento vencido; MAX_ATTEMPTS=3). Jamás descubre trabajo por su cuenta: ~61.300 empresas con website sin resolver costarían ~38.000 créditos y eso es una decisión de gasto. Con la cola vacía no llama a Apollo y gasta cero; autorizar otro lote es un INSERT.",
  files: ["app/api/cron/v3-apollo-org-enrichment/route.ts", "lib/apollo/org-enrichment-runner.ts"],
  schedule: "*/10 * * * *",
})
addNodeAfter("cron_v3_apollo_org", {
  id: "cron_v3_apollo_domain", label: "cron v3-apollo-domain-lookup (PAUSADO)", zone: "v3", layer: 2, kind: "cron",
  desc:
    "Resuelve el dominio por NOMBRE (organizations/search, gratuito) para las ~420.750 companies sin website, el 88% del catálogo que no entra a ninguna fase de Apollo porque enrich recibe dominios. 350 llamadas/hora sobre una cuota de 400. Solo promueve a companies.website lo clasificado auto_ok y solo sobre columnas vacías. PAUSADO el 8-sep (#154): su entrada salió de vercel.json, que es lo único que mira Vercel. La ruta sigue en pie (corre a mano con el secreto de cron y ?dryRun=1&limit=N) y la cola conserva sus filas en pending.",
  files: ["app/api/cron/v3-apollo-domain-lookup/route.ts", "lib/apollo/domain-lookup-runner.ts", "lib/apollo/domain-lookup.ts"],
  notes: "Reanudar = devolver la entrada al array `crons` con */10 y desplegar.",
})
addNodeAfter("svc_v3_mcp_tools", {
  id: "svc_v3_mcp_batch", label: "Screening, lotes y export MCP", zone: "v3", layer: 3, kind: "service",
  desc:
    "screen_account_list (una llamada para una lista; estado matched_no_signal distingue 'no tiene' de 'no está'), estimate_batch (cotiza el lote entero con una confirmación), create_batch_job (congela el batchPlanHash y el presupuesto de créditos calculado en el server, nunca del input), get_batch_job y create_export. Incluye icebreakers determinísticos sin IA.",
  files: [
    "lib/v3/services/screen-account-list.ts", "lib/v3/services/mcp-batch-estimate.ts", "lib/v3/services/mcp-batch-job.ts",
    "lib/v3/services/mcp-export.ts", "lib/v3/services/icebreaker-deterministic.ts", "lib/v3/services/mcp-cost-summary.ts",
  ],
  risk: "La clave de consolidación del screening es public.company_screen_key, separada de company_core_name A PROPÓSITO: auto_merge_safe_duplicates agrupa por normalized_name y fusiona, así que aflojar el normalizador habría fusionado empresas hoy separadas sin vuelta atrás.",
})
addNodeAfter("svc_v3_usage", {
  id: "svc_v3_spend_ledger", label: "Ledger de gasto", zone: "v3", layer: 3, kind: "service",
  desc:
    "Atribuye costo por corrida: Apify en v3.apify_runs (cron de primera pasada, mensual, kick de la UI y explore), Apollo vía contact_enrichment_runs/apollo_api_calls, IA en ai_usage_log. La unidad de atribución es la EMPRESA, no el usuario: el cron deduplica entre workspaces. get_cost_summary declara la calidad de cada número y marca el total como PISO cuando solo algunas corridas traen costo.",
  files: ["lib/v3/services/spend-ledger.ts", "lib/v3/services/mcp-cost-summary.ts", "lib/apollo/usage-stats.ts"],
  notes: "El 78% del gasto de IA registrado no tiene workspace_id (medido al escribir #142), por eso el resumen para credenciales sin topes suma una vista del gasto compartido.",
})
addNodeAfter("db_mcp_logs", {
  id: "db_mcp_batch", label: "v3.mcp_screenings / exports / batch_*", zone: "v3", layer: 4, kind: "table",
  desc: "v3.mcp_screenings, v3.mcp_exports, v3.mcp_batch_plans, v3.mcp_batch_jobs y v3.mcp_batch_job_items: el ciclo screening -> plan congelado -> trabajo -> entregable.",
})
addNodeAfter("db_apollo_cache", {
  id: "db_apollo_queues", label: "v3.apollo_company_enrichment / apollo_domain_lookup", zone: "v3", layer: 4, kind: "table",
  desc: "Dos colas sembradas con checkpoint: organizaciones por enriquecer (status, intentos, próximo reintento) y dominio por nombre (clasificación auto_ok / revisar). Nada las llena solas: sembrarlas es la decisión de gasto.",
  notes: "apollo_company_enrichment aloja además los ~45 campos de organizations/enrich que antes se descartaban (columnas apollo_*). Precedencia: las señales propias mandan; industry, is_public y ticker NO se tocan.",
})
addNodeAfter("db_apollo_queues", {
  id: "db_apify_runs", label: "v3.apify_runs", zone: "v3", layer: 4, kind: "table",
  desc: "Una fila por corrida de Apify y única fuente del costo de scraping (usageTotalUsd, origen, empresa).",
})
addNodeAfter("db_contacts", {
  id: "db_contact_identity", label: "public.contact_identities / v3.contact_merges", zone: "shared", layer: 4, kind: "table",
  desc: "Identidad de persona independiente de la URL cruda de LinkedIn (slug, sufijo, nombre normalizado) y registro de fusiones reversibles (merge_contacts / revert_contact_merge). contacts se deduplicaba con ON CONFLICT sobre el string crudo y LinkedIn cambia la URL sin que cambie la persona.",
})

// ═══ aristas ════════════════════════════════════════════════════════════════
const E = (id, from, to, kind, label) => addEdge({ id, from, to, kind, label })
E("e193", "ext_mcp_client", "api_mcp_admin", "call", "conector de claude.ai o API key admin")
E("e194", "api_mcp_admin", "svc_v3_mcp_auth", "call", "rechaza si no es unrestricted")
E("e195", "api_mcp_admin", "svc_v3_mcp_tools", "call", "mismas 45 tools")
E("e196", "api_mcp_admin", "svc_v3_usage", "call", "cuota + auditoría")
E("e197", "svc_v3_mcp_tools", "svc_v3_mcp_batch", "call", "screening, lote, export")
E("e198", "svc_v3_mcp_batch", "db_mcp_batch", "rw", "plan congelado, jobs, export")
E("e199", "svc_v3_mcp_batch", "svc_v3_contacts", "call", "enrichment contra presupuesto del lote")
E("e200", "svc_v3_mcp_batch", "svc_v3_spend_ledger", "call", "get_cost_summary")
E("e201", "svc_v3_spend_ledger", "db_apify_runs", "rw", "costo por corrida")
E("e202", "svc_v3_spend_ledger", "db_ai_usage", "read", "costo de IA")
E("e203", "ext_apify", "db_apify_runs", "write", "usageTotalUsd")
E("e204", "cron_v3_apollo_org", "svc_apollo", "call", "org-enrichment-runner")
E("e205", "cron_v3_apollo_domain", "svc_apollo", "call", "domain-lookup-runner (pausado)")
E("e206", "svc_apollo", "db_apollo_queues", "rw", "drena cola con checkpoint")
E("e207", "svc_apollo", "ext_apollo", "call", "organizations/enrich y /search")
E("e208", "svc_apollo", "db_companies", "write", "website solo si vacío; apollo_* siempre")
E("e209", "api_apollo_webhook", "db_apollo_cache", "write", "teléfono al caché compartido (v3)")
E("e210", "svc_etl", "db_contact_identity", "rw", "resuelve identidad de persona")
E("e211", "svc_v3_contacts", "db_apollo_cache", "rw", "no re-pedir lo ya pagado")

// ═══ flujos ═════════════════════════════════════════════════════════════════
addFlow({
  id: "f_mcp_admin_batch",
  name: "Lote sobre una lista de empresas (MCP admin)",
  version: "v3",
  trigger: "El equipo pega una lista de cuentas en el conector ASCI ADMIN y pide un informe",
  desc:
    "Reemplaza 42 llamadas sueltas y 42 confirmaciones por una cotización y un lote. El control del gasto irreversible pasa de la operación al lote que alguien cotizó y confirmó.",
  steps: [
    { n: 1, nodeId: "api_mcp_admin", edgeId: "e193", detail: "OAuth de claude.ai: unrestricted sale del workspace del token y del rol global, no de los scopes." },
    { n: 2, nodeId: "svc_v3_mcp_batch", edgeId: "e197", detail: "screen_account_list en UNA llamada; estimate_batch cotiza el lote entero (slots con enforced:false para esta credencial)." },
    { n: 3, nodeId: "db_mcp_batch", edgeId: "e198", detail: "create_batch_job congela batchPlanHash y enrichment_credits_authorized, calculado en el server desde el plan guardado." },
    { n: 4, nodeId: "svc_v3_contacts", edgeId: "e199", detail: "prepare/run_contact_enrichment cobran contra el presupuesto del lote; run devuelve authorizedBy. Sin batchJobId rige el cupo mensual." },
    { n: 5, nodeId: "svc_v3_spend_ledger", edgeId: "e200", detail: "get_cost_summary cierra el informe: IA medida, Apollo estimado, Apify medido por corrida; total PISO si falta algún costo." },
  ],
})
addFlow({
  id: "f_apollo_queues",
  name: "Enrichment de Apollo por colas sembradas",
  version: "v3",
  trigger: "Alguien siembra filas en v3.apollo_company_enrichment o v3.apollo_domain_lookup",
  desc:
    "El trabajo no se descubre, se siembra: con la cola vacía el cron no llama a Apollo. El barrido por dominio de nombre está pausado desde el 8-sep-2026.",
  steps: [
    { n: 1, nodeId: "cron_v3_apollo_org", edgeId: "e204", detail: "Cada 10 min reclama pending y error con reintento vencido. MAX_ATTEMPTS=3 evita un crédito por vuelta para siempre sobre una fila que siempre falla." },
    { n: 2, nodeId: "svc_apollo", edgeId: "e206", detail: "Reclama de la cola; countPending cuenta lo mismo que se reclama." },
    { n: 3, nodeId: "ext_apollo", edgeId: "e207", detail: "organizations/enrich: 1 crédito por cuenta resuelta. bulk_enrich no devuelve tecnologías." },
    { n: 4, nodeId: "db_companies", edgeId: "e208", detail: "Columnas apollo_* siempre; genéricas solo si están vacías; industry, is_public y ticker no se tocan." },
    { n: 5, nodeId: "cron_v3_apollo_domain", edgeId: "e205", detail: "PAUSADO. Haría lo mismo con organizations/search (gratis, 350 llamadas/h) para resolver website." },
  ],
})

// ═══ punto de contacto ══════════════════════════════════════════════════════
addContactPoint({
  id: "cp_admin_unrestricted",
  title: "Credencial sin topes (perfil MCP admin)",
  severity: "alta",
  nodes: ["api_mcp_admin", "api_mcp_oauth", "svc_v3_mcp_auth", "svc_v3_mcp_batch"],
  desc:
    "Un solo flag, `unrestricted`, levanta el cupo mensual, el tope de cargos y los lugares del plan en las 45 tools. Se otorga por dos caminos: una API key admin, o un token OAuth cuyo workspace y rol global lo permiten.",
  impact:
    "Un bug en cómo se deriva el flag emite una credencial sin topes sobre créditos de Apollo que no se recuperan. Lo que lo acota es el presupuesto del lote y la medición de todo gasto. No verificado en este repaso: que un token OAuth viejo emitido antes de #143 no conserve el marcador.",
})

// ═══ re-verificación de hallazgos abiertos ══════════════════════════════════
Object.assign(opt("OPT-05"), {
  title: "EMPEORÓ: cron_executions sigue sin retención y creció 40%",
  finding:
    "public.cron_executions tiene RLS desde 20260818220610, pero sigue sin retención: 1.828.165 filas el 19-oct-2026 (eran ~1,3M el 24-ago) y la más vieja es del 19-ene-2026, o sea que nunca se purgó. Dos crons corren cada minuto y ahora hay 13 en total.",
  evidence: ["public.cron_executions: count 1.828.165, min(started_at) 2026-01-19 (consulta de solo lectura, 19-oct-2026)", "supabase/migrations no tiene ninguna purga sobre cron_executions"],
})
Object.assign(opt("OPT-06"), {
  severity: "alta",
  title: "EMPEORÓ: 17 archivos instancian createClient crudo y saltean los helpers de Supabase",
  finding:
    "17 archivos (eran 13) importan createClient de @supabase/supabase-js fuera de lib/supabase/. Los cuatro nuevos son del enrichment de Apollo: dos rutas de cron (v3-apollo-org-enrichment, v3-apollo-domain-lookup) y lib/apollo/{org-enrichment-runner,company-writer,domain-lookup-runner}. El patrón se copió en código nuevo, no se limpió.",
  evidence: ["grep -rlE \"from '@supabase/supabase-js'\" app lib components, excluyendo lib/supabase/: 17 archivos (19-oct-2026)", "app/api/cron/*: 8 de las rutas de cron, app/api/v3/admin/normalize-country-phase5/route.ts, lib/v3/services/account-brief-row.ts, components/v3/navbar.tsx"],
})
Object.assign(opt("OPT-07"), {
  title: "PARCIAL: standard y admin comparten registración; Explore y Perfiles siguen copiados",
  finding:
    "Desde #139 las 45 tools del estándar viven en lib/v3/mcp-server-tools.ts y createV3McpHandler concentra transporte, auth y cuota: las rutas server y admin quedaron en 33 y 41 líneas. Lo que sigue copiado es Explore (499 líneas, 8 tools) y Perfiles (307 líneas, 3 tools), cada una con su bloque de auth y registro. La mitad del hallazgo se cerró; la otra mitad no.",
  evidence: ["lib/v3/mcp-server-tools.ts: 45 server.tool(", "app/api/v3/mcp/explore/[transport]/route.ts: 8 tool(", "app/api/v3/mcp/profiles/[transport]/route.ts: 3 tool("],
})
Object.assign(opt("OPT-12"), {
  evidence: [
    "lib/shared/: evidence.ts, evidence-level.ts, news-search.ts, apollo-decision-makers.ts, apollo-title-groups.ts, canonical-signals.ts, linkedin-profile.ts, phone-status.ts",
    "lib/ai-service.ts vs lib/v3/ai.ts",
    "lib/documents/ vs lib/v3/services/mcp-document-*.ts",
    "lib/tech-radar.ts vs lib/v3/services/radar*.ts",
    "app/actions/search-v2.ts vs lib/v3/services/capability-search.ts",
  ],
  finding:
    "SIGUE PARCIAL, avanzó: lib/shared/ pasó de cinco a ocho módulos (canonical-signals, linkedin-profile y phone-status entraron en el período; phone-status existe para que v2 y v3 hablen el mismo vocabulario de estado de teléfono). La duplicación restante es la de IA, documentos, radar y búsqueda. La frontera sigue practicada, no declarada por lint.",
})
Object.assign(opt("OPT-13"), {
  evidence: ["412 usos de .schema(\"v3\") en app/lib/components (19-oct-2026)"],
  finding:
    "El acceso a v3 depende de recordar .schema('v3') en cada consulta (412 usos). La evidencia anterior citaba app/actions/v3/csv-import.ts, que se borró el 19-ago (DEAD-01), así que el ejemplo concreto de .from('csv_imports') mezclado con y sin schema ya no existe. NO VERIFICADO en este repaso: si quedó otro archivo con la misma mezcla.",
})
Object.assign(dead("DEAD-03"), {
  loc: 369,
  finding:
    "Reemplazado por lib/v3/services/radar.ts y radar-agents.ts, que son los que usa el pipeline. Hoy el archivo tiene 369 líneas (el mapa decía 340): el último cambio es el merge de #110 del 21-ago, así que la diferencia es una medición vieja y no código nuevo. Sigue sin importadores.",
})
Object.assign(dead("DEAD-12"), {
  evidence: ["v3.bookmark_dedupe_log: 21 filas, sin referencias en app/lib/components", "v3.dictionary_term_suggestions: 769 filas; solo la toca lib/v3/services/dictionary.ts:304 (insert/update de sugerencias) sin ningún lector aparte"],
  finding:
    "Corrección: dictionary_term_suggestions NO es una tabla sin acceso. dictionary.ts la escribe (acumula occurrences y las últimas 20 evidencias) y se lee solo para deduplicar esa escritura. Lo que sigue sin existir es un consumidor: 769 filas que nadie revisa. bookmark_dedupe_log sigue sin ninguna referencia en código y tiene 21 filas.",
})

// ═══ hallazgo nuevo ═════════════════════════════════════════════════════════
addOpt({
  id: "OPT-17",
  title: "Un cron pausado se sostiene solo por una ausencia en vercel.json",
  severity: "baja",
  area: "operación",
  evidence: ["vercel.json: 13 crons, sin v3-apollo-domain-lookup", "app/api/cron/v3-apollo-domain-lookup/route.ts: ruta viva, comentario PAUSADO (8-sep)", "scripts/*.sql y supabase/migrations: cola v3.apollo_domain_lookup con filas pending"],
  finding:
    "La pausa de v3-apollo-domain-lookup es correcta y está documentada en la ruta, pero su única señal es que falta una entrada en vercel.json: nada en el mapa de crons, en un test ni en un panel distingue 'pausado a propósito' de 'nunca se agregó'.",
  why: "Quien mire vercel.json para saber qué corre no ve que existe un barrido a medio drenar, y quien reanude tiene que recordar el schedule. Es el tipo de estado que se pierde con el tiempo.",
  fix: "Mantener este nodo marcado PAUSADO mientras dure. Al reanudar, devolver la entrada */10 y actualizar stats.crons. Si la pausa se vuelve permanente, borrar la ruta y el runner en vez de dejarlos vivos.",
})

// ═══ validación ═════════════════════════════════════════════════════════════
const ids = new Set(j.nodes.map((n) => n.id))
const errs = []
for (const e of j.edges) {
  if (!ids.has(e.from)) errs.push(`arista ${e.id}: 'from' inexistente -> ${e.from}`)
  if (!ids.has(e.to)) errs.push(`arista ${e.id}: 'to' inexistente -> ${e.to}`)
}
const edgeIds = new Set(j.edges.map((e) => e.id))
for (const f of j.flows) for (const s of f.steps ?? []) {
  if (s.nodeId && !ids.has(s.nodeId)) errs.push(`flujo ${f.id}: nodeId inexistente -> ${s.nodeId}`)
  if (s.edgeId && !edgeIds.has(s.edgeId)) errs.push(`flujo ${f.id}: edgeId inexistente -> ${s.edgeId}`)
}
for (const c of j.contactPoints) for (const n of c.nodes ?? []) if (!ids.has(n)) errs.push(`contactPoint ${c.id}: nodo inexistente -> ${n}`)
for (const [name, arr] of [["nodos", j.nodes], ["aristas", j.edges], ["flujos", j.flows], ["contactPoints", j.contactPoints], ["optimizations", j.optimizations], ["deadCode", j.deadCode]]) {
  const d = arr.map((x) => x.id).filter((id, i, a) => a.indexOf(id) !== i)
  if (d.length) errs.push(`${name} duplicados: ${d.join(", ")}`)
}
if (errs.length) {
  console.error("VALIDACION FALLIDA, no se escribe nada:")
  for (const e of errs) console.error("  -", e)
  process.exit(1)
}
writeFileSync(PATH, JSON.stringify(j, null, 2) + "\n")
console.log("OK. Claves:", Object.keys(j).join(", "))
console.log(
  `nodes ${before.nodes} -> ${j.nodes.length} | edges ${before.edges} -> ${j.edges.length} | flows ${before.flows} -> ${j.flows.length} | ` +
    `cps ${before.cps} -> ${j.contactPoints.length} | opts ${before.opts} -> ${j.optimizations.length} | dead ${before.dead} -> ${j.deadCode.length}`,
)
