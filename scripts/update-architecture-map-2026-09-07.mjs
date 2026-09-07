/**
 * Actualiza docs/architecture-map.json con lo que entró entre el 24-ago-2026
 * (commit 1a7ee0c, "docs: el mapa de arquitectura al dia") y el 27-ago-2026
 * (commit bb0b8cf), revisando los 72 commits que tocan app/, lib/, components/,
 * supabase/migrations/, vercel.json o scripts/*.sql, más los 6 que no tocan esas
 * carpetas (docs-only) para contexto.
 *
 * Todo lo que sigue se verificó contra el CÓDIGO DE HOY (grep, lectura de
 * archivos, conteo de líneas), no contra el mensaje del commit: un mensaje
 * puede describir una intención que el diff de un PR posterior corrigió.
 *
 * LOS CINCO HILOS NARRATIVOS DE LA SEMANA, por peso:
 *
 * (1) APOLLO, de punta a punta. Se cierran los tres huecos que dejaba el
 *     enrichment de compañías (campos descartados, string vacío que congelaba
 *     el enrichment para siempre, costo real medido en vez de asumido en 0),
 *     se agregan DOS crons nuevos (v3-apollo-org-enrichment, que drena una cola
 *     sembrada de 61.300 empresas con website; v3-apollo-domain-lookup, que
 *     resuelve el 88% del catálogo que hoy no tiene website y por eso nunca
 *     entra a Apollo), se instrumenta el costo real de Apify por corrida
 *     (v3.apify_runs) y SE ABRE el camino de teléfonos por MCP que antes
 *     estaba explícitamente cerrado: backfill de los 80 que v2 ya había
 *     pagado al cache compartido, el webhook aprende a escribir en v3, y
 *     phone_status pasa a un solo vocabulario (el de v2, que es el que habla
 *     el webhook).
 *
 * (2) MCP ADMIN, server nuevo. Perfil sin topes de plan para el equipo de
 *     ASCI, en 4 fases (A: flag unrestricted + workspace admin declarado;
 *     B2: get_cost_summary con la calidad de cada número declarada; C: server
 *     admin sobre la MISMA registración de tools que el standard, vía un
 *     factory que resuelve OPT-07 para este par; batchPlanHash: autoriza
 *     créditos de Apollo por lote en vez de por mes). Server nuevo:
 *     /api/v3/mcp/admin. Las 45 tools (el comentario del código dice 44; el
 *     conteo real, hecho con dos métodos distintos, da 45) están en
 *     lib/v3/mcp-server-tools.ts y las comparten standard y admin.
 *
 * (3) SCREENING → COTIZACIÓN → LOTE → EXPORT, la Fase 3 completa del plan de
 *     ejecución directa (PRs #123-#125, 24-ago), ausente del mapa anterior:
 *     screen_account_list (cruza una lista contra el diccionario en una sola
 *     llamada), estimate_batch (cotiza un lote con batchPlanHash),
 *     create_batch_job (lo ejecuta), create_export (primer entregable como
 *     ARCHIVO de las 45 tools) y build_evidence_icebreaker (mensaje
 *     determinístico, sin IA, que no puede inventar una tecnología).
 *
 * (4) IDENTIDAD, dos capas nuevas. Capa 1 (66e3121): una señal es (empresa,
 *     entrada de diccionario, persona resuelta) y no una fila de `signals`;
 *     lib/shared/canonical-signals.ts es la unidad canónica que leen v2 y v3.
 *     Capa 2 (3750a1e + fixes): contact_identities + resolve_contact_id() +
 *     merge_contacts() + veto de perfiles discordantes — maquinaria instalada
 *     por migración pero NO APLICADA a producción (el propio commit 12cd806 lo
 *     dice: "queda a decisión del dueño"). Aparte, 25.056 vacantes recuperaron
 *     su fecha real (el 58% tenía la fecha de CARGA, no de publicación).
 *
 * (5) DICCIONARIO: tres ejes de taxonomía (vendor, categoría, ciclo de vida)
 *     sobre dictionary_products, y keywords con co-ocurrencia (contexto y
 *     exclusión) para las que son a la vez nombre de producto y palabra común
 *     ("Fabric", "Exchange"). Y el matching del screening gana una clave de
 *     consolidación propia (no toca company_core_name, que arriesgaba fusionar
 *     empresas) y localidad por señal de CONTACTO, no de casa matriz.
 *
 * Migraciones: de las 30 que entraron esta semana, 11 tienen confirmación
 * EXPLÍCITA de aplicación contra producción en el propio mensaje de commit (la
 * mayoría vía el patrón de renombre: CLAUDE.md exige que el nombre coincida con
 * la versión que asignó la base, así que un archivo renombrado post-commit es
 * un archivo aplicado). Las otras 19 —entre ellas TODA la maquinaria de
 * identidad de contactos (capa 2) y las 4 migraciones de Fase 0 del ETL— no
 * tienen esa confirmación y quedan marcadas "no aplicada / sin confirmar" en
 * vez de asumidas.
 *
 * Idempotente: correrlo dos veces deja el mismo resultado (mismo md5sum).
 *
 * Correr:  node scripts/update-architecture-map-2026-09-07.mjs
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
/** Inserta un nodo despues de otro, sin duplicar si ya existe. */
const addNodeAfter = (afterId, n) => {
  if (j.nodes.some((x) => x.id === n.id)) {
    Object.assign(node(n.id), n)
    return
  }
  const at = j.nodes.findIndex((x) => x.id === afterId)
  if (at < 0) throw new Error(`addNodeAfter: nodo de referencia inexistente: ${afterId}`)
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
/** Concatena un agregado a un campo de texto, IDEMPOTENTE: si el texto ya
 * termina con este agregado (de una corrida anterior), no lo vuelve a sumar. */
const appendOnce = (current, addition) => {
  const base = current ?? ""
  return base.includes(addition) ? base : `${base} ${addition}`.trim()
}

// ═══════════════════════════════════════════════════════════════════════════
// meta
// ═══════════════════════════════════════════════════════════════════════════
j.meta.generatedAt = "2026-09-07"
j.meta.summary =
  "Monorepo Next.js único donde conviven ASCI v2 (producción, schema public) y ASCI v3 (multitenant, schema v3) sobre la MISMA base Supabase. El aislamiento es por schema, no por proyecto ni por base. " +
  "Actualización 2026-09-07, repaso de los 72 commits que entraron desde el 24-ago (52 en un solo día: fue la sesión más densa del proyecto). Por orden de peso: " +
  "(1) APOLLO DE PUNTA A PUNTA — el enrichment de organizaciones deja de descartar ~40 campos y de congelarse por strings vacíos, su costo pasa de asumido en 0 a medido; DOS crons nuevos drenan colas sembradas (v3-apollo-org-enrichment sobre 61.300 empresas con website, v3-apollo-domain-lookup sobre el 88% del catálogo que no tiene website y por eso nunca entraba); el costo de Apify por corrida se instrumenta en v3.apify_runs; y el camino de TELÉFONOS POR MCP, que el mapa anterior daba por removido, se abre: backfill del cache compartido, el webhook de Apollo aprende a escribir en v3, y phone_status se unifica al vocabulario de v2 (el que habla el webhook). " +
  "(2) MCP ADMIN — cuarto servidor MCP (/api/v3/mcp/admin), perfil sin topes de plan para el equipo de ASCI, en 4 fases: flag unrestricted + workspace admin declarado, get_cost_summary con la calidad de cada número (measured/estimated/unavailable, nunca cero donde no se sabe), y el server admin comparte la MISMA registración de 45 tools que el standard vía un factory — resuelve OPT-07 para ese par, aunque Explore y Perfiles lo siguen sin. El batchPlanHash pasa a autorizar créditos de Apollo por lote. " +
  "(3) LA FASE 3 DEL PLAN DE EJECUCIÓN DIRECTA, ausente del mapa anterior pese a ser del 24-ago: screen_account_list (cruza una lista contra el diccionario en una llamada), estimate_batch + create_batch_job (cotizar y ejecutar un lote con una sola confirmación) y create_export (primer entregable como ARCHIVO). " +
  "(4) IDENTIDAD — capa 1: una señal es (empresa, entrada de diccionario, persona resuelta), no una fila de signals (lib/shared/canonical-signals.ts). Capa 2: contact_identities + resolve_contact_id() + merge_contacts(), con veto de perfiles discordantes (email accept-all, teléfono de empresa, sufijo de LinkedIn distinto no fusionan) — maquinaria INSTALADA por migración pero NO aplicada a producción, a decisión del dueño. Aparte: 25.056 vacantes (58% del total activo) recuperaron su fecha real de publicación, que hasta ahora era la fecha de carga. " +
  "(5) DICCIONARIO — tres ejes de taxonomía (vendor/categoría/ciclo de vida) y keywords con co-ocurrencia (contexto y exclusión) para las que son nombre de producto Y palabra común. El matching del screening gana clave de consolidación propia y localidad por señal de contacto en vez de casa matriz. " +
  "(6) RE-VERIFICACIÓN: de las optimizaciones y código muerto abiertos al 24-ago, uno se cerró solo (dictionary_term_suggestions ahora tiene escritor), uno empeoró en el conteo (OPT-06, aunque 2 de los 4 archivos nuevos ya estaban sin contar antes) y uno quedó con evidencia obsoleta (OPT-13 citaba un archivo que ya no existe). " +
  "(7) TABLAS: consultado information_schema vía MCP de Supabase (proyecto asciv2-database) el 07-sep-2026: public tiene 58 tablas base (era 55) y v3 tiene 68 (era 53, +15 — de ahí salen las cinco tablas de screening/lote/export, las dos colas de Apollo, apify_runs, contact_identities y contact_merges, entre otras de esta misma tanda)."
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
// (1) MCP ADMIN — server nuevo sobre una sola registración de tools
// ═══════════════════════════════════════════════════════════════════════════
const mcpServer = node("api_mcp_server")
mcpServer.label = "MCP estándar (45 tools)"
mcpServer.desc =
  "El PRIMERO de los cuatro servidores MCP, y el único que conversa con las señales ya interpretadas por el diccionario junto con MCP admin, que comparte sus tools. Desde el 26-ago la ruta es un wrapper de 33 líneas: registra sus INSTRUCTIONS propias y delega servidor, tools, auth y auditoría a createV3McpHandler(perfil='standard') en lib/v3/mcp-server-tools.ts. Scope base companies:read / signals:read / accounts:read."
mcpServer.files = ["app/api/v3/mcp/server/[transport]/route.ts", "lib/v3/mcp-server-tools.ts"]
mcpServer.risk =
  "Ya no es una ruta monolítica: el bloque de transporte/auth/cuota se extrajo a createV3McpHandler y lo comparten standard y admin (ver OPT-07, AVANZÓ). Sigue siendo grande el ARCHIVO de tools (lib/v3/mcp-server-tools.ts, ~680 líneas): registra las 45 en un solo módulo."
mcpServer.notes =
  "Conteo real al 27-ago-2026: 45 registraciones de server.tool( en lib/v3/mcp-server-tools.ts (verificado con dos métodos — grep de línea y un regex que sigue las llamadas multilínea — y sin nombres duplicados). El comentario del propio archivo dice '44 tools': quedó desactualizado, es un hallazgo nuevo para code review, no se corrige acá porque el mapa no toca código de la app."

addNodeAfter("api_mcp_server", {
  id: "api_mcp_admin",
  label: "MCP admin (mismas 45 tools)",
  zone: "v3",
  layer: 2,
  kind: "mcp",
  desc:
    "CUARTO servidor MCP, agregado el 26-ago-2026 (Fase C). Registra EXACTAMENTE las mismas 45 tools que el standard —createV3McpHandler(perfil='admin') sobre el mismo lib/v3/mcp-server-tools.ts— y sólo cambia texto: sus propias INSTRUCTIONS y nueve reglas find/replace de ADMIN_DESCRIPTION_RULES ('la cuenta tiene que estar guardada' y 'pedí confirmación porque consume cupo' no aplican en admin). Apollo conserva su confirmación entera —crédito de tercero, irreversible— y remove_workspace_account / confirm_document_analysis también, por destructivas.",
  files: ["app/api/v3/mcp/admin/[transport]/route.ts", "lib/v3/mcp-server-tools.ts", "lib/v3/admin-workspace.ts"],
  risk:
    "Perfil sin topes de plan. El acceso NO lo da conocer la URL: createV3McpHandler rechaza en el handshake (y lo LOGUEA, con workspace/usuario/motivo) cualquier credencial sin el marcador `unrestricted`. Una key admin se emite solo desde el panel, solo por un superadmin GLOBAL (el canManage de workspace no alcanza) y solo hacia el workspace declarado en ASCI_ADMIN_WORKSPACE_ID; sin esa variable el módulo falla CERRADO. El workspace admin pierde su cap de plan a cambio: v3-refresh-accounts, followedCap y el cupo mensual de research no aplican ahí (lib/v3/admin-workspace.ts declara la excepción en un solo lugar).",
  notes:
    "Usable desde un conector OAuth de claude.ai desde el 26-ago: la rama OAuth de validateMcpRequest devolvía `unrestricted: false` literal (los scopes de un token OAuth salen del consentimiento del usuario, y derivar el marcador de ahí sería dejar que un consentimiento manipulado emita una credencial sin topes), así que el conector completaba el OAuth y tools/list devolvía 401 sin error visible ('este conector no tiene herramientas disponibles'). Ahora sale de dos hechos del SERVIDOR que el cliente no puede tocar: el workspace guardado en la fila del token y el rol global en profiles.",
})

const mcpAuth = node("svc_v3_mcp_auth")
mcpAuth.label = "Auth MCP"
mcpAuth.desc =
  "OAuth, API keys y resolución de acceso/plan por request, para los CUATRO servidores MCP (standard, admin, Explore, Perfiles). Cada uno tiene su tipo de key y su scope; el consentimiento OAuth los ofrece por separado. El marcador `unrestricted` que habilita el perfil admin se resuelve acá, nunca desde los scopes del token."
mcpAuth.files = ["lib/v3/mcp-auth.ts", "lib/v3/mcp-oauth.ts", "lib/v3/api-key-access.ts", "lib/v3/admin-workspace.ts"]
mcpAuth.notes =
  "Dos bugs del mismo origen, corregidos el 13-ago: explore:read y profiles:read existían como scope de API key pero NO en el catálogo OAuth, así que sanitizeScopes los descartaba. La lección: el catálogo OAuth y el de API keys son dos listas y hay que tocar las dos. El mismo tipo de bug volvió el 26-ago con `unrestricted`: no es un scope, es un hecho del servidor (workspace + rol global), y dejarlo derivar de los scopes de un token OAuth habría sido la puerta de entrada."

addEdge({ id: "e193", from: "ext_mcp_client", to: "api_mcp_admin", kind: "call", label: "tool call (unrestricted)" })
addEdge({ id: "e194", from: "api_mcp_admin", to: "svc_v3_mcp_auth", kind: "call", label: "rechaza sin marcador unrestricted" })
addEdge({ id: "e195", from: "api_mcp_admin", to: "svc_v3_usage", kind: "call", label: "auditoría, sin bloqueo" })

opt("OPT-07").title = "AVANZÓ: el factory ya existe para standard+admin; Explore y Perfiles lo siguen sin"
opt("OPT-07").finding =
  "El patrón se replicó una tercera vez (MCP admin, 26-ago) pero esta vez NO se copió el andamiaje: createV3McpHandler({profile, basePath, instructions}) en lib/v3/mcp-server-tools.ts es exactamente el factory que este hallazgo pedía, y standard + admin lo comparten — mismo transporte, misma auth, misma auditoría, mismas 45 tools, y solo cambian instructions + 9 reglas de reemplazo de texto. Lo que NO se resolvió: Explore (8 tools) y Perfiles (3 tools) siguen con su propia copia completa del bloque (createMcpHandler + withMcpAuth + el mapa de nextAction), sin usar el factory."
opt("OPT-07").fix =
  "Extender createV3McpHandler (o un factory hermano) para que Explore y Perfiles lo usen también. El caso standard+admin ya demuestra que el ahorro es real: NUEVE frases de instructions en vez de duplicar ~650 líneas de registro de tools."

opt("OPT-06").title = "17 archivos instancian createClient crudo y saltean los helpers de Supabase"
opt("OPT-06").evidence = [
  "17 archivos con import de @supabase/supabase-js fuera de lib/supabase/ (medido 07-sep-2026)",
  "app/actions/dictionary.ts, 7 rutas de cron (2 nuevas: v3-apollo-org-enrichment, v3-apollo-domain-lookup), app/api/ingest/upload, app/api/landing-stats, app/api/v3/admin/normalize-country-phase5, components/v3/navbar.tsx, lib/apollo/{domain-lookup-runner,company-writer,org-enrichment-runner}.ts, lib/v3/services/account-brief-row.ts",
]
opt("OPT-06").finding =
  "Sube de 13 a 17, pero la mitad del salto no es código nuevo: normalize-country-phase5/route.ts y account-brief-row.ts YA estaban en el 24-ago y el conteo anterior los pasó por alto (verificado leyendo esos dos archivos en el commit 1a7ee0c: ya importaban @supabase/supabase-js). Lo que sí es nuevo esta semana son 5 archivos: los dos crons de Apollo (org-enrichment, domain-lookup) y sus tres módulos de soporte en lib/apollo/. El patrón sigue disponible y nada lo impide — cada cron nuevo lo reproduce por costumbre, no por necesidad."

// ═══════════════════════════════════════════════════════════════════════════
// (2) Fase 3 del plan de ejecución directa: screening, cotización, lote, export
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_v3_capability", {
  id: "svc_v3_screening",
  label: "Screening, cotización y lote",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "El circuito screen_account_list → estimate_batch → create_batch_job → get_batch_job, agregado el 24-ago (Fase 3) y sin nodo en el mapa anterior. screen_account_list cruza UNA LISTA de nombres contra uno o varios términos en una sola llamada (matched / matched_no_signal / no_match / matched_ambiguous) y PERSISTE el resultado con un screeningId, que es lo que create_export necesita: las filas no viajan dos veces por la conversación. estimate_batch cotiza los cuatro medidores juntos (lugares del plan, unidades de research, créditos de Apollo, costo USD) SIN gastar nada y devuelve un batchPlanHash que congela cuentas y roles por 1 hora. create_batch_job lo ejecuta: guarda las cuentas y lanza el research de todas de una vez, es IDEMPOTENTE por batchPlanHash, y se reanuda solo vía el watchdog si algo queda colgado.",
  files: [
    "lib/v3/services/screen-account-list.ts",
    "lib/v3/services/mcp-batch-estimate.ts",
    "lib/v3/services/mcp-batch-job.ts",
    "lib/v3/services/mcp-export.ts",
  ],
  notes:
    "El costo en USD de estimate_batch sale de telemetría real (ai_usage_log de los últimos 90 días, agrupado por research_job_id, NUNCA por fila: una fila subestima). Sin telemetría suficiente devuelve null y lo dice — un número inventado en una pantalla de autorización es peor que no tener número. La clave de consolidación del screening es propia (public.company_screen_key, calculada al vuelo): endurecer company_core_name se descartó porque de esa función depende auto_merge_safe_duplicates, y aflojarla fusionaría empresas hoy separadas sobre 517.326 filas sin vuelta atrás. La localidad del screening compara contra el país del CONTACTO, no de la casa matriz (rescata MAPFRE, SURA, Principal Financial, antes excluidas por figurar la matriz en otro país).",
  risk:
    "create_export es la única de las 45 tools que entrega un ARCHIVO (xlsx/csv, URL firmada de 24h) en vez de transcribir la tabla al chat. Antes de esto un reporte de 61 o 139 cuentas se transportaba entero como texto: ~20k-40k tokens y con 139 cuentas ya no entraba en el canal.",
})
addEdge({ id: "e196", from: "api_mcp_server", to: "svc_v3_screening", kind: "call" })
addEdge({ id: "e197", from: "api_mcp_admin", to: "svc_v3_screening", kind: "call", label: "batchPlanHash autoriza Apollo" })
addEdge({ id: "e198", from: "svc_v3_screening", to: "db_dictionary", kind: "read" })
addEdge({ id: "e199", from: "svc_v3_screening", to: "db_companies", kind: "read", label: "company_screen_key + localidad por contacto" })

addNodeAfter("db_scorecards", {
  id: "db_mcp_batch",
  label: "v3.mcp_screenings / mcp_exports / mcp_batch_jobs / mcp_batch_plans",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc:
    "El estado persistido del circuito screening → export → lote: mcp_screenings guarda el resultado de screen_account_list (de ahí sale screeningId), mcp_exports referencia el archivo en el bucket privado workspace-exports, mcp_batch_plans congela lo que estimate_batch cotizó (batchPlanHash, 1h de vigencia) y mcp_batch_jobs/mcp_batch_job_items el lote ya confirmado, con enrichment_credits_authorized para el presupuesto de Apollo por lote.",
  tables: ["v3.mcp_screenings", "v3.mcp_exports", "v3.mcp_batch_plans", "v3.mcp_batch_jobs", "v3.mcp_batch_job_items"],
  files: [
    "supabase/migrations/20260824210819_mcp_batch_plans.sql",
    "supabase/migrations/20260825015932_mcp_screenings_and_exports.sql",
    "supabase/migrations/20260825020834_mcp_batch_jobs.sql",
    "supabase/migrations/20260826191459_apollo_en_el_batch_plan_hash.sql",
  ],
  notes:
    "Las cuatro migraciones base están APLICADAS a producción (confirmado: los archivos fueron renombrados a la versión que asignó la base, patrón que exige CLAUDE.md). El índice único (workspace_id, batch_plan_hash) es lo que hace idempotente a create_batch_job: un reintento devuelve el lote que ya existe.",
})
addEdge({ id: "e200", from: "svc_v3_screening", to: "db_mcp_batch", kind: "rw" })

const icebreakers = node("svc_v3_icebreakers")
icebreakers.desc =
  "Dos caminos. build_evidence_icebreaker (24-ago, Fase 3) es DETERMINÍSTICO: cita la evidencia con un template, cuesta cero, no llama a ningún modelo y por eso no puede inventar una tecnología que la cuenta no tenga. Por default habla del EQUIPO, no de una persona ('en el equipo varios perfiles mencionan X'); nombrar a alguien es opt-in y trae aviso legal (Ley 19.628/21.719 en Chile, GDPR si hay matriz europea). Si toda la evidencia es de ex-empleados, no escribe el mensaje. generate_account_icebreaker sigue siendo el camino con IA, para tono o síntesis de varias señales, y consume cupo."
icebreakers.files = [
  "lib/v3/services/icebreakers.ts",
  "lib/v3/services/icebreaker-deterministic.ts",
  "lib/v3/services/icebreaker-register.ts",
  "lib/v3/services/icebreaker-template.ts",
]
icebreakers.notes =
  "El prompt de generate_account_icebreaker contenía el texto de terceros (el campo `about` de un perfil) directo interpolado: alcanzaba con instrucciones ahí para hablarle al modelo. Ahora va en un bloque de datos con la regla por delante y se le sacan los caracteres invisibles (vehículo clásico de inyección). No intenta detectar intención — un blocklist de frases es una carrera que se pierde —, la mitigación de fondo es que el camino determinístico no llama a ningún modelo."

// ═══════════════════════════════════════════════════════════════════════════
// (3) APOLLO — costo real, organizations/enrich completo, dominio por nombre
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_apollo", {
  id: "svc_apollo_enrichment",
  label: "Apollo: enrichment de organizaciones",
  zone: "v2",
  layer: 3,
  kind: "service",
  desc:
    "Aprovecha organizations/enrich y organizations/bulk_enrich al completo: Apollo devuelve ~45 campos por empresa y v2 solo persistía 5 (website, industry, employee_count, city, country). Ahora también se guardan tecnologías (tope 500, sin truncar en silencio), facturación (organization_revenue, que cubre el doble que annual_revenue y nunca difiere cuando ambos existen), año de fundación, dotación por área (departmental_head_count — el dato con más valor comercial: 60 de 134 empresas medidas tienen equipo de IT de 20+ personas), industrias múltiples, teléfono, códigos SIC/NAICS y el par de LinkedIn (linkedin_uid + linkedin_company_id, con reintento sin ese campo si colisiona el UNIQUE). Precedencia: columnas apollo_* siempre; columnas genéricas de companies solo si están vacías; industry y is_public/ticker NUNCA se tocan (taxonomías y pipelines distintos).",
  files: [
    "lib/apollo/company-writer.ts",
    "lib/apollo/bulk-organizations.ts",
    "lib/apollo/parsers.ts",
    "lib/apollo/rate-limits.ts",
    "lib/apollo/usage-stats.ts",
    "scripts/460_apollo_org_enrichment.mjs",
  ],
  risk:
    "El costo se asumía en 0 ('enrich no consume créditos') y era falso: Apollo cobra 1 crédito por cuenta RESUELTA (no por request — un bulk_enrich de 10 dominios que matchea 6 cuesta 6, y eso no se sabe antes de llamar). El ledger de apollo_api_calls estuvo ciego a este gasto desde siempre; se corrigió y se hizo backfill del histórico (135 créditos que estaban registrados en 0). String vacío ('') congelaba el enrichment para siempre en 60-66 mil filas por columna (website/industry/country): COALESCE no trata '' como NULL, así que ni Apollo ni LinkedIn podían completarlas nunca. Se normalizan a NULL.",
  notes:
    "hasEnrichment (no solo 'tiene apollo_organization_id') es la guarda del cache-hit desde el 26-ago: guardar el id sin el resto del payload dejaba 63 empresas pagas y vacías que el descubrimiento de decisores visitaba una y otra vez sin completarlas nunca. bulk_enrich no manda technology_names (organizations/enrich simple sí), así que la guarda acepta cualquiera de los campos ricos, no solo tecnologías. prepare_contact_enrichment tenía su PROPIO atajo que leía apollo_organization_id directo y cortocircuitaba antes de llegar a esta guarda: el fix estaba en la capa correcta pero en el camino equivocado, y hubo que aplicarlo dos veces (49ebc38, 87c1b8b).",
})
addNodeAfter("svc_apollo_enrichment", {
  id: "svc_apollo_domain_lookup",
  label: "Apollo: dominio por nombre",
  zone: "v2",
  layer: 3,
  kind: "service",
  desc:
    "420.753 companies (el 88% del catálogo activo) no tienen website y por eso NUNCA entran a Apollo: enrich y bulk_enrich reciben dominios, no nombres. Este cron resuelve el dominio con organizations/search (endpoint GRATUITO), de a 350 llamadas/hora sobre una cuota de 400. Solo se promueve a companies.website lo clasificado auto_ok, y solo sobre columnas vacías: un match difuso con un token geográfico presente de un solo lado baja a 'revisar' aunque el score sea alto.",
  files: ["lib/apollo/domain-lookup.ts", "lib/apollo/domain-lookup-runner.ts", "scripts/470_apollo_domain_lookup.mjs"],
  notes:
    "Corrige de paso la documentación interna que decía que organizations/enrich era gratis: cuesta 1 crédito por empresa resuelta, igual que el simple.",
})
addEdge({ id: "e201", from: "cron_v3_apollo_org_enrichment", to: "svc_apollo_enrichment", kind: "call" })
addEdge({ id: "e202", from: "svc_apollo_enrichment", to: "ext_apollo", kind: "call", label: "organizations/enrich + bulk_enrich" })
addEdge({ id: "e203", from: "svc_apollo_enrichment", to: "db_companies", kind: "write", label: "solo columnas vacías, namespace apollo_*" })
addEdge({ id: "e204", from: "cron_v3_apollo_domain_lookup", to: "svc_apollo_domain_lookup", kind: "call" })
addEdge({ id: "e205", from: "svc_apollo_domain_lookup", to: "ext_apollo", kind: "call", label: "organizations/search (gratis)" })
addEdge({ id: "e206", from: "svc_apollo_domain_lookup", to: "db_companies", kind: "write", label: "solo auto_ok, columnas vacías" })

addNodeAfter("cron_v3_enrich_linkedin", {
  id: "cron_v3_apollo_org_enrichment",
  label: "cron v3-apollo-org-enrichment (10m)",
  zone: "v2",
  layer: 2,
  kind: "cron",
  desc:
    "Drena v3.apollo_company_enrichment (status='pending'), sembrada aparte y NUNCA descubierta por el cron: barrer las ~61.300 empresas con website sin resolver son ~38.000 créditos, una decisión de gasto que no le corresponde a un cron. Con la cola vacía la corrida no llama a Apollo y gasta cero.",
  files: ["app/api/cron/v3-apollo-org-enrichment/route.ts"],
  notes:
    "El payload se empareja con la empresa POR POSICIÓN, no por dominio (Apollo puede contestar arcor.com a un pedido de arcor.com.ar). Lock con lease, igual que process-queue. Un lote que falla se reprograma ENTERO a 30 minutos, nunca al toque: no se sabe qué dominio llegó a resolverse y cobrar dos veces es peor que esperar. MAX_ATTEMPTS=3, tras lo cual la fila queda 'failed' terminal — sin tope, una fila que falla siempre (constraint, parser) pedía un crédito por vuelta, para siempre.",
})
addNodeAfter("cron_v3_apollo_org_enrichment", {
  id: "cron_v3_apollo_domain_lookup",
  label: "cron v3-apollo-domain-lookup (10m)",
  zone: "v2",
  layer: 2,
  kind: "cron",
  desc: "Drena v3.apollo_domain_lookup, sembrada aparte, resolviendo dominio por nombre para el 88% del catálogo sin website.",
  files: ["app/api/cron/v3-apollo-domain-lookup/route.ts"],
})

addNodeAfter("db_linkedin_enrichment", {
  id: "db_apollo_org_queues",
  label: "v3.apollo_company_enrichment / apollo_domain_lookup",
  zone: "v2",
  layer: 4,
  kind: "table",
  desc:
    "Las dos colas SEMBRADAS que drenan los crons nuevos de Apollo. apollo_company_enrichment guarda el checkpoint del payload crudo de organizations/enrich (normalizado a una sola forma con unwrapOrganization, porque enrich simple y bulk responden distinto). apollo_domain_lookup guarda el resultado de organizations/search por nombre, con su clasificación (auto_ok / revisar / sin_match).",
  tables: ["v3.apollo_company_enrichment", "v3.apollo_domain_lookup"],
  files: [
    "supabase/migrations/20260826120000_apollo_enrichment_columnas_y_checkpoint.sql",
    "supabase/migrations/20260827205412_checkpoint_de_dominio_por_nombre.sql",
  ],
  notes: "El trabajo se SIEMBRA, no se descubre: ningún cron sale a buscar candidatas por su cuenta. Autorizar un lote nuevo es un INSERT explícito.",
})
addEdge({ id: "e207", from: "cron_v3_apollo_org_enrichment", to: "db_apollo_org_queues", kind: "rw" })
addEdge({ id: "e208", from: "cron_v3_apollo_domain_lookup", to: "db_apollo_org_queues", kind: "rw" })

addNodeAfter("db_apollo_org_queues", {
  id: "db_spend_ledger",
  label: "v3.apify_runs",
  zone: "shared",
  layer: 4,
  kind: "table",
  desc:
    "Una fila por corrida de Apify (26-ago), única fuente del costo real de scraping: cubre los CUATRO orígenes que existían sin instrumentar (cron de primera pasada, mensual, kick de la UI y explore). usageTotalUsd sale de /v2/actor-runs/{runId}, que el cliente ya pedía en cada poll y descartaba. NO incluye el alquiler mensual fijo del actor (US$29,99) y no se prorratea: se reporta el costo marginal y se declara qué falta.",
  tables: ["v3.apify_runs"],
  files: ["lib/v3/services/spend-ledger.ts", "supabase/migrations/20260826203230_ledger_de_gasto_por_empresa.sql"],
  notes:
    "La unidad de atribución es la EMPRESA, no el usuario: el cron deduplica por empresa entre workspaces, así que una corrida sirve a todos los que siguen esa cuenta y el userId del batch es arbitrario (el primer seguidor). Migración APLICADA y verificada en producción (26-ago).",
})
addEdge({ id: "e209", from: "cron_v3_scrape_jobs", to: "db_spend_ledger", kind: "write" })
addEdge({ id: "e210", from: "svc_v3_explore", to: "db_spend_ledger", kind: "write" })

addNodeAfter("svc_v3_scoring", {
  id: "svc_v3_mcp_cost",
  label: "Costo por lote (get_cost_summary)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "Suma tres tablas de telemetría que ya existían y nadie leía juntas (cost_usd del AI Gateway por research_job_id, credits_spent de Apollo por corrida, v3.apify_runs) atadas a un lote por research_job_id / enrichment_plan_hash / batch_job_id. Cada número declara su calidad: measured (el AI Gateway cobró eso), estimated (cantidad real, precio contratado — Apollo: créditos × US$0,01), unavailable (Apify hoy, si el run no trajo su usageTotalUsd). El costo de Apify viaja en null, NUNCA en 0: cero es 'no gastó', null es 'no sabemos', y confundirlos subreporta.",
  files: ["lib/v3/services/mcp-cost-summary.ts", "lib/v3/services/spend-ledger.ts"],
  notes:
    "totalIsPartial se marca y nombra lo que falta cuando hay scraping sin costo conocido: un total parcial presentado como total es un número falso, y este número le pone precio a un informe. setReservationStatus PISABA el metadata en vez de mezclarlo (se perdía silenciosamente el batchJobId de atribución); ahora mezcla, con un discriminador kind:'research'|'job_scrape' explícito porque research y scraping comparten el mismo pool de reservas.",
})
addEdge({ id: "e211", from: "api_mcp_admin", to: "svc_v3_mcp_cost", kind: "call", label: "get_cost_summary, cierre de todo informe" })
addEdge({ id: "e212", from: "svc_v3_mcp_cost", to: "db_ai_usage", kind: "read" })
addEdge({ id: "e213", from: "svc_v3_mcp_cost", to: "db_spend_ledger", kind: "read" })
addEdge({ id: "e214", from: "svc_v3_mcp_cost", to: "db_mcp_batch", kind: "read", label: "presupuesto autorizado vs gastado" })

const plans = node("svc_v3_workspace")
plans.files = ["lib/v3/workspace.ts", "lib/v3/invitations.ts", "lib/v3/plans.ts", "lib/v3/plan-config.ts", "lib/v3/request-auth.ts", "lib/v3/admin-workspace.ts"]
plans.notes = appendOnce(
  plans.notes,
  "El precio de Apollo (1.000 créditos = US$10, o sea US$0,01/crédito) vive en plan-config.ts, puro, para que get_cost_summary lo lea sin depender de que Apify exponga el suyo. admin-workspace.ts (26-ago) declara en un solo lugar la excepción completa del workspace admin: qué deja de aplicar (cron mensual, topes de cuenta y cupo) y qué sigue aplicando igual (confirmación de Apollo, y TODO el registro — la regla del perfil es 'sin bloqueo', nunca 'sin medición').",
)

// ═══════════════════════════════════════════════════════════════════════════
// (3b) APOLLO — teléfonos por MCP: el camino que el mapa anterior daba por cerrado
// ═══════════════════════════════════════════════════════════════════════════
const sharedDM = node("svc_shared_apollo_dm")
sharedDM.notes =
  sharedDM.notes.replace(
    "El reveal de teléfono sigue removido: Apollo consumía 5 créditos por reveal y el webhook de entrega asincrónica nunca llegaba.",
    "DESACTUALIZADO desde el 27-ago: el reveal de teléfono existe por DOS caminos separados de éste — la UI de v2 (app/actions/apollo.ts, atada a la sesión y a user_company_contacts) y la tool request_contact_phones del MCP v3 (ver svc_v3_contact_phones). Este pipeline compartido (búsqueda de decisores) sigue sin pedir teléfonos: son productos distintos con costos distintos (1 crédito el email, 5 el teléfono).",
  )

addNodeAfter("svc_shared_apollo_dm", {
  id: "svc_v3_contact_phones",
  label: "Teléfonos por MCP",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "request_contact_phones (tool nueva, 27-ago): pide el reveal de teléfono de Apollo para los contactos de una cuenta y NO espera — el reveal es asíncrono y entrega el 57% de las veces (80 de 141 medidos), así que esperar bloquearía la conversación por algo que la mitad de las veces no llega. Los números se leen después con get_company_contacts (hasPhone, phoneStatus, frescura). Solo se pide para contacto con email VERIFICADO y cargo que matchea (5 créditos contra 1 del email: se paga por los que ya probaron ser los correctos). No se pide a quien ya tiene el número (caché compartido) ni a quien tiene un pedido en curso — ambos ANTES que los motivos de calificación, porque responden 'por qué no se gastó'.",
  files: ["lib/v3/services/mcp-contact-phones.ts", "lib/v3/services/contact-phone-inbox.ts", "lib/shared/phone-status.ts"],
  risk:
    "Se falla ANTES de gastar si falta NEXT_PUBLIC_SITE_URL o APOLLO_WEBHOOK_SECRET: sin webhook alcanzable, Apollo cobra igual y el número nunca vuelve — es el único error de configuración de todo el sistema que cuesta plata directamente. `pending` se marca antes de llamar y se revierte si Apollo no acepta el pedido.",
  notes:
    "phone_status pasó a UN SOLO vocabulario el 27-ago: ganó el de v2 (not_requested/pending/received/not_available), porque es el que está en producción con 5.148 filas y el que HABLA el webhook de Apollo, la única pieza que ninguna plataforma controla. v3.account_contacts tenía su propio CHECK (unknown/processing/available/unavailable/failed) y sólo 'not_requested' coincidía con v2 — la misma forma exacta de bug que ya rompió el enrichment una vez con role_origin:'mcp_enrichment'. La fuente única es lib/shared/phone-status.ts, con el mapeo de palabras viejas escrito dos veces a propósito (ahí y en el CASE de la migración) y un test que verifica que no diverjan. El webhook de Apollo (api_apollo_webhook) llama a contact-phone-inbox.ts en UN punto antes de sus tres salidas: el número va al caché COMPARTIDO (apollo_contacts_cache), el estado a v3.account_contacts — nunca a la fila del usuario, porque en v3 eso duplicaría el teléfono por workspace.",
})
addEdge({ id: "e215", from: "api_mcp_admin", to: "svc_v3_contact_phones", kind: "call", label: "request_contact_phones" })
addEdge({ id: "e216", from: "api_mcp_server", to: "svc_v3_contact_phones", kind: "call" })
addEdge({ id: "e217", from: "svc_v3_contact_phones", to: "ext_apollo", kind: "call", label: "reveal asíncrono, entrega 57%" })
addEdge({ id: "e218", from: "svc_v3_contact_phones", to: "db_apollo_cache", kind: "read", label: "revisa cache ANTES de pedir" })
addEdge({ id: "e219", from: "api_apollo_webhook", to: "svc_v3_contact_phones", kind: "call", label: "un punto antes de las 3 salidas" })
addEdge({ id: "e220", from: "svc_v3_contact_phones", to: "db_account_contacts", kind: "write", label: "estado solo en filas pending del pedidor" })

const apolloWebhook = node("api_apollo_webhook")
apolloWebhook.desc =
  "Callback de Apollo autenticado por secreto en el path. Desde el 27-ago también sabe escribir en el camino v3 (contact-phone-inbox.ts): antes solo conocía public.user_company_contacts (la tabla de la UI v2), y un teléfono pedido desde el MCP de v3 no tenía dónde aterrizar. Nunca tira: Apollo reintenta ante cualquier error y un reintento no recupera el crédito, así que el handler atrapa todo y sigue devolviendo 200 (el resultado real viaja en el log y en las respuestas)."

const apolloCache = node("db_apollo_cache")
apolloCache.desc =
  "Cache de Apollo por hash de query. Dejó de ser sólo de v2 el 21-ago (v3 también escribe al buscar decisores) y desde el 27-ago tiene TELÉFONOS reales: backfill de los 80 que v2 ya había pagado (65 móvil, 15 fijo; 0 personas de v2 sin espejo en el cache, medido antes y después contra producción dentro de una transacción revertida) más lo que aporta el webhook a partir de ahora."
apolloCache.notes =
  "Está indexado por dominio de la empresa, no por companyId. Es cache legacy sólo de nombre: es la tabla que lee getCompanyCachedContacts de v3. Solo se llena la columna de teléfono si está vacía — un número cargado a mano vale más que uno de Apollo — y el UPDATE excluye filas sin nada real que escribir, para no rejuvenecer updated_at sin motivo (splitByContactCache lo usa para decidir frescura)."

// ═══════════════════════════════════════════════════════════════════════════
// (4) IDENTIDAD — capa 1 (señal canónica) y capa 2 (identidad de contacto)
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_shared_evidence", {
  id: "svc_shared_identity",
  label: "Identidad canónica (señal + persona)",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc:
    "Capa 1 (24-ago): define la unidad canónica que leen v2 y v3 — una SEÑAL es (empresa, entrada de diccionario, persona resuelta), no una fila de `signals`. Antes 'Microsoft Intune' y 'Intune' del mismo perfil scrapeado dos veces (slug autogenerado vs. vanity URL) contaban como DOS señales y DOS personas. La identidad de persona en lectura resuelve por slug de LinkedIn sin sufijo autogenerado > email > contact_id, siempre con el nombre como guarda — conservador: ante la duda no fusiona, porque mostrar un duplicado es menos grave que fundir dos personas.",
  files: ["lib/shared/canonical-signals.ts", "lib/shared/linkedin-profile.ts"],
  notes:
    "linkedin-profile.ts es la definición única y GEMELA de la lógica SQL de capa 2 (parseo de slug, sufijo autogenerado, URN ofuscado). La usan tanto la unidad canónica de señal como contact-provider.ts (la unión v2/Apollo, que antes deduplicaba con una normalización floja y dejaba pasar el mismo perfil dos veces).",
})
addEdge({ id: "e221", from: "svc_v3_signals", to: "svc_shared_identity", kind: "call", label: "agrupamiento canónico" })
addEdge({ id: "e222", from: "svc_v3_contacts", to: "svc_shared_identity", kind: "call" })

const dbContacts = node("db_contacts")
dbContacts.notes = appendOnce(
  dbContacts.notes,
  "MAQUINARIA DE IDENTIDAD instalada el 25-ago pero NO APLICADA a producción (el propio commit lo dice: 'la aplicación queda a decisión del dueño de proyecto'; sin renombre posterior a versión de base, sin confirmación): contact_identities (todas las formas conocidas de identificar a un contacto, mantenida por trigger — el slug viejo de LinkedIn sigue apuntando al mismo contacto), resolve_contact_id() (slug > sufijo+nombre > email+nombre > teléfono+nombre; ambiguo no resuelve) y merge_contacts() + v3.contact_merges + revert_contact_merge(), reversible. Incluye VETO de perfiles discordantes: un email entra como identidad solo con status 'valid' (se caen 289.151 de 773.930, casi todos accept_all_unverifiable — el caso real: dos 'Alejandro Álvarez' de Falabella con el mismo mail adivinado por patrón, personas DISTINTAS), un teléfono solo con type 'personal' (78% de los teléfonos de la base son de conmutador de empresa), y sufijo de LinkedIn autogenerado discordante no fusiona por evidencia indirecta. El universo de fusión detectado baja de 3.566 a 2.098 grupos con estas reglas.",
)

// ═══════════════════════════════════════════════════════════════════════════
// (4b) job_postings: fechas reales, is_active fuera de lectura
// ═══════════════════════════════════════════════════════════════════════════
const jobPostings = node("db_job_postings")
jobPostings.desc = appendOnce(
  jobPostings.desc,
  "El 58% de las vacantes tenía posted_at = su fecha de CARGA, no de publicación: process_job_batch_internal buscaba la fecha en postedTime/publishedAt/post_date, pero los dos caminos de upload la renombran a posted_at antes de armar el row_data — el COALESCE nunca encontraba nada y caía en now(). 25.056 vacantes (99,6% de las recuperables) se corrigieron con la fecha cruda que el CSV ya traía en source_data (nunca se pisaba); 93 quedaron en NULL por venir de CSVs con columnas corridas. El badge 'Reciente' bajó de 9.376 a 5.338 vacantes tras la corrección.",
)
jobPostings.notes =
  "job_postings.is_active se dejó de LEER en toda consulta (era falso: nunca reflejó si la vacante seguía abierta) — MCP, drawer y exports pasan a describir los conteos como HISTÓRICOS explícitamente, sin ventana de fecha. La columna sigue existiendo, solo se dejó de confiar en ella para lectura."

const jobs = node("svc_v3_jobs")
jobs.risk = appendOnce(
  jobs.risk,
  "Las dos migraciones de fecha (20260825002000_job_posted_at, 20260825003000_job_posted_at_backfill) y las dos de is_active (20260825132651_drawer_job_postings_all_keywords, 20260825141319_job_postings_drop_is_active_reads) están APLICADAS y verificadas — estas últimas dos fueron renombradas a la versión real que asignó la base (patrón CLAUDE.md), confirmando la aplicación.",
)

// ═══════════════════════════════════════════════════════════════════════════
// (4c) el panorama de señales (get_company_signal_summary) deja de ser muestra
// ═══════════════════════════════════════════════════════════════════════════
const signalsV3 = node("svc_v3_signals")
signalsV3.desc = appendOnce(
  signalsV3.desc,
  "Corregido el 27-ago: el pool de candidatas a homónimo (para desambiguar 'Santander Chile' de las 7.153 empresas que matchean 'chile') era un OR de tokens con LIMIT 100 y SIN order by — inestable entre llamadas y ciego a las 31 entidades reales. Pasa a AND de todos los tokens con orden explícito. signalsScanned sube de 100 a 2.000 (cubre el catálogo entero salvo 55 empresas) y viaja un bloque `scan` que declara cuándo el panorama quedó incompleto. detail:'evidence' filtraba por keyword_matched literal mientras el panorama rotulaba por nombre de diccionario — mismatch que hacía que 3 de 4 tecnologías reportadas volvieran sin evidencia al pedir la cita (Oracle Forms era la única donde las dos columnas coincidían).",
)

// ═══════════════════════════════════════════════════════════════════════════
// (5) DICCIONARIO — tres ejes de taxonomía y co-ocurrencia
// ═══════════════════════════════════════════════════════════════════════════
const dbDict = node("db_dictionary")
dbDict.desc = appendOnce(
  dbDict.desc,
  "El 24-ago, dictionary_products ganó DOS ejes nuevos aditivos (categoria, ciclo_vida vigente|legado) sobre el único que tenía (vendor): backfill de 90 productos en 9 categorías, 13 en legado. Los cuatro vendors falsos (Legacy, Backend, Frontend, CMS) se borraron; 15 productos open source quedan con vendor NULL a propósito ('el vendor es quien te lo puede vender'). keywords_contexto (nivel entidad) y keywords_excluye (nivel ocurrencia) resuelven ambigüedad de dominio y de nombre para keywords que son a la vez producto y palabra común ('Fabric', 'Exchange', 'Commerce Cloud'): sin entrada en los mapas, NULL, comportamiento idéntico al de antes. Cinco keywords rescatadas de los siete lotes de limpieza previos, donde se habían borrado por ruido junto con las señales reales que también nombraban (Exchange 4.927→2.238 apariciones, 44/45 correctas en la muestra auditada).",
)

const capability = node("svc_v3_capability")
capability.notes = appendOnce(
  capability.notes,
  "Desde el 24-ago, capability-search.ts suma los niveles 3a (categoría) y 3c (ciclo de vida) de dictionary_products, calcados del bloque de vendor existente: la categoría acepta alias cortos (erp, crm, bi, cloud, seguridad...) porque nadie escribe el nombre completo.",
)

const dictV3 = node("svc_v3_dictionary")
dictV3.desc = appendOnce(
  dictV3.desc,
  "suggestDictionaryTerm ahora tiene ESCRITOR real (jobs-interpreter.ts y radar.ts la llaman): ver DEAD-12, ya no está completamente sin uso.",
)

// ═══════════════════════════════════════════════════════════════════════════
// deadCode: DEAD-12 avanzó, el resto se re-verificó sin cambios
// ═══════════════════════════════════════════════════════════════════════════
const d12 = dead("DEAD-12")
d12.title = "PARCIAL: v3.dictionary_term_suggestions ya tiene escritor; bookmark_dedupe_log sigue sin código que la lea"
d12.evidence = [
  "v3.bookmark_dedupe_log: solo aparece en supabase/migrations/20250101000000_baseline.sql y en scripts/417_bookmark_dedupe_legacy.sql — sin .from() en app/ ni lib/",
  "v3.dictionary_term_suggestions: lib/v3/services/dictionary.ts exporta suggestDictionaryTerm (INSERT/UPDATE), llamada desde lib/v3/services/jobs-interpreter.ts y lib/v3/services/radar.ts",
]
d12.finding =
  "dictionary_term_suggestions dejó de estar completamente huérfana: el ETL de vacantes y el pipeline de radar ya la ESCRIBEN cuando detectan un término candidato fuera del diccionario, con evidencia acumulada (últimas 20 muestras). Sigue sin lector: no hay pantalla de aprobación para super-admin, que es lo que el comentario del código dice que debería existir ('Sugerencias de términos nuevos... aprobables por super-admin'). bookmark_dedupe_log no cambió: sigue sin ningún código de aplicación que la lea o escriba, solo el snapshot histórico de scripts/417."
d12.recommendation =
  "Construir la pantalla de aprobación de dictionary_term_suggestions es ahora more barato que antes: ya hay filas reales acumulándose para probarla contra. bookmark_dedupe_log: confirmar con un conteo de filas si se sigue alimentando desde algún script suelto antes de decidir si se borra."

opt("OPT-13").evidence = [
  "uso de .schema(\"v3\") disperso: 77 archivos (medido 07-sep-2026), sin un helper único",
  "el ejemplo citado antes (app/actions/v3/csv-import.ts) ya NO EXISTE: se borró el 19-ago-2026 (DEAD-01 resuelto) — evidencia obsoleta, se retira",
]
opt("OPT-13").finding =
  "El riesgo de fondo sigue intacto (nada impide que una consulta a v3 olvide .schema('v3') y apunte en silencio a public, donde vive v2 en producción), pero el ejemplo concreto que el mapa citaba ya no está en el repo. No se encontró un caso vivo tan claro de mezcla en el mismo archivo al revisar esta semana; el hallazgo queda sostenido por el conteo (77 sitios dispersos) y no por un ejemplo puntual."

// ═══════════════════════════════════════════════════════════════════════════
// Flujos nuevos
// ═══════════════════════════════════════════════════════════════════════════
addFlow({
  id: "f_batch_admin",
  name: "Lote sin topes con el perfil admin (MCP)",
  version: "v3",
  trigger: "El equipo de ASCI arma una base de cuentas on-demand con una credencial unrestricted",
  desc: "El circuito completo que el perfil admin viene a reemplazar: 42 confirmaciones sueltas por UNA confirmación de lote, con el costo real medido al cierre en vez de un tope mensual que corta a mitad de un informe.",
  steps: [
    { n: 1, nodeId: "ext_mcp_client", edgeId: "e193", detail: "screen_account_list en una llamada sobre la lista pegada por el cliente." },
    { n: 2, nodeId: "svc_v3_screening", edgeId: "e196", detail: "Devuelve screeningId; matched/matched_no_signal/no_match/matched_ambiguous por fila." },
    { n: 3, nodeId: "svc_v3_screening", detail: "estimate_batch cotiza los 4 medidores y devuelve batchPlanHash (vence en 1h). Con unrestricted, monthlyUnits viaja null." },
    { n: 4, nodeId: "db_mcp_batch", edgeId: "e200", detail: "create_batch_job congela enrichment_credits_authorized desde el plan guardado y ejecuta; idempotente por batchPlanHash." },
    { n: 5, nodeId: "svc_v3_mcp_cost", edgeId: "e211", detail: "get_cost_summary cierra el informe: measured/estimated/unavailable por fuente, nunca 0 donde no se sabe." },
  ],
})
addFlow({
  id: "f_contact_phones",
  name: "Pedir teléfonos por MCP",
  version: "v3",
  trigger: "El usuario tiene contactos con email pero sin teléfono en una cuenta guardada",
  desc: "Asíncrono a propósito: Apollo entrega el 57% de las veces, así que la tool no espera y el resultado se lee después.",
  steps: [
    { n: 1, nodeId: "ext_mcp_client", edgeId: "e215", detail: "request_contact_phones(accountId). Filtra a email verificado + cargo que matchea." },
    { n: 2, nodeId: "svc_v3_contact_phones", edgeId: "e218", detail: "Revisa el cache compartido y los pedidos en curso ANTES de calificar por email/cargo: son los que explican '¿por qué no se gastó?'." },
    { n: 3, nodeId: "svc_v3_contact_phones", edgeId: "e217", detail: "Pide el reveal a Apollo (5 créditos c/u) y marca pending. Si Apollo rechaza por permisos, corta el bucle." },
    { n: 4, nodeId: "api_apollo_webhook", edgeId: "e219", detail: "Entrega asíncrona, ~57% de las veces. Escribe el número en el cache compartido y el estado en account_contacts, solo en filas pending del pedidor." },
    { n: 5, nodeId: "ext_mcp_client", detail: "get_company_contacts, en una llamada aparte, lee hasPhone/phoneStatus/frescura ya actualizados." },
  ],
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
if (dupOpts.length) errs.push(`optimizations duplicadas: ${dupOpts.join(", ")}`)
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
