/**
 * Actualiza docs/architecture-map.json con TODO lo que entró entre el 4-ago-2026
 * (cuando se armó el mapa) y el 24-ago-2026, revisando PR por PR.
 *
 * El mapa se había actualizado dos veces desde que se creó (07-ago:
 * centralización del research; 21-ago: retiro de Parallel), pero las dos pasadas
 * fueron QUIRÚRGICAS: tocaron solo los nodos del tema. Todo lo demás quedó
 * congelado en el 4-ago, y en tres semanas entraron 21 PRs. El resultado es que
 * el mapa afirmaba cosas hoy falsas —los cinco hallazgos de seguridad P0 seguían
 * abiertos, "sin supabase/migrations", un endpoint público que ya no existe— y
 * ocultaba cosas nuevas enteras: DOS servidores MCP, tres crons, la radiografía
 * comercial del bookmark y la carpeta lib/shared/.
 *
 * PRs cubiertos (todo lo que hay entre 919372b y HEAD):
 *
 *   #91-#94  12-ago  baseline versionada, seguridad P0, CI (typecheck/lint/test)
 *   #96-#97  13-ago  tercer MCP "Perfiles" + Explore en el consentimiento OAuth
 *   #98-#99  18-ago  RLS y vistas security invoker (Security Advisor)
 *   #100     18-ago  contrato compartido de evidencia (lib/shared/evidence.ts)
 *   #101-105 19-ago  carga masiva de cuentas, linkedin_company_id, corredor de
 *                    vacantes, policy de lectura de job_postings, cupos de plan
 *   #106-110 20/21   radiografía comercial del bookmark (fases 1-9), fechas de
 *                    puesto y movimientos de personal, noticias on-demand
 *   #111     21-ago  Perplexity retirado, bookmark en una sola vista
 *   #112-113 21-ago  search_companies_by_capability v2 + get_company_profile
 *   #114     21-ago  navegación no bloqueante (loading, auth deduplicada,
 *                    streaming) y funciones en gru1
 *   #115     21-ago  "Cuentas investigadas recientemente" (columna inexistente)
 *   #116     21-ago  sección de decisores (Apollo) en el bookmark de v3
 *
 * Se hace por SCRIPT y no con ediciones de texto por la misma razón que las
 * veces anteriores: son ~4.000 líneas de JSON y una edición de texto ya rompió
 * la estructura una vez (el autofix del editor absorbió `edges` dentro de
 * `nodes`). Manipular el objeto y reserializar preserva las claves de nivel
 * superior.
 *
 * Idempotente: correrlo dos veces deja el mismo resultado.
 *
 * Correr:  node scripts/update-architecture-map-2026-08-24.mjs
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
const cp = (id) => {
  const c = j.contactPoints.find((x) => x.id === id)
  if (!c) throw new Error(`ContactPoint inexistente: ${id}`)
  return c
}
/** Inserta un nodo despues de otro, sin duplicar si ya existe. */
const addNodeAfter = (afterId, n) => {
  if (j.nodes.some((x) => x.id === n.id)) {
    Object.assign(node(n.id), n)
    return
  }
  const at = j.nodes.findIndex((x) => x.id === afterId)
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
/** Agrega un punto de contacto, sin duplicar. */
const addContactPoint = (c) => {
  const at = j.contactPoints.findIndex((x) => x.id === c.id)
  if (at >= 0) j.contactPoints[at] = c
  else j.contactPoints.push(c)
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
j.meta.generatedAt = "2026-08-24"
j.meta.summary =
  "Monorepo Next.js único donde conviven ASCI v2 (producción, schema public) y ASCI v3 (multitenant, schema v3) sobre la MISMA base Supabase. El aislamiento es por schema, no por proyecto ni por base. " +
  "Actualización 2026-08-24, repaso completo de los 21 PRs que entraron desde que se armó el mapa (las dos pasadas anteriores fueron quirúrgicas y dejaron todo lo demás congelado en el 4-ago). Lo que cambió, por orden de peso: " +
  "(1) SEGURIDAD — los cinco hallazgos P0 están cerrados (guard de superadmin en las server actions privilegiadas, assertCron en los 11 crons, REVOKE de los 9 RPC de export a anon, proxy-image con allowlist exacta y sin redirects, cabeceras de seguridad con CSP en Report-Only), y con ellos el endpoint público /api/test-alert, que se borró. " +
  "(2) MIGRACIONES VERSIONADAS — supabase/migrations tiene 19 archivos con baseline sellada; OPT-14 dejó de ser cierta. Se sumó un gate de CI (typecheck + lint + tests) y next build volvió a fallar por errores de tipo. " +
  "(3) TRES SERVIDORES MCP, no uno: el estándar (37 tools, sobre las señales del diccionario), Explore (8 tools, sobre la tabla CRUDA de contactos y vacantes) y Perfiles (3 tools, persona-first, para buscar TALENTO con contacto personal). Comparten auth, rate limit y telemetría; se separan por scope y por prefijo de tool_name. " +
  "(4) EL BOOKMARK DE v3 ES LA RADIOGRAFÍA COMERCIAL — una sola vista sin pestañas, con resumen ejecutivo, scorecard, movimientos de personal, vacantes, radar de noticias, ángulos, riesgos, decisores (Apollo) y método. Lo determinístico se arma en cada render; los tres textos con IA se cachean en v3.account_reports por fingerprint de inputs (~US$0,001) y las noticias se buscan solas al seguir la cuenta y por cron. " +
  "(5) lib/shared/ EXISTE — el contrato de evidencia, la búsqueda de noticias y el pipeline de decisores de Apollo son un único módulo que llaman las dos versiones. Es la frontera que OPT-12 pedía, todavía practicada y no declarada por lint. " +
  "(6) Perplexity RETIRADO: era el último canal de IA fuera de v3.ai_usage_log. Hoy todo el consumo pasa por el AI Gateway."
j.meta.stats = {
  tsFiles: 432,
  apiRoutes: 55,
  pages: 50,
  crons: 12,
  sqlScripts: 241,
  migrations: 19,
  tablesPublic: 55,
  tablesV3: 53,
  mcpServers: 3,
  mcpTools: 48,
}

// ═══════════════════════════════════════════════════════════════════════════
// PR #111 — Perplexity retirado (21-ago)
// ═══════════════════════════════════════════════════════════════════════════
const perplexity = node("ext_perplexity")
perplexity.label = "Perplexity (retirado)"
perplexity.desc =
  "RETIRADO el 21-ago-2026. Fue el tercer motor de búsqueda web del sistema y el ÚNICO canal de IA que quedaba fuera de la contabilidad: generatePerplexityContent le pegaba directo a api.perplexity.ai con su propia key, así que su gasto no entraba en v3.ai_usage_log. Se borró junto con searchWebSignals, searchWeb, getPrivateSignals y el componente signals-tab.tsx. Hoy NINGÚN camino del código lo llama y PERPLEXITY_API_KEY no aparece en el repo."
perplexity.env = []
perplexity.files = []
perplexity.risk =
  "Queda en el mapa para que no se lo reintroduzca por error. Por qué se fue: (1) su gasto era invisible —Perplexity lo factura aparte y su respuesta no trae tokens comparables—, así que el sistema no podía decir cuánto costaba una cuenta; (2) escribía en company_news y company_implementations con un .insert() crudo, esquivando el contrato de evidencia (lib/shared/evidence.ts); (3) estaba muerto en los hechos, y se midió antes de borrar: user_company_signals, su tabla propia, tiene 0 filas, el componente BookmarkSignals ('Investigación Web Privada') no estaba montado en ninguna página, y searchWeb no tenía callers. La tabla user_company_signals se conserva porque la lee el armador de contexto de icebreakers. La única llamada directa a un proveedor que sobrevive es la lectura VISUAL de PDFs en lib/documents/extract-text.ts: es OCR, no búsqueda."

const aiV2 = node("svc_ai_v2")
aiV2.desc =
  "Wrapper de generación y estructuración de salidas del LLM. Desde el retiro de Perplexity (21-ago-2026) TODO su consumo pasa por el AI Gateway y queda contabilizado: debugAIConfiguration dejó de chequear PERPLEXITY_API_KEY porque ya no hay canal de IA fuera de v3.ai_usage_log, que es lo que ese check existía para vigilar. structureWithLLM sigue SIN consumidores: los 4 caminos de research migraron al motor (ver DEAD-13)."
aiV2.files = ["lib/ai-service.ts", "lib/ai-structurer.ts"]

// La arista svc_ai_v2 -> ext_perplexity ya no describe una llamada viva.
const e143 = j.edges.find((e) => e.id === "e143")
if (e143) {
  e143.kind = "call"
  e143.label = "RETIRADA 21-ago-2026"
}

// ═══════════════════════════════════════════════════════════════════════════
// PRs #91-#94 — seguridad P0, baseline versionada y CI (12-ago)
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_supabase", {
  id: "svc_auth_guards",
  label: "Guards de autorización",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc: "Los dos porteros del sistema, extraídos el 12-ago-2026: requireSuperadmin/assertSuperadmin/isSuperadmin para las server actions privilegiadas, y assertCron para los crons. Antes el rol se validaba SOLO en el layout de admin —que no participa de un POST a una server action— y la auth de cron tenía 3+ variantes inline divergentes.",
  files: ["lib/auth/require-superadmin.ts", "lib/cron-auth.ts"],
  notes:
    "Cierra OPT-01 y OPT-02. El bug real de los crons no era que faltara el chequeo: cleanup y process-dictionary DETECTABAN el request no autorizado, lo logueaban y seguían igual. Hoy los 11 crons pasan por assertCron y devuelven 401. Quedan como follow-up algunas actions de lectura admin y las escrituras de ingest/templates, que van por cliente con RLS.",
})
addEdge({ id: "e146", from: "svc_auth_guards", to: "db_profiles", kind: "read", label: "role = superadmin" })

const supabase = node("svc_supabase")
supabase.desc =
  "server (RLS con cookies), client (browser), admin (service_role, ignora RLS). Las funciones corren en gru1 (São Paulo) desde el 21-ago-2026: la base es sa-east-1 y vercel.json no fijaba regions, así que cada round-trip pagaba la latencia física del salto."
supabase.risk =
  "13 archivos instancian createClient crudo de @supabase/supabase-js salteando estos helpers (eran 16; ver OPT-06). La región se fija por vercel.json y NO por el dashboard a propósito: el archivo tiene precedencia sobre la UI, queda versionado y no depende de encontrar el setting."

// ── Nodo borrado: /api/test-alert ────────────────────────────────────────────
// El endpoint se borró en el PR de seguridad P0. Se saca el nodo y su arista en
// vez de dejarlos como 'retirado': a diferencia de Parallel o Perplexity, acá no
// hay una decisión de arquitectura que preservar, era un handler de prueba.
j.nodes = j.nodes.filter((n) => n.id !== "api_test_alert")
j.edges = j.edges.filter((e) => e.from !== "api_test_alert" && e.to !== "api_test_alert")

opt("OPT-01").severity = "resuelta"
opt("OPT-01").title = "RESUELTA: el guard de admin vivía solo en el layout"
opt("OPT-01").fix =
  "RESUELTA el 12-ago-2026. Se extrajo lib/auth/require-superadmin.ts y se llama como primera línea de las actions privilegiadas, empezando por la de mayor riesgo: app/actions/dictionary.ts corría el cliente service-role con CERO auth. También quedan guardadas las cuatro actions de export (superficie de exfiltración, porque sus RPC son SECURITY DEFINER) y las mutaciones destructivas de companies.ts (merge/auto-merge/update) y processing.ts (requeue). El layout volvió a ser lo que tenía que ser: UX. Pendiente menor: algunas lecturas admin y las escrituras de ingest/templates, que van por cliente con RLS como backstop."

opt("OPT-02").severity = "resuelta"
opt("OPT-02").title = "RESUELTA: el cron de cleanup detectaba el request no autorizado y seguía igual"
opt("OPT-02").fix =
  "RESUELTA el 12-ago-2026. lib/cron-auth.ts (assertCron) unifica las 3+ variantes inline que habían divergido y los 11 crons pasan por ahí. cleanup y process-dictionary, que sólo logueaban y continuaban, ahora devuelven 401."

opt("OPT-03").severity = "resuelta"
opt("OPT-03").title = "RESUELTA: 9 RPC de export SECURITY DEFINER con EXECUTE para anon"
opt("OPT-03").fix =
  "RESUELTA el 12-ago-2026 con la migración 20250101000001_revoke_anon_export_rpcs.sql: REVOKE de anon/PUBLIC en los 9 RPC y GRANT sólo a authenticated/service_role. Tiene test de regresión (tests/contract/export-rpc-acl.test.ts) que falla si anon recupera EXECUTE. La lección se reaplicó sola dos semanas después: al cambiarle la firma a search_companies_by_capability hubo que REVOCAR explícitamente, porque los ALTER DEFAULT PRIVILEGES del proyecto le dan EXECUTE a anon y authenticated y revocar de PUBLIC no alcanza."

opt("OPT-04").severity = "resuelta"
opt("OPT-04").title = "RESUELTA: proxy-image hacía fetch de una URL controlada por el cliente (SSRF)"
opt("OPT-04").fix =
  "RESUELTA el 12-ago-2026: https-only, allowlist de host por match EXACTO (era un .includes() sorteable), rechazo de hosts que resuelven a IP privada o loopback, sin seguir redirects, content-type de imagen obligatorio, tope de tamaño y timeout."

opt("OPT-10").severity = "resuelta"
opt("OPT-10").title = "RESUELTA: sin cabeceras de seguridad en la respuesta"
opt("OPT-10").fix =
  "RESUELTA el 12-ago-2026 en next.config.mjs: X-Content-Type-Options nosniff, X-Frame-Options SAMEORIGIN, Strict-Transport-Security, Referrer-Policy y Permissions-Policy. La CSP va en Content-Security-Policy-Report-Only a propósito: en enforce rompe el inline de Next y de los embebidos, así que primero se mide."

opt("OPT-14").severity = "resuelta"
opt("OPT-14").title = "RESUELTA: scripts SQL sueltos sin migraciones versionadas"
opt("OPT-14").evidence = [
  "supabase/migrations/ con 19 archivos, encabezados por 20250101000000_baseline.sql",
  "scripts/ conserva 241 .sql numerados como historia, ya no como mecanismo",
]
opt("OPT-14").fix =
  "RESUELTA el 12-ago-2026 (24e2ae8): se selló el estado de public + v3 como baseline versionada y desde entonces todo cambio de esquema entra como migración —19 al 24-ago—, lo que además arregló los previews de Supabase. run-sql.mjs queda para operaciones puntuales. Dos detalles que costaron un intento: las funciones tienen que ir ANTES de constraints e índices en el baseline, y hay que incluir las funciones de la app que quedan espuriamente linkeadas a una extensión."

opt("OPT-15").severity = "resuelta"
opt("OPT-15").title = "RESUELTA: un COMMIT dentro del .sql anulaba el dry run de run-sql.mjs"
opt("OPT-15").fix =
  "RESUELTA el 12-ago-2026: el runner parte las sentencias (para no confundir un COMMIT real con la palabra dentro de un string o un comentario) y RECHAZA el archivo si trae BEGIN/COMMIT/ROLLBACK propio, salvo que se pase --sin-transaccion explícitamente."

opt("OPT-16").severity = "resuelta"
opt("OPT-16").title = "RESUELTA: el scraper de vacantes buscaba por título y no por empresa"
opt("OPT-16").evidence = [
  "lib/v3/services/apify-client.ts: companyId numérico como filtro exacto",
  "lib/v3/services/apify-job-ingest.ts: guardrail belongsToCompany",
  "supabase/migrations/20260819100000_linkedin_company_id.sql",
]
opt("OPT-16").fix =
  "RESUELTA el 19-ago-2026 por los dos lados. En el ORIGEN: se agregó companies.linkedin_company_id y el actor pasó a filtrar por companyId numérico, que es EXACTO y no tiene homónimos. El backfill salió de las vacantes ya cargadas (CSV históricos y runs de Apify guardan el ID en source_data) con dos reglas medidas contra producción: sólo se toma el ID dominante de una compañía si cubre >=80% de sus vacantes, y un ID que apunta a más de una compañía sólo se asigna si una concentra >=90% (caso real: YPF con 135 vacantes contra dos duplicados con 1 cada uno). En la INGESTA: belongsToCompany es lo PRIMERO que corre y descarta lo ajeno, y el resultado reporta cuántas se descartaron —suele ser la mayoría cuando se cae al filtro por nombre."

opt("OPT-05").severity = "media"
opt("OPT-05").title = "PARCIAL: cron_executions ya tiene RLS, pero sigue sin retención"
opt("OPT-05").finding =
  "La tabla de log de crons ya NO está expuesta: la migración 20260818220610 le habilitó RLS junto a las otras 6 tablas que el Security Advisor marcaba. Lo que sigue abierto es el crecimiento: cleanup_old_import_data no la referencia y hay dos crons corriendo cada minuto."
opt("OPT-05").fix =
  "Falta sólo la mitad de datos: agregar retención (por ejemplo 14 días) dentro de cleanup_old_import_data o en un cron propio, y evaluar particionado por fecha si se quiere conservar historia. La mitad de seguridad ya está hecha."

opt("OPT-06").finding =
  "13 archivos (eran 16) instancian createClient crudo de @supabase/supabase-js en vez de pasar por lib/supabase/{server,client,admin}.ts. La baja no vino de una limpieza: son archivos que se borraron o reescribieron por otros motivos. El patrón sigue disponible y nada lo impide."
opt("OPT-06").evidence = [
  "13 archivos con import de @supabase/supabase-js fuera de lib/supabase/",
  "app/actions/dictionary.ts, 6 rutas de cron, app/api/ingest/upload, app/api/landing-stats, components/v3/navbar.tsx",
]

opt("OPT-07").title = "La ruta del servidor MCP concentra transporte, auth, cuota y tools — y ahora son tres rutas"
opt("OPT-07").finding =
  "El patrón se replicó en vez de corregirse: a la ruta del MCP estándar (37 tools) se le sumaron la de Explore (8) y la de Perfiles (3), cada una con su propia copia del bloque de transporte, auth, rate limit, mapa de nextAction por código de error y registro de tools. Lo compartido de verdad son las funciones que llaman (mcp-auth, mcp-usage, mcp_request_logs), no el andamiaje de la ruta."
opt("OPT-07").fix =
  "Extraer el andamiaje —createMcpHandler + withMcpAuth + auditoría + el mapa de nextAction— a un factory que reciba el scope y la lista de tools, y dejar en cada ruta sólo sus tools. Hoy un arreglo en el manejo de errores hay que hacerlo tres veces."

opt("OPT-11").why =
  "Es una restricción invisible en el código: una RPC que hoy tarda 3s pasa a fallar cuando la tabla crece, y el síntoma aparece en producción. El caso medido de búsqueda inversa muestra el techo real: 365 ms en caliente contra 6,6 s en frío, y la v2 de esa RPC volvió a medirse contra el mismo techo (peor caso 4,96 s con 1,7M de señales). Desde el 21-ago las funciones corren en gru1, junto a la base, así que el presupuesto ya no se gasta en latencia de red — pero el corte de 8s no se movió."

opt("OPT-12").evidence = [
  "RESUELTO en parte: lib/shared/ (evidence.ts, evidence-level.ts, news-search.ts, apollo-decision-makers.ts, apollo-title-groups.ts)",
  "lib/ai-service.ts vs lib/v3/ai.ts",
  "lib/documents/ vs lib/v3/services/mcp-document-*.ts",
  "lib/tech-radar.ts vs lib/v3/services/radar*.ts",
  "app/actions/search-v2.ts vs lib/v3/services/capability-search.ts",
]
opt("OPT-12").finding =
  "Cada capacidad transversal (IA, documentos, radar, búsqueda, dedupe, digest) tenía una implementación en v2 y otra en v3, sin módulo compartido ni regla explícita. AVANZÓ MUCHO: lib/shared/ ya existe y tiene cuatro inquilinos reales que las DOS versiones llaman —el contrato de evidencia, la búsqueda de noticias, el pipeline de decisores de Apollo y los grupos de cargos—, además del motor de research en lib/research/. La duplicación restante es la de IA, documentos y búsqueda."
opt("OPT-12").fix =
  "Lo que falta ya no es demostrar el patrón sino DECLARARLO: prohibición por lint de que lib/v3 importe de lib/ raíz salvo desde lib/shared/. Cada vez que se pospuso, se pagó: la sección de decisores de v3 fue la tercera vez que este repo estuvo a punto de tener dos implementaciones del mismo pipeline (pasó con las noticias y con el research). Ojo con la ubicación: el motor de research vive en lib/research/ y escribe en el schema v3, así que la frontera está practicada, no declarada."

// ── deadCode cerrado por el PR de seguridad ─────────────────────────────────
dead("DEAD-08").severity = "resuelta"
dead("DEAD-08").title = "RESUELTO: app/api/test-alert, endpoint de prueba público en producción"
dead("DEAD-08").recommendation =
  "BORRADO el 12-ago-2026 junto con el resto de la tanda P0. Era a la vez código muerto y superficie de abuso: permitía gatillar envíos de mail y quemar la cuota de Resend desde internet, sin sesión ni CRON_SECRET. El nodo salió del mapa."

dead("DEAD-06").severity = "resuelta"
dead("DEAD-06").title = "RESUELTO: lib/parallel-extract.ts"
dead("DEAD-06").recommendation =
  "BORRADO el 12-ago-2026, al saldar la deuda de tsc que destapó el gate de CI. Se lo había conservado como 'base aspiracional' para extraer PDFs en public-docs; con Parallel retirado nueve días después, esa base ya no servía para nada. Si vuelve la extracción de PDFs, se escribe contra el motor de research."

dead("DEAD-07").severity = "resuelta"
dead("DEAD-07").title = "RESUELTO: lib/search/search-provider.ts"
dead("DEAD-07").recommendation = "BORRADO el 12-ago-2026, en la misma pasada que lib/parallel-extract.ts."

// ═══════════════════════════════════════════════════════════════════════════
// PRs #96-#97 — MCP Explore y MCP Perfiles (12/13-ago)
// ═══════════════════════════════════════════════════════════════════════════
const mcpServer = node("api_mcp_server")
mcpServer.label = "MCP estándar (37 tools)"
mcpServer.desc =
  "El PRIMERO de los tres servidores MCP, y el único que conversa con las señales ya interpretadas por el diccionario. Punto de entrada único para lectura de cuentas, research, contactos y documentos; instrumenta cada tool con auditoría y cuota vía proxy sobre server.tool. Scope base companies:read / signals:read / accounts:read."
mcpServer.risk =
  "Ruta monolítica muy grande: concentra registro de tools, auth, cuota y transporte, y el patrón se copió dos veces más (ver OPT-07)."
mcpServer.notes =
  "Dos tools cambiaron de contrato el 21-ago. get_company_signal_summary acepta detail 'compact' (default en la tool) o 'full': el modo completo devolvía ~10.000 tokens por cuenta —hasta 3 snippets por término, las implementaciones enteras y 30 vacantes con 500 caracteres cada una—, con lo cual validar las 20 cuentas de una búsqueda era inviable y la validación terminaba delegada al usuario. get_company_profile devuelve ahora un bloque firmographics (linkedinUrl, domain, employeesApollo, isPublic, ticker, stockExchange) con null EXPLÍCITO y un fieldNotes que aclara que null significa 'no lo sabemos' y no 'empresa chica'."

addNodeAfter("api_mcp_server", {
  id: "api_mcp_explore",
  label: "MCP Explore (8 tools)",
  zone: "v3",
  layer: 2,
  kind: "mcp",
  desc: "Servidor MCP PARALELO al estándar, para A/B. Conversa directamente con la tabla CRUDA de contactos y vacantes, SIN pasar por el diccionario de señales: explore_start, set_country, set_industries, companies, company_people, scrape_jobs y el par prepare/run de decisores. Comparte auth, rate limit y telemetría con los otros dos, con scope propio explore:read y API key propia.",
  files: ["app/api/v3/mcp/explore/[transport]/route.ts"],
  notes:
    "Existe para MEDIR: con el prefijo explore_ de tool_name en v3.mcp_request_logs se puede comparar cuál de los dos embudos —el interpretado por el diccionario o el crudo— resuelve la misma pregunta en menos llamadas. Por eso no reemplazó al estándar.",
})
addNodeAfter("api_mcp_explore", {
  id: "api_mcp_profiles",
  label: "MCP Perfiles (3 tools)",
  zone: "v3",
  layer: 2,
  kind: "mcp",
  desc: "TERCER servidor MCP y el único persona-first: los otros dos son empresa-first ('qué empresas usan X'), este invierte el eje y busca TALENTO ('quién sabe X'), devolviendo el contacto PERSONAL para llegarle directo. profiles_search, profiles_countries, profiles_industries. Scope profiles:read.",
  files: ["app/api/v3/mcp/profiles/[transport]/route.ts"],
  risk:
    "Devuelve PII sensible (mail y teléfono particulares) de personas que no son usuarios del sistema. La tool declara que sólo se usen para el objetivo de contacto profesional que pidió el usuario, pero eso es una instrucción al modelo, no un control: el control es el scope de la API key.",
})

addNodeAfter("svc_v3_capability", {
  id: "svc_v3_explore",
  label: "Explore (tabla cruda)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "Capa de lectura del MCP Explore sobre public.contacts y public.job_postings sin diccionario: prepareTerms (nube de sinónimos del usuario), facetas de país e industria, búsqueda de empresas y de personas por empresa, y sesión de embudo persistida en v3.explore_sessions.",
  files: ["lib/v3/explore/mcp-explore.ts"],
  notes:
    "Va por conexión DIRECTA (lib/db/direct.ts) y no por PostgREST: cruza public.contacts (~2,4 GB con índices GIN trigram) y en frío pasa el corte de 8s. Es uno de los dos usos legítimos del escape hatch de OPT-11.",
})
addNodeAfter("svc_v3_explore", {
  id: "svc_v3_profiles",
  label: "Perfiles (talento)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "Búsqueda de personas por capacidad + experiencia de industria, con contacto personal resuelto (v3.profiles_search_people). Reusa de Explore prepareTerms y las facetas; lo propio es searchPeople.",
  files: ["lib/v3/profiles/mcp-profiles.ts"],
  notes:
    "Tres decisiones que se pagaron midiendo. (1) HISTORIAL: includePast suma el texto de los puestos anteriores (public.contacts_prevpos_text, indexado) y recupera ~21.500 perfiles de SAP que la v1 perdía; es opt-in porque es más lento. (2) GRUPOS AND: cada requisito es un OR de sinónimos y entre requisitos hay intersección, lo que además deja al planner intersecar bitmaps (BitmapAnd) antes del heap. (3) TOKENS CON SÍMBOLO: el ancla \\y se agrega SOLO del lado que empieza o termina en carácter de palabra, porque el \\y inicial frente al punto de '.NET' tiraba ~70% de los resultados.",
})

addEdge({ id: "e147", from: "ext_mcp_client", to: "api_mcp_explore", kind: "call", label: "tool call (explore:read)" })
addEdge({ id: "e148", from: "ext_mcp_client", to: "api_mcp_profiles", kind: "call", label: "tool call (profiles:read)" })
addEdge({ id: "e149", from: "api_mcp_explore", to: "svc_v3_mcp_auth", kind: "call", label: "misma auth que el estándar" })
addEdge({ id: "e150", from: "api_mcp_profiles", to: "svc_v3_mcp_auth", kind: "call", label: "misma auth que el estándar" })
addEdge({ id: "e151", from: "api_mcp_explore", to: "svc_v3_usage", kind: "call", label: "cuota + auditoría (prefijo explore_)" })
addEdge({ id: "e152", from: "api_mcp_profiles", to: "svc_v3_usage", kind: "call", label: "auditoría (prefijo profiles_)" })
addEdge({ id: "e153", from: "api_mcp_explore", to: "svc_v3_explore", kind: "call" })
addEdge({ id: "e154", from: "api_mcp_profiles", to: "svc_v3_profiles", kind: "call" })
addEdge({ id: "e155", from: "svc_v3_profiles", to: "svc_v3_explore", kind: "call", label: "reusa prepareTerms y facetas" })
addEdge({ id: "e156", from: "svc_v3_explore", to: "svc_db_direct", kind: "call", label: "esquiva el corte de 8s" })
addEdge({ id: "e157", from: "svc_v3_profiles", to: "svc_db_direct", kind: "call", label: "esquiva el corte de 8s" })
addEdge({ id: "e158", from: "svc_v3_explore", to: "db_contacts", kind: "read", label: "tabla CRUDA, sin diccionario" })
addEdge({ id: "e159", from: "svc_v3_profiles", to: "db_contacts", kind: "read", label: "puesto actual + historial" })
addEdge({ id: "e160", from: "svc_v3_explore", to: "db_explore_sessions", kind: "rw", label: "sesión del embudo" })
addEdge({ id: "e161", from: "api_mcp_explore", to: "svc_v3_jobs", kind: "call", label: "explore_scrape_jobs" })

const mcpAuth = node("svc_v3_mcp_auth")
mcpAuth.desc =
  "OAuth, API keys y resolución de acceso/plan por request, para los TRES servidores MCP. Cada uno tiene su tipo de key y su scope (standard, explore:read, profiles:read); el consentimiento OAuth los ofrece por separado."
mcpAuth.notes =
  "Dos bugs del mismo origen, corregidos el 13-ago: explore:read y profiles:read existían como scope de API key pero NO en el catálogo OAuth, así que sanitizeScopes los descartaba y ningún token OAuth podía usar esos servidores. La lección: el catálogo OAuth y el de API keys son dos listas y hay que tocar las dos."

// ═══════════════════════════════════════════════════════════════════════════
// PRs #99-#100 — Security Advisor y contrato de evidencia (18-ago)
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_research_engine", {
  id: "svc_shared_evidence",
  label: "Contrato de evidencia",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc: "Escritor ÚNICO de evidencia de compañía: toda escritura en company_news, company_implementations y radar_findings pasa por acá. Garantiza produced_by, dedupe_hash y atribución, y resuelve el mapeo a la tabla física, que es lo único que cambia entre los tres tipos. evidence-level.ts traduce EN LECTURA los tres vocabularios de nivel que conviven en producción.",
  files: ["lib/shared/evidence.ts", "lib/shared/evidence-level.ts"],
  notes:
    "Antes eran tres dialectos del mismo idioma: cada motor le agregaba a SU tabla la columna que necesitaba y llenaba las que se acordaba. Medido al 2026-08-17: 1.133 de 1.133 noticias con bookmark_id nulo, 0 filas con sourced_by_workspace, y un workaround con race condition en persistClientNews porque v3 no se animaba a tocar un índice parcial de v2. PRODUCED_BY se valida en TypeScript y no con un CHECK en la base a propósito: sumar un motor nuevo no tiene que exigir una migración —lección directa del CHECK de company_news.source, que tardó dos migraciones en soltar 'parallel'.",
})
addNodeAfter("svc_shared_evidence", {
  id: "svc_shared_news",
  label: "Búsqueda de noticias compartida",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc: "Los dos bundles profundos de noticias por cuenta (haiku por el AI Gateway, ~US$0,20 por cuenta), únicos para las dos versiones: los llaman /api/research/news de v2 y el corredor de noticias del bookmark de v3. Persisten por el contrato de evidencia con produced_by 'v3_news'.",
  files: ["lib/shared/news-search.ts", "lib/news-prompt.ts"],
  notes:
    "Es el bundle CARO del sistema y no tiene cupo ni confirmación de costo a propósito: se dispara una sola vez al seguir la cuenta y después sólo por cron, así que el gasto está acotado por el cupo de cuentas seguidas del plan y no por llamada. Por eso el intento se marca en company_news_scrapes ANTES de gastar: sin esa marca, una cuenta sin novedades se re-dispararía en cada visita al bookmark.",
})
addEdge({ id: "e189", from: "svc_shared_news", to: "svc_research_engine", kind: "call", label: "collect -> structure -> verify" })
addEdge({ id: "e190", from: "svc_shared_news", to: "svc_shared_evidence", kind: "call", label: "recordEvidenceBatch" })
addEdge({ id: "e191", from: "api_research_v2", to: "svc_shared_news", kind: "call", label: "/api/research/news" })
addEdge({ id: "e192", from: "cron_v3_scrape_news", to: "svc_shared_news", kind: "call", label: "dos bundles por cuenta" })

addEdge({ id: "e162", from: "svc_shared_evidence", to: "db_company_news", kind: "write", label: "produced_by + dedupe_hash" })
addEdge({ id: "e163", from: "svc_shared_evidence", to: "db_radar", kind: "write" })
addEdge({ id: "e164", from: "svc_research_engine", to: "svc_shared_evidence", kind: "call", label: "persiste lo verificado" })

addContactPoint({
  id: "cp_evidence",
  title: "Contrato de evidencia compartido",
  severity: "alta",
  nodes: ["svc_shared_evidence", "db_company_news", "db_radar", "db_signals"],
  desc: "Las tres tablas de hallazgos las escriben SEIS motores distintos (v2_research, v2_manual, v3_news, v3_radar, v3_drilldown, mcp_client, etl_apify, cron_refresh) y desde el 18-ago todos entran por el mismo módulo, que estampa produced_by, dedupe_hash y atribución.",
  impact:
    "Es la zona de contacto que MENOS duele hoy y más dolería si se saltea: cualquier .insert() crudo que la esquive vuelve a partir la procedencia, y la procedencia es lo que permite medir qué motor genera qué. Ya pasó: Perplexity escribía directo, y el CHECK de company_news.source estampó 'parallel' durante meses para filas de cinco motores distintos.",
})

const advisorNote =
  "El Security Advisor de Supabase se saldó el 18-ago-2026: las 4 vistas (apollo_reverify_candidates, apollo_title_catalog_ranked, import_batches_inconsistent, v_unmapped_industries) pasaron a SECURITY INVOKER, y 7 tablas expuestas por la API recibieron RLS (dictionary_job_matches, country_mappings, dictionary_patterns_cache, cron_executions, v3.radar_micro_agents, v3.linkedin_company_enrichment, v3.explore_sessions). El backend no cambió: todos los escritores reales son crons con service_role, la conexión directa o funciones SECURITY DEFINER, que esquivan RLS."
node("svc_supabase").notes = advisorNote

// ═══════════════════════════════════════════════════════════════════════════
// PRs #101-#105 — carga masiva, LinkedIn ID, corredor de vacantes, cupos
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_v3_jobs", {
  id: "svc_v3_imports",
  label: "Carga masiva de cuentas",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "Import interactivo de cuentas por archivo a un workspace: se sube, se resuelven los matches contra companies, el usuario REVISA y recién al confirmar se hace followAccount por fila. Opcionalmente puentea a v2 creando bookmarks para usuarios seleccionados.",
  files: ["lib/v3/services/account-import.ts", "app/actions/v3/account-imports.ts"],
  notes:
    "No reusa la cola ETL de v2 (import_batches/import_rows) a propósito: agregar un batch_type nuevo exige tocar el PL/pgSQL de process_import_batch, y este flujo es interactivo, no de cola. Reemplaza a app/actions/v3/csv-import.ts, que era el peor tipo de código muerto —una feature completa contra tablas que no existían (ver DEAD-01).",
})
addNodeAfter("db_ws_docs", {
  id: "db_account_imports",
  label: "v3.account_imports / account_import_rows",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Lote de carga masiva y sus filas con el match resuelto, para la pantalla de review previa a la confirmación.",
  tables: ["v3.account_imports", "v3.account_import_rows"],
  files: ["supabase/migrations/20260819000000_v3_account_imports.sql"],
  notes:
    "RLS habilitado SIN políticas permisivas, como el resto de v3: todo acceso va por service role con el filtro de workspace_id aplicado en TypeScript, detrás de requireSuperadmin / requireWorkspaceAdmin.",
})
addNodeAfter("db_account_imports", {
  id: "db_explore_sessions",
  label: "v3.explore_sessions",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Estado del embudo del MCP Explore entre llamadas: términos preparados, país e industrias elegidos. Es lo que permite que explore_set_country no tenga que reenviar la nube de términos.",
  tables: ["v3.explore_sessions"],
  notes: "Una sesión vencida o de otro workspace devuelve SESSION_NOT_FOUND, con la instrucción explícita de empezar de nuevo en vez de reintentar con el mismo sessionId.",
})
addNodeAfter("db_explore_sessions", {
  id: "db_linkedin_enrichment",
  label: "v3.linkedin_company_enrichment",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Resultado del actor harvestapi/linkedin-company: HQ, dotación y datos de la ficha de LinkedIn de la compañía, alimentado por el cron de enrichment.",
  tables: ["v3.linkedin_company_enrichment"],
})
addEdge({ id: "e165", from: "svc_v3_imports", to: "db_account_imports", kind: "rw" })
addEdge({ id: "e166", from: "svc_v3_imports", to: "db_followed", kind: "write", label: "followAccount al confirmar" })
addEdge({ id: "e167", from: "svc_v3_imports", to: "db_companies", kind: "read", label: "resuelve el match" })
addEdge({ id: "e168", from: "ui_v3_admin", to: "svc_v3_imports", kind: "call" })

const uiV3Admin = node("ui_v3_admin")
uiV3Admin.desc =
  "Panel cross-tenant: workspaces, usuarios, agentes, prompts, uso y carga masiva de cuentas por archivo (app/v3/admin/account-imports)."
uiV3Admin.risk =
  "Panel cross-tenant. El guard está en app/v3/admin/layout.tsx y, desde el 12-ago, también en las server actions (OPT-01 resuelta); las actions admin-* de v3 siguen con requireSuperAdmin duplicado en 4 archivos en vez de usar el módulo compartido."

const jobs = node("svc_v3_jobs")
jobs.desc =
  "Ingesta y lectura de vacantes vía Apify. Desde el 19-ago el actor filtra por companyId numérico de LinkedIn —EXACTO, sin homónimos— y cae al filtro por variantes de nombre sólo cuando no lo tenemos. Corre solo: un corredor scheduler-worker levanta las cuentas seguidas cada 10 minutos."
jobs.files = [
  "lib/v3/services/apify-job-ingest.ts",
  "lib/v3/services/job-posting-provider.ts",
  "lib/v3/services/jobs-interpreter.ts",
  "lib/v3/services/apify-client.ts",
]
jobs.risk =
  "El guardrail de pertenencia (belongsToCompany) es lo PRIMERO que corre en la ingesta y no es opcional: cuando se cae al filtro por nombre, la mayoría de lo que devuelve el actor es de otras empresas. Como job_postings alimenta al diccionario, una vacante mal atribuida se vuelve señal falsa visible también en la búsqueda de v2."
jobs.notes =
  "Regla del corredor, aprendida a los golpes: MARCAR EL INTENTO ANTES DE GASTAR. Sin la marca previa, una cuenta sin novedades se re-dispara en cada corrida —la misma lección que después obligó a crear company_news_scrapes para las noticias."

node("ext_apify").desc =
  "Actores harvestapi/linkedin-company (enrichment de HQ y dotación) y bebity/linkedin-jobs-scraper (vacantes). El segundo se invoca con companyId numérico cuando lo tenemos, que es el filtro exacto del actor."

const plans = node("svc_v3_workspace")
plans.desc =
  "Multitenancy: workspaces, invitación por email, roles admin/member y límites por plan. Los cupos de cuentas seguidas son 10/60/120/240 (trial/starter/pro/business) y el cupo de research quedó ALINEADO al de follow, que era la fuente de confusión: seguir una cuenta y poder investigarla son el mismo derecho."
plans.files = [
  "lib/v3/workspace.ts",
  "lib/v3/invitations.ts",
  "lib/v3/plans.ts",
  "lib/v3/plan-config.ts",
  "lib/v3/request-auth.ts",
]
plans.notes =
  "plan-config.ts es un módulo PURO (sin 'server-only', sin cliente de base) para que lo pueda leer un componente cliente sin arrastrar nada de servidor. Desde el 21-ago, getRequestUser, getWorkspaceForUser y workspaceHasDocuments están envueltos en cache() de React: memoiza POR REQUEST, no entre requests, así que no hay riesgo de servirle a alguien la identidad de otro."
plans.risk =
  "auth.getUser() no lee una cookie: hace un round-trip a la API de Auth. Abrir una cuenta de v3 lo hacía CUATRO veces por carga (getOnboardingStatus más los tres server actions que la página resuelve en paralelo, cada uno con su getAuthContext) y, sumada la resolución de workspace, eran 8 idas y vueltas a São Paulo para contestar '¿quién sos?', con el primer par bloqueando antes del Promise.all."

// ═══════════════════════════════════════════════════════════════════════════
// PRs #106-#110 — la radiografía comercial del bookmark de v3
// ═══════════════════════════════════════════════════════════════════════════
addNodeAfter("svc_v3_accounts", {
  id: "svc_v3_report",
  label: "Radiografía de cuenta",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc: "Arma el informe del bookmark de v3: semáforo de estado, scorecard operativo, movimientos de personal, vacantes con señal, radar de noticias, ángulos de entrada, riesgos y la sección de método y limitaciones. Todo lo determinístico se calcula en cada render sin costo; los tres textos que necesitan IA (resumen ejecutivo, ángulos, riesgos) se generan en UNA llamada batch (~US$0,001) y se cachean.",
  files: [
    "lib/v3/services/account-report.ts",
    "lib/v3/services/personnel-movements.ts",
    "lib/v3/services/personnel-movements-rules.ts",
  ],
  notes:
    "newsScrapeStatus tiene cuatro estados y el cuarto se agregó por un caso real: 'pending' (recién seguida, el kick sale en after()), 'running' (búsqueda en vuelo), 'queued' (seguida desde ANTES de que el scrape existiera: no hay nada corriendo, pero el cron la levanta) e 'idle'. Sin 'queued', esas cuentas mostraban 'sin noticias' como si no hubiera ninguna. El loader auto-refresca sólo en pending/running: poletear una cuenta en cola terminaría diciendo 'está demorando' para algo a lo que no le tocó el turno.",
  risk:
    "El email y el teléfono del informe priorizan el canal CORPORATIVO y caen al personal sólo si no hay otro, declarando cuál es con un chip. Antes se devolvía el primero válido, así que la elección dependía del orden de las columnas. La lista de dominios personales está DUPLICADA a propósito entre TypeScript y la función SQL public.is_personal_email: si se agrega uno, va en los dos lados.",
})
addNodeAfter("db_scorecards", {
  id: "db_account_reports",
  label: "v3.account_reports / account_news_readings",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Lo que la radiografía necesita guardar POR WORKSPACE: los tres textos generados del informe (con inputs_fingerprint para no repagarlos) y la lectura de cada noticia (relevancia y por qué importa para lo que ese workspace vende).",
  tables: ["v3.account_reports", "v3.account_news_readings"],
  files: [
    "supabase/migrations/20260821140000_account_reports.sql",
    "supabase/migrations/20260821100000_account_news_readings.sql",
  ],
  notes:
    "Principio del diseño: el HECHO es global y la LECTURA es por workspace. Si tres workspaces siguen YPF se paga UN scrape; lo que cambia es qué significa esa noticia — 'proyecto de innovación con datacenter nuevo' es relevancia 'propuesta' para quien vende datacenters y 'negocio' para un workspace de staffing. Por eso la lectura no puede vivir en company_news. Lo mismo con los textos: los ángulos de entrada de uno no son los del otro. Abrir la cuenta cien veces con los mismos datos no gasta nada: sólo se regenera cuando cambia el fingerprint.",
})
addNodeAfter("db_company_news", {
  id: "db_news_scrapes",
  label: "public.company_news_scrapes",
  zone: "shared",
  layer: 4,
  kind: "table",
  desc: "Bitácora GLOBAL de búsquedas de noticias por compañía: cuándo se buscó, con qué ventana y cuántas entraron.",
  tables: ["public.company_news_scrapes"],
  files: ["supabase/migrations/20260821110000_company_news_scrapes.sql"],
  notes:
    "Es una tabla y no algo derivable de company_news por una razón concreta: si una búsqueda no encuentra nada, no se inserta ninguna noticia — y sin marca, la próxima visita al bookmark vuelve a gastar los ~US$0,17. Es la misma lección del corredor de vacantes: marcar el intento ANTES de gastar. Además es la fuente de la sección 'Método y limitaciones' del informe.",
})
addEdge({ id: "e169", from: "svc_v3_report", to: "db_account_reports", kind: "rw", label: "cachea por inputs_fingerprint" })
addEdge({ id: "e170", from: "svc_v3_report", to: "db_news_scrapes", kind: "read", label: "fecha y ventana del último scrape" })
addEdge({ id: "e171", from: "svc_v3_report", to: "db_contacts", kind: "read", label: "movimientos de personal" })
addEdge({ id: "e172", from: "svc_v3_report", to: "db_job_postings", kind: "read", label: "vacantes con señal, tope de 5" })
addEdge({ id: "e173", from: "svc_v3_report", to: "db_company_news", kind: "read" })
addEdge({ id: "e174", from: "svc_v3_report", to: "svc_v3_ai", kind: "call", label: "resumen + ángulos + riesgos, 1 batch" })
addEdge({ id: "e175", from: "ui_v3_accounts", to: "svc_v3_report", kind: "call", label: "streaming: la promesa viaja a la vista" })

const dbContacts = node("db_contacts")
dbContacts.desc =
  "Contactos ingestados por el ETL de v2, leídos por v3. Desde el 20-ago guarda current_position_started_on y las fechas de cada posición previa, que es lo que permite detectar movimientos de personal sin scrapear perfiles de LinkedIn."
dbContacts.notes =
  "Tiene ~1 GB de índices GIN: los UPDATE masivos son no-HOT y caros. Las fechas de puesto YA venían en el export crudo y quedaban guardadas en import_rows.row_data, pero process_contact_batch_internal nunca las leía, así que se perdían al materializar; parse_position_date las normaliza desde 'YYYY-MM' / 'YYYY-MM-DD' / 'YYYY' a date o NULL, nunca a error."

const dbNews = node("db_company_news")
dbNews.desc =
  "Pool de noticias por compañía: sourced_by_workspace atribuye pero el dato es compartido. Desde el 21-ago su CHECK de source acepta sólo research | client_mcp | tech_radar: la columna quedó marcada LEGACY y la procedencia real vive en produced_by (motor) + ai_provider (modelos)."
dbNews.risk =
  "La RLS lo ata a bookmarks personales de v2, así que un miembro de workspace v3 no ve nada por la web. UPDATE sin WITH CHECK. El retiro de 'parallel' del CHECK se hizo en DOS migraciones a propósito: la primera renombró el valor y dejó el viejo aceptado, porque entre la migración y el deploy producción seguía escribiendo el nombre viejo — sacarlo antes habría roto el scrape en esa ventana, que es exactamente el bug que costó los scrapes de ARAUCO."

// ── Los tres crons que faltaban en el mapa ──────────────────────────────────
addNodeAfter("cron_v3_watchdog", {
  id: "cron_v3_scrape_news",
  label: "cron v3-scrape-news (30m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Corredor de noticias: levanta las cuentas seguidas cuyo último scrape venció y corre los dos bundles de lib/shared/news-search.ts. Marca el intento en company_news_scrapes ANTES de gastar.",
  files: ["app/api/cron/v3-scrape-news/route.ts"],
  notes:
    "Es el que sostiene el estado 'queued' del informe: una cuenta seguida desde antes de que el scrape existiera no tiene fila de intento y este cron la levanta igual. Verificado en producción el 21-ago a las 22:30 UTC: 17 filas nuevas con produced_by='v3_news', source='research' y ai_provider='anthropic/claude-haiku-4.5+google/gemini-2.5-flash-lite'.",
})
addNodeAfter("cron_v3_scrape_news", {
  id: "cron_v3_scrape_jobs",
  label: "cron v3-scrape-job-postings (10m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Corredor scheduler-worker de vacantes: toma las cuentas seguidas que tocan, dispara el actor de Apify filtrando por companyId de LinkedIn e ingesta con el guardrail de pertenencia.",
  files: ["app/api/cron/v3-scrape-job-postings/route.ts"],
})
addNodeAfter("cron_v3_scrape_jobs", {
  id: "cron_v3_enrich_linkedin",
  label: "cron v3-enrich-companies-linkedin (10m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Enriquece compañías candidatas con el actor harvestapi/linkedin-company (HQ, dotación, ficha) y persiste en v3.linkedin_company_enrichment.",
  files: ["app/api/cron/v3-enrich-companies-linkedin/route.ts"],
})
addEdge({ id: "e176", from: "cron_v3_scrape_news", to: "db_followed", kind: "read", label: "cuentas con scrape vencido" })
addEdge({ id: "e177", from: "cron_v3_scrape_news", to: "db_news_scrapes", kind: "write", label: "marca el intento ANTES de gastar" })
addEdge({ id: "e179", from: "cron_v3_scrape_jobs", to: "db_followed", kind: "read" })
addEdge({ id: "e180", from: "cron_v3_scrape_jobs", to: "svc_v3_jobs", kind: "call" })
addEdge({ id: "e181", from: "cron_v3_enrich_linkedin", to: "ext_apify", kind: "call", label: "harvestapi/linkedin-company" })
addEdge({ id: "e182", from: "cron_v3_enrich_linkedin", to: "db_linkedin_enrichment", kind: "write" })

// ═══════════════════════════════════════════════════════════════════════════
// PRs #112-#113 — search_companies_by_capability v2
// ═══════════════════════════════════════════════════════════════════════════
const capability = node("svc_v3_capability")
capability.desc =
  "Encuentra empresas por tecnología o proceso, con circuito de dos pasos screening -> detalle. La v2 (21-ago-2026) la volvió ACCIONABLE: minSignals filtra por volumen de evidencia ANTES del LIMIT, termHits desglosa [{term, signals}] en vez de devolver una lista de nombres, termsMode 'all' resuelve la intersección en el servidor, el cursor paginado convierte truncated:true en algo navegable, excluded.serviceProviders declara lo que el default descartaba en silencio, e include:['firmographics'] suma LinkedIn, dominio, dotación y si cotiza."
capability.files = [
  "lib/v3/services/capability-search.ts",
  "supabase/migrations/20260821162500_capability_search_v2.sql",
]
capability.notes =
  "Los keywords del diccionario PARTEN familias de producto: cortar por keyword exacta pierde resultados ('Dynamics 365' son dos productos, CRM y ERP; 'Microsoft' son 10). Por eso la unidad de intersección del modo AND es el TÉRMINO PEDIDO y no la entrada del diccionario: exigir las dos entradas sería exigir algo que nadie pidió. El cursor es un offset firmado con la forma de la consulta —cambiar un filtro y conservar el cursor devuelve CAPABILITY_CURSOR_MISMATCH en vez de la página N de otra cosa, que es el error más fácil de cometer para un cliente IA."
capability.risk =
  "Un renombre que era un bug de lectura: currentEmployees NO eran empleados, eran CONTACTOS de la base de ASCI. Mercado Libre figuraba con 122 teniendo 85.000. Hoy son contactsInBase / alumniInBase y la dotación real sale sólo de firmographics.employeesApollo, con null explícito (cobertura ~1%) para que 'chica' no se confunda con 'no sabemos'. El cambio de firma obligó a DROP + CREATE, y como los ALTER DEFAULT PRIVILEGES del proyecto le dan EXECUTE a anon y authenticated, revocar de PUBLIC no alcanzaba: siendo SECURITY DEFINER, sin el REVOKE explícito quedaba como lector anónimo de companies y signals."

const flowCapability = j.flows.find((f) => f.id === "f_capability_search")
flowCapability.desc =
  "El MCP afirmaba que ASCI no permitía búsquedas inversas y era falso: las RPC de v2 ya tenían EXECUTE para service_role, sólo faltaba la tool. La v2 de la RPC (21-ago) cerró la segunda mitad del problema: el resultado era interpretable pero NO accionable, y todo lo que faltaba se terminaba resolviendo a mano contra Supabase, con accesos que el usuario final no tiene."
flowCapability.steps = [
  { n: 1, nodeId: "ext_mcp_client", detail: "Consulta por capacidad. La nube de términos la aporta el modelo: no hay diccionario de sinónimos." },
  {
    n: 2,
    nodeId: "svc_v3_capability",
    edgeId: "e101",
    detail:
      "Resuelve los términos a IDs del diccionario devolviendo TODAS las coincidencias, no la primera. Con termsMode='all' un término sin resolver hace fallar la llamada a propósito: la intersección sin él daría un número que se leería como si fuera el pedido.",
  },
  {
    n: 3,
    nodeId: "db_dictionary",
    edgeId: "e103",
    detail: "Cuidado: los keywords PARTEN familias de producto, cortar por keyword exacta pierde resultados.",
  },
  {
    n: 4,
    nodeId: "db_companies",
    edgeId: "e102",
    detail:
      "RPC v3.search_companies_by_capability (SECURITY DEFINER, EXECUTE sólo para service_role). Medido con 1,7M de señales: peor caso 4,96 s, caso real 0,24 s. El costo dominante es leer public.signals; termHits se agrega SOLO para las <=50 filas de la página, porque las otras dos variantes costaban 1,1 s y 33 s.",
  },
  {
    n: 5,
    nodeId: "ext_mcp_client",
    detail:
      "guidance le dice al modelo qué hacer con ESTOS números: hasta ~200 empresas, cuántas llamadas son encadenando cursor; por encima, que no pagine y acote —889 filas son 18 llamadas y ~130k tokens— y que NO prometa un archivo ni una descarga, que es lo que un modelo hace cuando se queda sin salida. Las páginas se cuentan contra el límite MÁXIMO, no contra el que venía usando para explorar.",
  },
]

// ═══════════════════════════════════════════════════════════════════════════
// PRs #114-#116 — navegación, "investigadas recientemente" y decisores
// ═══════════════════════════════════════════════════════════════════════════
const uiAccounts = node("ui_v3_accounts")
uiAccounts.desc =
  "Listado de cuentas seguidas y bookmark de cuenta. El bookmark dejó de tener pestañas el 21-ago: es UNA sola vista con el informe completo y las secciones antes escondidas (hallazgos, señales fit, contexto, icebreakers, historial) como bloques colapsados que no se renderizan si están vacíos. La única acción es buscar decisores; todo lo demás se busca solo."
uiAccounts.files = [
  "app/v3/accounts/page.tsx",
  "app/v3/accounts/loading.tsx",
  "app/v3/accounts/[companyId]/page.tsx",
  "app/v3/accounts/[companyId]/loading.tsx",
  "app/v3/accounts/[companyId]/_components/account-detail-view.tsx",
  "app/v3/accounts/[companyId]/_components/account-report-view.tsx",
  "app/v3/accounts/[companyId]/_components/decision-makers-section.tsx",
]
uiAccounts.notes =
  "Tres arreglos de percepción de velocidad, del 21-ago. (1) LOADING BOUNDARIES: no había NINGÚN loading.tsx en /v3 y sin boundary el App Router espera la respuesta completa antes de cambiar de página — la pantalla no tardaba en pintar, no EMPEZABA a pintar. (2) STREAMING: la promesa del informe viaja a la vista sin await y se consume con use() dentro de tres Suspense (chip de estado, fechas, informe), así el encabezado se pinta enseguida; por contrato la promesa NUNCA rechaza (el error se convierte en null en el server component), así que use() no necesita error boundary. No se usaron componentes async como JSX porque @types/react 19.0.0 no acepta Promise<Element> en JSX.ElementType. (3) El encabezado muestra DataFreshness —'actualizado hace X · próxima actualización: fecha'—, donde la próxima es la de la fuente que vence ANTES, que es cuando el informe efectivamente cambia."
uiAccounts.risk =
  "Se sacó el CTA 'Investigar': prometía research y sólo navegaba a /v3/chat sin preseleccionar la cuenta. Con las pestañas se fueron también sus empty states, que eran los que pedían 'investiga esta cuenta desde el chat'. El funnel quedó seguir -> decisores -> icebreaker -> contactar."

const scoring = node("svc_v3_scoring")
scoring.desc =
  "Fit preliminar, scoring definitivo, perfil de fit del workspace y recomendador de propuesta de valor. summarizeCachedSignalsBatch resuelve N empresas en 3 queries en vez de 3 por empresa; summarizeCachedSignals quedó como wrapper sobre el lote para que el matching tenga UNA implementación."
scoring.notes =
  "El tope por empresa se aplica en memoria y NO en SQL a propósito: un limit global sobre el IN recortaría empresas enteras en vez de findings de cada una — el mismo error que tenía el .limit(50) de 'Cuentas investigadas recientemente'."
scoring.risk =
  "Lección del 21-ago que aplica a todo el repo: `data ?? []` sobre una respuesta de Supabase convierte un error de esquema en 'no hay datos', indistinguible del caso legítimo. getRecentlyResearchedAccounts consultaba v3.research_jobs.completed_at, una columna que no existe (la real es finished_at): PostgREST devolvía 42703, el código lo tragaba y la sección NUNCA mostró una sola tarjeta, en silencio. Ahora se loguea el error, como ya hacían getRadarFindings y listAccountJobPostings."

addNodeAfter("svc_apollo", {
  id: "svc_shared_apollo_dm",
  label: "Decisores (Apollo) compartido",
  zone: "shared",
  layer: 3,
  kind: "service",
  desc: "Pipeline ÚNICO de búsqueda de decisores: resuelve la organización antes de buscar (mucho más preciso que el dominio), cachea por query_hash determinístico para no repagar la misma búsqueda, enriquece en lotes de 4 y deduplica por apollo_person_id -> linkedin_url -> full_name. Lo llaman el tab de prospectos de v2 (como wrapper que resuelve su bookmark y su search_context) y la sección de decisores del bookmark de v3.",
  files: ["lib/shared/apollo-decision-makers.ts", "lib/shared/apollo-title-groups.ts"],
  notes:
    "Se extrajo en vez de copiarse: habría sido la TERCERA vez que este repo paga tener dos implementaciones del mismo pipeline (pasó con las noticias y con el research). Los decisores aterrizan en los mismos dos lugares que en v2 —user_company_contacts con source 'apollo' e is_decision_maker true, y apollo_contacts_cache—, y por eso un decisor encontrado desde cualquiera de los dos mundos aparece en el bookmark del otro. bookmark_id va en null desde v3: es una columna de v2 y la tabla la acepta nullable. El reveal de teléfono sigue removido: Apollo consumía 5 créditos por reveal y el webhook de entrega asincrónica nunca llegaba.",
})
addEdge({ id: "e183", from: "svc_shared_apollo_dm", to: "ext_apollo", kind: "call", label: "organización -> search -> enrich" })
addEdge({ id: "e184", from: "svc_shared_apollo_dm", to: "db_apollo_cache", kind: "rw", label: "cache por query_hash" })
addEdge({ id: "e185", from: "svc_shared_apollo_dm", to: "db_contacts", kind: "write", label: "user_company_contacts" })
addEdge({ id: "e186", from: "svc_apollo", to: "svc_shared_apollo_dm", kind: "call", label: "v2 quedó como wrapper" })
addEdge({ id: "e187", from: "ui_v3_accounts", to: "svc_shared_apollo_dm", kind: "call", label: "única acción del bookmark" })
addEdge({ id: "e188", from: "ui_v2_bookmarks", to: "svc_shared_apollo_dm", kind: "call", label: "tab de prospectos" })

node("svc_apollo").desc =
  "Search, enrich, organizations, cache por hash de query, validación de títulos, parsers y dominio. El pipeline de búsqueda de decisores salió de acá a lib/shared/ el 21-ago para que lo usen las dos versiones; v2 quedó como wrapper."

const apolloCache = node("db_apollo_cache")
apolloCache.desc =
  "Cache de Apollo por hash de query. Dejó de ser sólo de v2: desde el 21-ago v3 también ESCRIBE acá cuando busca decisores desde el bookmark, y es lo que hace que un decisor encontrado en cualquiera de los dos mundos aparezca en el otro."
apolloCache.notes =
  "Está indexado por dominio de la empresa, no por companyId. Es cache legacy sólo de nombre: es la tabla que lee getCompanyCachedContacts de v3."

cp("cp_apollo").desc =
  "v3 lee el cache que v2 ya pagó antes de llamar al proveedor, y desde el 21-ago también escribe en él: la búsqueda de decisores del bookmark de v3 y el tab de prospectos de v2 son el MISMO módulo (lib/shared/apollo-decision-makers.ts) y aterrizan en las mismas dos tablas."
cp("cp_apollo").nodes = ["db_apollo_cache", "svc_v3_cache_reader", "svc_apollo", "svc_shared_apollo_dm"]
cp("cp_apollo").impact =
  "Cambiar el esquema de hash de query invalida el cache para las dos versiones. Y ahora la escritura también es compartida: un decisor guardado desde v3 aparece en el bookmark de v2 del mismo usuario, que es deseado, pero significa que un bug en el dedupe contamina las dos puntas."

cp("cp_news").desc =
  "El esquema y el MCP tratan las noticias como pool público por compañía, pero la RLS las ata a bookmarks personales de v2. Desde el 21-ago la separación quedó explícita en el esquema: el HECHO vive en public.company_news (global, compartido), el INTENTO en public.company_news_scrapes (global) y la LECTURA en v3.account_news_readings (por workspace)."
cp("cp_news").nodes = ["db_company_news", "db_news_scrapes", "db_account_reports", "svc_v3_drilldown", "svc_v3_report"]
cp("cp_news").impact =
  "Un miembro de workspace v3 no ve noticias en la web. Además el UPDATE no tiene WITH CHECK. Lo que SÍ se cerró: company_news.source ya no acepta 'parallel' y quedó marcada LEGACY, así que la procedencia real (produced_by + ai_provider) es la única fuente sobre qué motor produjo cada fila."

cp("cp_jobs").desc =
  "job_postings las escriben el ETL de v2 y el corredor de v3, y las lee el diccionario de las dos. Desde el 19-ago la tabla tiene policy de lectura para authenticated: tenía RLS habilitado desde la baseline y NUNCA una policy, así que dos RPC que corren como INVOKER devolvían 0 con vacantes reales (get_company_signal_summary, o sea la tarjeta 'Búsquedas Laborales' de v2, y search_companies_by_process)."
cp("cp_jobs").impact =
  "Una vacante mal atribuida entra al diccionario y se vuelve señal falsa visible en la búsqueda de v2: contaminación que cruza de v3 a producción. Por eso el guardrail de pertenencia no es opcional y el filtro por companyId de LinkedIn es el camino preferido."

const flowJobs = j.flows.find((f) => f.id === "f_jobs_apify")
flowJobs.trigger = "Cron cada 10 minutos sobre las cuentas seguidas, o etapa del pipeline de research"
flowJobs.desc =
  "El actor puede filtrar por companyId numérico de LinkedIn (EXACTO) o por título de puesto. Cuando cae al segundo, devuelve vacantes de cualquier empresa que matchee, y sin guardrail de pertenencia se contaminan las de la cuenta."
flowJobs.steps = [
  { n: 1, nodeId: "cron_v3_scrape_jobs", detail: "Toma las cuentas seguidas que tocan y MARCA EL INTENTO antes de gastar." },
  {
    n: 2,
    nodeId: "svc_v3_jobs",
    detail: "Arma la query: companyId si la compañía tiene linkedin_company_id, variantes de nombre si no. publishedAt es un enum cerrado.",
  },
  { n: 3, nodeId: "ext_apify", edgeId: "e74", detail: "bebity/linkedin-jobs-scraper." },
  {
    n: 4,
    nodeId: "db_job_postings",
    edgeId: "e75",
    detail:
      "CONTACTO con v2: belongsToCompany descarta lo ajeno ANTES de insertar y el resultado dice cuántas se cayeron. Sin URL no se inserta: no se podría deduplicar.",
  },
  { n: 5, nodeId: "svc_v3_dictionary", edgeId: "e128", detail: "Interpreta la vacante contra el diccionario." },
]

// ── Flujos nuevos ───────────────────────────────────────────────────────────
addFlow({
  id: "f_account_report",
  name: "Radiografía comercial del bookmark (v3)",
  version: "v3",
  trigger: "El usuario abre una cuenta seguida en /v3/accounts/[companyId]",
  desc: "Abrir el bookmark NO dispara búsquedas: lo caro (los dos bundles de noticias, ~US$0,20) sale UNA vez al marcar la cuenta y el cron lo refresca. Abrir cien veces con los mismos datos no gasta nada.",
  steps: [
    {
      n: 1,
      nodeId: "ui_v3_accounts",
      detail:
        "La página arranca getAccountReportData y NO la espera: la promesa viaja a la vista. Con loading.tsx presente, el router cambia de pantalla enseguida.",
    },
    {
      n: 2,
      nodeId: "svc_v3_report",
      edgeId: "e175",
      detail: "~6 etapas de queries. Todo lo determinístico (semáforo, scorecard, movimientos, vacantes, noticias, método) se arma acá sin costo.",
    },
    {
      n: 3,
      nodeId: "db_account_reports",
      edgeId: "e169",
      detail:
        "Si inputs_fingerprint no cambió, los tres textos con IA salen de cache. Si cambió (entraron vacantes o noticias, o cambió la propuesta de valor), se regeneran en UNA llamada batch de ~US$0,001.",
    },
    {
      n: 4,
      nodeId: "svc_v3_ai",
      edgeId: "e174",
      detail: "Resumen ejecutivo en 4 puntos, ángulos de entrada y riesgos. Por workspace: los ángulos de quien vende datacenters no son los de un workspace de staffing.",
    },
    {
      n: 5,
      nodeId: "ui_v3_accounts",
      detail: "Tres Suspense desenvuelven la MISMA promesa con use(): chip de estado, fechas de refresco e informe aterrizan sin bloquearse entre sí.",
    },
  ],
})
addFlow({
  id: "f_decision_makers",
  name: "Decisores de Apollo (v2 + v3)",
  version: "shared",
  trigger: "El usuario elige cargos en el bookmark de v3 o en el tab de prospectos de v2",
  desc: "La ÚNICA acción del bookmark de v3. Los cargos vienen presugeridos: getAccountSignals ya cruzaba las señales fit con ROLE_RULES y marcaba cuáles están cubiertos por el cache, así que arrancan preseleccionados salvo los ya cubiertos — volver a buscarlos es gastar una llamada.",
  steps: [
    { n: 1, nodeId: "ui_v3_accounts", edgeId: "e187", detail: "Cargos sugeridos + grupos por área + campo libre. País con mapToApolloCountry, que sabe que companies.country guarda direcciones enteras." },
    { n: 2, nodeId: "svc_shared_apollo_dm", detail: "Resuelve la ORGANIZACIÓN antes de buscar y consulta el cache por query_hash. Si pega, no llama al proveedor." },
    { n: 3, nodeId: "ext_apollo", edgeId: "e183", detail: "search + enrich en lotes de 4. Sin reveal de teléfono: consumía 5 créditos y el webhook nunca llegaba." },
    { n: 4, nodeId: "db_apollo_cache", edgeId: "e184", detail: "Escribe también acá, que es la tabla que v3 YA leía: por eso el decisor aparece en el bookmark del otro mundo." },
    { n: 5, nodeId: "db_contacts", edgeId: "e185", detail: "user_company_contacts con source 'apollo' e is_decision_maker true. La lista se devuelve SIEMPRE, también cuando Apollo falla." },
  ],
})
addFlow({
  id: "f_explore_mcp",
  name: "Embudo del MCP Explore",
  version: "v3",
  trigger: "Un agente busca empresas por capacidad sobre la tabla cruda",
  desc: "El mismo objetivo que la búsqueda inversa del MCP estándar, por el otro camino: sin diccionario, contra el texto de contactos y vacantes. Corre en paralelo para MEDIR cuál resuelve en menos llamadas.",
  steps: [
    { n: 1, nodeId: "ext_mcp_client", edgeId: "e147", detail: "explore_start con la nube de términos que arma el modelo." },
    { n: 2, nodeId: "svc_v3_explore", edgeId: "e153", detail: "prepareTerms + facetas de país e industria para acotar antes de listar." },
    { n: 3, nodeId: "db_explore_sessions", edgeId: "e160", detail: "La sesión guarda el estado del embudo entre llamadas." },
    { n: 4, nodeId: "svc_db_direct", edgeId: "e156", detail: "Conexión directa: public.contacts son ~2,4 GB con GIN trigram y en frío pasa el corte de 8s de PostgREST." },
    { n: 5, nodeId: "db_contacts", edgeId: "e158", detail: "explore_companies / explore_company_people. Desde ahí se puede saltar a scrapear vacantes o a buscar decisores." },
  ],
})
addFlow({
  id: "f_profiles_mcp",
  name: "Búsqueda de talento (MCP Perfiles)",
  version: "v3",
  trigger: "Un agente busca PERSONAS por lo que saben, no empresas",
  desc: "Invierte el eje de los otros dos MCP. Los requisitos se intersecan (AND entre requisitos, OR de sinónimos dentro de cada uno) y el match es literal por palabra completa sobre texto libre: no es semántico, el vocabulario lo aporta el modelo.",
  steps: [
    { n: 1, nodeId: "ext_mcp_client", edgeId: "e148", detail: "profiles_search con requirements. Las facetas (profiles_countries / industries) miran el puesto ACTUAL, así que son una aproximación para acotar." },
    { n: 2, nodeId: "svc_v3_profiles", edgeId: "e154", detail: "Anclas \\y sólo del lado que empieza/termina en palabra, para que '.NET', 'C#' y 'C++' matcheen." },
    { n: 3, nodeId: "svc_db_direct", edgeId: "e157", detail: "v3.profiles_search_people por conexión directa. Sumar requisitos es más RÁPIDO: el planner interseca bitmaps antes del heap." },
    { n: 4, nodeId: "db_contacts", edgeId: "e159", detail: "Puesto actual por default; includePast suma contacts_prevpos_text y recupera ~21.500 perfiles de SAP que la v1 perdía." },
  ],
})
addFlow({
  id: "f_account_import",
  name: "Carga masiva de cuentas por archivo",
  version: "v3",
  trigger: "Un admin sube un archivo de cuentas a un workspace",
  desc: "Interactivo, no de cola: el usuario REVISA los matches antes de confirmar. Por eso no reusa import_batches/import_rows de v2, que exigirían tocar el PL/pgSQL de process_import_batch.",
  steps: [
    { n: 1, nodeId: "ui_v3_admin", edgeId: "e168", detail: "Upload y pantalla de review." },
    { n: 2, nodeId: "svc_v3_imports", edgeId: "e167", detail: "Resuelve cada fila contra public.companies." },
    { n: 3, nodeId: "db_account_imports", edgeId: "e165", detail: "El lote y sus filas quedan persistidos con el match propuesto." },
    { n: 4, nodeId: "db_followed", edgeId: "e166", detail: "Al confirmar, followAccount por fila. Opcionalmente puentea a v2 creando bookmarks para usuarios seleccionados." },
  ],
})

// ═══════════════════════════════════════════════════════════════════════════
// deadCode: lo que se resolvió y lo que sigue
// ═══════════════════════════════════════════════════════════════════════════
const d01 = dead("DEAD-01")
d01.severity = "resuelta"
d01.title = "RESUELTO: app/actions/v3/csv-import.ts, feature completa contra tablas que no existían"
d01.recommendation =
  "BORRADO el 19-ago-2026 y reemplazado por la carga masiva real: app/actions/v3/account-imports.ts + lib/v3/services/account-import.ts, sobre v3.account_imports y v3.account_import_rows, creadas por su propia migración. Se cumplió lo que decía la recomendación: la ingesta volvió junto con su migración."

const d02 = dead("DEAD-02")
d02.severity = "resuelta"
d02.title = "RESUELTO: app/actions/v3/apollo.ts sin consumidores"
d02.evidence = [
  "app/v3/accounts/[companyId]/page.tsx importa listDecisionMakers",
  "decision-makers-section.tsx importa searchDecisionMakersAction",
]
d02.finding =
  "Eran 509 líneas de server actions de Apollo que nadie invocaba. El 21-ago el archivo se reescribió de cero (509 -> 115 líneas): delega el pipeline en lib/shared/apollo-decision-makers.ts y deja sólo lo propio de v3 —autorizar por workspace y devolver la lista para refrescar la sección sin recargar."
d02.recommendation =
  "Nada pendiente. La preocupación original —'mantener dos entradas a Apollo en v3 invita a que una quede sin el guardrail de cuota'— se resolvió por la vía contraria a borrar: hoy hay UNA sola entrada y la comparten v2 y v3."

const d09 = dead("DEAD-09")
d09.title = "Tres tabs del drilldown de bookmarks huérfanos (eran cuatro)"
d09.evidence = [
  "app/bookmarks/[id]/_components/contacts-tab.tsx (185)",
  "news-tab.tsx (319)",
  "public-docs-tab.tsx (424)",
  "RESUELTO en parte: signals-tab.tsx (184) se borró el 21-ago-2026",
]
d09.finding =
  "Eran cuatro componentes de tab sin consumidor. signals-tab.tsx ('Investigación Web Privada') se borró con el retiro de Perplexity, que era su motor. Los otros tres siguen: sus funciones quedaron absorbidas por intelligence-tab.tsx, que sí está referenciado."
d09.recommendation =
  "Borrar los tres que quedan. Son 928 líneas que aparecen en toda búsqueda de código del drilldown y compiten con la implementación vigente."

addDead({
  id: "DEAD-15",
  title: "RESUELTO: el motor de búsqueda de Perplexity y sus tres funciones",
  severity: "resuelta",
  loc: 540,
  evidence: [
    "generatePerplexityContent (lib/ai-service.ts), searchWebSignals, searchWeb y getPrivateSignals (app/actions/workspace.ts)",
    "app/bookmarks/[id]/_components/signals-tab.tsx",
    "user_company_signals: 0 filas",
  ],
  finding:
    "Era el tercer motor de búsqueda web del sistema y estaba muerto en los hechos, pero seguía costando: su gasto era el único que no entraba en v3.ai_usage_log y escribía evidencia con .insert() crudo, esquivando el contrato. Se midió antes de borrar: su tabla propia tenía 0 filas, el componente que lo mostraba no estaba montado en ninguna página y searchWeb era una casi gemela sin callers.",
  verification:
    "Grep de PERPLEXITY_API_KEY y de cada símbolo en todo el repo: sin referencias vivas. La tabla user_company_signals se CONSERVA a propósito porque la lee el armador de contexto de icebreakers.",
  recommendation:
    "Nada pendiente. Queda UN motor de búsqueda: collect con búsqueda server-side de Anthropic por el AI Gateway, para noticias, radar y documentos públicos, en v2 y en v3. La única llamada directa a un proveedor que sobrevive es la lectura VISUAL de PDFs en lib/documents/extract-text.ts, que está señalada en el diseño para que no se confunda con un olvido.",
})

addDead({
  id: "DEAD-16",
  title: "RESUELTO: la deuda de tsc y lint que ocultaba ignoreBuildErrors",
  severity: "resuelta",
  loc: 0,
  evidence: [".github/workflows/ci.yml", "next.config.mjs sin ignoreBuildErrors ni ignoreDuringBuilds"],
  finding:
    "next build tenía ignoreBuildErrors activo, así que los errores de tipo no frenaban un deploy. Al montar el gate de CI (typecheck + lint + tests) aparecieron 62 errores de tsc preexistentes y ESLint sin configuración flat.",
  verification:
    "Se saldó la deuda en dos pasadas y recién entonces se sacó el flag; hoy un error de tipo rompe el build. En el camino se borraron lib/parallel-extract.ts y lib/search/search-provider.ts, y se corrigió un test con una aserción de query-hash desactualizada que nadie corría.",
  recommendation:
    "Nada pendiente. La lección para el mapa: dos de los tres 'código muerto de severidad baja' se fueron solos cuando hubo un gate que los nombrara.",
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
