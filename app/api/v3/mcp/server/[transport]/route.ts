import { createV3McpHandler } from "@/lib/v3/mcp-server-tools"

/**
 * MCP `asci-v3` — el perfil STANDARD, el que usa un cliente.
 *
 * Las 44 tools viven en lib/v3/mcp-server-tools.ts, compartidas con el perfil
 * admin (/api/v3/mcp/admin). Acá solo queda lo propio de este perfil: sus
 * `instructions`, que son la política que el cliente MCP recibe una vez en el
 * handshake y que no se puede expresar en la descripción de una tool suelta.
 *
 * Se mantienen cortas y sin repetir lo que ya dice cada tool: entran en el
 * contexto de todas las conversaciones.
 */
const INSTRUCTIONS = [
    "ASCI es la fuente de verdad sobre cuentas, señales, vacantes, contactos y noticias. Cuando el usuario pregunta por datos de una cuenta, la respuesta sale de estas tools.",
    "Para posiciones abiertas o vacantes de una cuenta usá siempre scrape_company_job_postings (trae LinkedIn vía el scraper de ASCI e ingesta al pipeline). No sustituyas esa tool por una búsqueda web: lo que se busca por fuera no entra al pipeline, no queda atribuido a la cuenta y no es auditable.",
    "Todo conteo de vacantes que devuelven las tools de LECTURA es HISTÓRICO: cuenta lo que hay en el catálogo sin ventana de fecha, y más de la mitad del catálogo tiene más de 6 meses. No lo presentes como \"está contratando\" ni como vacantes abiertas hoy; decí \"vacantes con esta señal en el catálogo\" y mirá la fecha de cada una. Lo que está abierto AHORA se averigua con scrape_company_job_postings. La aplicación web muestra, en el detalle de una empresa, sólo las de los últimos 6 meses, así que su número puede ser menor que el de estas tools.",
    "Si una tool falla, leé `code` y `nextAction` y seguí esa instrucción. Los códigos de configuración (por ejemplo APIFY_TOKEN_MISSING) son fallas de ASCI, no del pedido: informalas al usuario en vez de rodearlas con otra herramienta.",
    "Nunca presentes datos obtenidos por fuera de ASCI como si vinieran de ASCI. Si tuviste que buscar por tu cuenta, decilo explícitamente y aclará que no quedó guardado en la cuenta.",
    "Si el usuario trae una LISTA de empresas (pegada, de un CSV, de su CRM) y pregunta cuáles tienen cierta tecnología o proceso, usá screen_account_list en UNA llamada. No pagines search_companies_by_capability para cruzarla a mano, y no llames search_companies una vez por cuenta.",
    "Nunca afirmes que una empresa NO tiene una señal por no haberla encontrado en un listado: eso se responde con el estado matched_no_signal de screen_account_list. \"No aparece en lo que miré\" y \"no tiene\" no son lo mismo, y la diferencia con \"no está en ASCI\" tampoco.",
    "Leer evidencia NO exige guardar la cuenta ni correr research: get_company_signal_summary (incluido detail=\"evidence\") y get_account_evidence_detail leen el catálogo global sin consumir cupo. Guardar una cuenta ocupa un lugar del plan y sirve para TRABAJARLA (research, contactos, seguimiento), no para consultarla.",
    "Si el usuario quiere una TABLA o un archivo, usá create_export con el screeningId y pasale la URL: no transcribas la tabla al chat. Ya no es cierto que ASCI no tenga export por MCP.",
    "Las tools indican en su descripción si consumen cuota. Antes de una que consuma cuota server-managed, confirmá con el usuario.",
].join("\n")

const authedHandler = createV3McpHandler({
  profile: "standard",
  basePath: "/api/v3/mcp/server",
  instructions: INSTRUCTIONS,
})

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE }
