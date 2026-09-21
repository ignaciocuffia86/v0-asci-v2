/**
 * Actualiza docs/architecture-map.json con TODO lo que entró entre el 24-ago-2026
 * (última pasada completa) y el 21-sep-2026: 69 commits no-merge que tocan
 * app/, lib/, supabase/migrations/ o vercel.json (`git log 1a7ee0c..origin/main`).
 *
 * Es la primera pasada desde que el mapa se puso al día el 24-ago, así que no
 * hay atajo: se revisó cada commit contra el código de HOY, no contra lo que el
 * mensaje del commit dice que hizo (dos afirmaciones del mapa anterior ya habían
 * quedado falsas por commits posteriores — ver más abajo, "correcciones").
 *
 * TEMAS, por peso:
 *
 *   1. CUARTO SERVIDOR MCP — "admin" (app/api/v3/mcp/admin). No es una cuarta
 *      copia del andamiaje: comparte las 45 tools con el estándar a través de
 *      UN factory (lib/v3/mcp-server-tools.ts, createV3McpHandler), y lo único
 *      propio de cada ruta son las `instructions`. Esto resuelve la MITAD de
 *      OPT-07 (server+admin dejaron de duplicar registro de tools; explore y
 *      profiles lo siguen duplicando).
 *   2. SUBSISTEMA screening → batch → export → costo, enteramente nuevo: cruzar
 *      una lista de cuentas del cliente contra señales en una llamada
 *      (screen_account_list), cotizar y autorizar un lote con un solo
 *      batchPlanHash, ejecutarlo, exportarlo a un archivo con URL firmada en vez
 *      de transcribirlo al chat, y cerrar con un resumen de costo que declara la
 *      CALIDAD de cada número (medido vs. estimado). 5 tablas nuevas en v3.
 *   3. APOLLO — pipeline de enrichment de organizaciones por cola (cron cada
 *      10m) y de resolución de dominio por NOMBRE para las que no tienen
 *      website (implementado, aplicado, y PAUSADO 12 días después: el schedule
 *      salió de vercel.json y la cola quedó a mitad de camino). Más: caché
 *      revisado ANTES de salir a Apollo (21,8% de gasto evitado, medido),
 *      teléfonos por MCP con webhook asíncrono que ahora escribe en v2 Y v3, y
 *      un ledger de costo por corrida de Apify.
 *   4. IDENTIDAD DE PERSONA Y EMPRESA (docs/analisis-inputs-companias-
 *      contactos-senales.md) — Fase 0 completa: merge_companies deja de perder
 *      linkedin_company_id y los campos de Apollo del duplicado, el ETL de
 *      vacantes deja de fabricar identidad falsa (website ← URL de LinkedIn,
 *      country ← ubicación del aviso), previous_positions pasa de pisarse a
 *      mergearse, y las funciones que sólo vivían en scripts/ (upsert_company,
 *      merge_companies, company_core_name) se consolidaron en migraciones.
 *      Contactos: fusión reversible de duplicados de persona (2.170 fusiones,
 *      cero errores) sobre un nuevo resolver de identidad que deja de crear un
 *      contacto nuevo cada vez que LinkedIn cambia el slug de la URL.
 *   5. DICCIONARIO — auditoría con siete lotes de keywords por co-ocurrencia
 *      (contexto que suma, exclusiones que descartan por colocación) y tres
 *      ejes de taxonomía, documentado en docs/auditoria-diccionario-tecnologia.md.
 *   6. CALIDAD DE DATOS puntual: 25.056 vacantes con posted_at recuperado
 *      (fecha de carga por fecha real), cupo de 100 en el drawer de vacantes,
 *      todas las señales detectadas por vacante (no una arbitraria), la UI
 *      explica por qué el contador de la lista y el drawer difieren.
 *
 * CORRECCIONES a afirmaciones del mapa anterior que dejaron de ser ciertas
 * (PASO 2 — esto es lo que más vale de esta pasada, no lo nuevo):
 *   - svc_shared_apollo_dm decía "el reveal de teléfono sigue removido". Volvió:
 *     fc25cba (27-ago) lo reintroduce por MCP con webhook asíncrono.
 *   - api_apollo_webhook estaba marcado zone "v2". Desde 583bc4e also escribe
 *     el lado v3 (receivePhoneForV3) en la misma request: es compartido.
 *   - svc_apollo decía "11 módulos"; son 18 (creció con el enrichment por cola,
 *     el lookup de dominio y el writer con reglas de precedencia).
 *   - OPT-06 (createClient crudo) decía 13 archivos; son 16 — empeoró, no
 *     mejoró: los módulos nuevos de lib/apollo/ instancian su propio cliente.
 *   - DEAD-12 daba dos tablas sin lector; dictionary_term_suggestions ya tiene
 *     uno (lib/v3/services/dictionary.ts), bookmark_dedupe_log sigue sin lector.
 *
 * HALLAZGO NUEVO, no arreglado a propósito (regla del mapa: anotar, no tocar
 * código de la app desde esta rutina): lib/v3/services/value-proposition-
 * recommender.ts:33 selecciona columnas de job_postings que no existen
 * (posted_date, url — son posted_at, job_url). La tool que lo llama falla
 * siempre. Ver OPT-17.
 *
 * NO VERIFICADO: DEAD-11 (APOLLO_WEBHOOL_SECRET con typo) es sobre variables
 * de entorno de Vercel, no sobre código — esta pasada no tocó Vercel, así que
 * queda como estaba. El código SÍ es consistente: las 6 lecturas de
 * APOLLO_WEBHOOK_SECRET en el repo usan la ortografía correcta.
 *
 * Se hace por SCRIPT y no con ediciones de texto por la misma razón que las
 * veces anteriores: son ~4.600 líneas de JSON y una edición de texto ya rompió
 * la estructura una vez. Idempotente: correrlo dos veces deja el mismo
 * resultado byte a byte.
 *
 * Correr:  node scripts/update-architecture-map-2026-09-21.mjs
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
  if (at < 0) throw new Error(`addNodeAfter: nodo de referencia inexistente: ${afterId}`)
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
const addDead = (d) => {
  const at = j.deadCode.findIndex((x) => x.id === d.id)
  if (at >= 0) j.deadCode[at] = d
  else j.deadCode.push(d)
}
const addOpt = (o) => {
  const at = j.optimizations.findIndex((x) => x.id === o.id)
  if (at >= 0) j.optimizations[at] = o
  else j.optimizations.push(o)
}

// ═══════════════════════════════════════════════════════════════════════════
// meta
// ═══════════════════════════════════════════════════════════════════════════
j.meta.generatedAt = "2026-09-21"
j.meta.summary =
  "Monorepo Next.js único donde conviven ASCI v2 (producción, schema public) y ASCI v3 (multitenant, schema v3) sobre la MISMA base Supabase. El aislamiento es por schema, no por proyecto ni por base. " +
  "Actualización 2026-09-21: repaso de los 69 commits que entraron desde la pasada del 24-ago (la primera desde que el mapa se puso al día). Por peso: " +
  "(1) CUARTO SERVIDOR MCP, 'admin' — comparte las 45 tools con el estándar a través de un único factory (createV3McpHandler); ya no las duplica, sólo cambian las instructions del handshake. Encima se construyó un subsistema nuevo: screen_account_list cruza una lista de cuentas del cliente contra señales en una llamada, estimate_batch/create_batch_job cotizan y autorizan un lote con un solo batchPlanHash, create_export entrega un archivo con URL firmada en vez de transcribir la tabla al chat, y get_cost_summary cierra declarando si cada número es medido o estimado. " +
  "(2) APOLLO — enrichment de organizaciones por cola (cron cada 10m, sólo consume lo sembrado) y resolución de dominio por NOMBRE para el 88% del catálogo sin website: implementado, aplicado (420.753 filas sembradas) y PAUSADO 12 días después al sacar el cron de vercel.json — la cola quedó donde estaba, reanudar es una línea. Antes de salir a Apollo ahora se revisa el caché completo (21,8% de gasto evitado, medido sobre 4.223 llamadas históricas), y el webhook de teléfonos por MCP es asíncrono y ahora escribe en v2 Y v3 desde la misma request. " +
  "(3) IDENTIDAD — Fase 0 completa contra el catálogo real: merge_companies dejaba de perder linkedin_company_id y los campos de Apollo del duplicado que se borraba; el ETL de vacantes fabricaba identidad falsa (website ← URL de LinkedIn, country ← ubicación del aviso) y dejó de hacerlo; previous_positions pasaba de pisarse a mergearse; y las funciones que sólo vivían en scripts/ se consolidaron en migraciones. Aparte, fusión reversible de 2.170 duplicados de contacto sobre un resolver de identidad nuevo. " +
  "(4) DICCIONARIO — siete lotes de keywords medidos por co-ocurrencia (contexto que suma, exclusiones por colocación) y tres ejes de taxonomía nuevos. " +
  "(5) CORRECCIONES al propio mapa — el reveal de teléfono de Apollo, que el mapa anterior daba por removido, volvió por MCP; el webhook de Apollo dejó de ser sólo de v2; svc_apollo creció de 11 a 18 módulos; y OPT-06 empeoró (13→16 archivos con cliente Supabase crudo) porque los módulos nuevos de Apollo no pasan por los helpers. " +
  "(6) Un bug real encontrado y NO arreglado desde esta rutina (regla: sólo documentación): una tool del MCP llama a una función que selecciona columnas de job_postings que no existen y falla siempre (OPT-17)."
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
// TEMA 1 — Cuarto servidor MCP: "admin", y consolidación del registro de tools
// ═══════════════════════════════════════════════════════════════════════════
const mcpServer = node("api_mcp_server")
mcpServer.label = "MCP estándar (45 tools)"
mcpServer.desc =
  "Perfil 'standard' del servidor MCP asci-v3: el que usa un cliente pago normal, con topes de plan. Desde el 26-ago-2026 sus 45 tools NO se registran acá: viven en lib/v3/mcp-server-tools.ts (createV3McpHandler) y esta ruta sólo aporta sus `instructions` propias de handshake. El perfil 'admin' (api_mcp_admin) registra las MISMAS 45 tools desde el mismo módulo."
mcpServer.risk =
  "Ya no concentra el registro de tools (eso resuelve la mitad de OPT-07), pero sigue siendo el único punto donde auth, cuota y transporte se instancian para este perfil — y esa parte se sigue copiando en las otras tres rutas."
mcpServer.notes =
  "Creció de 37 a 45 tools desde el 24-ago: el subsistema completo de screening → batch → export → costo (screen_account_list, estimate_batch, create_batch_job, create_export, get_cost_summary), enrichment de contactos por Apollo con planHash (prepare_contact_enrichment, run_contact_enrichment), y pedido de teléfonos (request_contact_phones)."

addNodeAfter("api_mcp_profiles", {
  id: "api_mcp_admin",
  label: "MCP admin (mismas 45 tools)",
  zone: "v3",
  layer: 2,
  kind: "mcp",
  desc:
    "Perfil 'admin' de asci-v3, para el equipo de ASCI: catálogo GLOBAL sin necesidad de guardar la cuenta, y con los topes de plan levantados (unrestricted). Registra EXACTAMENTE las mismas 45 tools que el estándar desde lib/v3/mcp-server-tools.ts — createV3McpHandler rechaza en el handshake cualquier credencial sin el marcador unrestricted. Lo único propio de esta ruta es el texto: estas INSTRUCTIONS y las 9 reglas de ADMIN_DESCRIPTION_RULES que reescriben la descripción de cada tool para el contexto admin.",
  files: ["app/api/v3/mcp/admin/[transport]/route.ts", "lib/v3/mcp-server-tools.ts"],
  risk:
    "Sin cupo mensual ni presupuesto de lote que frene un gasto (unrestricted=true): lo que lo hace defendible no es un tope sino que get_cost_summary deja todo medido. run_contact_enrichment y request_contact_phones siguen avisando el costo ANTES de gastar aunque no haya tope que lo bloquee — es un aviso, no una cotización a aceptar. remove_workspace_account y confirm_document_analysis son las dos excepciones que SÍ siguen pidiendo el visto bueno del usuario, tope o no.",
  notes:
    "Se puede usar desde un conector de claude.ai (de3a548, 26-ago): la credencial admin funciona igual por OAuth que por API key, así que no hace falta una integración MCP dedicada para operarlo desde un chat de Claude normal.",
})

addEdge({ id: "e193", from: "ext_mcp_client", to: "api_mcp_admin", kind: "call", label: "tool call (unrestricted)" })
addEdge({ id: "e194", from: "api_mcp_admin", to: "svc_v3_mcp_auth", kind: "call", label: "rechaza si no es unrestricted" })
addEdge({ id: "e195", from: "api_mcp_admin", to: "svc_v3_usage", kind: "call", label: "auditoría, sin rate limit" })

const mcpTools = node("svc_v3_mcp_tools")
mcpTools.label = "Tools MCP (registro compartido)"
mcpTools.desc =
  "Implementación y registro de las 45 tools que comparten los perfiles standard y admin: lectura, ciclo de vida de cuenta, circuito client-assisted, y desde el 26-ago el subsistema completo de screening/batch/export/costo y enrichment de contactos por Apollo. lib/v3/mcp-server-tools.ts es el ÚNICO lugar donde se llama .tool(): las rutas standard y admin sólo pasan profile + instructions."
mcpTools.files = [
  "lib/v3/mcp-server-tools.ts",
  "lib/v3/mcp-read-tools.ts",
  "lib/v3/mcp-account-lifecycle.ts",
  "lib/v3/mcp-client-ai.ts",
]

// ── El subsistema screening → batch → export → costo, enteramente nuevo ────
addNodeAfter("svc_v3_capability", {
  id: "svc_v3_screening",
  label: "Screening de listas (MCP)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "screen_account_list: cruza UNA lista de cuentas que trae el cliente (pegada, de un CSV, de su CRM) contra uno o varios términos, en una sola llamada. Antes no existía el cruce lista×término —search_companies va de un nombre a empresas, search_companies_by_capability de un término a empresas— y se resolvía paginando el universo entero (9 llamadas, ~80k tokens) y matcheando a mano; para las cuentas SIN señal, la única forma de decir 'no tiene' era inferir por orden alfabético que el nombre no aparecía.",
  files: ["lib/v3/services/screen-account-list.ts"],
  notes:
    "Corregido el 27-ago (2356b23) después de la primera corrida real (Santander Chile): el pool de candidatas a homónimo era una muestra de 100 filas SIN order by sobre miles de matches por token —para 'Santander Chile', 'chile' solo matchea 7.153 empresas y de las 31 entidades Santander reales, 0 caían en la muestra—, así que el resultado cambiaba entre llamadas y tres de cuatro tecnologías volvían sin evidencia al repetir la consulta. Ahora el matching usa clave propia para consolidar (no se endurece company_core_name: de ahí depende auto_merge_safe_duplicates sobre 517.326 filas, aflojarla fusionaría empresas separadas sin vuelta atrás) y localidad POR SEÑAL en vez de por empresa.",
})
addNodeAfter("svc_v3_screening", {
  id: "svc_v3_batch",
  label: "Cotización y ejecución de lotes",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "estimate_batch cotiza el costo de un LOTE completo (research, enrichment, vacantes) en una sola llamada y devuelve un batchPlanHash; create_batch_job lo ejecuta. Existía el circuito prepare_* → planHash → run_*(userConfirmed) pero operaba por UNA cuenta — un lote de 42 eran 42 confirmaciones para una sola decisión de presupuesto. No arma una máquina de estados propia: reusa v3.research_jobs (lease, heartbeat, reintentos) y el watchdog que ya la sostiene.",
  files: ["lib/v3/services/mcp-batch-estimate.ts", "lib/v3/services/mcp-batch-job.ts"],
  risk:
    "37b5dca (26-ago): run_contact_enrichment y prepare_contact_enrichment tenían descripciones CONTRADICTORIAS sobre si el batchPlanHash alcanzaba como autorización — el modelo obedecía a la que ejecuta el gasto y pedía 22 confirmaciones sueltas, exactamente lo que el batchPlanHash existe para evitar. RunResult ahora declara authorizedBy. 7a4d4a6 (27-ago): estimateBatch calculaba lugares de plan sin mirar `unrestricted` y bloqueaba al perfil admin con un cupo que save_account ya no le aplicaba; ahora slots viaja con enforced:false para esa credencial.",
})
addNodeAfter("svc_v3_batch", {
  id: "svc_v3_export",
  label: "Export de MCP a archivo",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "create_export convierte el resultado de un screening en un archivo (xlsx/csv) en Vercel Blob y devuelve una URL firmada de 24hs. Hasta el 25-ago ninguna de las tools devolvía un archivo: un reporte de 61 o 139 cuentas se transportaba como texto en el chat, y la guidance de las tools literalmente pedía 'acotar hasta un recorte que entre en la conversación'.",
  files: ["lib/v3/services/mcp-export.ts"],
})
addNodeAfter("svc_v3_export", {
  id: "svc_v3_cost_summary",
  label: "Resumen de costo (MCP)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "get_cost_summary junta lo que ya se registraba en tres tablas distintas y nadie leía junto. Cada número DECLARA su calidad: measured (sale de un ledger real — AI Gateway, apify_runs) vs. estimated (Apollo: 1 crédito por organización resuelta, 5 por teléfono, salvo Waterfall Enrichment activo, sin confirmar contra el consumo real que reporta Apollo — ver docs/plan-mcp-admin.md §8.3). Es lo que hace defendible al perfil admin: sin tope, lo mínimo es poder decir cuánto costó.",
  files: ["lib/v3/services/mcp-cost-summary.ts"],
  risk:
    "El costo de Apollo es ESTIMADO, no medido: mixed_people/search no figura en la tabla de precios publicada por Apollo y se bookea creditsEstimated:0 pese a paginar en loop, y una cuenta con Waterfall Enrichment activo puede costar hasta 10x lo estimado. Documentado, no resuelto — pendiente comparar el consumo real de Apollo de un día contra la suma de creditsEstimated de ese día.",
})
addNodeAfter("svc_v3_cost_summary", {
  id: "svc_v3_contact_enrichment",
  label: "Enrichment de contactos (Apollo por MCP)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "prepare_contact_enrichment congela un plan (cargos, maxContacts, costo) y devuelve un planHash sin gastar; run_contact_enrichment ejecuta EXACTAMENTE ese plan y gasta. Reserva el peor caso (maxContacts) porque no se sabe cuánta gente va a devolver Apollo antes de buscar, y commitea sólo lo realmente enriquecido.",
  files: ["lib/v3/services/mcp-contact-enrichment.ts"],
  notes:
    "08dd0bf (27-ago): el caché sólo acertaba si la consulta ENTERA se repetía (mismo organization_id, mismos cargos, mismo maxResults) — cambiar un cargo lo fallaba por completo y volvía a pagar por gente que ya estaba en la base. Medido sobre 4.223 llamadas históricas a people/match: 921 créditos (21,8%) pagados dos veces por la misma persona. Ahora se revisa apollo_contacts_cache completo antes de salir a Apollo, TENGA EMAIL O NO —que Apollo no tenga el email también es una respuesta ya comprada—, y creditsSpent viaja junto a creditsSaved para que un costo en cero no se lea como que Apollo regaló el dato.",
})
addNodeAfter("svc_v3_contact_enrichment", {
  id: "svc_v3_contact_phones",
  label: "Teléfonos por MCP",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "request_contact_phones pide el reveal de teléfono de Apollo y NO espera: el reveal es asíncrono (llega por webhook el ~57% de las veces, 80/141 medido) y una tool que bloquea la conversación por algo que la mitad de las veces no llega es peor que una que pide y sigue. Sólo pide para contactos con email verificado y cargo que matchea (5 créditos contra 1 del email); los resultados se leen después con get_company_contacts (hasPhone, phoneStatus, frescura).",
  files: ["lib/v3/services/mcp-contact-phones.ts", "lib/v3/services/contact-phone-inbox.ts"],
  notes:
    "El camino de vuelta lo resuelve contact-phone-inbox.ts del lado v3: v2 guarda el teléfono EN la fila del contacto (public.user_company_contacts); v3 separa PII de scope y sólo referencia apollo_cache_id desde v3.account_contacts, así que el mismo webhook (api_apollo_webhook) ahora escribe los dos lados en la misma request. skipped/creditsSaved declaran cuántos contactos ya tenían número y no se volvieron a pedir. phone_status habla el vocabulario de v2 desde el 27-ago (7a4d4a6): antes cada versión tenía su propio set de estados y una cuenta armada desde admin podía mostrar un estado que la UI de v2 no reconocía.",
})

addEdge({ id: "e196", from: "svc_v3_screening", to: "db_mcp_screenings_exports", kind: "rw" })
addEdge({ id: "e197", from: "svc_v3_screening", to: "svc_v3_capability", kind: "call", label: "reusa resolveCapabilityTerms" })
addEdge({ id: "e198", from: "svc_v3_batch", to: "db_mcp_batch", kind: "rw" })
addEdge({ id: "e199", from: "svc_v3_batch", to: "db_research_jobs", kind: "call", label: "reusa research_jobs, no arma otra máquina de estados" })
addEdge({ id: "e200", from: "svc_v3_export", to: "db_mcp_screenings_exports", kind: "rw" })
addEdge({ id: "e201", from: "svc_v3_export", to: "ext_blob", kind: "write", label: "xlsx/csv, URL firmada 24h" })
addEdge({ id: "e202", from: "svc_v3_cost_summary", to: "db_apollo_company_enrichment", kind: "read" })
addEdge({ id: "e203", from: "svc_v3_cost_summary", to: "db_apify_runs", kind: "read" })
addEdge({ id: "e204", from: "svc_v3_cost_summary", to: "db_ai_usage", kind: "read" })
addEdge({ id: "e205", from: "svc_v3_contact_enrichment", to: "ext_apollo", kind: "call" })
addEdge({ id: "e206", from: "svc_v3_contact_enrichment", to: "db_apollo_cache", kind: "rw", label: "revisa antes de gastar" })
addEdge({ id: "e207", from: "svc_v3_contact_phones", to: "ext_apollo", kind: "call", label: "reveal_phone_number=true, no espera" })
addEdge({ id: "e208", from: "svc_v3_contact_phones", to: "db_account_contacts", kind: "read" })
addEdge({ id: "e209", from: "api_apollo_webhook", to: "svc_v3_contact_phones", kind: "call", label: "receivePhoneForV3, misma request que v2" })
addEdge({ id: "e210", from: "api_mcp_admin", to: "svc_v3_screening", kind: "call" })
addEdge({ id: "e211", from: "api_mcp_admin", to: "svc_v3_batch", kind: "call" })
addEdge({ id: "e212", from: "api_mcp_admin", to: "svc_v3_export", kind: "call" })
addEdge({ id: "e213", from: "api_mcp_admin", to: "svc_v3_cost_summary", kind: "call" })
addEdge({ id: "e214", from: "api_mcp_server", to: "svc_v3_screening", kind: "call" })
addEdge({ id: "e215", from: "api_mcp_server", to: "svc_v3_contact_enrichment", kind: "call" })
addEdge({ id: "e216", from: "api_mcp_server", to: "svc_v3_contact_phones", kind: "call" })

addNodeAfter("db_account_imports", {
  id: "db_mcp_screenings_exports",
  label: "v3.mcp_screenings / v3.mcp_exports",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Resultado guardado de un screen_account_list (para que create_export no reciba las filas de vuelta) y los archivos generados por create_export con su URL firmada.",
  tables: ["v3.mcp_screenings", "v3.mcp_exports"],
  files: ["supabase/migrations/20260825015932_mcp_screenings_and_exports.sql"],
})
addNodeAfter("db_mcp_screenings_exports", {
  id: "db_mcp_batch",
  label: "v3.mcp_batch_jobs / v3.mcp_batch_job_items",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Un batchPlanHash autorizado y sus items (una cuenta o una operación por fila), con el estado de ejecución de cada una para que create_batch_job sea reanudable.",
  tables: ["v3.mcp_batch_jobs", "v3.mcp_batch_job_items"],
  files: ["supabase/migrations/20260825020834_mcp_batch_jobs.sql", "supabase/migrations/20260826191459_apollo_en_el_batch_plan_hash.sql"],
  notes: "960bb56/b3a9a85 (26-ago): la migración de Apollo en el batchPlanHash había quedado registrada con una versión que no coincidía con lo aplicado en producción — se corrigió el nombre del archivo para que coincida con la versión real, siguiendo la regla de CLAUDE.md.",
})

// ═══════════════════════════════════════════════════════════════════════════
// TEMA 2 — Apollo: enrichment por cola, dominio por nombre (pausado), costo
// ═══════════════════════════════════════════════════════════════════════════
const svcApollo = node("svc_apollo")
svcApollo.label = "Apollo (18 módulos)"
svcApollo.desc =
  "Search, enrich, organizations, cache por hash de query, validación de títulos, parsers y dominio — creció de 11 a 18 módulos desde el 24-ago con el enrichment de organizaciones por cola, el lookup de dominio por nombre y el writer con reglas de precedencia explícitas. El pipeline de búsqueda de decisores sigue en lib/shared/ (svc_shared_apollo_dm); v2 queda como wrapper."
svcApollo.files = ["lib/apollo/"]
svcApollo.risk =
  "5 de los 18 módulos (company-writer, domain-lookup-runner, org-enrichment-runner + 2 rutas de cron) instancian su propio cliente Supabase en vez de pasar por lib/supabase/{admin}.ts — son parte de los 16 archivos de OPT-06."

const apolloDM = node("svc_shared_apollo_dm")
apolloDM.notes =
  "Se extrajo en vez de copiarse: habría sido la TERCERA vez que este repo paga tener dos implementaciones del mismo pipeline (pasó con las noticias y con el research). Los decisores aterrizan en los mismos dos lugares que en v2 —user_company_contacts con source 'apollo' e is_decision_maker true, y apollo_contacts_cache—, y por eso un decisor encontrado desde cualquiera de los dos mundos aparece en el bookmark del otro. bookmark_id va en null desde v3: es una columna de v2 y la tabla la acepta nullable. CORRECCIÓN (27-ago-2026): el reveal de teléfono, que esta nota daba por removido ('Apollo consumía 5 créditos por reveal y el webhook nunca llegaba'), VOLVIÓ — ver svc_v3_contact_phones. El webhook sí llega, en el ~57% de los casos medido, y ahora hay un camino de retorno para v3 además de v2."

const apolloWebhook = node("api_apollo_webhook")
apolloWebhook.zone = "shared"
apolloWebhook.label = "Webhook Apollo (v2 + v3)"
apolloWebhook.desc =
  "Callback de Apollo autenticado por secreto en el path, para el reveal asíncrono de teléfono de /people/match. Desde el 26-ago-2026 (583bc4e) deja de ser sólo de v2: en la MISMA request resuelve primero el lado v3 (receivePhoneForV3, escribe en v3.account_contacts vía apollo_cache_id) y después las tres salidas de v2 sobre user_company_contacts — a propósito arriba de las tres ramas, para que ningún cambio futuro deje afuera a v3 por error. Siempre devuelve 200: un reintento de Apollo no recupera el crédito gastado."
apolloWebhook.notes =
  "El log de arrival ahora es incondicional (antes de validar el secret), para poder diagnosticar una rotación de env var o un encoding de URL distinto; y el log de éxito pasa por logApolloCall, que conoce el schema real de apollo_api_calls — el insert directo anterior usaba columnas inexistentes y los webhooks quedaban sin trazabilidad."

addNodeAfter("svc_apollo", {
  id: "svc_v3_apollo_org_enrich",
  label: "Apollo: enrichment de organizaciones (cola)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "Drena v3.apollo_company_enrichment (status='pending') con organizations/bulk_enrich (10 dominios por llamada, 1 crédito por organización resuelta). NO descubre trabajo, lo consume: nunca sale a buscar candidatas por su cuenta — el catálogo tiene ~61.300 empresas con website sin resolver y barrerlo entero son ~38.000 créditos, decisión del dueño del proyecto, no de un cron. Con la cola vacía la corrida gasta cero. Escribe por lib/apollo/company-writer.ts: columnas apollo_* siempre, genéricas sólo si están vacías, industry/is_public nunca (Apollo usa lowercase, LinkedIn Title Case — mezclarlas rompe el mapeo a master_industry_id).",
  files: ["lib/apollo/org-enrichment-runner.ts", "lib/apollo/bulk-organizations.ts", "lib/apollo/company-writer.ts", "app/api/cron/v3-apollo-org-enrichment/route.ts"],
  notes:
    "Dos caminos alimentan la misma cola y hacen lo mismo por debajo (applyCompanyEnrichment): oportunista al buscar decisores (prepare_contact_enrichment de paso enriquece la compañía — las primeras 197) y en lote por este cron cada 10 minutos. Estado al 26-ago: 197 resueltas, 61.304 candidatas con website sin tocar. Priorizado por contactos (85% de las compañías tiene alguna señal, así que señales no discrimina nada).",
})
addNodeAfter("svc_v3_apollo_org_enrich", {
  id: "svc_v3_apollo_domain_lookup",
  label: "Apollo: dominio por nombre (PAUSADO)",
  zone: "v3",
  layer: 3,
  kind: "service",
  desc:
    "Resuelve dominio a partir del NOMBRE contra organizations/search (fuzzy_select_mode, gratuito) para el 88% del catálogo (455.747 de 517.790 companies) que no tiene website y por eso no entra a NINGUNA fase de Apollo. El techo es la cuota del plan, no el precio: 400 llamadas/hora sobre ese endpoint, medido (Apollo lo confirma en el mensaje de rechazo). El cron usaba 350/hora dejando 50 libres para trabajo manual, contando contra apollo_api_calls real en vez de un contador propio. Sólo promueve a companies el match auto_ok, y sólo sobre columnas vacías; un token geográfico presente de un solo lado baja el match a 'revisar' en vez de auto-aplicarlo (medido: 'Joyeria Vasari' vs 'JOYERIA VASARI MADRID SL', similitud 0.67, pasaba como automático sin esa guarda).",
  files: ["lib/apollo/domain-lookup.ts", "lib/apollo/domain-lookup-runner.ts", "app/api/cron/v3-apollo-domain-lookup/route.ts"],
  risk:
    "PAUSADO el 08-sep-2026 (f513468), 12 días después de aplicarse: la entrada salió del array crons de vercel.json, que es lo único que Vercel mira para invocar un cron — el runner, la cola v3.apollo_domain_lookup y su checkpoint quedan intactos, con las filas sin procesar en 'pending'. Reanudar es devolver la entrada al schedule y desplegar; mientras tanto la ruta se puede seguir corriendo a mano y las 350 llamadas/hora reservadas quedan libres para trabajo manual. Medición preliminar sobre 180 casos: 23% auto_ok, 36% con algún dominio candidato, 60% sin match — falta rehacerla sobre la muestra completa (420.753 sembradas).",
})
addEdge({ id: "e217", from: "cron_v3_apollo_org_enrichment", to: "svc_v3_apollo_org_enrich", kind: "call" })
addEdge({ id: "e218", from: "svc_v3_apollo_org_enrich", to: "db_apollo_company_enrichment", kind: "rw" })
addEdge({ id: "e219", from: "svc_v3_apollo_org_enrich", to: "ext_apollo", kind: "call", label: "bulk_enrich, 10 dominios/llamada" })
addEdge({ id: "e220", from: "svc_v3_apollo_org_enrich", to: "db_companies", kind: "write", label: "apollo_* siempre, genéricas si vacías" })
addEdge({ id: "e221", from: "svc_v3_apollo_domain_lookup", to: "db_apollo_domain_lookup", kind: "rw" })
addEdge({ id: "e222", from: "svc_v3_apollo_domain_lookup", to: "ext_apollo", kind: "call", label: "organizations/search, gratuito" })
addEdge({ id: "e223", from: "svc_v3_apollo_domain_lookup", to: "db_companies", kind: "write", label: "sólo auto_ok, sólo columnas vacías" })
addEdge({ id: "e224", from: "svc_v3_apollo_org_enrich", to: "db_apollo_calls", kind: "read", label: "cuenta lo gastado leyendo el ledger real" })
addEdge({ id: "e225", from: "svc_v3_apollo_domain_lookup", to: "db_apollo_calls", kind: "read", label: "cuota horaria leída de apollo_api_calls" })

addNodeAfter("cron_v3_enrich_linkedin", {
  id: "cron_v3_apollo_org_enrichment",
  label: "cron v3-apollo-org-enrichment (10m)",
  zone: "v3",
  layer: 2,
  kind: "cron",
  desc: "Drena la cola de v3.apollo_company_enrichment vía organizations/bulk_enrich. Sólo consume lo sembrado; con la cola vacía no llama a Apollo.",
  files: ["app/api/cron/v3-apollo-org-enrichment/route.ts"],
})

addNodeAfter("db_linkedin_enrichment", {
  id: "db_apollo_company_enrichment",
  label: "v3.apollo_company_enrichment",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Cola del enrichment de organizaciones por dominio: pending / error (reintenta en 30m) / found / not_found (terminales) / skipped (sin dominio parseable) / failed (agotó 3 intentos).",
  tables: ["v3.apollo_company_enrichment"],
  files: ["supabase/migrations/20260826120000_apollo_enrichment_columnas_y_checkpoint.sql", "supabase/migrations/20260826121000_strings_vacios_bloquean_enrichment.sql"],
})
addNodeAfter("db_apollo_company_enrichment", {
  id: "db_apollo_domain_lookup",
  label: "v3.apollo_domain_lookup",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Checkpoint del barrido de dominio-por-nombre: 420.753 filas sembradas el 27-ago, la mayoría todavía en 'pending' porque el cron que las drena está pausado desde el 08-sep.",
  tables: ["v3.apollo_domain_lookup"],
  files: ["supabase/migrations/20260827205412_checkpoint_de_dominio_por_nombre.sql"],
})
addNodeAfter("db_apollo_domain_lookup", {
  id: "db_apify_runs",
  label: "v3.apify_runs",
  zone: "v3",
  layer: 4,
  kind: "table",
  desc: "Ledger de costo de Apify por corrida y por origen (cron, MCP, kick al seguir cuenta): lo que get_cost_summary lee como número MEDIDO, a diferencia del de Apollo, que es estimado.",
  tables: ["v3.apify_runs"],
  files: ["supabase/migrations/20260826203230_ledger_de_gasto_por_empresa.sql"],
})
addNodeAfter("db_apollo_cache", {
  id: "db_apollo_calls",
  label: "public.apollo_api_calls",
  zone: "shared",
  layer: 4,
  kind: "table",
  desc: "Log de CADA llamada HTTP a Apollo (endpoint, latencia, status, metadata), escrito por lib/apollo/logger.ts. Es el ledger real que los dos crons de Apollo leen para saber cuánto llevan gastado en la última hora/corrida, en vez de llevar un contador propio que se desincroniza de lo que otros procesos llamaron por fuera.",
  tables: ["public.apollo_api_calls"],
})

// ═══════════════════════════════════════════════════════════════════════════
// TEMA 3 — Identidad de empresa y de persona (Fase 0 del análisis de inputs)
// ═══════════════════════════════════════════════════════════════════════════
const dbCompanies = node("db_companies")
const FASE0_NOTE =
  "Fase 0 aplicada el 25/26-ago (docs/analisis-inputs-companias-contactos-senales.md): merge_companies() coalesceaba una lista incompleta y perdía linkedin_company_id, hq_country_iso y los campos apollo_* del duplicado que se borraba (recuperables sólo desde duplicate_snapshot) — linkedin_company_id es el decisor de MÁXIMA prioridad de belongsToCompany, así que cada merge que lo perdía degradaba la atribución de vacantes. El ETL de vacantes fabricaba identidad falsa: website ← companyUrl (URL de LinkedIn del AVISO) y country ← location (ubicación del aviso, no de la empresa) — el website falso además alteraba el paso ③ de upsert_company (matching por núcleo). Los dos se cortaron. upsert_company, merge_companies y company_core_name vivían SÓLO en scripts/ (script 443/450/451) y nunca habían vuelto a supabase/migrations/: un rebuild desde migraciones restauraba la ingesta anterior al dedup. Se consolidaron copiando pg_get_functiondef() de producción."
if (!dbCompanies.notes?.includes("Fase 0 aplicada el 25/26-ago")) {
  dbCompanies.notes = dbCompanies.notes ? `${dbCompanies.notes} ${FASE0_NOTE}` : FASE0_NOTE
}
const CATALOGO_VACIO_RISK =
  "75% del catálogo (385.898 de 514.391) queda 'solo nombre' por asimetría de diseño del ETL de contactos: el empleador actual entra con 7 campos, cada empleador anterior entra como upsert_company(nombre, NULL×6). 99% de esas vacías son empleador anterior de alguien. No es un bug, es un trade-off de diseño documentado."
if (!dbCompanies.risk?.includes("queda 'solo nombre' por asimetría")) {
  dbCompanies.risk = dbCompanies.risk ? `${dbCompanies.risk} ${CATALOGO_VACIO_RISK}` : CATALOGO_VACIO_RISK
}

const dbContacts = node("db_contacts")
const IDENTIDAD_PERSONA_NOTE =
  "Identidad de persona (25-ago, docs/analisis-inputs-companias-contactos-senales.md): se deduplicaba por linkedin_url CRUDA, que identifica la URL y no a la persona — medido sobre 544.808 filas con perfil, 6.312 eran la misma persona repetida con evidencia fuerte (mismo nombre + email/teléfono/sufijo/slug), 6.386 tenían el URN ofuscado de LinkedIn en vez del slug público (nace fila nueva cada vez que el scraper lo devuelve), 675 quedaban en placeholder:<uuid>. resolve_contact_id corta la creación hacia adelante; una fusión reversible (gemela de merge_companies, con snapshot y reversión) fusionó lo que ya existía: dry run 3.566 grupos, con calidad exigida (mail verificado, teléfono personal, sufijos discordantes vetados) bajó a 2.169 grupos, 2.170 fusiones, CERO errores. previous_positions pasó de pisarse entero en cada re-import (un export con menos posiciones borraba historial) a merge aditivo: lo nuevo manda, sobrevive lo viejo cuyo (company_id, título) no está en el import nuevo."
if (!dbContacts.notes?.includes("Identidad de persona (25-ago")) {
  dbContacts.notes = dbContacts.notes ? `${dbContacts.notes} ${IDENTIDAD_PERSONA_NOTE}` : IDENTIDAD_PERSONA_NOTE
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMA 4 — Diccionario: co-ocurrencia y taxonomía (siete lotes)
// ═══════════════════════════════════════════════════════════════════════════
const dbDictionary = node("db_dictionary")
dbDictionary.notes =
  "Auditoría de siete lotes cerrada el 24-ago (docs/auditoria-diccionario-tecnologia.md): reglas de co-ocurrencia por keyword — contexto que SUMA cuando aparece cerca (mide colocación, no presencia en el perfil entero: 'Fabric' + 'Service' sin contexto de datos cerca es tela, no Microsoft Fabric) y exclusiones que DESCARTAN por ocurrencia exacta, nunca por presencia en el perfil (alguien que dice 'Service Fabric' también puede decir 'Power BI' sin que eso invalide la señal de Fabric). Cinco keywords reprocesadas con el método: Exchange (2.238 señales finales, cuentas 903→2.118), Fabric (123, 41→146), Web Forms (191), Commerce Cloud (100, 30→69), Pub/Sub (140). Cambiar las reglas de una keyword existente encola remove+add en inserts SEPARADOS (compartir created_at deja el desempate indefinido). Tres ejes de taxonomía nuevos aplicados el mismo día."
dbDictionary.files = ["docs/auditoria-diccionario-tecnologia.md"]

const svcV3Dictionary = node("svc_v3_dictionary")
svcV3Dictionary.desc =
  "Lectura del diccionario de v2, sugerencia de nuevos términos (v3.dictionary_term_suggestions, ABM en el panel admin) y gestión de reglas de co-ocurrencia por keyword."

// ═══════════════════════════════════════════════════════════════════════════
// TEMA 5 — Calidad de datos: posted_at, is_active muerta, drawer de vacantes
// ═══════════════════════════════════════════════════════════════════════════
const dbJobPostings = node("db_job_postings")
dbJobPostings.desc =
  "Vacantes: insumo del diccionario en v2 y de la interpretación en v3. is_active quedó MUERTA desde el 25-ago (ver DEAD-17): las 6 funciones que la leían no filtraban nada con ella (43.052 filas en true, 0 en false, medido) y se les sacó la lectura; la columna queda por irreversibilidad, con un COMMENT que lo dice."
dbJobPostings.notes =
  "posted_at reparado en dos pasadas (25-ago): primero el ETL hacia adelante (parseo real en la ingesta), después un backfill sobre el 58% ya cargado (25.056 filas) que tenía posted_at = fecha de CARGA en vez de fecha real — recuperable porque el ON CONFLICT viejo sólo tocaba title/description/updated_at. El contador de la lista (search_companies_by_*_v2, sin ventana de fecha) y el drawer (get_company_drawer_data, posted_at >= NOW() - 6 meses) miden cosas DISTINTAS a propósito — señal acumulada vs. hiring reciente— y desde el 25-ago la UI lo explica en vez de dejarlo como una inconsistencia aparente. El drawer tenía además dos bugs de lectura: sin LIMIT devolvía hasta ~3.400 filas para la peor empresa del catálogo (Falabella, 677 vacantes × sus señales) — ahora cupo de 100 con aviso de truncado —, y un SELECT DISTINCT ON sin ORDER BY dejaba una keyword arbitraria por vacante en vez de todas las detectadas."

// ═══════════════════════════════════════════════════════════════════════════
// TEMA 6 — ETL de ingesta: el nodo apuntaba al camino muerto
// ═══════════════════════════════════════════════════════════════════════════
const svcEtl = node("svc_etl")
svcEtl.label = "ETL de ingesta (CSV)"
svcEtl.desc =
  "CSV manual en /admin/ingest → Vercel Blob → import_rows (staging JSONB) → cron cada minuto (process-queue) → process_import_batch → process_contact_batch_internal. El camino real de subida es la ruta API, no las server actions del mismo nombre: ver DEAD-17b."
svcEtl.files = ["app/api/ingest/upload/route.ts", "lib/normalize-utils.ts"]
svcEtl.risk =
  "El nodo apuntaba a app/actions/ingest.ts como si fuera el ETL vivo; de sus 4 exports sólo getBatchStatus tiene un caller real (polling de estado). createImportBatch, uploadBatchRows y triggerBatchProcessing duplican el mapeo de columnas de la ruta real sin que nada los llame — ver DEAD-17b."

// ═══════════════════════════════════════════════════════════════════════════
// Optimizaciones: correcciones y una nueva
// ═══════════════════════════════════════════════════════════════════════════
opt("OPT-06").title = "16 archivos instancian createClient crudo y saltean los helpers de Supabase"
opt("OPT-06").finding =
  "Subió de 13 a 16 desde el 24-ago: EMPEORÓ, no mejoró. La suba no es dispersión al azar — son 5 módulos nuevos de lib/apollo/ (company-writer, domain-lookup-runner, org-enrichment-runner) y 2 rutas de cron nuevas (v3-apollo-domain-lookup, v3-apollo-org-enrichment) que instancian su propio cliente en vez de importar lib/supabase/admin.ts, más account-brief-row.ts y normalize-country-phase5.ts. El patrón sigue disponible y nada lo impide ni lo señala en review."
opt("OPT-06").evidence = [
  "16 archivos con import de @supabase/supabase-js fuera de lib/supabase/ (medido 21-sep-2026)",
  "app/actions/dictionary.ts, 6 rutas de cron (incluidas las 2 nuevas de Apollo), app/api/ingest/upload, app/api/landing-stats, app/api/v3/admin/normalize-country-phase5, components/v3/navbar.tsx, 3 módulos de lib/apollo/, lib/v3/services/account-brief-row.ts",
]

opt("OPT-07").severity = "media"
opt("OPT-07").title = "PARCIAL: server y admin dejaron de duplicar el registro de tools; Explore y Perfiles lo siguen haciendo"
opt("OPT-07").finding =
  "El 26-ago (MCP admin Fase C, 8001842) se resolvió la mitad del problema, pero NO extrayendo un factory genérico como proponía el hallazgo original: las 45 tools del perfil standard y del perfil admin se registran UNA sola vez en lib/v3/mcp-server-tools.ts, y cada ruta sólo aporta su profile + instructions. Explore (8 tools) y Perfiles (3 tools) siguen siendo rutas de 300-500 líneas con su propia copia completa de transporte, auth, rate limit y mapa de nextAction — el patrón que se replicó en vez de corregirse ahora es 2 copias en vez de 4."
opt("OPT-07").fix =
  "Falta extraer el andamiaje común (createMcpHandler + withMcpAuth + auditoría + nextAction) para que Explore y Perfiles lo reusen igual que standard/admin reusan mcp-server-tools.ts. El molde ya existe y funciona: es el mismo createV3McpHandler, parametrizado por lista de tools en vez de por profile fijo."

const opt12 = opt("OPT-12")
opt12.evidence = [
  "lib/shared/ creció de 4 a 8 archivos desde el 24-ago: evidence.ts, evidence-level.ts, news-search.ts, apollo-decision-makers.ts, apollo-title-groups.ts, canonical-signals.ts, linkedin-profile.ts, phone-status.ts",
  "lib/ai-service.ts vs lib/v3/ai.ts",
  "lib/documents/ vs lib/v3/services/mcp-document-*.ts",
  "lib/tech-radar.ts vs lib/v3/services/radar*.ts",
  "app/actions/search-v2.ts vs lib/v3/services/capability-search.ts",
]
opt12.finding =
  "Sigue creciendo el lado bueno: phone-status.ts (vocabulario compartido de estado de teléfono, 27-ago) y canonical-signals.ts/linkedin-profile.ts se sumaron a los cuatro inquilinos que ya tenía lib/shared/. La duplicación de IA, documentos y búsqueda que quedaba pendiente en la pasada anterior NO se tocó en estos 69 commits."

addOpt({
  id: "OPT-17",
  title: "Una tool del MCP llama a una función que selecciona columnas de job_postings que no existen",
  severity: "alta",
  finding:
    "lib/v3/services/value-proposition-recommender.ts:33 hace .select('id,company_id,title,description,location,posted_date,url') sobre public.job_postings. Esas dos últimas columnas no existen: la tabla tiene posted_at y job_url. PostgREST rechaza el select completo, así que la función falla SIEMPRE que se la llama, no sólo a veces.",
  evidence: [
    "lib/v3/services/value-proposition-recommender.ts:33",
    "Único caller: lib/v3/mcp-server-tools.ts (una tool del MCP la invoca en producción)",
    "public.job_postings no tiene columnas posted_date ni url (tiene posted_at y job_url)",
  ],
  fix:
    "No se corrigió desde esta rutina de mapa por regla (PASO 0/6: sólo docs/ y scripts/, ningún código de la app). Cambiar posted_date→posted_at y url→job_url en el .select() de la línea 33 es el fix directo; falta confirmar si hay más lugares del mismo archivo con el mismo nombre de columna viejo antes de tocarlo.",
})

// ═══════════════════════════════════════════════════════════════════════════
// deadCode: DEAD-12 parcial, DEAD-17 nueva (is_active), DEAD-17b (ingest.ts)
// ═══════════════════════════════════════════════════════════════════════════
dead("DEAD-12").title = "PARCIAL: dictionary_term_suggestions ya tiene lector; bookmark_dedupe_log sigue sin uno"
dead("DEAD-12").finding =
  "v3.dictionary_term_suggestions RESUELTO: lib/v3/services/dictionary.ts la lee y escribe (ABM de sugerencias de términos del panel admin), desde antes del 24-ago según el propio código pero no reflejado en la pasada anterior del mapa. v3.bookmark_dedupe_log sigue sin ningún lector en app/ ni lib/ — sólo aparece en la definición de baseline.sql."
dead("DEAD-12").recommendation =
  "Confirmar con el dueño del proyecto si bookmark_dedupe_log se puede borrar o si está reservada para un feature que todavía no se escribió."

addDead({
  id: "DEAD-17",
  title: "job_postings.is_active — columna sin escritores reales y con lecturas ya retiradas",
  severity: "baja",
  loc: 0,
  evidence: [
    "supabase/migrations/20260825141319_job_postings_drop_is_active_reads.sql",
    "Medido 25-ago-2026: 43.052 filas en true, 0 en false, 0 en null",
  ],
  finding:
    "Columna creada con DEFAULT true (scripts/043); nada la escribe (el INSERT del ETL no la nombra, el único UPDATE que la toca sólo puede subirla a true en merges de empresa). Seis funciones la leían sin que filtrara nada — el número se leía como 'vacantes abiertas' sin serlo, porque nada en el pipeline actual revisita una vacante vieja para bajarla. Las 6 lecturas se retiraron el 25-ago.",
  recommendation:
    "La columna QUEDA a propósito (el ETL sigue escribiendo su default y borrarla es irreversible), con un COMMENT que dice que no se mantiene. No hace falta acción — sólo no volver a construir sobre ella. 'Abierto ahora' se responde con scrape_company_job_postings, que va a LinkedIn en el momento.",
})

addDead({
  id: "DEAD-17b",
  title: "app/actions/ingest.ts — 3 de sus 4 exports sin caller real",
  severity: "baja",
  loc: 0,
  evidence: [
    "app/admin/ingest/page.tsx sólo importa getBatchStatus",
    "createImportBatch, uploadBatchRows, triggerBatchProcessing sin callers (grep 21-sep-2026)",
    "El camino real de subida es app/api/ingest/upload/route.ts",
  ],
  finding:
    "El nodo svc_etl del mapa apuntaba a este archivo como si fuera el ETL vivo. No lo es: duplica el mapeo de columnas de la ruta API real sin que nada lo invoque, salvo getBatchStatus (polling de estado de un batch, sí en uso). Corregido en este mapa (svc_etl ahora apunta a app/api/ingest/upload/route.ts).",
  recommendation:
    "Borrar createImportBatch, uploadBatchRows y triggerBatchProcessing, o todo el archivo salvo getBatchStatus (que puede mudarse a un módulo más chico).",
})

// ═══════════════════════════════════════════════════════════════════════════
// integridad referencial
// ═══════════════════════════════════════════════════════════════════════════
const nodeIds = new Set(j.nodes.map((n) => n.id))
if (nodeIds.size !== j.nodes.length) throw new Error("Hay ids de nodo duplicados")
for (const e of j.edges) {
  if (!nodeIds.has(e.from)) throw new Error(`Arista ${e.id}: from inexistente ${e.from}`)
  if (!nodeIds.has(e.to)) throw new Error(`Arista ${e.id}: to inexistente ${e.to}`)
}
const edgeIds = new Set(j.edges.map((e) => e.id))
if (edgeIds.size !== j.edges.length) throw new Error("Hay ids de arista duplicados")
for (const f of j.flows ?? []) {
  for (const step of f.steps ?? []) {
    if (step.nodeId && !nodeIds.has(step.nodeId)) throw new Error(`Flujo ${f.id}: nodeId inexistente ${step.nodeId}`)
    if (step.edgeId && !edgeIds.has(step.edgeId)) throw new Error(`Flujo ${f.id}: edgeId inexistente ${step.edgeId}`)
  }
}
for (const cp of j.contactPoints ?? []) {
  for (const n of cp.nodes ?? []) {
    if (!nodeIds.has(n)) throw new Error(`ContactPoint ${cp.id}: nodo inexistente ${n}`)
  }
}
const optIds = new Set(j.optimizations.map((o) => o.id))
if (optIds.size !== j.optimizations.length) throw new Error("Hay ids de optimizacion duplicados")
const deadIds = new Set(j.deadCode.map((d) => d.id))
if (deadIds.size !== j.deadCode.length) throw new Error("Hay ids de deadCode duplicados")

writeFileSync(PATH, JSON.stringify(j, null, 2) + "\n")

const after = {
  nodes: j.nodes.length,
  edges: j.edges.length,
  flows: j.flows.length,
  cps: j.contactPoints.length,
  opts: j.optimizations.length,
  dead: j.deadCode.length,
}
console.log("Antes:", before)
console.log("Después:", after)
