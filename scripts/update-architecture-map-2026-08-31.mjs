/**
 * Actualiza docs/architecture-map.json con lo que entró entre el 24-ago-2026
 * (último corte, commit 1a7ee0c) y el 27-ago-2026 (origin/main, bb0b8cf): 78
 * commits sin merge, 134 archivos, +22.341/-897 líneas.
 *
 * Revisado commit por commit contra el CÓDIGO DE HOY (no contra el mensaje del
 * commit) por tres pasadas de investigación independientes. Lo que cambió, por
 * orden de peso:
 *
 *   1. CUARTO SERVIDOR MCP — admin (26-ago). Comparte las 45 tools con el
 *      estándar vía un factory nuevo (createV3McpHandler/registerV3Tools en
 *      lib/v3/mcp-server-tools.ts) y sólo cambia el texto: instructions propias
 *      y nueve reglas find/replace que sacan "pedí confirmación" de 9 tools.
 *      Esto resuelve PARCIALMENTE OPT-07: server+admin ya comparten andamiaje,
 *      explore y profiles todavía no.
 *   2. APOLLO — dos colas nuevas (domain-by-name, gratis, resuelve el 88% del
 *      catálogo sin website; org-enrichment, paga, sembrada a mano) con cron
 *      propio cada una, más siete defectos de producción ya corregidos
 *      (créditos de bulk_enrich contados en cero, empresas pagadas que
 *      quedaban vacías por un testigo de caché equivocado, filas en error que
 *      no volvían a la cola). Instrumentación de gasto nueva: spend-ledger.ts
 *      + get_cost_summary, con measured/estimated/partial/unavailable.
 *   3. TELÉFONOS REACTIVADOS (27-ago) — request_contact_phones + el camino v3
 *      del webhook + un vocabulario único de estado (gana v2). El mapa daba
 *      esto por retirado; ya no es cierto.
 *   4. IDENTIDAD DE PERSONA EN EL ETL (25-ago) — contact_identities resuelve
 *      identidad ANTES de insertar, con veto de sufijos discordantes de
 *      LinkedIn. Encontró y corrigió de paso que upsert_company nunca escribía
 *      normalized_name (84% en NULL, 58,5% de la búsqueda de v2 invisible).
 *   5. UNA SEÑAL ES (DICCIONARIO, PERSONA) (24-ago) — canonical-signals.ts
 *      colapsa en lectura duplicados del mismo término por persona.
 *   6. EL PANORAMA DE SEÑALES DEJA DE SER MUESTRA (27-ago) — el filtro de
 *      candidatas a homónimo pasó de OR con LIMIT 100 sin ORDER BY (0 de 31
 *      Santander Chile reales entraban) a AND con orden explícito.
 *   7. FECHA REAL DE VACANTES (25-ago) — 58% de las vacantes por CSV
 *      (25.056 de 43.052) tenían la fecha de CARGA, no la de publicación.
 *   8. SCREENING NUEVO (24/26-ago) — screen_account_list, con clave propia de
 *      consolidación y localidad medida contra el contacto (94,4% de
 *      cobertura) en vez de sólo la empresa (12,6%).
 *   9. Migraciones: 19 → 49 archivos. Tablas: public 55→58, v3 53→68.
 *
 * Se hace por SCRIPT y no con ediciones de texto por la misma razón de
 * siempre: son ~4.000 líneas de JSON y una edición de texto ya rompió la
 * estructura una vez (el autofix del editor absorbió `edges` dentro de
 * `nodes`). Manipular el objeto y reserializar preserva las claves de nivel
 * superior.
 *
 * Idempotente: correrlo dos veces deja el mismo resultado byte a byte.
 *
 * Correr:  node scripts/update-architecture-map-2026-08-31.mjs
 *          node scripts/build-architecture-map.mjs
 */
import { readFileSync, writeFileSync } from "node:fs"

const PATH = "docs/architecture-map.json"
const j = JSON.parse(readFileSync(PATH, "utf8"))

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
  if (at < 0) throw new Error(`No existe el nodo de referencia: ${afterId}`)
  j.nodes.splice(at + 1, 0, n)
}
/** Agrega una arista con id explicito, sin duplicar. */
const addEdge = (e) => {
  const existing = j.edges.find((x) => x.id === e.id)
  if (existing) Object.assign(existing, e)
  else j.edges.push(e)
}
/** Agrega un punto de contacto, sin duplicar. */
const addContactPoint = (c) => {
  const at = j.contactPoints.findIndex((x) => x.id === c.id)
  if (at >= 0) j.contactPoints[at] = c
  else j.contactPoints.push(c)
}

// ═══════════════════════════════════════════════════════════════════════════
// meta
// ═══════════════════════════════════════════════════════════════════════════
j.meta.generatedAt = "2026-08-31"
j.meta.summary =
  "Monorepo Next.js único donde conviven ASCI v2 (producción, schema public) y ASCI v3 (multitenant, schema v3) sobre la MISMA base Supabase. El aislamiento es por schema, no por proyecto ni por base. " +
  "Actualización 2026-08-31, repaso de los 78 commits que entraron desde el 24-ago (49 PRs, #123 a #151). Por orden de peso: " +
  "(1) CUARTO SERVIDOR MCP — admin (45 tools, las MISMAS que el estándar, registradas una sola vez y compartidas por un factory nuevo en lib/v3/mcp-server-tools.ts), para el equipo de ASCI con una credencial 'unrestricted' que levanta cupos y confirmaciones pero no la medición: get_cost_summary declara measured/estimated/partial/unavailable para cada rubro de gasto. Resuelve PARCIALMENTE OPT-07: server y admin ya comparten andamiaje; explore y profiles todavía no. " +
  "(2) APOLLO, DOS COLAS NUEVAS Y SIETE DEFECTOS DE PRODUCCIÓN — domain-by-name (gratis, resuelve dominio para el 88% del catálogo que hoy no puede entrar a ningún flujo pago de Apollo) y org-enrichment (paga, cola sembrada a mano porque sembrarla ya autoriza gasto) drenan con cron propio cada 10 minutos. Siete bugs que sólo aparecieron contra datos reales —créditos de bulk_enrich contados en cero, empresas pagadas que quedaban vacías por un testigo de caché equivocado, filas en error que nunca volvían a la cola— ya están corregidos. " +
  "(3) TELÉFONOS REACTIVADOS — request_contact_phones + el camino v3 del webhook de Apollo + un vocabulario único de estado (gana v2, con 5.148 filas en producción) devuelven algo que el mapa daba por retirado desde el 21-ago; ya no es cierto. " +
  "(4) IDENTIDAD DE PERSONA EN EL ETL — contact_identities resuelve identidad ANTES de insertar (slug, sufijo, email verificado, teléfono personal), con veto cuando dos perfiles tienen sufijos autogenerados de LinkedIn distintos. El merge reversible gemelo del de empresas ya existe (merge_contacts/v3.contact_merges) pero sin caller de TypeScript todavía. De paso se encontró y corrigió que upsert_company nunca escribía normalized_name: 84% en NULL, 58,5% de la búsqueda de v2 invisible en silencio. " +
  "(5) UNA SEÑAL ES (DICCIONARIO, PERSONA) — canonical-signals.ts colapsa en lectura duplicados del mismo término por persona, resolviendo primero el perfil vigente; lo comparten v2 y v3. " +
  "(6) EL PANORAMA DE SEÑALES DEJA DE SER MUESTRA — el filtro de candidatas a homónimo pasó de OR de tokens con LIMIT 100 sin ORDER BY (inestable entre lecturas; 0 de 31 entidades reales de 'Santander Chile' entraban) a AND de todos los tokens con orden explícito. " +
  "(7) FECHA REAL DE VACANTES — 58% de las vacantes cargadas por CSV (25.056 de 43.052) tenían la fecha de CARGA del lote en vez de la de publicación real; job_postings.is_active (nadie la escribía) se deja de leer. " +
  "(8) SCREENING NUEVO — screen_account_list cruza una lista de cuentas del cliente contra el diccionario en una sola llamada MCP, con clave propia de consolidación (separada de normalized_name a propósito) y localidad medida contra el contacto (94,4% de cobertura) en vez de sólo la empresa (12,6%). " +
  "(9) Migraciones: 19 → 49 archivos, sin duplicados de versión. Tablas: public 55→58, v3 53→68."
j.meta.stats = {
  tsFiles: 490,
  apiRoutes: 58,
  pages: 50,
  crons: 14,
  sqlScripts: 268,
  migrations: 49,
  tablesPublic: 58,
  tablesV3: 68,
  mcpServers: 4,
  mcpTools: 56,
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Cuarto servidor MCP: admin, con factory compartido (26-ago)
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("api_mcp_profiles", {
  id: "api_mcp_admin",
  label: "MCP Admin (45 tools)",
  zone: "v3",
  layer: 2,
  kind: "mcp",
  desc: "CUARTO servidor MCP, creado el 26-ago-2026 para el equipo de ASCI: registra las MISMAS 45 tools que el estándar —una sola vez, en registerV3Tools()— y sólo cambia el texto: instructions propias y nueve reglas find/replace (ADMIN_DESCRIPTION_RULES) que sacan de 9 tools las frases 'la cuenta tiene que estar guardada' y 'pedí confirmación'. El acceso lo cierra createV3McpHandler: una credencial sin el marcador unrestricted se rechaza en el handshake y el rechazo queda logueado.",
  files: ["app/api/v3/mcp/admin/[transport]/route.ts", "lib/v3/mcp-server-tools.ts"],
  notes:
    "Emitir una key admin exige DOS llaves: quien la pide tiene que ser superadmin GLOBAL (no alcanza con canManage del workspace) y el workspace destino tiene que ser el workspace admin (ASCI_ADMIN_WORKSPACE_ID). Sin esa env var no se puede emitir ninguna. El comentario del código dice '44 tools' en tres lugares (esta ruta, el server estándar y mcp-server-tools.ts); el conteo real de server.tool( da 45 — quedó desactualizado cuando se sumó request_contact_phones (PR #150) sin tocar los comentarios.",
})

const mcpServer = node("api_mcp_server")
mcpServer.label = "MCP estándar (45 tools)"
mcpServer.desc =
  "Uno de los CUATRO servidores MCP, el único de acceso general (Explore y Perfiles son A/B; Admin es sólo para el equipo). Conversa con las señales ya interpretadas por el diccionario. Desde el 26-ago las 45 tools se registran una sola vez en lib/v3/mcp-server-tools.ts (registerV3Tools) y esta ruta sólo aporta sus instructions — el mismo factory arma también el server admin. Scope base companies:read / signals:read / accounts:read."
mcpServer.risk =
  "El propio factory (createV3McpHandler) sigue siendo grande y es el de mayor riesgo de conflicto de merge del repo, pero ya no está DUPLICADO entre server y admin (ver OPT-07): la copia que sigue sin resolver es la de Explore y Perfiles, que no migraron al factory."

const mcpAuth = node("svc_v3_mcp_auth")
mcpAuth.desc =
  "OAuth, API keys y resolución de acceso/plan por request, para los CUATRO servidores MCP (server, explore, profiles, admin). Cada tipo de key tiene su scope; admin suma el marcador admin:unrestricted, que sólo se puede emitir si quien lo pide es superadmin GLOBAL y el workspace destino es el workspace admin (lib/v3/admin-workspace.ts, ASCI_ADMIN_WORKSPACE_ID)."
mcpAuth.files = ["lib/v3/mcp-auth.ts", "lib/v3/mcp-oauth.ts", "lib/v3/api-key-access.ts", "lib/v3/mcp-key-scopes.ts", "lib/v3/admin-workspace.ts"]
mcpAuth.notes =
  "Dos bugs del mismo origen, corregidos el 13-ago: explore:read y profiles:read existían como scope de API key pero NO en el catálogo OAuth. La lección se repitió el 27-ago con admin: el flag `unrestricted` de un token OAuth tenía un `false` literal hardcodeado, así que un conector de claude.ai nunca podía alcanzar el perfil admin aunque la API key sí pudiera (PR #143). Hoy `unrestricted` para OAuth se deriva en el servidor (workspace del token + isGlobalSuperAdmin), nunca de los scopes que el cliente pidió en el consentimiento."

const mcpTools = node("svc_v3_mcp_tools")
mcpTools.desc =
  "Implementación de las tools de lectura, ciclo de vida de cuenta, batch/cuota y costo. Antes vivía sobre todo en mcp-read-tools.ts; desde el 26-ago sumó el circuito de lotes autorizados (estimate_batch/create_batch_job) y el de costo (get_cost_summary), que son la base técnica de la credencial unrestricted."
mcpTools.files = [
  "lib/v3/mcp-read-tools.ts",
  "lib/v3/mcp-account-lifecycle.ts",
  "lib/v3/mcp-client-ai.ts",
  "lib/v3/services/mcp-batch-estimate.ts",
  "lib/v3/services/mcp-batch-job.ts",
  "lib/v3/services/mcp-cost-summary.ts",
]

addEdge({ id: "e193", from: "ext_mcp_client", to: "api_mcp_admin", kind: "call", label: "tool call (unrestricted)" })
addEdge({ id: "e194", from: "api_mcp_admin", to: "svc_v3_mcp_auth", kind: "call", label: "exige el marcador unrestricted" })
addEdge({ id: "e195", from: "api_mcp_admin", to: "svc_v3_mcp_tools", kind: "call" })

const fMcpTool = flow("f_mcp_tool")
fMcpTool.trigger = "Un agente IA invoca una de las 45 tools, por el server estándar o por el admin"
fMcpTool.desc =
  "Todo pasa por un proxy sobre server.tool que instrumenta auditoría y cuota sin perder tipado. Desde el 26-ago el registro de tools (registerV3Tools) es compartido por server y admin vía createV3McpHandler; sólo cambian instructions y las reglas de descripción. mcp_request_logs sigue siendo a la vez auditoría y contador de rate limit (OPT-08, sin cambios)."

// ═══════════════════════════════════════════════════════════════════════════
// 2. Instrumentación de gasto: spend-ledger + get_cost_summary (26-ago)
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_v3_mcp_auth", {
  id: "svc_v3_spend_ledger",
  label: "Ledger de gasto (Apify)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "Registro único de lo que se gasta afuera por corrida de Apify, con la EMPRESA como unidad y no el usuario: el cron dedupe por empresa entre workspaces, y cobrarle el gasto al primer follower que aparece haría ver caro un trabajo que aprovecharon todos (userId se guarda igual, sólo como dato informativo). Antes de esto, job-scrape-runner —el cron que más va a correr al escalar— no registraba costo en ningún lado; el de Explore tampoco.",
  files: ["lib/v3/services/spend-ledger.ts"],
})
addNodeAfter("svc_v3_spend_ledger", {
  id: "svc_v3_cost_summary",
  label: "Resumen de costos MCP",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "Implementa get_cost_summary: junta tres ledgers que ya se registraban por separado —AI Gateway, créditos de Apollo, v3.apify_runs— y declara la CALIDAD de cada número: measured (lo cobra el proveedor), estimated (cantidad real, precio supuesto), partial (piso, no total, con totalIsPartial:true) o unavailable (viaja null, nunca cero). Es lo que hace defendible que el perfil admin no tenga topes: no hay cupo, pero todo queda medido.",
  files: ["lib/v3/services/mcp-cost-summary.ts"],
  notes:
    "Medido en la cabecera de su propia migración: el 78% del gasto de IA ya registrado (US$57 de US$73) tenía workspace_id NULL, y un total filtrado por workspace lo dejaba afuera en silencio.",
})
addNodeAfter("db_ws_docs", {
  id: "db_apify_runs",
  label: "v3.apify_runs",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Una fila por corrida de Apify: origen (cron_first_pass / cron_monthly / ui_kick / mcp_tool / mcp_explore), company_id (FK ON DELETE SET NULL, el gasto sobrevive al borrado de la empresa), workspace_id NULL-able (NULL = gasto compartido por varios workspaces) y cost_usd NULL cuando no se pudo leer — nunca cero por default, para no confundir 'no gastó' con 'no sabemos cuánto'.",
  tables: ["v3.apify_runs"],
  files: ["supabase/migrations/20260826203230_ledger_de_gasto_por_empresa.sql"],
  notes: "RLS habilitado sin políticas permisivas: sólo service role escribe y lee.",
})

const jobsV3 = node("svc_v3_jobs")
jobsV3.files = [
  "lib/v3/services/apify-job-ingest.ts",
  "lib/v3/services/job-posting-provider.ts",
  "lib/v3/services/jobs-interpreter.ts",
  "lib/v3/services/apify-client.ts",
  "lib/v3/services/job-scrape-runner.ts",
]
jobsV3.notes =
  "Regla del corredor, aprendida a los golpes: MARCAR EL INTENTO ANTES DE GASTAR. Sin la marca previa, una cuenta sin novedades se re-dispara en cada corrida —la misma lección que después obligó a crear company_news_scrapes para las noticias. Desde el 26-ago el corredor (job-scrape-runner.ts) registra cada corrida en el ledger de gasto (spend-ledger.ts): antes no quedaba costo en ningún lado."

addEdge({ id: "e196", from: "svc_v3_mcp_tools", to: "svc_v3_cost_summary", kind: "call", label: "get_cost_summary" })
addEdge({ id: "e197", from: "svc_v3_cost_summary", to: "db_apify_runs", kind: "read" })
addEdge({ id: "e198", from: "svc_v3_jobs", to: "svc_v3_spend_ledger", kind: "call", label: "job-scrape-runner registra cada corrida" })
addEdge({ id: "e199", from: "svc_v3_spend_ledger", to: "db_apify_runs", kind: "write" })

// ═══════════════════════════════════════════════════════════════════════════
// 3. Apollo: dominio por nombre (PR #151, 27-ago — el más reciente)
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_apollo", {
  id: "svc_apollo_domain_lookup",
  label: "Apollo: dominio por nombre",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc: "Resuelve dominio a partir del NOMBRE contra organizations/search de Apollo (gratuito, fuzzy_select_mode). Medido: 455.747 de 517.790 companies (88%) no tienen website, y por eso no pueden entrar a ningún flujo PAGO de Apollo; ~420.750 tienen nombre buscable. Techo medido en producción: 400 llamadas/hora sobre ese endpoint puntual (rechazo explícito de Apollo); el barrido de fondo usa 350 y deja 50 libres para que una búsqueda manual no se tope un 429 provocado por un proceso que puede esperar.",
  files: ["lib/apollo/domain-lookup.ts", "lib/apollo/domain-lookup-runner.ts"],
  notes:
    "classifyMatch() sólo promueve sin ojo humano los auto_ok (similitud alta y SIN choque geográfico): 'joyeria vasari' no se promueve contra 'JOYERIA VASARI MADRID SL' pese a matchear bien, porque el token 'madrid' sólo aparece de un lado. A 350/hora, barrer las ~420.750 candidatas sembradas de una sola vez (no por anti-join, que degrada a seq-scan casi completo cerca del final) son ~50 días.",
})
addNodeAfter("svc_apollo_domain_lookup", {
  id: "cron_apollo_domain_lookup",
  label: "cron v3-apollo-domain-lookup (10m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Drena v3.apollo_domain_lookup en lotes de ~58, con lock de 300s. Escribe website/logo_url/apollo_organization_id sólo en columnas VACÍAS de companies y sólo para matches auto_ok.",
  files: ["app/api/cron/v3-apollo-domain-lookup/route.ts"],
})
addNodeAfter("db_apollo_cache", {
  id: "db_apollo_domain_lookup",
  label: "v3.apollo_domain_lookup",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Cola sembrada de una sola vez (INSERT idempotente con ON CONFLICT DO NOTHING, ~420.750 filas) con el score y la clase (auto_ok / revisar / descartado / match_sin_dominio / sin_match / error) de cada candidata a dominio por nombre.",
  tables: ["v3.apollo_domain_lookup"],
  files: ["supabase/migrations/20260827205412_checkpoint_de_dominio_por_nombre.sql"],
})
addEdge({ id: "e200", from: "svc_apollo_domain_lookup", to: "ext_apollo", kind: "call", label: "organizations/search, gratuito" })
addEdge({ id: "e201", from: "svc_apollo_domain_lookup", to: "db_apollo_domain_lookup", kind: "rw" })
addEdge({ id: "e202", from: "svc_apollo_domain_lookup", to: "db_companies", kind: "write", label: "sólo columnas vacías, sólo auto_ok" })
addEdge({ id: "e203", from: "cron_apollo_domain_lookup", to: "svc_apollo_domain_lookup", kind: "call" })

// ═══════════════════════════════════════════════════════════════════════════
// 4. Apollo: enrichment de organizaciones (26-ago)
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("cron_apollo_domain_lookup", {
  id: "svc_apollo_org_enrichment",
  label: "Apollo: enrichment de organizaciones",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc: "Drena v3.apollo_company_enrichment, una cola sembrada A MANO —nunca sale a buscar candidatas por su cuenta— porque sembrarla SÍ autoriza gasto: 1 crédito por cuenta resuelta, y barrer las ~61.300 empresas con website sin resolver son ~38.000 créditos, una decisión del dueño del proyecto y no de un cron. Usa bulk_enrich en lotes de 10 (lib/apollo/bulk-organizations.ts): los endpoints bulk consumen la misma cuota por dominio que los simples, la ganancia es en latencia y en no gastar 1 request HTTP por empresa.",
  files: ["lib/apollo/org-enrichment-runner.ts", "lib/apollo/bulk-organizations.ts", "lib/apollo/company-writer.ts"],
  notes:
    "Reglas de escritura de company-writer.ts: las columnas apollo_* se pisan SIEMPRE; las genéricas (linkedin_url, website, country, logo_url, description, linkedin_company_id) sólo si están vacías; is_public/ticker/cik NUNCA se tocan (son de la pipeline de SEC EDGAR); industry de Apollo va SIEMPRE a apollo_industry, nunca se mezcla con la taxonomía propia.",
})
addNodeAfter("svc_apollo_org_enrichment", {
  id: "cron_apollo_org_enrichment",
  label: "cron v3-apollo-org-enrichment (10m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Cada 10 minutos, con 45s de presupuesto, drena lo que ya esté sembrado en v3.apollo_company_enrichment. Con la cola vacía corre, no encuentra nada y gasta cero: autorizar otro lote es un INSERT explícito.",
  files: ["app/api/cron/v3-apollo-org-enrichment/route.ts"],
})
addNodeAfter("db_apollo_domain_lookup", {
  id: "db_apollo_company_enrichment",
  label: "v3.apollo_company_enrichment",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Cola de organizaciones a enriquecer contra Apollo, con status pending/error/done y tope de 3 intentos por fila (evita pagar un crédito por vuelta en un reintento infinito).",
  tables: ["v3.apollo_company_enrichment"],
  files: [
    "supabase/migrations/20260826120000_apollo_enrichment_columnas_y_checkpoint.sql",
    "supabase/migrations/20260826150000_apollo_campos_de_alto_valor.sql",
  ],
})
addEdge({ id: "e204", from: "svc_apollo_org_enrichment", to: "ext_apollo", kind: "call", label: "organizations/bulk_enrich, lotes de 10" })
addEdge({ id: "e205", from: "svc_apollo_org_enrichment", to: "db_apollo_company_enrichment", kind: "rw" })
addEdge({ id: "e206", from: "svc_apollo_org_enrichment", to: "db_companies", kind: "write" })
addEdge({ id: "e207", from: "cron_apollo_org_enrichment", to: "svc_apollo_org_enrichment", kind: "call" })

// ═══════════════════════════════════════════════════════════════════════════
// 5. Apollo: siete defectos de producción, ya corregidos (26-ago)
// ═══════════════════════════════════════════════════════════════════════════
const svcApollo = node("svc_apollo")
svcApollo.label = "Apollo (18 módulos)"
svcApollo.desc =
  "Search, enrich, organizations, cache por hash de query, validación de títulos, parsers y dominio, más domain-lookup, org-enrichment, bulk-organizations, company-writer, rate-limits y usage-stats (sumados 26/27-ago). El pipeline de búsqueda de decisores salió de acá a lib/shared/ el 21-ago para que lo usen las dos versiones; v2 quedó como wrapper."
svcApollo.notes =
  "Siete defectos aparecieron sólo probando contra producción real (ARAUCO, Carrefour, empresas chilenas), la misma lección que CLAUDE.md pide documentar sobre datos sintéticos — acá con datos reales, no sintéticos, y ya corregidos: (1) bulk_enrich/enrich SÍ cobran 1 crédito por cuenta resuelta, el código tenía creditsEstimated:0 y confundía cupo interno con facturación real. (2) Tope de tecnologías en el parser subido de 200 a 500 (Carrefour tenía 221, se truncaba en silencio). (3) La ventana de rate-limit diaria se leía siempre null (Apollo manda x-rate-limit-24-hour, el código buscaba x-rate-limit-daily). (4) El descubrimiento de decisores dejaba 63 empresas PAGADAS y vacías: el cache-hit sólo miraba 'tiene org_id + es reciente' sin verificar que el enrichment hubiera aterrizado de verdad. (5) bulk_enrich no devuelve technology_names (a diferencia de enrich simple) y el testigo de 'ya tiene datos' sólo miraba ese campo — cada empresa enriquecida por el cron nuevo se veía vacía y se re-pagaba; el testigo ahora acepta cualquier campo rico (departmental_head_count, annual_revenue). (6) El mismo fix no llegaba a prepare_contact_enrichment, que lee apollo_organization_id directo sin pasar por el testigo — las 63 empresas seguían condenadas hasta que se exportó la función. (7) Las filas error de la cola de org-enrichment nunca volvían: la query de reclamo sólo miraba pending, así que un 429/500 pasajero varaba 10 empresas para siempre."

const sharedDm = node("svc_shared_apollo_dm")
sharedDm.notes =
  "Se extrajo en vez de copiarse: habría sido la TERCERA vez que este repo paga tener dos implementaciones del mismo pipeline (pasó con las noticias y con el research). Los decisores aterrizan en los mismos dos lugares que en v2 —user_company_contacts con source 'apollo' e is_decision_maker true, y apollo_contacts_cache—, y por eso un decisor encontrado desde cualquiera de los dos mundos aparece en el bookmark del otro. bookmark_id va en null desde v3: es una columna de v2 y la tabla la acepta nullable. RESUELTO 27-ago-2026 (ver DEAD/OPT no aplica, PR #150): el reveal de teléfono, que este texto daba por removido, se reactivó completo — request_contact_phones pide, el webhook entrega asíncrono (~57% de las veces) y svc_contact_phone_inbox recibe del lado v3."

const dApolloCache = node("db_apollo_cache")
dApolloCache.desc =
  "Cache de Apollo por hash de query. Dejó de ser sólo de v2: desde el 21-ago v3 también ESCRIBE acá cuando busca decisores desde el bookmark, y desde el 27-ago también recibe los teléfonos que el webhook entrega asíncrono (request_contact_phones), sean pedidos desde v2 o desde v3."

const fDecisionMakers = flow("f_decision_makers")
const dmStep3 = fDecisionMakers.steps.find((s) => s.n === 3)
if (dmStep3) dmStep3.detail = "search + enrich en lotes de 4. El reveal de teléfono, aparte de esto, vía request_contact_phones (5 créditos, asíncrono por webhook)."

// ═══════════════════════════════════════════════════════════════════════════
// 6. Teléfonos por MCP (PR #150, 27-ago)
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_v3_contacts", {
  id: "svc_contact_phone_inbox",
  label: "Teléfonos: camino de vuelta v3",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "receivePhoneForV3() recibe el teléfono que Apollo entrega asíncrono por webhook (llega ~57% de las veces, medido 80/141). El número va al caché compartido (public.apollo_contacts_cache); el estado del pedido va a v3.account_contacts.phone_status y sólo se toca en filas pending, para no afirmar un pedido que otro workspace no hizo. Nunca lanza: el webhook siempre devuelve 200.",
  files: ["lib/v3/services/contact-phone-inbox.ts", "lib/v3/services/mcp-contact-phones.ts"],
  notes:
    "request_contact_phones NO espera la respuesta a propósito: pide (5 créditos contra 1 del email, sólo para contactos con email verificado y cargo que matchea) y devuelve qué pidió; los números se leen después con get_company_contacts. skipped/creditsSaved dicen qué no se volvió a pedir porque ya había número.",
})
addNodeAfter("svc_shared_apollo_dm", {
  id: "svc_shared_phone_status",
  label: "Vocabulario de estado de teléfono",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc: "Había TRES vocabularios incompatibles para el mismo eje: v2 (not_requested·pending·received·not_available, 5.148 filas en producción), el CHECK viejo de v3 (seis valores) y el código de v3, que escribía 'not_requested' pero leía 'processing' —que nadie escribía nunca, así que pendingPhone daba 0 por construcción—. Gana v2, no por antigüedad: es el vocabulario que habla el webhook de Apollo, la pieza que ninguna de las dos plataformas controla.",
  files: ["lib/shared/phone-status.ts", "supabase/migrations/20260827172000_phone_status_habla_el_vocabulario_de_v2.sql"],
  notes:
    "Es la misma forma exacta de bug que ya mató el enrichment una vez con role_origin:'mcp_enrichment' (un CHECK que rechazaba un valor que el código sí escribía). El backfill (20260827190000) movió 80 teléfonos que v2 ya había pagado al caché compartido, para que el MCP no le volviera a pagar a Apollo por ellos.",
})

addEdge({ id: "e208", from: "api_apollo_webhook", to: "svc_contact_phone_inbox", kind: "call", label: "camino v3, agregado 27-ago" })
addEdge({ id: "e209", from: "svc_contact_phone_inbox", to: "db_apollo_cache", kind: "write" })
addEdge({ id: "e210", from: "svc_contact_phone_inbox", to: "db_account_contacts", kind: "write", label: "phone_status" })
addEdge({ id: "e211", from: "svc_v3_contacts", to: "svc_shared_phone_status", kind: "call" })
addEdge({ id: "e212", from: "svc_contact_phone_inbox", to: "svc_shared_phone_status", kind: "call" })

const apolloWebhook = node("api_apollo_webhook")
apolloWebhook.zone = "shared"
apolloWebhook.desc =
  "Callback de Apollo autenticado por secreto en el path. El flujo v2 (escribe user_company_contacts) queda intacto; desde el 27-ago-2026 (PR #148) se agregó el camino v3, insertado ANTES de las tres ramas de salida de v2 para que no quede afuera si alguien toca la función después."

// ═══════════════════════════════════════════════════════════════════════════
// 7. Capa 1: una señal es (diccionario, persona) — canonical-signals.ts (24-ago)
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_shared_evidence", {
  id: "svc_shared_canonical_signals",
  label: "Unidad canónica de señal",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc: "Una señal es (empresa, entrada de diccionario, persona resuelta), no una fila de signals: la keyword literal y el snippet son evidencia de esa señal, no señales aparte. Colapsa en LECTURA, sin tocar datos ni ETL: resuelve primero el perfil VIGENTE por persona (por updated_at de contacts, no por la fecha de la señal) y agrupa después por (señal, entidad). Caso real que lo motivó: en Molinos Agro 'Intune' aparecía dos veces para la misma persona porque dos filas de contacts —una con el slug autogenerado de LinkedIn, otra con la vanity URL— apuntaban al mismo signal_id.",
  files: ["lib/shared/canonical-signals.ts"],
  notes:
    "Lo comparten v2 (company-drawer.tsx) y v3 (company-signal-summary.ts) para que no vuelvan a agrupar distinto. Deliberadamente conservador: ante la duda NO fusiona personas —mostrar un duplicado pesa menos que fundir a dos personas distintas—; el merge real de filas duplicadas de contacts es un trabajo aparte (ver svc_contact_identity).",
})
addEdge({ id: "e213", from: "svc_v3_signals", to: "svc_shared_canonical_signals", kind: "call" })
addEdge({ id: "e214", from: "svc_shared_canonical_signals", to: "db_signals", kind: "read" })
addEdge({ id: "e215", from: "svc_shared_canonical_signals", to: "db_contacts", kind: "read" })

const signalsV3 = node("svc_v3_signals")
signalsV3.files = ["lib/v3/services/company-signal-summary.ts", "lib/v3/services/legacy-signal-provider.ts", "lib/v3/services/evidence-level.ts", "lib/shared/canonical-signals.ts"]
signalsV3.desc =
  "Resumen de señales por compania, provider legacy sobre datos de v2 y nivel de evidencia. Desde el 27-ago el panorama de homónimos es CENSO, no muestra: el filtro de candidatas pasó de OR de tokens con LIMIT 100 sin ORDER BY (inestable entre lecturas — para 'Santander Chile', 0 de 31 entidades reales entraban) a AND de todos los tokens con orden explícito; el tope de señales escaneadas subió de 100 a 2.000 con un bloque scan que declara si quedó incompleto; y la evidencia se resuelve también contra el diccionario, no sólo contra el texto literal (antes buscaba 'JCL' con 0 resultados para una señal rotulada 'IBM Z')."
signalsV3.notes =
  "El defecto de muestreo y el de rotulado son invisibles con datos sintéticos: el test de contrato tests/contract/company-signal-scope.test.ts corre sólo contra el catálogo real (RUN_SCREEN_CONTRACT_TESTS=1) — la misma lección de CLAUDE.md sobre validar contra datos reales, aplicada de nuevo. El risk de fuga cross-tenant (cp_tenant_leak) NO fue tocado por este trabajo: sigue abierto tal cual."

// ═══════════════════════════════════════════════════════════════════════════
// 8. Capa 2: identidad de persona en el ETL (25-ago)
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_etl", {
  id: "svc_contact_identity",
  label: "Identidad de contacto (resolución + merge reversible)",
  zone: "v2",
  layer: 3,
  kind: "service",
  desc: "Resuelve identidad de persona ANTES de insertar, en vez de deduplicar por linkedin_url crudo: contact_identities (slug, sufijo, email verificado, teléfono personal) es historial mantenido por trigger, y resolve_contact_id() reapunta la fila existente a la URL nueva antes de que actúe el ON CONFLICT de siempre. Vetoa la fusión cuando dos perfiles tienen sufijos autogenerados de LinkedIn DISTINTOS: son dos cuentas reales aunque compartan mail o teléfono (caso real: dos 'Alejandro Álvarez' de Falabella/Sodimac con el mismo mail adivinado por el proveedor).",
  files: [
    "lib/shared/linkedin-profile.ts",
    "supabase/migrations/20260825000000_contact_identity_resolution.sql",
    "supabase/migrations/20260825001000_contact_merge.sql",
    "supabase/migrations/20260825163000_previous_positions_aditivo.sql",
  ],
  notes:
    "Gemelo declarado con contact_profile_slug()/contact_profile_suffix() (SQL): si divergen, la UI pliega como una sola persona a alguien que la base cree que son dos, o al revés. merge_contacts()/auto_merge_contact_duplicates() instalan el merge reversible (snapshot + revert, gemelo de merge_companies) pero NO corren solos: a diferencia del dedupe de empresas (con UI en /admin/companies/duplicates), hoy no tienen ningún caller en TypeScript — se corren a mano por SQL. El dry run sobre producción bajó el universo de 3.566 a 2.169 grupos al exigir esta calidad de identidad: mail verificado, teléfono personal, sin veto de sufijo.",
  risk:
    "El aviso de export incompleto (identity_fields_missing, cuando faltan email1_status/phone1_type) sólo se ve en app/api/ingest/upload/route.ts; el otro camino de carga, app/actions/ingest.ts, no lo muestra.",
})
addEdge({ id: "e216", from: "svc_etl", to: "svc_contact_identity", kind: "call" })
addEdge({ id: "e217", from: "svc_contact_identity", to: "db_contacts", kind: "rw" })

const dbContacts = node("db_contacts")
dbContacts.notes =
  "Tiene ~1 GB de índices GIN: los UPDATE masivos son no-HOT y caros. Las fechas de puesto YA venían en el export crudo y quedaban guardadas en import_rows.row_data, pero process_contact_batch_internal nunca las leía, así que se perdían al materializar; parse_position_date las normaliza desde 'YYYY-MM' / 'YYYY-MM-DD' / 'YYYY' a date o NULL, nunca a error. Desde el 25-ago, contact_identities (slug/sufijo/email verificado/teléfono personal) resuelve identidad antes de insertar y evita duplicar la misma persona por cambio de vanity URL; merge_contacts()/v3.contact_merges instala el merge reversible análogo al de empresas (ver svc_contact_identity)."
dbContacts.files = ["supabase/migrations/20260825000000_contact_identity_resolution.sql"]

const svcDedupe = node("svc_dedupe")
svcDedupe.notes =
  "Fase 0 (25-ago) cerró tres agujeros medidos contra producción: el regex de sufijo societario se comía letras finales de palabras normales (Cisco→cis, Alicorp→ali; 4.523 nombres truncados, que fabricaban duplicados falsos — Alicorp llegó a fusionarse con ALICO, una aseguradora sin relación); upsert_company nunca escribía normalized_name (84% de 514.182 filas en NULL, y como la búsqueda de v2 filtra únicamente por esa columna, el 58,5% de las empresas elegibles eran invisibles en silencio); y merge_companies perdía linkedin_company_id/hq_country_iso/is_public del duplicado al fusionar. Una sola normalización canónica: normalize_company_name (muerta, sin llamadores) se borró y createCompany de v3 pasó a llamar upsert_company en vez de insertar directo."

addContactPoint({
  id: "cp_contact_identity",
  title: "Identidad de persona: un gemelo TS/SQL que puede divergir",
  severity: "alta",
  nodes: ["db_contacts", "svc_contact_identity", "svc_shared_canonical_signals", "svc_v3_contacts"],
  desc: "contact_profile_slug()/contact_profile_suffix() (SQL, ETL de v2) y linkedinProfileSlug()/linkedinProfileBase() (TS, lib/shared/linkedin-profile.ts) tienen que definir la MISMA identidad de persona. El ETL de v2 decide con la versión SQL si inserta o actualiza una fila de contacts; v3 (contact-provider.ts) y la UI de las dos versiones (vía canonical-signals.ts) pliegan señales con la versión TS.",
  impact:
    "Si las dos definiciones divergen, la pantalla —v2 y v3 por igual, porque comparten canonical-signals.ts— muestra como dos personas distintas a alguien que la base ya fusionó bajo un solo contact_id, o al revés. No es un problema de escritura concurrente: sólo v2 escribe identidad hoy. Es que dos implementaciones del mismo criterio viven en dos lenguajes sin más que un comentario pidiendo que se mantengan sincronizadas — no hay test de paridad entre las dos, sólo un test unitario de la versión TS sola.",
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. Fecha real de vacantes + is_active dejó de leerse (25-ago)
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_v3_jobs", {
  id: "svc_job_posted_at",
  label: "Fecha real de publicación de vacantes",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc: "Normaliza fechas relativas del scraper de LinkedIn ('4 weeks ago', 'hace 3 dias') a ISO-8601, resueltas contra la fecha de SCRAPEO del lote y no contra el momento de procesar. Gemelo TS/SQL: normalizePostedDate() y parse_job_posted_at() tienen que cambiar juntas. Corrigió que el 58% de las vacantes por CSV (25.056 de 43.052) quedara fechada con su fecha de carga: los dos caminos de subida de CSV renombran la fecha a posted_at, una clave que el RPC de ingesta nunca buscaba, así que el COALESCE caía siempre en now().",
  files: ["lib/v3/services/apify-posted-dates.ts", "supabase/migrations/20260825002000_job_posted_at.sql", "supabase/migrations/20260825003000_job_posted_at_backfill.sql"],
  notes:
    "El backfill recuperó las 25.056 filas usando que el ON CONFLICT viejo nunca pisaba posted_at ni source_data: la fecha real seguía en el string crudo, identificable sin ambigüedad por abs(posted_at - created_at) < 2s.",
})
addEdge({ id: "e218", from: "svc_v3_jobs", to: "svc_job_posted_at", kind: "call" })

const dbJobs = node("db_job_postings")
dbJobs.notes =
  "Desde el 25-ago, posted_at se parsea con parse_job_posted_at() (ver svc_job_posted_at) en vez de con COALESCE contra claves que un CSV nunca trae. is_active tiene DEFAULT true, nadie la escribe (0 filas en false) y desde el 25-ago seis funciones —incluida search_companies_by_name_filtered— dejaron de leerla: queda en la tabla con un COMMENT que dice que no se mantiene, porque borrarla es irreversible. Lo que está abierto HOY se responde con scrape_company_job_postings, no con esta columna."

// ═══════════════════════════════════════════════════════════════════════════
// 10. Diccionario: keywords con contexto y exclusión (24-ago)
// ═══════════════════════════════════════════════════════════════════════════
const dbDictionary = node("db_dictionary")
dbDictionary.notes =
  "Desde el 24-ago, dictionary_products tiene keywords_contexto y keywords_excluye (jsonb): permiten recuperar keywords ambiguas que los siete lotes de limpieza anteriores habían borrado por ruidosas (ej. 'Fabric', 556 menciones → 154 válidas exigiendo contexto de datos) sin comerse colocaciones de otro producto ('Service Fabric' no cuenta como 'Fabric'). Los ~10 lotes de contenido del 24-ago (CRM, BI, cloud, cyber, dev stacks, ERP) son datos, no arquitectura: ningún hallazgo del mapa depende de ellos."

// ═══════════════════════════════════════════════════════════════════════════
// 11. Screening de listas de cuentas (24/26-ago) — nace después del corte anterior
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_v3_signals", {
  id: "svc_screen_account_list",
  label: "Screening de listas de cuentas",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "Cruza una lista de empresas del cliente contra uno o varios términos del diccionario en UNA llamada MCP, con cuatro estados —matched, matched_ambiguous, matched_no_signal, no_match— que no son intercambiables: matched_no_signal es un descarte legítimo, no_match significa que la empresa no está en ASCI. Tope de 100 nombres por llamada, bajado de 200 al medir 26s contra el catálogo real (514.269 filas) por encima del techo de 8s de PostgREST (OPT-11 en acción).",
  files: [
    "lib/v3/services/screen-account-list.ts",
    "supabase/migrations/20260824205956_screen_account_list.sql",
    "supabase/migrations/20260826215500_screening_clave_propia_y_localidad_por_senal.sql",
  ],
  notes:
    "Nació el 24-ago, después del corte del mapa anterior. El 26-ago se le corrigieron dos defectos medidos en la primera corrida real (75 cuentas de Chile + Power BI: 21 no llegaban al enrichment): una clave propia (company_screen_key, deliberadamente separada de normalized_name para no arriesgar el auto-merge de empresas sobre 517.326 filas) y localidad evaluada también contra contacts.country_normalized (94,4% de cobertura) en vez de sólo companies.country (12,6%) — nunca excluye, sólo rescata candidatas.",
})
addEdge({ id: "e219", from: "svc_v3_mcp_tools", to: "svc_screen_account_list", kind: "call" })
addEdge({ id: "e220", from: "svc_screen_account_list", to: "svc_dedupe", kind: "call", label: "company_screen_key, variante de company_core_name" })
addEdge({ id: "e221", from: "svc_screen_account_list", to: "db_contacts", kind: "read", label: "localidad por country_normalized" })
addEdge({ id: "e222", from: "svc_screen_account_list", to: "db_dictionary", kind: "read" })

// ═══════════════════════════════════════════════════════════════════════════
// Optimizations: re-verificadas contra el código de hoy
// ═══════════════════════════════════════════════════════════════════════════
opt("OPT-06").title = "15 archivos instancian createClient crudo y saltean los helpers de Supabase"
opt("OPT-06").evidence = [
  "15 archivos con createClient( real de @supabase/supabase-js fuera de lib/supabase/ (4 más sólo importan el TIPO SupabaseClient, no cuentan)",
  "app/actions/dictionary.ts, app/api/ingest/upload, app/api/landing-stats, components/v3/navbar.tsx, y 4 crons/rutas v3 nuevos: v3-enrich-companies-linkedin, v3-apollo-org-enrichment, v3-apollo-domain-lookup, admin/normalize-country-phase5",
]
opt("OPT-06").finding =
  "EMPEORÓ: de 13 (eran 16) pasó a 15. El aumento no es un patrón nuevo: son crons v3 agregados entre el 21 y el 27-ago que siguieron la costumbre existente en vez de importar los helpers de lib/supabase/. El patrón sigue disponible y nada lo impide."

opt("OPT-07").title = "La ruta del servidor MCP concentra transporte, auth, cuota y tools — resuelto en 2 de 4 rutas"
opt("OPT-07").evidence = [
  "lib/v3/mcp-server-tools.ts: createV3McpHandler/registerV3Tools, compartido por server y admin",
  "app/api/v3/mcp/explore/[transport]/route.ts y app/api/v3/mcp/profiles/[transport]/route.ts: siguen con createMcpHandler propio",
]
opt("OPT-07").finding =
  "PARCIAL. El 26-ago se creó un factory —exactamente lo que pedía el fix— en lib/v3/mcp-server-tools.ts: createV3McpHandler registra las 45 tools UNA sola vez y arma el handler para cualquier perfil; server (33 líneas) y el nuevo admin (41 líneas) son hoy casi puro texto (instructions + reglas de descripción). PERO Explore (499 líneas) y Perfiles (307 líneas) no migraron: siguen con su propio createMcpHandler/withMcpAuth inline. Son 4 rutas, no 3: 2 unificadas por el factory, 2 con la copia vieja del patrón."
opt("OPT-07").fix =
  "Lo que falta es extender el mismo factory a Explore y Perfiles — ya está escrito y probado por dos consumidores reales (server, admin). El costo de duplicar un arreglo en el manejo de errores bajó de 3 rutas a 2."

opt("OPT-13").evidence = [
  "uso de .schema(\"v3\") disperso: 81 archivos hoy",
  "app/actions/v3/csv-import.ts ya NO EXISTE — reemplazado por app/actions/v3/account-imports.ts y lib/v3/services/account-import.ts",
]
opt("OPT-13").finding =
  "El ejemplo puntual citado (csv-import.ts mezclando .from() sin schema y .schema('v3').from() a pocas líneas) quedó OBSOLETO: ese archivo no existe más, ni siquiera en el historial de git bajo ese nombre. Se reorganizó como account-imports.ts, revisado línea por línea: sus 9 llamadas a .from('account_imports') van siempre precedidas por .schema('v3'), sin el patrón mixto. El problema estructural de fondo sigue intacto — 81 archivos con .schema('v3') disperso, sin helper v3Db() (lib/supabase/ sólo tiene admin.ts, client.ts, middleware.ts, server.ts) y sin regla de lint — sólo cambió el ejemplo que lo ilustraba."

opt("OPT-16").fix =
  "RESUELTA el 19-ago-2026 por los dos lados. En el ORIGEN: se agregó companies.linkedin_company_id y el actor pasó a filtrar por companyId numérico, que es EXACTO y no tiene homónimos. El backfill salió de las vacantes ya cargadas (CSV históricos y runs de Apify guardan el ID en source_data) con dos reglas medidas contra producción: sólo se toma el ID dominante de una compañía si cubre >=80% de sus vacantes, y un ID que apunta a más de una compañía sólo se asigna si una concentra >=90% (caso real: YPF con 135 vacantes contra dos duplicados con 1 cada uno). En la INGESTA: belongsToCompany es lo PRIMERO que corre y descarta lo ajeno, y el resultado reporta cuántas se descartaron —suele ser la mayoría cuando se cae al filtro por nombre. Actualización 25-ago: el script 459 subió linkedin_company_id de 3.955 a 14.481 empresas (3,7x) partiendo de las vacantes ya atribuidas. Encontró 2 filas contaminadas por el propio guard de contención de los scripts 453/454 (Uala/ig-UALA-r, Tsoft/ne-TSOFT) — el guard 'da por cerrado' el problema de MIN_CONTAINMENT pero no del todo; queda como detalle menor a vigilar, no como regresión de OPT-16."

// ═══════════════════════════════════════════════════════════════════════════
// DeadCode: DEAD-12 se divide — dictionary_term_suggestions ya tiene lector
// ═══════════════════════════════════════════════════════════════════════════
dead("DEAD-12").title = "Tabla de v3 sin lector: bookmark_dedupe_log"
dead("DEAD-12").evidence = ["v3.bookmark_dedupe_log"]
dead("DEAD-12").finding =
  "dictionary_term_suggestions, que este hallazgo agrupaba junto a bookmark_dedupe_log, DEJÓ DE ESTAR MUERTA: lib/v3/services/dictionary.ts la consulta (líneas 304/315/325) como parte del flujo de super-admin. bookmark_dedupe_log sigue sin ningún lector en lib/, app/ ni scripts/."
dead("DEAD-12").verification =
  "grep de 'bookmark_dedupe_log' y 'dictionary_term_suggestions' sobre lib/, app/ y scripts/, 27-ago-2026."
dead("DEAD-12").recommendation =
  "Confirmar con un conteo de filas antes de tocar bookmark_dedupe_log: puede alimentarse desde SQL suelto en scripts/. dictionary_term_suggestions ya no aplica a este hallazgo — sacar de la vigilancia."

// ═══════════════════════════════════════════════════════════════════════════
// verificación de integridad + escritura
// ═══════════════════════════════════════════════════════════════════════════
const nodeIds = new Set(j.nodes.map((n) => n.id))
if (nodeIds.size !== j.nodes.length) throw new Error("Hay ids de nodo duplicados")
for (const e of j.edges) {
  if (!nodeIds.has(e.from)) throw new Error(`Arista ${e.id}: nodo origen inexistente ${e.from}`)
  if (!nodeIds.has(e.to)) throw new Error(`Arista ${e.id}: nodo destino inexistente ${e.to}`)
}
const edgeIds = new Set(j.edges.map((e) => e.id))
if (edgeIds.size !== j.edges.length) throw new Error("Hay ids de arista duplicados")
for (const f of j.flows) {
  for (const s of f.steps) {
    if (!nodeIds.has(s.nodeId)) throw new Error(`Flujo ${f.id}: paso con nodeId inexistente ${s.nodeId}`)
    if (s.edgeId && !edgeIds.has(s.edgeId)) throw new Error(`Flujo ${f.id}: paso con edgeId inexistente ${s.edgeId}`)
  }
}
for (const c of j.contactPoints) {
  for (const nid of c.nodes) {
    if (!nodeIds.has(nid)) throw new Error(`ContactPoint ${c.id}: nodo inexistente ${nid}`)
  }
}
const optIds = new Set(j.optimizations.map((o) => o.id))
if (optIds.size !== j.optimizations.length) throw new Error("Hay ids de optimization duplicados")
const deadIds = new Set(j.deadCode.map((d) => d.id))
if (deadIds.size !== j.deadCode.length) throw new Error("Hay ids de deadCode duplicados")

writeFileSync(PATH, JSON.stringify(j, null, 2) + "\n")
console.log(
  `OK nodos=${j.nodes.length} aristas=${j.edges.length} flujos=${j.flows.length} contactPoints=${j.contactPoints.length} optimizations=${j.optimizations.length} deadCode=${j.deadCode.length}`,
)
