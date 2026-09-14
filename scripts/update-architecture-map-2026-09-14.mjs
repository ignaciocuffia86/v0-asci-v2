/**
 * Actualiza docs/architecture-map.json con lo que entró entre el 24-ago-2026
 * (commit 1a7ee0c, última pasada completa) y el 08-sep-2026 (commit f513468,
 * HEAD de origin/main al correr este script). Son ~72 commits sin pasada
 * intermedia: 25 con número de PR y el resto commits directos a main (varios
 * del propio Claude, de un día para el otro — el repo permite eso mientras
 * pasen los tres checks de CI).
 *
 * Cada afirmación de abajo se verificó contra el CÓDIGO de hoy (no contra el
 * mensaje del commit, que describe el momento del merge) y, cuando hay un
 * número, contra un comando o una consulta a la base real
 * (asciv2-database / grenlquhexbyneubtdub), nunca de memoria.
 *
 * Lo que cambió, resumido (el detalle completo va en meta.summary):
 *
 *   1. MCP ADMIN CONSOLIDADO (PRs #136, #138, #139, #143). Cuarta ruta MCP
 *      que NO trae tools propias: server y admin comparten las MISMAS 45
 *      tools desde un único registro (lib/v3/mcp-server-tools.ts) vía el
 *      factory createV3McpHandler. Esto RESUELVE OPT-07. El acceso exige dos
 *      llaves (superadmin global + workspace admin declarado en un solo
 *      archivo) y se arregló para funcionar también desde un conector OAuth.
 *   2. LOTES, COSTO Y EXPORT (PRs #140, #141, #142, más 0dbf411 de la pasada
 *      anterior que quedó sin nodo). screen_account_list, estimate_batch,
 *      create_batch_job, get_cost_summary, create_export. Se detectó una
 *      inconsistencia real: un string le dice al modelo que Apollo no está
 *      autorizado por el batchPlanHash cuando el código de al lado ya lo
 *      autoriza (OPT-17, nuevo).
 *   3. APOLLO: 18 módulos (eran 11). Cron nuevo de enrichment de
 *      organizaciones (paga) y un segundo cron de dominio por nombre (gratis,
 *      88% del catálogo) sembrado el 27-ago y PAUSADO el 08-sep (#154).
 *      Ledger de costo real de Apify por corrida y teléfonos pedibles por MCP.
 *   4. IDENTIDAD DE PERSONA, capa 1 y 2 (24/25-ago): unidad canónica de señal
 *      (empresa, entrada, persona), fusión reversible de contactos
 *      duplicados, y una reparación puntual de 37 keywords del diccionario
 *      con doble dueño que habían inflado 151.906 señales.
 *   5. Limpieza de datos medida contra producción: is_active de job_postings
 *      dejó de leerse (DEAD-17, nuevo), fechas de vacantes recuperadas,
 *      screening con clave propia y localidad por contacto.
 *   6. Los conteos saltaron: v3 pasó de 53 a 68 tablas (medido contra la base
 *      real), public de 55 a 58, migraciones de 19 a 49, tools MCP de 48 a 56.
 *
 * Se hace por SCRIPT y no con ediciones de texto por la misma razón de
 * siempre: son ~4.600 líneas de JSON y una edición de texto ya rompió la
 * estructura una vez. Manipular el objeto y reserializar preserva las claves
 * de nivel superior.
 *
 * Idempotente: correrlo dos veces deja el mismo resultado (usa los mismos
 * helpers addNodeAfter/addEdge/addFlow/addContactPoint/addDead que las
 * pasadas anteriores, que actualizan in-place si el id ya existe).
 *
 * Correr:  node scripts/update-architecture-map-2026-09-14.mjs
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
/** Agrega una optimizacion nueva o actualiza si el id ya existe. */
const addOpt = (o) => {
  const at = j.optimizations.findIndex((x) => x.id === o.id)
  if (at >= 0) j.optimizations[at] = o
  else j.optimizations.push(o)
}
/** Inserta un nodo despues de otro, sin duplicar si ya existe. */
const addNodeAfter = (afterId, n) => {
  if (j.nodes.some((x) => x.id === n.id)) {
    Object.assign(node(n.id), n)
    return
  }
  const at = j.nodes.findIndex((x) => x.id === afterId)
  if (at < 0) throw new Error(`addNodeAfter: nodo ancla inexistente: ${afterId}`)
  j.nodes.splice(at + 1, 0, n)
}
/** Agrega una arista con id explicito, sin duplicar. */
const addEdge = (e) => {
  const existing = j.edges.find((x) => x.id === e.id)
  if (existing) Object.assign(existing, e)
  else j.edges.push(e)
}
/** Agrega una entrada de deadCode, sin duplicar. */
const addDead = (d) => {
  const at = j.deadCode.findIndex((x) => x.id === d.id)
  if (at >= 0) j.deadCode[at] = d
  else j.deadCode.push(d)
}

// ═══════════════════════════════════════════════════════════════════════════
// meta
// ═══════════════════════════════════════════════════════════════════════════
j.meta.generatedAt = "2026-09-14"
j.meta.summary =
  "Monorepo Next.js único donde conviven ASCI v2 (producción, schema public) y ASCI v3 (multitenant, schema v3) sobre la MISMA base Supabase. El aislamiento es por schema, no por proyecto ni por base. " +
  "Actualización 2026-09-14, repaso de los ~72 commits que entraron desde el 24-ago (25 con número de PR, el resto commits directos a main con CI en verde). Lo que cambió, por orden de peso: " +
  "(1) MCP ADMIN CONSOLIDADO — cuarto endpoint MCP (/api/v3/mcp/admin) que NO trae tools propias: server y admin comparten las MISMAS 45 tools desde un único registro (lib/v3/mcp-server-tools.ts) vía el factory createV3McpHandler, con instructions y reglas de descripción propias por perfil. Esto RESUELVE OPT-07: antes cada ruta MCP copiaba su propio andamiaje de auth/cuota/transporte; hoy las cuatro rutas comparten una función y sólo server+admin comparten además las tools. El acceso admin exige DOS llaves —superadmin global y estar en EL workspace admin, declarado en un solo archivo (lib/v3/admin-workspace.ts)— y se arregló para que también funcione desde un conector OAuth de claude.ai, no sólo con API key. " +
  "(2) LOTES, COSTO Y EXPORT — screen_account_list (cruza una lista del cliente contra términos, Tier 0, sin IA), estimate_batch/create_batch_job (cotiza y ejecuta un lote con un solo batchPlanHash, que ahora TAMBIÉN autoriza créditos de Apollo), get_cost_summary (declara la CALIDAD de cada número: measured/estimated/partial/unavailable, nunca cero donde no se sabe) y create_export (xlsx/csv con URL firmada de 24h). Encontramos una inconsistencia real haciendo este repaso: el string que devuelve get_batch_job todavía dice que Apollo NO está autorizado por el batchPlanHash, y el código de al lado ya lo autoriza (OPT-17, nuevo). " +
  "(3) APOLLO MADURÓ A 18 MÓDULOS (eran 11): cron nuevo de enrichment de organizaciones (paga, 1 crédito/cuenta, con tope de reintentos) y un segundo cron de resolución de dominio por nombre para el 88% del catálogo sin website —gratis, sembrado con 420.753 filas el 27-ago y PAUSADO el 08-sep (la entrada salió de vercel.json; el código y la cola quedan intactos, listos para reanudar). Ledger de costo real por corrida de Apify (v3.apify_runs, nunca cero donde no se sabe) y teléfonos pedibles por MCP (request_contact_phones). " +
  "(4) IDENTIDAD DE PERSONA, capa 1 y 2: una señal es (empresa, entrada del diccionario, persona resuelta) y no una fila de signals (canonical-signals.ts); fusión reversible de contactos duplicados (v3.contact_merges, mismo patrón que company_merges); y una reparación puntual de 37 keywords del diccionario con doble dueño que habían inflado 151.906 señales por doble conteo, revertible con v3.revert_keyword_ownership(). " +
  "(5) LIMPIEZA DE DATOS medida contra producción: is_active de job_postings dejó de leerse —nunca fue confiable, la columna queda viva sin mantenerse (DEAD-17, nuevo)—, 24.963 de 25.056 vacantes recuperaron su fecha real, y el screening usa una clave de consolidación propia (company_screen_key, separada de normalized_name) más localidad por contacto (94% de cobertura) en vez de país de la empresa (12,6%). " +
  "(6) LOS NÚMEROS SALTARON: v3 pasó de 53 a 68 tablas y public de 55 a 58 (medido contra la base real), las migraciones de 19 a 49, y las tools MCP de 48 a 56 — docs/mcp-inventario-y-perfiles.md (fecha 24-ago) quedó desactualizado, dice 39/54; no se tocó en este PR porque el alcance es sólo el mapa."
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
// PRs #136, #138, #139 — MCP admin: flag unrestricted, get_cost_summary, y
// el server admin sobre una sola registración de tools (26-ago). RESUELVE OPT-07.
// ═══════════════════════════════════════════════════════════════════════════
const mcpServerNode = node("api_mcp_server")
mcpServerNode.label = "MCP estándar (45 tools, compartidas con admin)"
mcpServerNode.desc =
  "Punto de entrada de lectura para un cliente: cuentas, research, contactos, documentos, screening y lotes. Desde el 26-ago (Fase C, #139) las 45 tools NO se registran acá: viven en lib/v3/mcp-server-tools.ts y esta ruta sólo aporta sus `instructions` propias — la política que el cliente MCP recibe una vez en el handshake."
mcpServerNode.risk =
  "Sigue siendo el único perfil sin el marcador admin:unrestricted, así que respeta cupos y topes de cuenta. Antes concentraba además el registro de tools, auth, cuota y transporte (OPT-07); ese antes ya no es cierto, ver la nota."
mcpServerNode.notes =
  "OPT-07 RESUELTA el 26-ago-2026: las 45 tools se registran UNA VEZ en createV3McpHandler (lib/v3/mcp-server-tools.ts) y las cuatro rutas MCP (server, admin, explore, profiles) comparten esa función factory para transporte + auth + auditoría. server y admin comparten además el mismo set de tools; lo único propio de cada ruta son las `instructions` del handshake y, en admin, las nueve ADMIN_DESCRIPTION_RULES que reescriben cada descripción para el perfil sin fricción. " +
  "Conteo medido hoy con `grep -oE '^\\s*server\\.tool\\(' lib/v3/mcp-server-tools.ts | wc -l` → 45 (no 37, no 39: docs/mcp-inventario-y-perfiles.md, fechado 24-ago, quedó desactualizado y no se tocó en este PR). Dos tools cambiaron de contrato el 21-ago: get_company_signal_summary acepta detail 'compact' (default) o 'full', y get_company_profile devuelve un bloque firmographics con null EXPLÍCITO."

addNodeAfter("api_mcp_profiles", {
  id: "api_mcp_admin",
  label: "MCP admin (mismas 45 tools)",
  zone: "v3",
  layer: 2,
  kind: "mcp",
  desc:
    "CUARTA ruta MCP, agregada el 26-ago-2026 (Fase C, #139). No es un servidor nuevo con tools propias: registra las MISMAS 45 tools que el estándar desde createV3McpHandler (lib/v3/mcp-server-tools.ts), con otras `instructions` y las nueve ADMIN_DESCRIPTION_RULES que reescriben cada descripción de tool para un perfil sin fricción operación por operación.",
  files: ["app/api/v3/mcp/admin/[transport]/route.ts", "lib/v3/mcp-server-tools.ts"],
  risk:
    "Sólo se llega acá con una credencial marcada admin:unrestricted: una API key admin (emitida sólo para el workspace admin) o un token OAuth de un superadmin en ESE workspace (ver svc_admin_workspace). Levanta los topes de cuenta y cupo mensual; lo que lo hace defendible es que get_cost_summary sigue registrando todo el gasto igual.",
  notes:
    "Dos excepciones que SIGUEN pidiendo confirmación explícita pese al perfil sin fricción: remove_workspace_account (libera cuentas) y confirm_document_analysis (persiste una extracción). El resto no pregunta operación por operación, a propósito — repreguntar 42 veces es justo lo que este perfil viene a eliminar.",
})

addNodeAfter("svc_v3_workspace", {
  id: "svc_admin_workspace",
  label: "Workspace admin (la excepción declarada)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "UN único workspace (env var ASCI_ADMIN_WORKSPACE_ID) donde ASCI arma informes on-demand para clientes y el que gasta es el que paga: por eso queda afuera del cron de refresh mensual y de los topes de cuenta/cupo. La excepción se declara en UN solo archivo a propósito — repartida en cinco archivos sería una excepción que nadie puede auditar.",
  files: ["lib/v3/admin-workspace.ts"],
  notes:
    "Dos llaves, no una: hace falta ser superadmin global Y estar en ese workspace (oauthUnrestricted en este archivo). Arreglado el 26-ago (#143): antes la rama OAuth de validateMcpRequest devolvía unrestricted:false LITERAL, así que un conector de claude.ai completaba el OAuth y mostraba 'este conector no tiene herramientas disponibles' sin ningún error visible — claude.ai no tiene dónde pegar una API key, que era el único camino que otorgaba el marcador. Falla cerrado: sin la variable configurada no hay workspace admin y nada se exceptúa.",
  risk:
    "Lo que SIGUE aplicando acá, a propósito: la confirmación explícita de Apollo (prepare → planHash → run, porque el crédito de un tercero es irreversible) y el registro completo (ai_usage_log, mcp_request_logs). 'Sin bloqueo' nunca significa 'sin medición'.",
})
addEdge({ id: "e193", from: "ext_mcp_client", to: "api_mcp_admin", kind: "call", label: "tool call (admin:unrestricted)" })
addEdge({ id: "e194", from: "api_mcp_admin", to: "svc_v3_mcp_auth", kind: "call", label: "misma auth que el estándar" })
addEdge({ id: "e195", from: "api_mcp_admin", to: "svc_v3_usage", kind: "call", label: "cuota + auditoría (perfil admin)" })
addEdge({ id: "e196", from: "api_mcp_admin", to: "svc_v3_mcp_tools", kind: "call", label: "mismas 45 tools que el estándar" })
addEdge({ id: "e197", from: "svc_v3_mcp_auth", to: "svc_admin_workspace", kind: "call", label: "resuelve unrestricted (superadmin + workspace)" })

const mcpToolsNode = node("svc_v3_mcp_tools")
mcpToolsNode.desc =
  "Registro ÚNICO de las 45 tools MCP (lib/v3/mcp-server-tools.ts, desde el 26-ago) más lectura, ciclo de vida de cuenta y circuito client-assisted. Es lo que ahora comparten server y admin: createV3McpHandler registra este mismo set dos veces, una por perfil, y sólo cambia el texto que ve el modelo."
mcpToolsNode.files = ["lib/v3/mcp-server-tools.ts", "lib/v3/mcp-read-tools.ts", "lib/v3/mcp-account-lifecycle.ts", "lib/v3/mcp-client-ai.ts"]

opt("OPT-07").severity = "resuelta"
opt("OPT-07").title = "RESUELTA: la ruta del servidor MCP concentraba transporte, auth, cuota y tools — y ya eran tres rutas"
opt("OPT-07").fix =
  "RESUELTA el 26-ago-2026 (#139, Fase C). Se extrajo createV3McpHandler(lib/v3/mcp-server-tools.ts) como factory único de transporte + auth + auditoría + mapa de nextAction, y las 45 tools se registran UNA sola vez ahí. server y admin (la cuarta ruta MCP, agregada en el mismo PR) llaman a la misma función y comparten el mismo set de tools; explore y profiles usan el factory para el andamiaje pero mantienen sus propias tools (8 y 3). Un arreglo en el manejo de errores hoy se hace una vez para server+admin, no tres."

// ═══════════════════════════════════════════════════════════════════════════
// PRs #140, #141, #142 — batchPlanHash autoriza Apollo, ledger de Apify,
// y 0dbf411 (Fase 3, pasada anterior) que había quedado sin nodo: lotes,
// costo y export.
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_v3_mcp_tools", {
  id: "svc_v3_mcp_batch",
  label: "Lotes, costo y export (MCP)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "Las tools que resuelven 'una lista, no cuenta por cuenta'. screen_account_list cruza una lista de nombres del cliente contra uno o varios términos del diccionario en Tier 0 (sin IA, sin cupo, sin exigir que las cuentas estén guardadas). estimate_batch cotiza los cuatro medidores juntos (lugares del plan, unidades de research, créditos de Apollo, USD) sin gastar nada y devuelve un batchPlanHash que vence en 1 hora. create_batch_job lo ejecuta de una vez —idempotente por hash— y desde el 26-ago TAMBIÉN autoriza el gasto de Apollo del lote. get_batch_job consulta estado sin cupo. get_cost_summary cierra con lo realmente gastado, declarando la CALIDAD de cada número (measured/estimated/partial/unavailable — nunca cero donde no se sabe). create_export entrega un xlsx/csv con URL firmada de 24h en vez de transcribir la tabla al chat.",
  files: [
    "lib/v3/services/screen-account-list.ts",
    "lib/v3/services/mcp-batch-estimate.ts",
    "lib/v3/services/mcp-batch-job.ts",
    "lib/v3/services/mcp-cost-summary.ts",
    "lib/v3/services/mcp-export.ts",
    "lib/v3/services/spend-ledger.ts",
  ],
  notes:
    "screen_account_list bajó su tope de 200 a 100 nombres por llamada midiendo contra el catálogo real: la prueba local sobre 300.000 empresas sintéticas daba 5,6s para 200 nombres difusos, pero contra las 514.269 reales eran ~26s, muy por encima del corte de 8s de PostgREST (mismo techo que OPT-11). Con 100 nombres todos difusos mide 5,7s. Desde el 26-ago (#145) usa company_screen_key(name) para consolidar —clave propia, DISTINTA de normalized_name/company_core_name, calculada al vuelo y sin backfill— y cruza localidad por company_screen_key contra contacts.country_normalized (94,4% de cobertura) en vez de companies.country (12,6%): rescata candidatas antes excluidas por país, nunca excluye una que hoy pasa.",
  risk:
    "OPT-17 (nuevo): get_batch_job devuelve un interpretationGuidance que dice 'El gasto en Apollo NO está autorizado por el batchPlanHash' (lib/v3/services/mcp-batch-job.ts, junto al bloque de respuesta) — ese texto es de Fase 3 (21-ago) y quedó desactualizado: desde el 26-ago create_batch_job SÍ calcula y persiste enrichment_credits_authorized, recortado al cupo mensual restante salvo que la credencial sea unrestricted. El código hace lo correcto; el string que lee el modelo dice lo contrario.",
})
addEdge({ id: "e202", from: "svc_v3_mcp_tools", to: "svc_v3_mcp_batch", kind: "call" })
addEdge({ id: "e203", from: "svc_v3_mcp_batch", to: "db_mcp_batch_jobs", kind: "rw" })
addEdge({ id: "e204", from: "svc_v3_mcp_batch", to: "db_companies", kind: "read", label: "screen_account_list" })
addEdge({ id: "e205", from: "svc_v3_mcp_batch", to: "db_apify_runs", kind: "read", label: "get_cost_summary" })
addEdge({ id: "e206", from: "svc_v3_mcp_batch", to: "db_ai_usage", kind: "read", label: "get_cost_summary" })
addEdge({ id: "e207", from: "svc_v3_mcp_batch", to: "svc_apollo", kind: "call", label: "créditos de contact enrichment" })

addNodeAfter("db_account_contacts", {
  id: "db_mcp_batch_jobs",
  label: "v3.mcp_batch_jobs",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc:
    "Un lote cotizado por estimate_batch y su estado de ejecución: cuentas guardadas, research en curso/listo/fallido, créditos de Apollo autorizados y gastados. Es lo que hace idempotente a create_batch_job — reintentar con el mismo batchPlanHash devuelve el lote existente en vez de gastar cupo dos veces.",
  tables: ["v3.mcp_batch_jobs"],
  files: ["supabase/migrations/20260826191459_apollo_en_el_batch_plan_hash.sql"],
})

addOpt({
  id: "OPT-17",
  title: "get_batch_job le dice al modelo que Apollo no está autorizado por el batchPlanHash — y sí lo está",
  severity: "baja",
  area: "arquitectura",
  evidence: [
    "lib/v3/services/mcp-batch-job.ts: interpretationGuidance de getBatchJob",
    "lib/v3/services/mcp-batch-job.ts líneas ~122-150: authorizedCredits SÍ se calcula y persiste en enrichment_credits_authorized",
  ],
  finding:
    "El texto que getBatchJob le devuelve al cliente MCP dice 'El gasto en Apollo NO está autorizado por el batchPlanHash'. Es un string de Fase 3 (0dbf411, 21-ago-2026), previo a que b3a9a85 (26-ago) agregara la autorización real de créditos de Apollo al batch. El código quedó correcto; el string que lee el modelo quedó desactualizado y dice lo contrario.",
  why:
    "Es una instrucción al modelo, no al desarrollador: si el LLM la toma literal, puede volver a pedir confirmación por cuenta para un gasto que el lote ya autorizó, deshaciendo justo lo que create_batch_job vino a resolver (una confirmación para el lote entero en vez de 42 sueltas).",
  fix:
    "Actualizar el string de interpretationGuidance en getBatchJob para que describa lo que el código ya hace: el batchPlanHash autoriza authorizedCredits de Apollo, expuesto como remaining = authorized - spent.",
})

// ═══════════════════════════════════════════════════════════════════════════
// Commits sueltos de Apollo (26/27-ago) — 18 módulos (eran 11), cron de
// enrichment de organizaciones, cron de dominio por nombre (sembrado y
// PAUSADO el 08-sep, #154), ledger de Apify y teléfonos por MCP.
// ═══════════════════════════════════════════════════════════════════════════
const apolloSvc = node("svc_apollo")
apolloSvc.label = "Apollo (18 módulos)"
apolloSvc.desc =
  "Search, enrich, bulk_enrich de organizaciones, cache por hash de query, validación de títulos, parsers, dominio y logger de costo. Creció de 11 a 18 módulos entre el 26 y el 27-ago: bulk-organizations.ts, company-writer.ts, domain-lookup.ts + su runner, org-enrichment-runner.ts y rate-limits.ts. El pipeline de búsqueda de decisores sigue en lib/shared/ desde el 21-ago, usado por las dos versiones; v2 queda como wrapper."
apolloSvc.notes =
  "Cada llamada real se loguea en apollo_api_calls.credits_estimated (lib/apollo/logger.ts): el bug que anotaba el costo en cero (fcf40a4) está corregido — el crédito se calcula por llamada, no por defecto. splitByContactCache (search-cache.ts) chequea el cache ANTES de salir a Apollo: medido en producción, 921 de 4.223 llamadas eran redundantes (21,8%)."

addNodeAfter("cron_v3_enrich_linkedin", {
  id: "cron_v3_apollo_org_enrichment",
  label: "cron v3-apollo-org-enrichment (10m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc:
    "Drena v3.apollo_company_enrichment (status pending/error con attempts<3) contra organizations/bulk_enrich de Apollo. La cola NO se llena sola: sembrar filas es un acto explícito, porque Apollo cobra 1 crédito por cuenta resuelta y con la cola vacía esta corrida no gasta nada.",
  files: ["app/api/cron/v3-apollo-org-enrichment/route.ts", "lib/apollo/org-enrichment-runner.ts"],
  notes:
    "Reintentos con tope: MAX_ATTEMPTS=3 y después queda failed terminal — cierra el bug de 628ddb1, donde una fila en error volvía a la cola sin límite. Lock propio (v3-apollo-org-enrichment, TTL 300s), mismo patrón que el resto de los corredores de 10 minutos.",
})
addNodeAfter("cron_v3_apollo_org_enrichment", {
  id: "cron_v3_apollo_domain_lookup",
  label: "cron v3-apollo-domain-lookup (PAUSADO)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc:
    "Resuelve dominio por NOMBRE contra organizations/search de Apollo (gratis) para las ~420.750 companies sin website — el 88% del catálogo que ninguna otra fase de Apollo puede tocar, porque enrich/bulk_enrich reciben dominio, no nombre. Drena v3.apollo_domain_lookup, sembrada el 27-ago-2026 con 420.753 filas en pending.",
  files: ["app/api/cron/v3-apollo-domain-lookup/route.ts", "lib/apollo/domain-lookup-runner.ts", "lib/apollo/domain-lookup.ts"],
  risk:
    "PAUSADO el 08-sep-2026 (#154): la entrada salió del array `crons` de vercel.json, que es lo único que Vercel mira para invocar un cron. El código, la ruta y la cola quedan intactos y las filas sin procesar siguen en pending; reanudar es devolver la entrada a vercel.json y desplegar — DEFAULT_LIMIT ya está calibrado para la cadencia de 10 minutos. Mientras dure la pausa, las 350 llamadas/hora que este barrido reservaba a organizations/search quedan libres para trabajo manual.",
  notes:
    "No confundir con cron_v3_apollo_org_enrichment: ese SÍ sigue activo y gasta créditos (1 por cuenta resuelta); este es gratis y por eso se pudo sembrar con el catálogo entero de una sola vez.",
})
addEdge({ id: "e198", from: "cron_v3_apollo_org_enrichment", to: "db_apollo_queues", kind: "rw" })
addEdge({ id: "e199", from: "cron_v3_apollo_org_enrichment", to: "ext_apollo", kind: "call", label: "organizations/bulk_enrich" })
addEdge({ id: "e200", from: "cron_v3_apollo_domain_lookup", to: "db_apollo_queues", kind: "rw", label: "PAUSADO: no se invoca" })
addEdge({ id: "e201", from: "cron_v3_apollo_domain_lookup", to: "ext_apollo", kind: "call", label: "organizations/search, gratis — PAUSADO" })

addNodeAfter("db_apollo_cache", {
  id: "db_apollo_queues",
  label: "v3.apollo_company_enrichment / apollo_domain_lookup",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc:
    "Las dos colas que alimentan el enrichment de empresas contra Apollo. apollo_company_enrichment (paga, 1 crédito/cuenta) la drena cron_v3_apollo_org_enrichment; apollo_domain_lookup (gratis, resolución de dominio por nombre) la drenaba cron_v3_apollo_domain_lookup, HOY pausado — sus filas siguen en pending.",
  tables: ["v3.apollo_company_enrichment", "v3.apollo_domain_lookup"],
  files: [
    "supabase/migrations/20260826120000_apollo_enrichment_columnas_y_checkpoint.sql",
    "supabase/migrations/20260827205412_checkpoint_de_dominio_por_nombre.sql",
  ],
})
addNodeAfter("db_apollo_queues", {
  id: "db_apify_runs",
  label: "v3.apify_runs",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc:
    "Ledger de gasto de Apify por CORRIDA y por ORIGEN (cron_first_pass, cron_monthly, ui_kick, mcp_tool, mcp_explore), no por usuario. cost_usd es NULLABLE a propósito: null es 'no se pudo leer', nunca cero por defecto — la misma regla de calidad de dato que aplica get_cost_summary.",
  tables: ["v3.apify_runs"],
  files: ["supabase/migrations/20260826203230_ledger_de_gasto_por_empresa.sql"],
})

const webhook = node("api_apollo_webhook")
webhook.desc =
  "Callback de Apollo autenticado por secreto en el path. Desde el 27-ago (F2, #148) también aprende el camino v3: llama receivePhoneForV3() INCONDICIONALMENTE antes de los tres returns propios de v2."
webhook.notes =
  "receivePhoneForV3 (lib/v3/services/contact-phone-inbox.ts) escribe en dos lugares distintos según el dato: el NÚMERO va al cache compartido (public.apollo_contacts_cache, sólo si estaba vacío) y el ESTADO va a v3.account_contacts.phone_status, sólo en filas 'pending' y por workspace. phone_last_verified_at se toca en TODAS las filas de esa persona, no sólo las pending — decisión deliberada, documentada en el código."

const contactsV3 = node("svc_v3_contacts")
contactsV3.desc =
  "Provider de contactos, cobertura y enrichment; reusa el cache de Apollo de v2. Desde el 27-ago (#150) también pide teléfonos por MCP (request_contact_phones): 5 créditos contra 1 del email, asíncrono — Apollo entrega por webhook y el 57% de las veces llega, así que la tool dice qué pidió y los números se leen después con get_company_contacts. Salta a quien ya tenía el número o un pedido en curso (creditsSaved)."
contactsV3.files = [
  "lib/v3/services/contacts.ts",
  "lib/v3/services/contact-provider.ts",
  "lib/v3/services/mcp-contact-enrichment.ts",
  "lib/v3/services/mcp-contact-phones.ts",
  "lib/v3/services/contact-phone-inbox.ts",
  "lib/v3/mcp-contact-coverage.ts",
]

const accountContacts = node("db_account_contacts")
accountContacts.notes =
  "phone_status pasó a hablar el vocabulario de v2 el 27-ago (#147, migración 20260827172000): antes tenía sus propios valores, hoy son los mismos que usa v2 para el mismo campo. Backfill medido: 80 personas (65 con móvil, 15 con fijo), 0 huérfanas — sólo UPDATE sobre filas vacías (migración 20260827190000)."

// ═══════════════════════════════════════════════════════════════════════════
// PRs de identidad — capa 1 (24-ago) y capa 2 (25-ago): unidad canónica de
// señal, fusión reversible de personas, y la reparación puntual de keywords
// con doble dueño en el diccionario.
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_shared_news", {
  id: "svc_contact_identity",
  label: "Identidad de persona y señal canónica",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc:
    "Capa 1 y capa 2 de identidad, cerradas el 24/25-ago-2026. Capa 1 (66e3121): una SEÑAL es (empresa, entrada de diccionario, persona resuelta) y no una fila de `signals` — la unidad canónica vive en canonical-signals.ts y la usan el drawer de v2 (company-drawer.tsx) y el panorama de v3 (company-signal-summary.ts). Capa 2 (3750a1e, 2e42716, c0a65ff): identidad de PERSONA en el ETL con fusión reversible de duplicados (resolve_contact_id, auto_merge_contacts) y reglas de calidad —email sólo status='valid', teléfono sólo type='personal', veto de perfil discordante— más normalización canónica de URL/slug de LinkedIn (linkedin-profile.ts, gemela de la función SQL homónima).",
  files: ["lib/shared/canonical-signals.ts", "lib/shared/linkedin-profile.ts", "lib/v3/services/contact-provider.ts"],
  notes:
    "A diferencia de evidence.ts o news-search.ts (OPT-12), estos módulos todavía no son inquilinos plenos de las dos versiones: canonical-signals.ts sí lo cruzan v2 (company-drawer.tsx) y v3, pero linkedin-profile.ts y contact-provider.ts hoy sólo los llama v3. La fusión es reversible por diseño: v3.contact_merges guarda merge_id y reverted_at, mismo patrón que v3.company_merges.",
})
addEdge({ id: "e208", from: "svc_v3_contacts", to: "svc_contact_identity", kind: "call", label: "dedupe de personas en el merge v2/Apollo" })
addEdge({ id: "e209", from: "svc_contact_identity", to: "db_contact_merges", kind: "rw" })
addEdge({ id: "e210", from: "svc_contact_identity", to: "db_contacts", kind: "rw" })
addEdge({ id: "e211", from: "svc_v3_signals", to: "svc_contact_identity", kind: "call", label: "unidad canónica de señal" })

addNodeAfter("db_contacts", {
  id: "db_contact_merges",
  label: "v3.contact_merges",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc:
    "Historial de fusión de personas duplicadas, reversible (merge_id, reverted_at) — el mismo patrón que v3.company_merges pero para contactos. Alimentado por resolve_contact_id y auto_merge_contacts.",
  tables: ["v3.contact_merges"],
  files: ["supabase/migrations/20260825001000_contact_merge.sql"],
})

const dictionaryDb = node("db_dictionary")
dictionaryDb.desc =
  "Vendors, productos, procesos, jobs, matches y cache de patrones. Desde el 24-ago dictionary_products tiene tres ejes de taxonomía (categoria, ciclo_vida vigente/legado) además del original, y desde el 25-ago dos columnas jsonb —keywords_contexto y keywords_excluye— para desambiguar por co-ocurrencia."

const dictSvc = node("svc_v3_dictionary")
dictSvc.notes =
  "Reparación puntual el 25-ago (65fdc9e): 37 de 3.694 keywords estaban reclamados por dos entradas a la vez, generando una señal por cada entrada que reclamara el término — 222.291 señales con keyword ambiguo, 151.906 infladas por doble conteo. Se resolvió por especificidad, reclasificación (On-Premise pasó a technology) y eliminación de keywords que no distinguían nada ('innovación', 49.458 señales). check_keyword_ownership() hoy devuelve vacío. Ver db_keyword_repair."

addNodeAfter("db_dictionary", {
  id: "db_keyword_repair",
  label: "v3.keyword_ownership_plan y afines",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc:
    "Maquinaria de la reparación puntual del 25-ago-2026 de keywords con doble dueño en el diccionario. Cuatro tablas de soporte: keyword_ownership_plan (qué se decidió por keyword), dictionary_snapshot (estado previo), signal_keyword_repairs (qué señal se reatribuyó o borró) y keyword_ownership_moves (el movimiento aplicado). No es maquinaria de uso continuo: se corrió una vez.",
  tables: ["v3.keyword_ownership_plan", "v3.dictionary_snapshot", "v3.signal_keyword_repairs", "v3.keyword_ownership_moves"],
  files: ["supabase/migrations/20260825004000_keyword_ownership.sql"],
  notes:
    "Reversible con v3.revert_keyword_ownership() si hiciera falta deshacerlo. La reparación REATRIBUYE evidencia en vez de borrarla cuando la entrada ganadora ya tenía la señal: de 122.962 filas borradas eran sólo duplicados y keywords sin dueño; 30.497 se reatribuyeron sin que ninguna evidencia perdiera su señal.",
})
addEdge({ id: "e212", from: "svc_v3_dictionary", to: "db_keyword_repair", kind: "write", label: "reparación puntual (25-ago)" })

// ═══════════════════════════════════════════════════════════════════════════
// Vacantes / screening / panorama de señales (24/25-ago)
// ═══════════════════════════════════════════════════════════════════════════
const jobPostings = node("db_job_postings")
jobPostings.notes =
  "is_active dejó de leerse el 25-ago (f2a8ee1, migración 20260825141319): nunca fue confiable como filtro y hoy es 54.072/54.072 filas en true, sin ningún lector. La columna sigue viva mecánicamente (default true en la ingesta) — ver DEAD-17. posted_at se corrigió el mismo día: el parser buscaba postedTime/publishedAt/post_date y el CSV real trae posted_at, así que caía a now(); el backfill recuperó 24.963 de 25.056 vacantes mal fechadas (93 sin fecha reconstruible). El drawer del detalle de empresa top a 100 vacantes con aviso de truncado, y agrega detected_keywords por (vacante, señal) con orden determinístico."

const signalsV3 = node("svc_v3_signals")
signalsV3.notes =
  "get_company_signal_summary ('panorama de señales', 2356b23, 24-ago): el pool de candidatas a homónimo pasó de un OR de tokens con limit(100) sin orden a un AND con order by explícito, y MAX_SIGNALS_SCAN subió de 100 a 2000 — antes se presentaba una muestra como si fuera el censo completo."

// ═══════════════════════════════════════════════════════════════════════════
// Re-verificación de hallazgos abiertos (paso 2) — todo lo que no es OPT-07
// ═══════════════════════════════════════════════════════════════════════════
opt("OPT-06").evidence = [
  "13 archivos con import de @supabase/supabase-js fuera de lib/supabase/",
  "app/actions/dictionary.ts, 6 rutas de cron, app/api/ingest/upload, app/api/landing-stats, app/api/v3/admin/normalize-country-phase5/route.ts",
]
opt("OPT-06").finding =
  "Sigue en 13 archivos, medido de nuevo el 14-sep. Un ejemplo de la lista anterior ya no aplica: components/v3/navbar.tsx hoy usa createClient de lib/supabase/client y sólo importa el TYPE User de supabase-js, no la función. El archivo real detrás del cupo 13 es otro, no relevado antes: app/api/v3/admin/normalize-country-phase5/route.ts. El patrón de fondo — nada impide instanciar crudo — sigue igual."

opt("OPT-08").evidence = ["v3.mcp_request_logs", "lib/v3/mcp-auth.ts", "lib/v3/mcp-usage.ts"]
opt("OPT-08").finding =
  "Sigue igual. La cita anterior apuntaba a mcp-usage.ts; el chequeo real vive en lib/v3/mcp-auth.ts (.is('tool_name', null) sobre v3.mcp_request_logs para el rate limit por minuto), con un comentario propio en el código que dice explícitamente que la tabla cumple dos funciones y conviene no mezclarlas."

opt("OPT-12").finding =
  "Cada capacidad transversal (IA, documentos, radar, búsqueda, dedupe, digest) tenía una implementación en v2 y otra en v3, sin módulo compartido ni regla explícita. lib/shared/ pasó de 5 a 8 archivos: sumó canonical-signals.ts, linkedin-profile.ts y phone-status.ts (ver svc_contact_identity), pero esos tres TODAVÍA no son inquilinos plenos de las dos versiones — canonical-signals.ts sí lo cruzan v2 y v3, linkedin-profile.ts y contact-provider.ts hoy sólo los llama v3. Los inquilinos confirmados de ambos lados siguen siendo evidence.ts, news-search.ts y apollo-decision-makers.ts (importadores de v2 verificados: app/api/research/news/route.ts, app/actions/apollo.ts). La duplicación de IA, documentos y búsqueda sigue sin tocar."

opt("OPT-13").evidence = ["uso de .schema(\"v3\") disperso (400+ ocurrencias)", "app/actions/v3/account-imports.ts (antes csv-import.ts, renombrado)"]
opt("OPT-13").finding =
  "El ejemplo original (app/actions/v3/csv-import.ts:285,324 mezclando .from() con y sin schema) quedó obsoleto: ese archivo se renombró a account-imports.ts antes del PR #110 y hoy usa .schema('v3') consistentemente, sin mezcla. Un chequeo amplio de client.from() sin .schema() en lib/v3 y app/*/v3 no encontró ningún caso de mezcla schema/no-schema sobre la misma tabla v3 — todos los .from() sin schema apuntan a tablas legítimamente public. El riesgo de fondo sigue vigente (400+ usos dispersos de .schema('v3'), sin helper central que lo fuerce en compilación), pero con un ejemplo distinto al citado antes."

dead("DEAD-12").finding =
  "v3.dictionary_term_suggestions ya NO está huérfana: desde el 25-ago (d546629) lib/v3/services/dictionary.ts (suggestDictionaryTerm) escribe ahí, llamada desde jobs-interpreter.ts y radar.ts. Pero sigue sin lector: el docstring dice que 'el super-admin las revisa y aprueba' y no hay ninguna UI o action que la lea — pasó de ser una tabla huérfana a una que acumula datos sin salida. v3.bookmark_dedupe_log sigue sin acceso desde app/lib, tal como estaba."
dead("DEAD-12").recommendation =
  "Para dictionary_term_suggestions: construir la UI de revisión que el docstring da por hecha, o si no se va a construir pronto, dejar de escribir ahí. Para bookmark_dedupe_log: mismo tratamiento que antes, confirmar con un conteo de filas antes de borrar."

addDead({
  id: "DEAD-17",
  title: "public.job_postings.is_active: columna sin lectores, siempre en true",
  severity: "baja",
  loc: 0,
  evidence: [
    "grep de is_active en app/, lib/, components/: cero usos sobre job_postings (todos los resultados son de otras tablas)",
    "select count(*), count(*) filter (where is_active) from job_postings -> 54.072 / 54.072",
  ],
  finding:
    "La lectura se eliminó el 25-ago (f2a8ee1, migración 20260825141319_job_postings_drop_is_active_reads.sql): nunca fue un filtro confiable. La columna NO se dropeó, sólo se documentó vía COMMENT ON COLUMN como 'no se mantiene'. Sigue viva mecánicamente: la ingesta la escribe en true por default y el merge de empresas la propaga (SET is_active = m.is_active OR r.dup_active), pero ningún camino del código la lee.",
  verification: "Medido contra producción el 14-sep-2026: 54.072 de 54.072 filas en true.",
  recommendation:
    "No es candidata a DROP inmediato: sigue escribiéndose desde varios puntos y dropearla exige tocarlos todos. Si en el futuro se confirma que no hace falta, dropearla junto con las escrituras que la alimentan; mientras tanto no agregar ningún lector nuevo.",
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
const dupOpts = j.optimizations.map((o) => o.id).filter((id, i, a) => a.indexOf(id) !== i)
const dupDead = j.deadCode.map((d) => d.id).filter((id, i, a) => a.indexOf(id) !== i)
if (dupNodes.length) errs.push(`nodos duplicados: ${dupNodes.join(", ")}`)
if (dupEdges.length) errs.push(`aristas duplicadas: ${dupEdges.join(", ")}`)
if (dupFlows.length) errs.push(`flujos duplicados: ${dupFlows.join(", ")}`)
if (dupOpts.length) errs.push(`optimizaciones duplicadas: ${dupOpts.join(", ")}`)
if (dupDead.length) errs.push(`deadCode duplicados: ${dupDead.join(", ")}`)

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
