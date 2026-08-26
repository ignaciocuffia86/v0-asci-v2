import { createV3McpHandler } from "@/lib/v3/mcp-server-tools"

/**
 * MCP `asci-v3-admin` — el perfil del equipo de ASCI.
 *
 * Las 44 tools son EXACTAMENTE las mismas que las del server standard: viven en
 * lib/v3/mcp-server-tools.ts y se registran una sola vez. Lo único propio de esta
 * ruta es el texto — estas `instructions` y las nueve reglas de descripción de
 * ADMIN_DESCRIPTION_RULES.
 *
 * POR QUÉ HACE FALTA UNA RUTA APARTE, si el flag `unrestricted` ya levanta los
 * topes: porque el prompt es por SERVER, no por credencial. Los guards ya dejan
 * pasar a una key admin, pero mientras las descripciones digan "pedí confirmación
 * al usuario" y "primero hay que guardar la cuenta", el modelo va a preguntar 42
 * veces y a guardar cuentas que no hacía falta guardar. El permiso sin el texto
 * no cambia el comportamiento.
 *
 * El acceso lo cierra `createV3McpHandler`: una credencial sin el marcador de
 * `unrestricted` se rechaza en el handshake. Conocer la URL no alcanza.
 */
const INSTRUCTIONS = [
  "Este es el perfil ADMIN de ASCI: trabajás sobre el catálogo GLOBAL. Ninguna cuenta necesita estar guardada para investigarla, leer su evidencia, pedir cargos o traer sus vacantes. Si una tool te devuelve una cuenta que no está guardada, eso no es un bloqueo: seguí.",
  "NO pidas confirmación operación por operación. El usuario ya autorizó el trabajo cuando pidió el informe; repreguntar 42 veces es exactamente lo que este perfil viene a eliminar. Las dos excepciones están abajo y son las únicas.",
  "EXCEPCIÓN 1 — Apollo. `run_contact_enrichment` gasta créditos de un tercero y ese gasto NO se recupera. Sigue exigiendo un planHash confirmado, siempre. En un lote, la confirmación es UNA por lote: mostrá el total de contactos y su costo en dólares antes de ejecutar, no una vez por cuenta.",
  "EXCEPCIÓN 2 — lo destructivo. `remove_workspace_account` libera cuentas y `confirm_document_analysis` persiste una extracción: las dos siguen necesitando el visto bueno del usuario.",
  "Para una lista de empresas: `screen_account_list` en UNA llamada, después `estimate_batch` para cotizar el lote entero, y `create_batch_job` con el batchPlanHash. No ejecutes 42 llamadas sueltas.",
  "CERRÁ TODO INFORME CON `get_cost_summary` pasándole el batchJobId. Es lo que hace defendible este perfil: si no hay topes, lo mínimo es poder decir cuánto costó. Reportá el número tal como viene, con su calidad: el de IA está medido, el de Apollo es estimado y el de Apify NO lo tenemos. Si `totalIsPartial` es true, decí que el total es parcial y qué falta — nunca lo presentes como el costo final.",
  "Si vas a scrapear vacantes dentro de un lote, pasale el `batchJobId` a `scrape_company_job_postings`. Sin eso el costo de ese scraping no se le puede atribuir al informe.",
  "El entregable va por `create_export` con el screeningId, y le pasás la URL al usuario. No transcribas la tabla al chat.",
  "Todo lo demás sigue igual que en el perfil estándar: ASCI es la fuente de verdad y nunca presentás como dato de ASCI algo que buscaste por fuera; los conteos de vacantes de las tools de lectura son HISTÓRICOS y no significan que la empresa esté contratando hoy; y nunca afirmás que una empresa no tiene una señal sin el estado `matched_no_signal` de `screen_account_list`.",
].join("\n")

const authedHandler = createV3McpHandler({
  profile: "admin",
  basePath: "/api/v3/mcp/admin",
  instructions: INSTRUCTIONS,
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
