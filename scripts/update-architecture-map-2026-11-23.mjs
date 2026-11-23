/**
 * Actualiza docs/architecture-map.json con lo que entró entre el 24-ago-2026
 * (commit 1a7ee0c, la última vez que se tocó el mapa) y el 23-nov-2026.
 *
 * Son 78 commits sin merges, pero el último que toca código es del 8-sep (#154):
 * desde ahí hasta hoy no entró nada. El mapa llevaba tres meses afirmando cosas
 * del 24-ago —un MCP de 37 tools que hoy tiene 45, 12 crons que hoy son 13, 19
 * migraciones que hoy son 49— y no conocía el cuarto servidor MCP (admin) ni las
 * dos colas de Apollo que hoy escriben sobre public.companies.
 *
 * Bloques cubiertos (cada uno verificado contra el código de hoy, no contra el
 * mensaje del commit):
 *
 *   #124-#125     24-ago  Fase 3 del MCP: icebreaker determinístico, export,
 *                         lotes (batchPlanHash). screen_account_list.
 *   capa 1/2      24/25   señal canónica (diccionario, persona), identidad de
 *                         contacto en el ETL y fusión reversible.
 *   vacantes      25-ago  posted_at real; is_active deja de leerse.
 *   Fase 0 ETL    25-ago  el pipeline deja de ensuciar identidad de empresas.
 *   Apollo org    26-ago  enrichment de organizaciones, cola sembrada y cron
 *                         v3-apollo-org-enrichment.
 *   #136-#143     26-ago  MCP admin: flag unrestricted, get_cost_summary,
 *                         server admin sobre una sola registración, OAuth.
 *   #142          26-ago  v3.apify_runs: el costo de Apify por corrida.
 *   #144-#147     26/27   lotes que autorizan Apollo; matching del screening.
 *   #148-#150     27-ago  teléfonos v3 por webhook, backfill, request_contact_phones.
 *   #149          27-ago  revisar el caché antes de pagarle a Apollo.
 *   #151, #154    27-ago / 8-sep  dominio por nombre; el cron queda PAUSADO.
 *
 * Además se re-verificaron TODOS los hallazgos abiertos (PASO 2): OPT-05 y
 * OPT-06 empeoraron, OPT-07 mejoró en parte, OPT-13 y DEAD-12 citaban evidencia
 * que ya no es cierta (o que nunca lo fue) y se corrigen.
 *
 * Por qué por SCRIPT: son ~4.000 líneas de JSON y una edición de texto ya rompió
 * la estructura una vez (el autofix absorbió `edges` dentro de `nodes`).
 *
 * Idempotente: correrlo dos veces deja el mismo resultado byte a byte.
 *
 * Correr:  node scripts/update-architecture-map-2026-11-23.mjs
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
/** Agrega archivos a un nodo sin duplicar. */
const addFiles = (id, files) => {
  const n = node(id)
  n.files = [...new Set([...(n.files ?? []), ...files])]
}

// ═══════════════════════════════════════════════════════════════════════════
// meta — stats MEDIDAS el 23-nov-2026 (comandos en el cuerpo del PR)
// ═══════════════════════════════════════════════════════════════════════════
j.meta.generatedAt = "2026-11-23"
j.meta.summary =
  "Monorepo Next.js único donde conviven ASCI v2 (producción, schema public) y ASCI v3 (multitenant, schema v3) sobre la MISMA base Supabase. El aislamiento es por schema, no por proyecto ni por base. " +
  "Actualización 2026-11-23: repaso de los 78 commits que entraron desde el 24-ago. El último que toca código es del 8-sep (#154); desde ahí no entró nada. Lo que cambió, por orden de peso: " +
  "(1) CUATRO ENDPOINTS MCP, no tres. El perfil ADMIN (/api/v3/mcp/admin) sirve EXACTAMENTE las mismas 45 tools que el estándar: viven una sola vez en lib/v3/mcp-server-tools.ts y lo único que cambia son unas reglas find/replace sobre las descripciones y el flag unrestricted, que sale de dos hechos del servidor (workspace admin declarado + rol superadmin) y nunca de los scopes. Total de tools distintas: 45 + 8 (Explore) + 3 (Perfiles) = 56. " +
  "(2) EL MCP OPERA LOTES: screen_account_list resuelve una lista de nombres contra el catálogo, estimate_batch/create_batch_job congelan un plan con presupuesto de Apollo (batchPlanHash), create_export entrega el resultado por URL firmada y get_cost_summary dice cuánto costó, declarando la calidad de cada número (measured / estimated / unavailable). " +
  "(3) APOLLO ESCRIBE SOBRE public.companies por dos colas SEMBRADAS en v3: el enrichment de organizaciones (cron cada 10 min, 642 filas procesadas) y el dominio por nombre (397.234 pendientes, cron PAUSADO desde el 8-sep). Ninguna descubre trabajo sola: autorizar gasto es un INSERT. " +
  "(4) EL GASTO SE MIDE: v3.apify_runs registra el costo de cada corrida de Apify (127 hasta hoy) y el caché de contactos se consulta antes de pagar (921 de 4.223 llamadas a people/match eran repetidas). " +
  "(5) IDENTIDAD: public.contact_identities (1,56 M filas) y v3.contact_merges resuelven la persona en el ETL, y lib/shared/canonical-signals.ts define la señal como (diccionario, persona) y no como fila de signals. " +
  "(6) DERIVA DE MIGRACIONES: el repo tiene 49 archivos; la base registra 38 versiones desde el 24-ago contra 30 archivos. Dos de las ocho sin archivo están consolidadas a propósito en otro archivo; las otras seis, todas del diccionario del 24-ago, no se pudieron verificar (ver OPT-18)."
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
// #136-#143 — perfil admin del MCP y una sola registración de tools
// ═══════════════════════════════════════════════════════════════════════════
const mcpStd = node("api_mcp_server")
mcpStd.label = "MCP estándar (45 tools)"
mcpStd.desc =
  "El PRIMERO de los servidores MCP y el único que conversa con las señales ya interpretadas por el diccionario. Desde el 26-ago (#139) la ruta es un archivo de 33 líneas: las 45 tools se registran en lib/v3/mcp-server-tools.ts (createV3McpHandler) y las comparte con el perfil admin. Cubre lectura de cuentas, research, contactos, documentos y —desde la Fase 3— lotes: screen_account_list, estimate_batch, create_batch_job, create_export, get_cost_summary, build_evidence_icebreaker, request_contact_phones. Scope base companies:read / signals:read / accounts:read."
mcpStd.files = ["app/api/v3/mcp/server/[transport]/route.ts", "lib/v3/mcp-server-tools.ts"]
mcpStd.risk =
  "El monolito se movió de la ruta a lib/v3/mcp-server-tools.ts (≈650 líneas con las 45 registraciones). Mejora real para standard+admin; Explore y Perfiles siguen con su andamiaje propio (ver OPT-07). Los comentarios de las dos rutas y de registerV3Tools todavía dicen '44 tools': request_contact_phones (#150) fue la 45 y nadie actualizó el texto."

addNodeAfter("api_mcp_profiles", {
  id: "api_mcp_admin",
  label: "MCP admin (mismas 45 tools)",
  zone: "v3",
  layer: 2,
  kind: "mcp",
  desc: "Cuarto endpoint MCP, para el equipo de ASCI (26-ago, #136-#143). Sirve las MISMAS 45 tools que el estándar —se registran una sola vez— sin topes de plan (cupo mensual de Apollo, lugares de cuentas seguidas) y con confirmación de Apollo UNA vez por lote en vez de una por cuenta. Lo que cambia por perfil son reglas find/replace sobre las descripciones, aplicadas por un proxy sobre server.tool: si alguien reescribe la frase estándar, la regla deja de aplicar y un test falla.",
  files: ["app/api/v3/mcp/admin/[transport]/route.ts", "lib/v3/admin-workspace.ts"],
  env: ["ASCI_ADMIN_WORKSPACE_ID"],
  risk: "El flag unrestricted NO sale de los scopes (un consentimiento OAuth manipulado emitiría una credencial sin topes): sale del workspace guardado en la credencial más el rol global de profiles. Sin ASCI_ADMIN_WORKSPACE_ID el módulo falla cerrado. Lo que NO se levanta es maxContacts por cuenta. Lo que hace defendible el perfil no es un tope sino que todo queda medido (get_cost_summary).",
  notes: "Bug del 26-ago (#143): la rama OAuth de validateMcpRequest devolvía unrestricted:false LITERAL, así que el conector de claude.ai conectaba y mostraba cero tools —tools/list daba 401 y el cliente lo pintaba como servidor vacío—. Ahora el rechazo se loguea con tipo de credencial, workspace, usuario y qué falta.",
})
addEdge({ id: "e189", from: "ext_mcp_client", to: "api_mcp_admin", kind: "call", label: "perfil admin (OAuth o key admin)" })
addEdge({ id: "e190", from: "api_mcp_admin", to: "svc_v3_mcp_auth", kind: "call", label: "unrestricted por workspace + rol" })
addEdge({ id: "e191", from: "api_mcp_admin", to: "svc_v3_mcp_tools", kind: "call", label: "misma registración que el estándar" })

const mcpAuth = node("svc_v3_mcp_auth")
mcpAuth.desc =
  "OAuth, API keys y resolución de acceso/plan por request, para los CUATRO endpoints MCP. Cada uno tiene su tipo de key y su scope (standard, explore:read, profiles:read, admin); el catálogo de scopes por tipo de key vive en lib/v3/mcp-key-scopes.ts desde el 24-ago, cuando la key standard no alcanzaba nueve tools de su propio MCP."
addFiles("svc_v3_mcp_auth", ["lib/v3/mcp-key-scopes.ts", "lib/v3/admin-workspace.ts"])

const mcpTools = node("svc_v3_mcp_tools")
mcpTools.desc =
  "Implementación de las tools: lectura, ciclo de vida de cuenta, circuito client-assisted y, desde el 24-ago, la operación por lotes (screening de listas, plan y lote con presupuesto, export, resumen de costo). lib/v3/mcp-server-tools.ts es la registración única que comparten standard y admin."
addFiles("svc_v3_mcp_tools", ["lib/v3/mcp-server-tools.ts"])

// ═══════════════════════════════════════════════════════════════════════════
// #124 y siguientes — lotes del MCP: screening, plan, export, costo
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_v3_mcp_tools", {
  id: "svc_v3_mcp_batch",
  label: "Lotes MCP (screening, plan, export, costo)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "Lo que permite operar una LISTA de cuentas en vez de una por vez. screen_account_list resuelve nombres contra el catálogo con estado explícito (matched / ambiguous / matched_no_signal / no_match); estimate_batch cotiza; create_batch_job congela el plan y un presupuesto de créditos de Apollo calculado en el server (nunca desde el input); create_export sube el resultado a Supabase Storage y devuelve una URL firmada; get_cost_summary suma IA (measured), Apollo (estimated: créditos × US$ 0,01) y Apify (desde v3.apify_runs).",
  files: [
    "lib/v3/services/screen-account-list.ts",
    "lib/v3/services/mcp-batch-estimate.ts",
    "lib/v3/services/mcp-batch-job.ts",
    "lib/v3/services/mcp-export.ts",
    "lib/v3/services/mcp-cost-summary.ts",
    "lib/v3/services/spend-ledger.ts",
  ],
  risk: "screen_account_list es la RPC que dio origen a la lección de CLAUDE.md: pasó todas las pruebas sobre 300.000 filas sintéticas y contra las 514.269 reales tenía cuatro defectos. El matching usa public.company_screen_key, una clave PROPIA del screening y no normalized_name, a propósito: aflojar el normalizador haría que auto_merge_safe_duplicates fusione empresas hoy separadas, sin vuelta atrás.",
  notes: "Uso real medido el 23-nov: 12 screenings, 2 lotes, 0 exports. Sin batchJobId no cambia nada: rige el cupo mensual del plan. Para una credencial CON topes, el presupuesto del lote se recorta al cupo que le queda.",
})
addEdge({ id: "e192", from: "svc_v3_mcp_tools", to: "svc_v3_mcp_batch", kind: "call", label: "tools de lote" })

addNodeAfter("db_mcp_logs", {
  id: "db_mcp_batch",
  label: "v3.mcp_screenings / batch_plans / batch_jobs / exports",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Estado de la operación por lotes del MCP. mcp_batch_plans guarda el plan cotizado por hash; mcp_batch_jobs + mcp_batch_job_items el lote confirmado con enrichment_credits_authorized y lo gastado (RPC increment_batch_credits); mcp_screenings el resultado de cada screening; mcp_exports cada entregable generado. contact_enrichment_runs.batch_job_id ata cada corrida de Apollo a su lote.",
  tables: ["v3.mcp_screenings", "v3.mcp_batch_plans", "v3.mcp_batch_jobs", "v3.mcp_batch_job_items", "v3.mcp_exports"],
  files: [
    "supabase/migrations/20260824210819_mcp_batch_plans.sql",
    "supabase/migrations/20260825015932_mcp_screenings_and_exports.sql",
    "supabase/migrations/20260825020834_mcp_batch_jobs.sql",
    "supabase/migrations/20260826191459_apollo_en_el_batch_plan_hash.sql",
  ],
})
addEdge({ id: "e193", from: "svc_v3_mcp_batch", to: "db_mcp_batch", kind: "write", label: "plan, lote, screening, export" })

addNodeAfter("db_mcp_batch", {
  id: "db_apify_runs",
  label: "v3.apify_runs",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Una fila por corrida de Apify (26-ago, #142): única fuente del costo de scraping, para los cuatro orígenes (cron de primera pasada, mensual, kick de la UI y explore). Antes el gasto vivía en la metadata de la reserva del MCP, que el cron no tiene. La unidad de atribución es la EMPRESA, no el usuario: una corrida sirve a todos los que siguen la cuenta.",
  tables: ["v3.apify_runs"],
  files: ["supabase/migrations/20260826203230_ledger_de_gasto_por_empresa.sql", "lib/v3/services/spend-ledger.ts"],
  notes: "127 filas al 23-nov. Medido sobre una corrida real: US$ 0,0004 por vacante, 55% proxy residencial. usageTotalUsd NO incluye el alquiler fijo del actor (US$ 29,99/mes) y no se prorratea: se reporta el costo marginal y se dice que el fijo queda afuera. Cuando sólo algunas corridas traen su número, el total se declara PISO.",
})
addEdge({ id: "e194", from: "svc_v3_jobs", to: "db_apify_runs", kind: "write", label: "costo por corrida" })
addEdge({ id: "e195", from: "svc_v3_mcp_batch", to: "db_apify_runs", kind: "read", label: "get_cost_summary" })
addEdge({ id: "e196", from: "svc_v3_mcp_batch", to: "db_ai_usage", kind: "read", label: "costo IA measured" })

// ═══════════════════════════════════════════════════════════════════════════
// Apollo: enrichment de organizaciones y dominio por nombre (26/27-ago, 8-sep)
// ═══════════════════════════════════════════════════════════════════════════
const svcApollo = node("svc_apollo")
svcApollo.label = "Apollo (18 módulos)"
svcApollo.desc =
  "Search, enrich, organizations, cache por hash de query, validación de títulos, parsers y dominio. Desde el 26-ago suma los runners de las dos colas que escriben sobre public.companies (org-enrichment-runner, domain-lookup-runner), el escritor con precedencia (company-writer), bulk_enrich, los límites por endpoint (rate-limits) y las estadísticas de uso. El pipeline de decisores está en lib/shared/ desde el 21-ago; v2 quedó como wrapper."
svcApollo.notes =
  "Precedencia al escribir companies (decisión del dueño): columnas apollo_* siempre; columnas genéricas sólo si están vacías; industry NUNCA (la taxonomía de Apollo es lowercase y rompería el mapeo a master_industry_id); is_public/ticker NUNCA (son de SEC EDGAR, la versión de Apollo va a apollo_publicly_traded_*). Las tecnologías de Apollo no alimentan el tech radar propio. Antes de salir a Apollo se mira apollo_contacts_cache: una fila ahí significa que YA se pagó por esa persona, tenga email o no (#149)."

const extApollo = node("ext_apollo")
extApollo.desc =
  "Fuente primaria de contactos y organizaciones. Consumida por v2 y reusada por v3. Costos verificados en el código (#151 corrigió una doc que decía lo contrario): organizations/enrich cuesta 1 crédito por empresa resuelta; organizations/search es gratuito pero con cuota de 400 llamadas/hora; un teléfono cuesta 5 créditos contra 1 del email y llega por webhook (el 57% de las veces)."

addNodeAfter("cron_v3_enrich_linkedin", {
  id: "cron_v3_apollo_org",
  label: "cron v3-apollo-org-enrichment (10m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Drena la cola SEMBRADA v3.apollo_company_enrichment contra organizations/enrich / bulk_enrich (26-ago). No descubre candidatas: barrer las ~61.300 empresas con website sin resolver son ~38.000 créditos, una decisión de gasto que no le corresponde a un cron. Con la cola vacía no llama a Apollo y gasta cero; autorizar otro lote es un INSERT.",
  files: [
    "app/api/cron/v3-apollo-org-enrichment/route.ts",
    "lib/apollo/org-enrichment-runner.ts",
    "lib/apollo/bulk-organizations.ts",
    "lib/apollo/company-writer.ts",
  ],
  notes: "Estado al 23-nov: 595 found, 46 not_found, 1 skipped, 0 pending — la cola está vacía, el cron corre cada 10 min y no gasta. El payload se empareja con la empresa POR POSICIÓN y no por dominio (Apollo puede contestar arcor.com a un pedido de arcor.com.ar). Un lote que falla se reprograma entero a 30 min; las filas en error vuelven a la cola y a los 3 intentos quedan 'failed', terminal (628ddb1): si no, una fila que falla siempre costaría un crédito cada media hora para siempre.",
})
addNodeAfter("cron_v3_apollo_org", {
  id: "cron_v3_apollo_domain",
  label: "cron v3-apollo-domain-lookup (PAUSADO)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Resuelve el dominio de las empresas sin website por NOMBRE, contra organizations/search (gratuito, 350 llamadas/hora de las 400 del plan), sobre la cola sembrada v3.apollo_domain_lookup (27-ago, #151). Sólo promueve a companies.website lo clasificado auto_ok y sólo sobre columnas vacías: el match por nombre es difuso y un token geográfico presente de un solo lado baja el match a 'revisar'.",
  files: ["app/api/cron/v3-apollo-domain-lookup/route.ts", "lib/apollo/domain-lookup-runner.ts", "lib/apollo/domain-lookup.ts"],
  risk: "PAUSADO desde el 8-sep (#154): su entrada salió de vercel.json, que es lo único que Vercel mira. La ruta sigue en pie y se puede correr a mano (pasa por assertCron); reanudar es devolver la entrada al schedule. Por eso hay 14 rutas bajo app/api/cron/ y 13 crons.",
  notes: "Estado al 23-nov (último checked_at 2026-09-07): 397.234 pending, 13.201 sin_match, 5.960 promoted, 2.060 descartado, 1.200 revisar, 1.094 match_sin_dominio, 4 failed. Al ritmo de 350/h el resto son ~47 días de cron continuo. Hoy hay 461.460 companies sin website sobre 532.083.",
})
addEdge({ id: "e197", from: "cron_v3_apollo_org", to: "svc_apollo", kind: "call", label: "drena la cola sembrada" })
addEdge({ id: "e198", from: "cron_v3_apollo_domain", to: "svc_apollo", kind: "call", label: "pausado desde 8-sep" })
addEdge({ id: "e199", from: "svc_apollo", to: "db_companies", kind: "write", label: "apollo_* siempre, genéricas si vacías" })

addNodeAfter("db_apify_runs", {
  id: "db_apollo_queues",
  label: "v3.apollo_company_enrichment / apollo_domain_lookup",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Las dos colas sembradas de Apollo. Viven en v3 pero apuntan a public.companies: son el único camino por el que un cron de v3 escribe en la tabla más caliente de v2. Seis estados en la de organizaciones (tres terminales), siete en la de dominio.",
  tables: ["v3.apollo_company_enrichment", "v3.apollo_domain_lookup"],
  files: [
    "supabase/migrations/20260826120000_apollo_enrichment_columnas_y_checkpoint.sql",
    "supabase/migrations/20260827205412_checkpoint_de_dominio_por_nombre.sql",
  ],
})
addEdge({ id: "e200", from: "svc_apollo", to: "db_apollo_queues", kind: "write", label: "estado por fila" })

const companies = node("db_companies")
companies.desc =
  "Núcleo del dato: 532.083 empresas al 23-nov-2026 (eran ~488k cuando se armó el mapa). v3 la referencia desde muchos módulos y le agregó hq_country_iso. Desde el 26-ago tiene columnas apollo_* (namespace separado, se escriben siempre) y el string vacío dejó de existir: website='' en 66.163 filas, industry='' en 63.701 y country='' en 60.610 las volvían ineligibles para siempre porque COALESCE no rellena ''; se normalizaron a NULL y upsert_company dejó de generarlos."
companies.risk =
  "Tabla más caliente del sistema y punto de contacto principal v2<->v3. Desde el 26-ago la escriben también dos crons de v3 (colas de Apollo). normalized_name deriva de company_core_name y de ella dependen upsert_company y auto_merge_safe_duplicates (GROUP BY normalized_name y FUSIONA): tocar el normalizador es tocar el merge."

addContactPoint({
  id: "cp_apollo_companies",
  title: "Crons de v3 que escriben public.companies",
  severity: "alta",
  nodes: ["cron_v3_apollo_org", "cron_v3_apollo_domain", "svc_apollo", "db_apollo_queues", "db_companies"],
  desc: "Dos crons de v3 escriben sobre la tabla de empresas que usa producción de v2. La protección es de reglas, no de schema: sólo columnas apollo_* o genéricas vacías, nunca industry ni is_public, y el dominio por nombre sólo si quedó auto_ok.",
  impact: "Si la regla de precedencia se rompe, el ETL de v2 y la UI de v2 ven datos de Apollo pisando los propios —o un website mal resuelto por nombre— sin que nada en v2 haya cambiado. La regla vive en lib/apollo/company-writer.ts y en las RPC de las migraciones del 26/27-ago; no hay constraint que la haga cumplir.",
})

addFlow({
  id: "f_apollo_org_queue",
  name: "Enrichment de organizaciones por cola sembrada",
  version: "v3",
  trigger: "Alguien inserta filas pending en v3.apollo_company_enrichment (decisión de gasto)",
  desc: "El cron no descubre trabajo: sin filas sembradas no llama a Apollo.",
  steps: [
    { n: 1, nodeId: "cron_v3_apollo_org", edgeId: "e197", detail: "Cada 10 min reclama pending y error con reintento vencido." },
    { n: 2, nodeId: "svc_apollo", edgeId: "e26", detail: "bulk_enrich por dominio; el payload se empareja por posición." },
    { n: 3, nodeId: "db_companies", edgeId: "e199", detail: "Escribe con precedencia: apollo_* siempre, genéricas si vacías." },
    { n: 4, nodeId: "db_apollo_queues", edgeId: "e200", detail: "found / not_found / failed (terminal a los 3 intentos)." },
  ],
})

// ═══════════════════════════════════════════════════════════════════════════
// #148-#150 — teléfonos en v3
// ═══════════════════════════════════════════════════════════════════════════
const webhook = node("api_apollo_webhook")
webhook.zone = "shared"
webhook.desc =
  "Callback de Apollo autenticado por secreto en el path. Desde el 27-ago (#148) también sabe el camino v3: llama a receivePhoneForV3 en UN solo punto, antes de sus tres salidas, así ninguna rama lo saltea. El número va al caché COMPARTIDO (apollo_contacts_cache) y el estado a v3.account_contacts; v2 lo sigue guardando en user_company_contacts."
webhook.files = ["app/api/webhooks/apollo/[secret]/route.ts", "lib/v3/services/contact-phone-inbox.ts"]
webhook.notes =
  "Dos reglas opuestas con test propio: el ESTADO se toca sólo en filas 'pending' (pedir es por workspace; marcar 'received' a quien no pidió afirmaría un pedido que no hizo), y la FECHA de verificación en TODAS las filas de esa persona (describe el dato, no el pedido)."
addEdge({ id: "e201", from: "api_apollo_webhook", to: "db_account_contacts", kind: "write", label: "estado del teléfono (solo pending)" })
addEdge({ id: "e202", from: "api_apollo_webhook", to: "db_apollo_cache", kind: "write", label: "número al caché compartido" })

const contacts = node("svc_v3_contacts")
contacts.desc =
  "Provider de contactos, cobertura y enrichment; reusa el cache de Apollo de v2. Desde el 27-ago pide teléfonos (request_contact_phones, sólo para contactos con email verificado y cargo que matchea) y phone_status habla el vocabulario de v2 (lib/shared/phone-status.ts). El 26-ago dejó de re-pagar a quien ya está en el caché dentro de la ventana de frescura: 921 de 4.223 llamadas históricas a people/match (21,8%) eran repetidas."
addFiles("svc_v3_contacts", [
  "lib/v3/services/mcp-contact-phones.ts",
  "lib/v3/services/contact-phone-inbox.ts",
  "lib/shared/phone-status.ts",
])
const apolloCache = node("db_apollo_cache")
apolloCache.notes =
  "Está indexado por dominio de la empresa, no por companyId. Es la tabla que lee getCompanyCachedContacts de v3. El 27-ago recibió por backfill los 80 teléfonos que v2 ya había pagado (106 filas en user_company_contacts = 80 personas: contar filas inflaba el número un 32%); hasta ahí tenía 4.416 personas y CERO teléfonos. Una fila acá significa 'ya pagamos por esta persona', y por eso se consulta antes de salir a Apollo."

// ═══════════════════════════════════════════════════════════════════════════
// Capa 1/2 — señal canónica e identidad de contacto
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_shared_news", {
  id: "svc_shared_canonical",
  label: "Señal canónica (diccionario, persona)",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc: "Una señal es (entrada de diccionario, persona), no una fila de signals (24-ago). El caso que lo originó: 'Intune' aparecía dos veces en Molinos Agro para la misma persona porque el perfil se scrapeó con dos slugs de LinkedIn. canonicalizeSignals y groupBySignal colapsan eso; linkedin-profile.ts normaliza el slug. Lo usan el drawer de v2 y el panorama de señales de v3.",
  files: ["lib/shared/canonical-signals.ts", "lib/shared/linkedin-profile.ts"],
  notes: "Cuarto y quinto inquilino de lib/shared/ (con phone-status.ts, el sexto). El panorama de señales (#146) además dejó de ser una muestra: el pool de homónimos era un OR de tokens con limit 100 y SIN order by —para 'Santander Chile', 'chile' matcheaba 7.153 empresas y 0 de las 31 Santander caían adentro—. Ahora es AND de tokens, tope de 2.000 señales y un bloque scan que declara si quedó incompleto.",
})
addEdge({ id: "e203", from: "svc_v3_signals", to: "svc_shared_canonical", kind: "call", label: "panorama de señales" })
addEdge({ id: "e204", from: "ui_v2_search", to: "svc_shared_canonical", kind: "call", label: "company-drawer (señales por persona)" })
addFiles("svc_v3_contacts", ["lib/shared/linkedin-profile.ts"])

addNodeAfter("db_contacts", {
  id: "db_contact_identity",
  label: "public.contact_identities / v3.contact_merges",
  zone: "shared",
  layer: 4,
  kind: "table",
  desc: "Identidad de PERSONA resuelta en el ETL (24/25-ago): el perfil vigente manda sobre el contenido, se exige calidad a la identidad y se vetan perfiles discordantes. Los duplicados se fusionan de forma reversible y cada fusión queda en v3.contact_merges. previous_positions dejó de pisarse entero en cada import: un export recortado ya no borra historial laboral.",
  tables: ["public.contact_identities", "v3.contact_merges"],
  files: [
    "supabase/migrations/20260825000000_contact_identity_resolution.sql",
    "supabase/migrations/20260825001000_contact_merge.sql",
    "supabase/migrations/20260825163000_previous_positions_aditivo.sql",
  ],
  notes: "Al 23-nov: 1.557.432 identidades y 1.253 fusiones.",
})
addEdge({ id: "e205", from: "svc_etl", to: "db_contact_identity", kind: "write", label: "identidad y fusión reversible" })

const jobs = node("db_job_postings")
const JOBS_NOTE =
  "Desde el 25-ago posted_at es la fecha REAL del aviso (se parsea en la ingesta; 25.056 vacantes mal fechadas se recuperaron) y job_postings.is_active dejó de leerse porque nunca fue cierto. Los conteos de vacantes de las tools MCP son HISTÓRICOS y lo dicen."
// Idempotente: sólo se agrega si la nota todavía no está.
if (!(jobs.notes ?? "").includes(JOBS_NOTE)) jobs.notes = [jobs.notes, JOBS_NOTE].filter(Boolean).join(" ")

const icebreakers = node("svc_v3_icebreakers")
icebreakers.desc =
  "Cruza los docs de valor del tenant con las señales de la cuenta. Desde el 24-ago (#124) hay además un icebreaker DETERMINÍSTICO sin IA (build_evidence_icebreaker): cita lo observado, cuesta cero, no consume cupo y no puede inventar una tecnología. Por default AGREGA ('en el equipo varios perfiles mencionan X') y no individualiza (Ley 19.628/21.719 en Chile, GDPR), y un ex-empleado no prueba uso actual. El texto de terceros entra contenido (untrusted-text.ts)."
addFiles("svc_v3_icebreakers", [
  "lib/v3/services/icebreaker-deterministic.ts",
  "lib/v3/services/icebreaker-template.ts",
  "lib/v3/services/icebreaker-register.ts",
  "lib/v3/services/untrusted-text.ts",
])

// ═══════════════════════════════════════════════════════════════════════════
// Rutas que existían y el mapa no tenía (encontradas en el PASO 1)
// ═══════════════════════════════════════════════════════════════════════════
addFiles("svc_v3_imports", ["app/api/v3/account-imports/blob-upload/route.ts"])
addNodeAfter("api_v3_research_batch", {
  id: "api_v3_admin_country",
  label: "API normalize-country-phase5",
  zone: "v3",
  layer: 2,
  kind: "route",
  desc: "POST de un solo uso: Fase 5 de la normalización de país, pasa por IA los ~500 valores sin mapeo después de las fases 1-4 y persiste en bulk UPDATE. No es cron (no está en vercel.json) y usa createClient crudo con service role.",
  files: ["app/api/v3/admin/normalize-country-phase5/route.ts"],
  risk: "Auth inline divergente, la que OPT-02 dice haber unificado: compara con startsWith(`Bearer ${CRON_SECRET || API_SECRET}`) en vez de pasar por assertCron. Ver OPT-17.",
})
addEdge({ id: "e206", from: "api_v3_admin_country", to: "svc_normalize", kind: "call", label: "normalizeCountries (heurística → IA)" })

// ═══════════════════════════════════════════════════════════════════════════
// PASO 2 — re-verificación de hallazgos abiertos
// ═══════════════════════════════════════════════════════════════════════════
const o05 = opt("OPT-05")
o05.title = "EMPEORÓ: cron_executions sigue sin retención y ya pasa los 2 M de filas"
o05.evidence = [
  "public.cron_executions: 2.063.594 filas al 23-nov-2026 (eran ~1,3 M el 24-ago), la más vieja del 2026-01-19",
  "relrowsecurity = true (la mitad de seguridad sigue cerrada)",
  "ninguna migración ni ruta borra filas de cron_executions",
]
o05.finding =
  "La tabla ya NO está expuesta (RLS desde la migración 20260818220610). Lo que sigue abierto es el crecimiento, y se aceleró: en tres meses sumó ~760.000 filas. Hay dos crons cada minuto y desde el 26-ago otro cada 10 minutos (v3-apollo-org-enrichment) que corre aunque su cola esté vacía."
o05.fix =
  "Igual que antes, y más urgente: retención (por ejemplo 14 días) dentro de cleanup_old_import_data o en un cron propio, y particionado por fecha si se quiere conservar historia."

const o06 = opt("OPT-06")
o06.title = "EMPEORÓ: los dos crons nuevos de Apollo repiten el createClient crudo"
o06.evidence = [
  "12 archivos instancian createClient de @supabase/supabase-js fuera de lib/supabase/ (medido el 23-nov con grep de 'createClient(' sobre los imports)",
  "nuevos desde el 24-ago: app/api/cron/v3-apollo-org-enrichment/route.ts, app/api/cron/v3-apollo-domain-lookup/route.ts",
  "siguen: app/actions/dictionary.ts, 6 rutas de cron de v2/v3, app/api/ingest/upload, app/api/landing-stats, app/api/v3/admin/normalize-country-phase5",
  "17 archivos importan algo de @supabase/supabase-js, pero 5 son sólo tipos (SupabaseClient / User) y no cuentan",
]
o06.finding =
  "El 24-ago el mapa decía '13 archivos (eran 16)' contando cualquier import del paquete, incluido components/v3/navbar.tsx, que hoy sólo importa el TIPO User. Contando sólo los que instancian, son 12, y dos de ellos son crons que entraron el 26/27-ago: el patrón se sigue copiando en código nuevo. Los runners de lib/apollo/ reciben el cliente por parámetro (import type), que es lo correcto; la instanciación cruda quedó en la ruta."
o06.fix =
  "Reemplazar por createAdminClient de lib/supabase/admin.ts empezando por los crons (son copia literal unos de otros) y prohibir el import de valor de @supabase/supabase-js fuera de lib/supabase/ por lint (no-restricted-imports con allowTypeImports). Sin la regla, el número va a seguir subiendo con cada cron."

const o07 = opt("OPT-07")
o07.title = "PARCIAL: standard y admin comparten un factory; Explore y Perfiles siguen con su copia"
o07.evidence = [
  "lib/v3/mcp-server-tools.ts: createV3McpHandler + registerV3Tools (45 tools)",
  "app/api/v3/mcp/server/[transport]/route.ts (33 líneas) y app/api/v3/mcp/admin/[transport]/route.ts (41 líneas)",
  "app/api/v3/mcp/explore/[transport]/route.ts (499 líneas) y profiles (307) siguen llamando createMcpHandler + withMcpAuth por su cuenta",
]
o07.finding =
  "Avanzó el 26-ago (#139): la ruta estándar dejó de ser un monolito y el perfil admin NO duplicó las tools —se registran una vez y las diferencias van por reglas find/replace sobre las descripciones—. Pero el factory es de las 45 tools del estándar, no del andamiaje: Explore y Perfiles siguen con su propia copia de transporte, auth, rate limit y mapa de nextAction. El monolito se movió de la ruta a lib/v3/mcp-server-tools.ts (≈650 líneas)."
o07.fix =
  "Generalizar createV3McpHandler para que reciba la lista de tools y el scope, y pasar Explore y Perfiles por ahí. Hoy un arreglo en el manejo de errores hay que hacerlo tres veces (eran tres veces para tres rutas; ahora son tres para cuatro)."

const o13 = opt("OPT-13")
o13.evidence = [
  '412 usos de .schema("v3") en app/ y lib/ al 23-nov-2026',
  "no existe un helper v3Db() ni regla de lint",
  "CORREGIDO: la evidencia anterior (app/actions/v3/csv-import.ts:285,324) ya no aplica; ese archivo no existe en el repo",
]
o13.finding =
  "El acceso a v3 depende de recordar .schema('v3') en cada consulta: 412 veces. El ejemplo que citaba el mapa (csv-import.ts mezclando .from('csv_imports') con y sin schema) ya no existe —el import de cuentas se rehízo el 19-ago sobre v3.account_imports—, pero el mecanismo que lo permitía sigue igual."

addOpt({
  id: "OPT-17",
  title: "Una ruta con service role sigue con auth inline divergente (normalize-country-phase5)",
  severity: "media",
  area: "seguridad",
  evidence: [
    "app/api/v3/admin/normalize-country-phase5/route.ts:105-107",
    "process.env.CRON_SECRET || process.env.API_SECRET",
    "auth?.startsWith(`Bearer ${expectedSecret}`)",
  ],
  finding:
    "OPT-02 se cerró unificando la auth de los crons en assertCron, pero esta ruta —que no es cron, así que no entró en el barrido de los 11— conserva una variante propia: acepta un segundo secreto (API_SECRET) como alternativa y compara con startsWith, así que cualquier sufijo después del secreto también pasa. Corre con service role y escribe en bulk sobre companies.",
  why: "No es explotable sin conocer el secreto, pero es exactamente la divergencia que OPT-02 vino a eliminar: dos fuentes de secreto y una comparación más laxa que la del resto. Es una ruta de un solo uso (Fase 5 de país) que quedó viva.",
  fix: "Si la Fase 5 ya corrió, borrar la ruta. Si no, pasarla por assertCron o requireSuperadmin. No se tocó acá: esta rutina sólo documenta. NO VERIFICADO si la Fase 5 ya se ejecutó en producción.",
})

addOpt({
  id: "OPT-18",
  title: "La base registra migraciones que no tienen archivo en supabase/migrations",
  severity: "media",
  area: "datos",
  evidence: [
    "supabase_migrations.schema_migrations: 38 versiones desde 20260824 contra 30 archivos (medido el 23-nov)",
    "consolidadas a propósito en 20260824212326_screen_account_list_fixes_from_production.sql: 20260824211432, 20260824211623 (y 212326 con otro nombre)",
    "sin archivo y sin consolidación verificada: 20260824144206 dictionary_products_categoria_ciclo_vida, 20260824152533 keywords_contexto_columna, 20260824153130 keywords_coocurrencia_columnas_y_helpers, 20260824153250 process_dictionary_job_coocurrencia, 20260824173419 jobs_diferidos_recalculo_nocturno, 20260824175646 rpc_encolar_y_liberar_recalculos",
  ],
  finding:
    "Los 30 archivos del período sí están registrados con su versión (la regla de CLAUDE.md se cumple en esa dirección). La otra dirección no: hay versiones aplicadas en producción sin archivo homónimo. Dos están declaradas como consolidadas en el archivo del screening; las seis del diccionario del 24-ago no tienen esa declaración, y algunas pueden estar absorbidas en 20260824150000_keywords_contexto_coocurrencia.sql (es el único archivo que menciona process_dictionary_job), pero no se pudo confirmar contenido por contenido.",
  why: "Un rebuild desde migraciones no reproduciría producción, que es lo que la baseline sellada y la migración 'consolidar_funciones_vivas' (25-ago) vinieron a garantizar.",
  fix: "Para cada versión huérfana, comparar su statement registrado (schema_migrations.statements) con los archivos y, o bien declarar en el archivo que la absorbe, o bien agregar el archivo con su versión exacta. NO VERIFICADO contenido por contenido: esta rutina sólo comparó versiones.",
})

const d12 = dead("DEAD-12")
d12.title = "Tabla de v3 sin lector: bookmark_dedupe_log (dictionary_term_suggestions SÍ tiene)"
d12.evidence = [
  "v3.bookmark_dedupe_log: 21 filas, ninguna referencia en app/ ni lib/",
  "CORREGIDO: v3.dictionary_term_suggestions la lee y escribe lib/v3/services/dictionary.ts (líneas ~304-325) y tiene 769 filas; ya era así el 24-ago, el hallazgo estaba mal en esa mitad",
]
d12.finding =
  "Sólo bookmark_dedupe_log quedó sin lector en el código. dictionary_term_suggestions está viva: es la cola de sugerencias de términos del diccionario que revisa el super-admin."
d12.recommendation =
  "Decidir si bookmark_dedupe_log es auditoría que alguien consulta por SQL (y entonces documentarlo) o un resto (y entonces dropearla con su migración)."

// Re-verificados sin cambios: siguen existiendo y sin importadores (23-nov).
for (const id of ["DEAD-03", "DEAD-04", "DEAD-05", "DEAD-09", "DEAD-10", "DEAD-13"]) {
  dead(id).verification = "Re-verificado el 23-nov-2026: el archivo sigue existiendo y sin importadores (grep en app/, lib/, components/)."
}
dead("DEAD-11").verification =
  "NO re-verificado el 23-nov-2026: son variables del proyecto en Vercel, no código; esta rutina no las consultó."

// ═══════════════════════════════════════════════════════════════════════════
// Validación de integridad referencial
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
const dups = (arr, label) => {
  const d = arr.filter((id, i, a) => a.indexOf(id) !== i)
  if (d.length) errs.push(`${label} duplicados: ${d.join(", ")}`)
}
dups(j.nodes.map((n) => n.id), "nodos")
dups(j.edges.map((e) => e.id), "aristas")
dups(j.flows.map((f) => f.id), "flujos")
dups(j.contactPoints.map((c) => c.id), "contactPoints")
dups(j.optimizations.map((o) => o.id), "optimizations")
dups(j.deadCode.map((d) => d.id), "deadCode")

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
