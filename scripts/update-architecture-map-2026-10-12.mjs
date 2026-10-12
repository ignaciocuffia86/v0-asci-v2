/**
 * Actualiza docs/architecture-map.json con lo que entró entre el 24-ago-2026
 * (última pasada, commit 1a7ee0c) y el 12-oct-2026 (origin/main f513468):
 * 80 commits sin merges, PRs #123 a #154 más los commits sueltos de ETL, Apollo
 * y diccionario.
 *
 * SOLO DOCUMENTACIÓN: describe cambios hechos en PRs anteriores. No toca código.
 *
 * Qué cambió en el sistema, por orden de peso, y por qué cada cosa está acá:
 *
 *  1. MCP admin (#136-#147): cuarto servidor MCP, sobre la MISMA registración de
 *     tools que el estándar (lib/v3/mcp-server-tools.ts). Credencial `unrestricted`
 *     emitida sólo por workspace admin + rol superadmin; también por OAuth (#143).
 *     Las tools pasaron de 37 a 45 en el servidor compartido.
 *  2. Lotes MCP con cotización y autorización (#124, #140, #144): estimate_batch,
 *     create_batch_job, get_batch_job, create_export; el batchPlanHash congela un
 *     presupuesto de créditos de Apollo. Tablas v3.mcp_batch_* / mcp_screenings /
 *     mcp_exports.
 *  3. Gasto medido (#138, #142): v3.apify_runs + spend-ledger + get_cost_summary.
 *  4. Apollo: dos colas sembradas (v3.apollo_company_enrichment — cron nuevo en
 *     vercel.json — y v3.apollo_domain_lookup — cron PAUSADO el 08-sep, #154),
 *     chequeo de caché antes de pagar (#149), webhook que aprende el camino v3 y
 *     backfill de teléfonos (#148, #150), ledger que anotaba enrichment en cero.
 *  5. Identidad de datos: núcleo de nombre de empresa, identidad de persona
 *     (contact_identities, fusión reversible), señal = (diccionario, persona),
 *     posted_at real de vacantes, is_active que nunca fue cierto.
 *
 * Se hace por SCRIPT y no con ediciones de texto: son ~4.000 líneas de JSON y una
 * edición de texto ya rompió la estructura una vez (el autofix del editor absorbió
 * `edges` dentro de `nodes`). Idempotente: correrlo dos veces deja el mismo archivo.
 *
 * Correr:  node scripts/update-architecture-map-2026-10-12.mjs
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
const upsert = (arr, x, afterId) => {
  const at = arr.findIndex((y) => y.id === x.id)
  if (at >= 0) { arr[at] = x; return }
  if (afterId) { arr.splice(arr.findIndex((y) => y.id === afterId) + 1, 0, x); return }
  arr.push(x)
}
const addNodeAfter = (afterId, n) => upsert(j.nodes, n, afterId)
const addEdge = (e) => upsert(j.edges, e)
const addFlow = (f) => upsert(j.flows, f)
const addContactPoint = (c) => upsert(j.contactPoints, c)
const addOpt = (o) => upsert(j.optimizations, o)
const addDead = (d) => upsert(j.deadCode, d)
/** Agrega un parrafo a un campo de texto una sola vez (idempotente por marcador). */
const append = (obj, key, marker, text) => {
  if (!(obj[key] ?? "").includes(marker)) obj[key] = (obj[key] ? obj[key] + " " : "") + text
}
const addFile = (n, f) => { n.files = n.files ?? []; if (!n.files.includes(f)) n.files.push(f) }
const reverified = "Re-verificado el 12-oct-2026"
const addEvidence = (o, line) => { o.evidence = o.evidence ?? []; if (!o.evidence.includes(line)) o.evidence.push(line) }

// ═══ meta ═══
const MARK = "Actualización 2026-10-12"
if (!j.meta.summary.includes(MARK)) {
  j.meta.summary +=
    ` ${MARK}, repaso de los 80 commits que entraron desde el 24-ago (PRs #123-#154 y commits sueltos). Por orden de peso: ` +
    "(1) CUARTO MCP, `asci-v3-admin`: comparte con el estándar la MISMA registración de 45 tools (lib/v3/mcp-server-tools.ts) y sólo cambia el texto; el acceso lo da una credencial `unrestricted` que sale del workspace admin + rol superadmin, también por OAuth. " +
    "(2) LOTES CON PRESUPUESTO: estimate_batch → create_batch_job (congela enrichment_credits_authorized en el server) → run; el tope de gasto irreversible de Apollo pasó del mes calendario al lote cotizado. " +
    "(3) GASTO MEDIDO: v3.apify_runs (costo por corrida y origen), spend-ledger y get_cost_summary, donde cada número declara si es measured, estimated o unavailable (Apify null, nunca 0). " +
    "(4) APOLLO: dos colas SEMBRADAS (la siembra autoriza el gasto, el cron nunca descubre trabajo); la de enrichment corre cada 10 min y la de dominio por nombre está PAUSADA desde el 08-sep (ruta viva, fuera de vercel.json); antes de pagar se revisa apollo_contacts_cache (21,8% de las llamadas históricas repetían una persona ya pagada); el webhook escribe también el camino v3. " +
    "(5) IDENTIDAD DE DATOS: nombre núcleo de empresa único, identidad de persona con fusión reversible, señal = (diccionario, persona), posted_at real de vacantes y job_postings.is_active declarado falso (54.542 de 54.542 en true). " +
    "Stats medidos con comandos sobre origin/main y, las de tablas y filas, contra la base real (solo lectura)."
}
j.meta.generatedAt = "2026-10-12"
j.meta.stats = {
  tsFiles: 490, apiRoutes: 58, pages: 50, crons: 13, sqlScripts: 268, migrations: 49,
  tablesPublic: 58, tablesV3: 68, mcpServers: 4, mcpTools: 56,
}

// ═══ MCP: cuarto servidor y registración compartida ═══
const mcpServer = node("api_mcp_server")
mcpServer.label = "MCP estándar (45 tools)"
mcpServer.desc =
  "Servidor MCP de las señales ya interpretadas por el diccionario. Desde #139 (26-ago) las tools ya no se registran en la ruta: viven en lib/v3/mcp-server-tools.ts (45 server.tool, nombres únicos verificados) y la ruta es un handler de 33 líneas que llama a createV3McpHandler({profile:'standard'}). Instrumenta cada tool con auditoría y cuota vía proxy sobre server.tool. Sumó estimate_batch, create_batch_job, get_batch_job, create_export, screen_account_list, build_evidence_icebreaker, request_contact_phones y get_cost_summary. Scope base companies:read / signals:read / accounts:read."
addFile(mcpServer, "lib/v3/mcp-server-tools.ts")

addNodeAfter("api_mcp_server", {
  id: "api_mcp_admin",
  label: "MCP admin (mismas 45 tools)",
  zone: "v3", layer: 2, kind: "mcp",
  desc:
    "Perfil del equipo de ASCI (/api/v3/mcp/admin). NO tiene tools propias: usa la misma registración que el estándar y cambia sólo el texto, con ADMIN_DESCRIPTION_RULES (reglas find/replace aplicadas por un proxy sobre server.tool, así que si alguien reescribe la frase estándar la regla deja de aplicar y el test falla en vez de desfasarse en silencio) y las `instructions` del server. Por qué una ruta aparte si el flag `unrestricted` ya levanta los topes: el prompt es por SERVER, no por credencial; sin el texto el modelo preguntaba 42 veces. Conserva la confirmación de Apollo y la de las tools destructivas. El handshake rechaza (y loguea con tipo de credencial, workspace y usuario) cualquier credencial sin `unrestricted`.",
  files: ["app/api/v3/mcp/admin/[transport]/route.ts", "lib/v3/mcp-server-tools.ts", "lib/v3/admin-workspace.ts"],
  env: ["ASCI_ADMIN_WORKSPACE_ID"],
  risk:
    "`unrestricted` NO sale de los scopes (en OAuth salen del consentimiento del usuario, manipulable) sino de dos hechos del servidor: el workspace guardado en la fila del token y el rol global de profiles. Sin ASCI_ADMIN_WORKSPACE_ID el módulo falla cerrado. El comentario de la ruta dice '44 tools' y el registro tiene 45: quedó viejo cuando se sumó request_contact_phones (#150); no es un bug, es un número desactualizado en un comentario.",
})
addEdge({ id: "e200", from: "api_mcp_admin", to: "svc_v3_mcp_auth", kind: "call", label: "exige unrestricted" })
addEdge({ id: "e201", from: "api_mcp_admin", to: "svc_v3_usage", kind: "call", label: "cuota + auditoría" })
addEdge({ id: "e202", from: "api_mcp_admin", to: "svc_v3_mcp_tools", kind: "call", label: "misma registración" })
addEdge({ id: "e203", from: "ext_mcp_client", to: "api_mcp_admin", kind: "call", label: "conector claude.ai (OAuth) o API key admin" })

const mcpTools = node("svc_v3_mcp_tools")
mcpTools.desc =
  "Implementación de las tools de lectura, ciclo de vida de cuenta, circuito client-assisted, lotes (cotización, ejecución, export), screening de listas y teléfonos. El registro único está en lib/v3/mcp-server-tools.ts (45 tools, compartido por standard y admin); Explore (8) y Perfiles (3) registran en su propia ruta."
for (const f of ["lib/v3/mcp-server-tools.ts", "lib/v3/services/mcp-batch-estimate.ts", "lib/v3/services/mcp-batch-job.ts", "lib/v3/services/mcp-export.ts", "lib/v3/services/screen-account-list.ts", "lib/v3/services/mcp-contact-phones.ts", "lib/v3/mcp-key-scopes.ts"]) addFile(mcpTools, f)

const mcpAuth = node("svc_v3_mcp_auth")
append(mcpAuth, "desc", "unrestricted", "Desde #136/#143 resuelve además el marcador `unrestricted` (topes de bookmark y cupo levantados), que sólo se otorga con workspace admin + rol superadmin, por API key o por OAuth. lib/v3/mcp-key-scopes.ts es la fuente única del catálogo de scopes: un test fija que cada tool registrada sea alcanzable (nueve tools de la key standard no lo eran).")

// ═══ Lotes MCP, screening y gasto ═══
addNodeAfter("svc_v3_mcp_tools", {
  id: "svc_v3_mcp_batch",
  label: "Lotes MCP: cotizar, autorizar, ejecutar, exportar",
  zone: "v3", layer: 3, kind: "service",
  desc:
    "estimate_batch cotiza un lote con UNA confirmación (lugares del plan, unidades de research, créditos de Apollo y dólares estimados desde el promedio de ai_usage_log por research_job_id, no por fila) y devuelve un batchPlanHash que congela cuentas y roles. create_batch_job congela enrichment_credits_authorized calculado en el server desde el plan guardado, nunca del input; prepare_contact_enrichment con batchJobId cobra contra ese presupuesto. Sin batchJobId rige el cupo mensual para todos los perfiles: esa rama evita dejar a Apollo sin techo. Para una credencial CON topes el presupuesto se recorta al cupo que le queda. Para `unrestricted` (#147) el lote es atribución del gasto, no autorización. create_export arma el archivo; el texto de terceros pasa por untrusted-text.ts.",
  files: ["lib/v3/services/mcp-batch-estimate.ts", "lib/v3/services/mcp-batch-job.ts", "lib/v3/services/mcp-export.ts", "lib/v3/services/untrusted-text.ts"],
  notes: "Cuando el tope de cargos del plan recorta la búsqueda pagada, ahora se avisa en estimate_batch antes de autorizar (#144); antes el recorte pasaba en silencio, cuenta por cuenta.",
})
addNodeAfter("svc_v3_mcp_batch", {
  id: "svc_v3_screening",
  label: "Screening de listas de cuentas",
  zone: "v3", layer: 3, kind: "service",
  desc:
    "screen_account_list cruza una lista del cliente contra términos: una fila por nombre, cuatro estados. Consolida entidades duplicadas con public.company_screen_key —clave PROPIA calculada al vuelo sobre las candidatas, sin backfill— y NO con company_core_name, porque de esa función depende normalized_name y con él auto_merge_safe_duplicates, que fusiona por GROUP BY (aflojarla habría empezado a fusionar empresas hoy separadas). El pool de homónimos pasó a AND de tokens con orden explícito y el panorama de señales a tope 2.000 con bloque `scan` que declara cuándo quedó incompleto (#145, #146).",
  files: ["lib/v3/services/screen-account-list.ts", "lib/v3/services/company-signal-summary.ts", "supabase/migrations/20260824205956_screen_account_list.sql"],
})
addNodeAfter("svc_v3_screening", {
  id: "svc_v3_cost",
  label: "Gasto medido (ledger + get_cost_summary)",
  zone: "v3", layer: 3, kind: "service",
  desc:
    "get_cost_summary junta tres fuentes que nadie leía juntas: cost_usd del AI Gateway (measured), credits_spent de Apollo × US$0,01 (estimated) y v3.apify_runs (usageTotalUsd por corrida; medido: US$0,0004 por vacante, 55% proxy residencial). Cada número declara su calidad; Apify sin dato viaja en null, NUNCA en cero, y el total se marca totalIsPartial. El alquiler fijo del actor (US$29,99/mes) queda afuera y se dice. Para credenciales sin topes suma el gasto compartido (el 78% del gasto de IA registrado no tiene workspace_id).",
  files: ["lib/v3/services/mcp-cost-summary.ts", "lib/v3/services/spend-ledger.ts", "lib/v3/services/apify-client.ts"],
  notes: "setReservationStatus pisaba el metadata de la reserva en vez de mezclarlo y borraba la información que atribuye el gasto a un informe (corregido en #138).",
})
addNodeAfter("db_mcp_logs", {
  id: "db_mcp_batches",
  label: "v3.mcp_batch_* / mcp_screenings / mcp_exports",
  zone: "v3", layer: 4, kind: "table",
  desc: "Planes cotizados (mcp_batch_plans, con el hash y el presupuesto de créditos), lotes en ejecución (mcp_batch_jobs, mcp_batch_job_items), resultados de screening (mcp_screenings) y exports (mcp_exports).",
  tables: ["v3.mcp_batch_plans", "v3.mcp_batch_jobs", "v3.mcp_batch_job_items", "v3.mcp_screenings", "v3.mcp_exports"],
  files: ["supabase/migrations/20260824210819_mcp_batch_plans.sql", "supabase/migrations/20260825015932_mcp_screenings_and_exports.sql", "supabase/migrations/20260825020834_mcp_batch_jobs.sql", "supabase/migrations/20260826191459_apollo_en_el_batch_plan_hash.sql"],
})
addNodeAfter("db_mcp_batches", {
  id: "db_apify_runs",
  label: "v3.apify_runs",
  zone: "v3", layer: 4, kind: "table",
  desc: "Una fila por corrida de Apify y única fuente del costo de scraping. Cubre los cuatro orígenes (cron de primera pasada, mensual, kick de la UI y explore). La unidad de atribución es la EMPRESA, no el usuario: el cron deduplica entre workspaces y el userId del batch es el del primer seguidor, arbitrario.",
  tables: ["v3.apify_runs"],
  files: ["supabase/migrations/20260826203230_ledger_de_gasto_por_empresa.sql"],
})
addEdge({ id: "e204", from: "svc_v3_mcp_tools", to: "svc_v3_mcp_batch", kind: "call" })
addEdge({ id: "e205", from: "svc_v3_mcp_tools", to: "svc_v3_screening", kind: "call" })
addEdge({ id: "e206", from: "svc_v3_mcp_tools", to: "svc_v3_cost", kind: "call", label: "get_cost_summary" })
addEdge({ id: "e207", from: "svc_v3_mcp_batch", to: "db_mcp_batches", kind: "write" })
addEdge({ id: "e208", from: "svc_v3_mcp_batch", to: "svc_v3_contacts", kind: "call", label: "enrichment cobrado contra el lote" })
addEdge({ id: "e209", from: "svc_v3_screening", to: "db_companies", kind: "read" })
addEdge({ id: "e210", from: "svc_v3_screening", to: "db_mcp_batches", kind: "write", label: "mcp_screenings" })
addEdge({ id: "e211", from: "svc_v3_cost", to: "db_ai_usage", kind: "read" })
addEdge({ id: "e212", from: "svc_v3_cost", to: "db_apify_runs", kind: "read" })
addEdge({ id: "e213", from: "cron_v3_scrape_jobs", to: "db_apify_runs", kind: "write", label: "costo por corrida" })

// ═══ Apollo: colas sembradas, caché, webhook ═══
const apollo = node("svc_apollo")
apollo.label = "Apollo (18 módulos)"
apollo.desc =
  "Search, enrich, organizations, bulk_enrich, cache de búsqueda, validación de títulos, parsers, rate limits y dos runners de cola (org-enrichment y domain-lookup). El pipeline de búsqueda de decisores vive en lib/shared/. Hechos que importan: (1) enrich y bulk_enrich COBRAN 1 crédito por cuenta resuelta; el ledger apollo_api_calls lo anotaba en cero y estuvo ciego a ese gasto hasta #fcf40a4. (2) Antes de salir a Apollo se consulta apollo_contacts_cache: una fila significa que YA pagamos por esa persona (tenga email o no) y dentro de la ventana de frescura no se vuelve a pedir; medido sobre 4.223 llamadas históricas a people/match, 921 (21,8%) repetían una persona ya pagada dentro de la ventana. Ante un error de lectura del caché se pide todo: el error seguro es gastar de más. (3) Se capturan los campos de alto valor que antes se tiraban y el tope de tecnologías subió a 500."
for (const f of ["lib/apollo/org-enrichment-runner.ts", "lib/apollo/domain-lookup-runner.ts", "lib/apollo/rate-limits.ts", "lib/apollo/company-writer.ts", "lib/apollo/bulk-organizations.ts"]) addFile(apollo, f)

addNodeAfter("db_apollo_cache", {
  id: "db_apollo_queues",
  label: "v3.apollo_company_enrichment / apollo_domain_lookup",
  zone: "v3", layer: 4, kind: "table",
  desc: "Dos colas SEMBRADAS. Nada las llena sola: sembrar filas es el acto que autoriza el gasto. apollo_company_enrichment (status pending) se drena por organizations/bulk_enrich a 1 crédito por cuenta resuelta (~61.300 empresas con website sin resolver ≈ 38.000 créditos, decisión de gasto que no le corresponde a un cron). apollo_domain_lookup se sembró con ~420.750 companies sin website y se drena por organizations/search, gratuito pero con cuota de 400 llamadas/hora.",
  tables: ["v3.apollo_company_enrichment", "v3.apollo_domain_lookup"],
  files: ["supabase/migrations/20260826120000_apollo_enrichment_columnas_y_checkpoint.sql", "supabase/migrations/20260827205412_checkpoint_de_dominio_por_nombre.sql"],
})
addNodeAfter("cron_v3_enrich_linkedin", {
  id: "cron_v3_apollo_org",
  label: "cron v3-apollo-org-enrichment (10m)",
  zone: "v3", layer: 2, kind: "cron",
  desc: "Drena v3.apollo_company_enrichment con status='pending' en lotes chicos (lock con lease vía acquire_cron_lock, presupuesto de 45 s sobre maxDuration 60). Con la cola vacía no llama a Apollo y gasta cero. Existe porque el script manual necesitaba APOLLO_API_KEY y POSTGRES_URL_NON_POOLING, que sólo existen en producción. Agregado a vercel.json: es el cron número 13.",
  files: ["app/api/cron/v3-apollo-org-enrichment/route.ts", "lib/apollo/org-enrichment-runner.ts"],
})
addNodeAfter("cron_v3_apollo_org", {
  id: "cron_v3_apollo_domain",
  label: "cron v3-apollo-domain-lookup (PAUSADO)",
  zone: "v3", layer: 2, kind: "cron",
  desc: "PAUSADO el 08-sep-2026 (#154): su entrada salió de vercel.json, que es lo único que Vercel mira, así que NO cuenta entre los 13 crons agendados. La ruta sigue viva y se puede correr a mano con el secreto de cron (?dryRun=1&limit=N). Mientras dure la pausa la cola se queda en pending y nada se pierde. Reanudar es devolver la entrada (cada 10 min, DEFAULT_LIMIT calibrado) y desplegar. A 350 llamadas/hora el barrido completo son ~50 días: es el precio de la cuota, no lentitud.",
  files: ["app/api/cron/v3-apollo-domain-lookup/route.ts", "lib/apollo/domain-lookup-runner.ts", "lib/apollo/domain-lookup.ts"],
  notes: "Sólo se promueve a companies.website lo clasificado auto_ok y sólo sobre columnas vacías: el match por nombre es difuso y un token geográfico presente de un solo lado baja el match a 'revisar' por alto que sea el score.",
})
for (const [id, c] of [["e214", "cron_v3_apollo_org"], ["e215", "cron_v3_apollo_domain"]]) {
  addEdge({ id, from: c, to: "ext_apollo", kind: "call", label: c === "cron_v3_apollo_org" ? "organizations/bulk_enrich (1 crédito/cuenta)" : "organizations/search (gratis, 400/h)" })
}
addEdge({ id: "e216", from: "cron_v3_apollo_org", to: "db_apollo_queues", kind: "read" })
addEdge({ id: "e217", from: "cron_v3_apollo_org", to: "db_companies", kind: "write", label: "campos de alto valor, país, LinkedIn id" })
addEdge({ id: "e218", from: "cron_v3_apollo_domain", to: "db_apollo_queues", kind: "read" })
addEdge({ id: "e219", from: "cron_v3_apollo_domain", to: "db_companies", kind: "write", label: "website sólo si auto_ok y vacío" })

const hook = node("api_apollo_webhook")
hook.desc =
  "Callback de Apollo autenticado por secreto en el path. Desde #148 (27-ago) conoce los DOS mundos: el lado v3 (lib/v3/services/contact-phone-inbox.ts) se llama en UN solo punto, ANTES de las tres salidas de v2, para que ninguna rama lo deje afuera. Reglas con test propio: el número va al caché COMPARTIDO apollo_contacts_cache y el estado a v3.account_contacts; el ESTADO se toca sólo en filas 'pending' (pedir es por workspace) y la FECHA de verificación en TODAS las filas de esa persona (describe el dato, no el pedido)."
addFile(hook, "lib/v3/services/contact-phone-inbox.ts")
addEdge({ id: "e220", from: "api_apollo_webhook", to: "svc_v3_contacts", kind: "call", label: "receivePhoneForV3" })
const contacts = node("svc_v3_contacts")
append(contacts, "desc", "request_contact_phones", "Pide teléfonos con la tool request_contact_phones (#150); el backfill movió a apollo_contacts_cache los 80 teléfonos que v2 ya había pagado (106 filas, 80 personas distintas: contar filas inflaba 32%) para no pagarlos de nuevo. phone_status habla el vocabulario de v2 (lib/shared/phone-status.ts).")

// ═══ Identidad de datos y compartido ═══
addNodeAfter("svc_shared_news", {
  id: "svc_shared_identity",
  label: "Señal canónica, perfil LinkedIn y phone_status (compartido)",
  zone: "shared", layer: 3, kind: "service",
  desc: "Tres módulos de lib/shared/ que llaman las dos versiones: canonical-signals.ts (una señal es (entrada del diccionario, persona), no una fila de signals: 'Intune' aparecía dos veces para la misma persona porque el mismo perfil se había scrapeado con el slug autogenerado y con la vanity URL), linkedin-profile.ts (identidad de persona) y phone-status.ts.",
  files: ["lib/shared/canonical-signals.ts", "lib/shared/linkedin-profile.ts", "lib/shared/phone-status.ts"],
})
addNodeAfter("db_contacts", {
  id: "db_contact_identities",
  label: "public.contact_identities / v3.contact_merges",
  zone: "shared", layer: 4, kind: "table",
  desc: "Identidad de persona en el ETL y fusión REVERSIBLE de duplicados. contacts se deduplicaba con ON CONFLICT (linkedin_url) sobre el string crudo, pero esa URL identifica a la URL, no a la persona (cambia la vanity, LinkedIn regenera el slug): 563 de 937 grupos duplicados con email compartido eran sólo eso. contact_merges guarda lo necesario para deshacer.",
  tables: ["public.contact_identities", "v3.contact_merges"],
  files: ["supabase/migrations/20260825000000_contact_identity_resolution.sql", "supabase/migrations/20260825001000_contact_merge.sql"],
})
addEdge({ id: "e221", from: "svc_etl", to: "db_contact_identities", kind: "write", label: "resuelve identidad antes del upsert" })
addEdge({ id: "e222", from: "svc_v3_signals", to: "svc_shared_identity", kind: "call" })

const etl = node("svc_etl")
append(etl, "desc", "company_core_name", "Fase 0 (12cd806): una sola normalización canónica de empresas (company_core_name quita el sufijo societario sólo al final y el prefijo sólo al principio; se borró la función vieja que lo hacía en cualquier posición: 'Grupo Arcor S.A.I.C.' daba 'grupo arcor s.a.i.c' y 'arcor'); merge_companies hereda linkedin_company_id, país y estado público del duplicado; el ETL de vacantes ya no escribe la URL de LinkedIn en companies.website ni la ubicación del aviso en companies.country; previous_positions se mergea en vez de pisarse (un export recortado ya no borra historial). Las migraciones de Fase 0 se escribieron SIN aplicar: la aplicación es decisión del dueño.")
const jp = node("db_job_postings")
append(jp, "desc", "posted_at", "Desde el 25-ago guarda la fecha de publicación REAL: process_job_batch_internal buscaba postedTime/publishedAt/post_date pero los uploads renombran a posted_at, el COALESCE caía en now() y el 58% quedó fechado con su fecha de carga (25.056 recuperadas). parse_job_posted_at resuelve relativas es/en/fr contra la fecha de scrapeo del batch y prefiere NULL a una fecha inventada. is_active NO sirve: 54.542 de 54.542 filas están en true (medido el 12-oct-2026).")
const companies = node("db_companies")
companies.desc = companies.desc.replace(/~488k/g, "532.083 (medido el 12-oct-2026)")
const ice = node("svc_v3_icebreakers")
append(ice, "desc", "DETERMINÍSTICO", "build_evidence_icebreaker (#124) es DETERMINÍSTICO: cita lo observado, cuesta cero, no consume cupo, no exige cuenta guardada y no puede inventar una tecnología que la cuenta no tenga.")

// ═══ Flujos y puntos de contacto ═══
addFlow({
  id: "f_mcp_batch", name: "Lote MCP: cotizar, autorizar, ejecutar, exportar", version: "v3",
  trigger: "Un cliente MCP (admin o standard) arma un informe sobre una lista de cuentas",
  desc: "El control del gasto irreversible pasa de la operación al lote: se cotiza una vez, el server congela el presupuesto y todo lo que se cobra después se imputa a ese lote.",
  steps: [
    { n: 1, nodeId: "ext_mcp_client", detail: "Llama estimate_batch con la lista; no reserva nada ni llama a un modelo." },
    { n: 2, nodeId: "api_mcp_admin", edgeId: "e203", detail: "En el perfil admin el handshake exige la credencial unrestricted." },
    { n: 3, nodeId: "svc_v3_mcp_batch", detail: "Cotiza y devuelve batchPlanHash; create_batch_job congela enrichment_credits_authorized." },
    { n: 4, nodeId: "db_mcp_batches", edgeId: "e207", detail: "Guarda plan, lote e ítems." },
    { n: 5, nodeId: "svc_v3_contacts", edgeId: "e208", detail: "prepare/run_contact_enrichment con batchJobId cobran contra el presupuesto; sin batchJobId rige el cupo mensual." },
    { n: 6, nodeId: "ext_apollo", detail: "Cada crédito gastado queda en el ledger con su lote." },
    { n: 7, nodeId: "svc_v3_cost", edgeId: "e211", detail: "get_cost_summary reporta el gasto con la calidad de cada número." },
  ],
})
addFlow({
  id: "f_apollo_org_queue", name: "Enrichment de companies con Apollo (cola sembrada)", version: "v3",
  trigger: "Alguien siembra filas pending en v3.apollo_company_enrichment",
  desc: "El cron nunca descubre trabajo: con la cola vacía no gasta. Sembrar es el acto de autorización.",
  steps: [
    { n: 1, nodeId: "db_apollo_queues", detail: "INSERT de las empresas a enriquecer (la siembra autoriza el gasto)." },
    { n: 2, nodeId: "cron_v3_apollo_org", edgeId: "e216", detail: "Cada 10 min toma un lote bajo lock con lease." },
    { n: 3, nodeId: "ext_apollo", edgeId: "e214", detail: "bulk_enrich, 1 crédito por cuenta resuelta." },
    { n: 4, nodeId: "db_companies", edgeId: "e217", detail: "Escribe sólo columnas vacías; verifica identidad antes y encola lo que no pudo auditar." },
  ],
})
addFlow({
  id: "f_phone_request", name: "Teléfono pedido por MCP", version: "v3",
  trigger: "request_contact_phones",
  desc: "Apollo responde por webhook y el número aterriza en el caché compartido, no por workspace.",
  steps: [
    { n: 1, nodeId: "svc_v3_mcp_tools", detail: "Marca las filas en pending y pide el reveal." },
    { n: 2, nodeId: "ext_apollo", detail: "Entrega asíncrona." },
    { n: 3, nodeId: "api_apollo_webhook", detail: "Un único punto v3 antes de las tres salidas de v2." },
    { n: 4, nodeId: "svc_v3_contacts", edgeId: "e220", detail: "Número al caché; estado sólo en pending; fecha en todas las filas de la persona." },
    { n: 5, nodeId: "db_apollo_cache", detail: "Otro workspace se beneficia del número ya pagado." },
  ],
})
addContactPoint({
  id: "cp_apollo_shared_cache", title: "Webhook y caché de Apollo (v2 y v3 sobre las mismas filas)", severity: "alta",
  nodes: ["api_apollo_webhook", "db_apollo_cache", "svc_v3_contacts", "svc_apollo"],
  desc: "Desde #148 el webhook de v2 escribe también en tablas de v3 y el caché apollo_contacts_cache es compartido por diseño: es lo que evita pagar dos veces el mismo dato.",
  impact: "Un cambio en las salidas del webhook, o en la regla 'una fila del caché = ya pagamos', afecta el gasto de las dos versiones. Una lectura de caché que devuelva un hit falso entrega un contacto vacío como real.",
})
addContactPoint({
  id: "cp_company_identity", title: "Identidad canónica de empresa (company_core_name → normalized_name → merge)", severity: "alta",
  nodes: ["svc_etl", "db_companies", "svc_v3_screening"],
  desc: "normalized_name se deriva de company_core_name y de esa columna dependen upsert_company y auto_merge_safe_duplicates, que FUSIONA por GROUP BY. Cualquier cambio en la función cambia qué empresas se funden, sobre 532.083 filas y sin vuelta atrás.",
  impact: "Por eso el screening usa su propia clave (company_screen_key) y no endurece la canónica.",
})

// ═══ Optimizaciones y código muerto: re-verificación ═══
const o5 = opt("OPT-05")
o5.finding =
  "EMPEORÓ: cron_executions pasó de ~1,3M a 1.781.047 filas (medido el 12-oct-2026) y sigue sin retención: ningún script ni migración la limpia. Con RLS ya no está expuesta; el problema abierto es sólo el crecimiento (cron_executions registra cada corrida y hay dos crons por minuto y ahora trece en total)."
addEvidence(o5, "public.cron_executions: 1.781.047 filas el 12-oct-2026 (era ~1,3M)")
const o6 = opt("OPT-06")
o6.title = "17 archivos instancian createClient crudo y saltean los helpers de Supabase"
o6.finding =
  "EMPEORÓ: 17 archivos (eran 13) importan @supabase/supabase-js fuera de lib/supabase/. La suba viene de los crons y runners nuevos de Apollo (v3-apollo-org-enrichment, v3-apollo-domain-lookup, lib/apollo/org-enrichment-runner.ts, domain-lookup-runner.ts, company-writer.ts) que copiaron el patrón del cron vecino. Medido con grep sobre app/, lib/ y components/."
addEvidence(o6, "17 archivos con import de @supabase/supabase-js fuera de lib/supabase/ (12-oct-2026)")
const o7 = opt("OPT-07")
o7.title = "El andamiaje del MCP se replicó por ruta: cuatro rutas, dos formas de registrar tools"
o7.finding =
  "AVANZÓ EN PARTE: standard y admin ya comparten UNA registración (lib/v3/mcp-server-tools.ts, 45 tools, #139) y sus rutas son handlers de ~35 líneas; esa mitad del problema está resuelta y con test (un test falla si una regla admin apunta a una tool que ya no existe). Sigue abierto en Explore (8 tools, 499 líneas) y Perfiles (3 tools, 307 líneas): cada una conserva su copia del bloque de transporte, auth, rate limit y mapa de nextAction."
addEvidence(o7, "app/api/v3/mcp/{server,admin}/[transport]/route.ts: 33 y 41 líneas; explore: 499; profiles: 307")
const o12 = opt("OPT-12")
addEvidence(o12, "lib/shared/ suma canonical-signals.ts, linkedin-profile.ts y phone-status.ts (ocho módulos en total, 12-oct-2026)")
const o13 = opt("OPT-13")
o13.evidence = o13.evidence.map((e) => e.startsWith("app/actions/v3/csv-import.ts") ? "app/actions/v3/csv-import.ts: ya NO EXISTE (borrado el 19-ago-2026, ver DEAD-01); el ejemplo original quedó sin archivo" : e)
o13.finding = o13.finding.replace(/En csv-import\.ts el mismo archivo mezcla[^.]*\./, "El ejemplo que lo ilustraba (csv-import.ts, que mezclaba .from('csv_imports') con y sin schema) se borró el 19-ago-2026; el patrón de riesgo sigue, pero ya no hay un archivo concreto que lo muestre: no re-medido.")

addOpt({
  id: "OPT-17", severity: "resuelta", area: "costos",
  title: "RESUELTA: el ledger de Apollo anotaba el enrichment en cero",
  evidence: ["lib/apollo/organizations.ts y lib/apollo/logger.ts: creditsEstimated acepta una función del response", "tests/unit/apollo/parsers.test.ts"],
  finding: "El código decía `creditsEstimated: 0, // enrich no consume credits`. Apollo cobra 1 crédito por cuenta resuelta. El cero venía de confundir el cupo interno por plan con la facturación real, y dejó a apollo_api_calls —que alimenta get_ai_usage y el dashboard de admin— ciega al gasto de organizations/enrich desde siempre.",
  why: "Un ledger que subreporta decide mal cuánto se puede gastar.",
  fix: "RESUELTA el 26-ago-2026 (fcf40a4). creditsEstimated pasa a ser función del response porque el cobro es por cuenta DEVUELTA, no por request. Misma familia que el 21,8% de créditos repetidos (OPT-18).",
})
addOpt({
  id: "OPT-18", severity: "resuelta", area: "costos",
  title: "RESUELTA: se pagaba dos veces por personas que ya estaban en la base",
  evidence: ["apollo_contacts_cache: 4.223 llamadas a people/match, 3.300 personas distintas, 921 repetidas dentro de la ventana de frescura (21,8%)", "lib/apollo/search-cache.ts"],
  finding: "El caché de búsqueda sólo acertaba si la consulta ENTERA se repetía (mismo organization_id, cargos y maxResults); cambiar un cargo lo fallaba y se volvía a enriquecer y pagar a gente ya conocida.",
  why: "921 créditos pagados por datos que ya teníamos.",
  fix: "RESUELTA el 27-ago-2026 (#149): una fila de apollo_contacts_cache significa 'ya pagamos', tenga email o no, y dentro de la ventana no se re-pide; creditsSpent cuenta sólo lo pedido y viaja creditsSaved. No re-medido después del cambio cuánto bajó el repetido en producción.",
})
addOpt({
  id: "OPT-19", severity: "resuelta", area: "datos",
  title: "RESUELTA: 58% de las vacantes quedaban fechadas con la fecha de carga",
  evidence: ["supabase/migrations/20260825002000_job_posted_at.sql", "supabase/migrations/20260825003000_job_posted_at_backfill.sql"],
  finding: "process_job_batch_internal leía postedTime/publishedAt/post_date, pero los uploads renombran a posted_at; el COALESCE caía en now(). Una señal de 'hiring' fechada hoy porque se cargó hoy no dice nada.",
  why: "Contamina cualquier ventana por fecha, incluidos los conteos de vacantes del MCP.",
  fix: "RESUELTA el 25-ago-2026: el RPC lee posted_at primero y parse_job_posted_at resuelve las relativas contra la fecha de scrapeo; backfill de 25.056 vacantes mal fechadas. Preferimos NULL a una fecha inventada.",
})
addOpt({
  id: "OPT-20", severity: "baja", area: "datos",
  title: "job_postings.is_active nunca fue cierto y la columna sigue existiendo",
  evidence: ["public.job_postings: 54.542 de 54.542 filas en true (12-oct-2026); el commit f2a8ee1 midió 43.052 de 43.052", "lib/v3/services/company-signal-summary.ts:541 — comentario: sin activeCount porque is_active está en true en todas las filas"],
  finding: "La columna se creó con DEFAULT true y nadie la escribe; seis funciones la leían y ninguna descartaba una fila. El único proceso que revisita vacantes (v3-scrape-job-postings) corre sobre cuentas seguidas y en el refresh mensual con windowDays 30: 'no apareció en la última corrida' no prueba que se cerró.",
  why: "Los conteos de vacantes son HISTÓRICOS y el MCP lo dice (511f6cb); un 'activas' hubiera sido un número falso.",
  fix: "Las lecturas ya se sacaron (f2a8ee1). Falta decidir si se borra la columna o si se la hace cierta con un proceso que revisite vacantes. Nota: el `.eq('is_active', true)` de app/api/cron/v3-scrape-job-postings/route.ts es sobre v3.followed_accounts, no sobre vacantes.",
})
addOpt({
  id: "OPT-21", severity: "media", area: "costos",
  title: "PAUSADO: ~420.750 companies sin website siguen sin resolverse por dominio",
  evidence: ["vercel.json: sin la entrada de /api/cron/v3-apollo-domain-lookup", "app/api/cron/v3-apollo-domain-lookup/route.ts: comentario de PAUSADO (08-sep-2026)"],
  finding: "El 88% del catálogo no tiene website y por eso no entra a ninguna fase de Apollo (enrich y bulk_enrich reciben dominios, no nombres). El barrido gratuito por nombre existe pero está pausado para dejar la cuota horaria de Apollo al trabajo manual.",
  why: "A 350 llamadas/hora el barrido completo son ~50 días; pausar lo corre, no lo cancela.",
  fix: "Reanudar es devolver la entrada al array crons y desplegar. No verificado: cuántas filas de la cola están hoy en pending vs. procesadas (no se consultó la cola).",
})

for (const id of ["DEAD-03", "DEAD-04", "DEAD-05", "DEAD-09", "DEAD-10", "DEAD-13"]) {
  addEvidence(dead(id), `${reverified}: el archivo existe y sigue sin importadores`)
}
const d12 = dead("DEAD-12")
d12.title = "Tabla de v3 sin lector: bookmark_dedupe_log (dictionary_term_suggestions ya tiene uno)"
d12.finding =
  "bookmark_dedupe_log sigue sin lector en app/ ni lib/ (sólo la mencionan scripts/417, 419, 400 y el baseline). dictionary_term_suggestions YA NO está huérfana: lib/v3/services/dictionary.ts:304 y :315 la leen y escriben. La versión anterior de este hallazgo las daba a las dos por sin lector y ya no es cierto para la segunda."
d12.evidence = ["v3.bookmark_dedupe_log", "lib/v3/services/dictionary.ts:304,315 (dictionary_term_suggestions con lector)"]
addEvidence(dead("DEAD-11"), "NO verificado el 12-oct-2026: la variable vive en el proyecto de Vercel, no en el repo; en el repo 'WEBHOOL' sólo aparece en docs/")

// ═══ Validación de integridad referencial ═══
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
const dups = (arr) => arr.map((x) => x.id).filter((id, i, a) => a.indexOf(id) !== i)
for (const [k, arr] of Object.entries({ nodos: j.nodes, aristas: j.edges, flujos: j.flows, optimizaciones: j.optimizations, deadCode: j.deadCode, contactPoints: j.contactPoints })) {
  const d = dups(arr)
  if (d.length) errs.push(`${k} duplicados: ${d.join(", ")}`)
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
    `contactPoints ${before.cps} -> ${j.contactPoints.length} | optimizations ${before.opts} -> ${j.optimizations.length} | deadCode ${before.dead} -> ${j.deadCode.length}`,
)
