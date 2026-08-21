/**
 * Prompt de búsqueda de DOCUMENTOS OFICIALES de una empresa (memorias anuales,
 * reportes de sostenibilidad, earnings calls, reportes financieros).
 *
 * ── Por qué es un prompt y ya no un objeto de parámetros ──
 * Antes esto era `buildPublicDocsSearchParams` en `lib/parallel.ts`: devolvía
 * un `objective` + una lista de `search_queries` + un `source_policy` con
 * listas de dominios, porque así se le hablaba a Parallel. Parallel se retiró
 * (no es enrutable por el AI Gateway) y la búsqueda hoy la hace `collect` con
 * la herramienta server-side de Anthropic, que recibe UN prompt en lenguaje
 * natural y decide sus propias queries.
 *
 * Las listas de dominios se conservan como instrucciones del prompt en vez de
 * como filtro duro: son las que evitan que esta pestaña se llene con lo que
 * pertenece a las otras dos (prensa → noticias, vendors → implementaciones).
 *
 * Vive en su propio módulo, sin imports, para que un script pueda leerlo sin
 * arrastrar credenciales ni el SDK — la misma razón que `lib/news-prompt.ts`.
 */

export interface PublicDocsContext {
  companyName: string
  ticker?: string | null
  country?: string | null
  isPublic?: boolean
  sources: ("annual" | "earnings" | "sustainability" | "financial")[]
}

const LATAM = ["méxico", "mexico", "argentina", "colombia", "chile", "perú", "peru", "brasil", "brazil", "ecuador"]

const SOURCE_LABEL: Record<PublicDocsContext["sources"][number], string> = {
  annual: "memorias anuales / annual reports / informes anuales",
  earnings: "transcripciones de earnings calls y conference calls con inversores",
  sustainability: "reportes de sostenibilidad / sustentabilidad / ESG",
  financial: "reportes financieros y resultados anuales",
}

export function buildPublicDocsPrompt(context: PublicDocsContext): string {
  const year = new Date().getFullYear()
  const prevYear = year - 1
  const twoYearsAgo = new Date()
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2)
  const afterDate = twoYearsAgo.toISOString().split("T")[0]

  const isLatam = !!context.country && LATAM.some((c) => context.country!.toLowerCase().includes(c))
  const tickerNote = context.ticker ? ` (ticker: ${context.ticker})` : ""
  const wanted = context.sources.map((s) => SOURCE_LABEL[s]).join(", ")

  return (
    `Busca DOCUMENTOS OFICIALES publicados por la propia empresa "${context.companyName}"${tickerNote}` +
    `${context.country ? `, de ${context.country}` : ""}: ${wanted}.\n\n` +
    `QUE CUENTA COMO RESULTADO VALIDO:\n` +
    `- Documentos publicados por la empresa en su sitio de investor relations o en comunicados oficiales.\n` +
    `- Repositorios de reportes (annualreports.com) y transcripciones de earnings (seekingalpha.com, fool.com).\n` +
    `- Publicados en los ultimos 2 años (desde ${afterDate}); priorizar ${year} y ${prevYear}.\n\n` +
    `QUE NO:\n` +
    `- Articulos de prensa que HABLAN SOBRE un reporte. Busco el documento ORIGINAL, no la nota que lo comenta. ` +
    `Excluir reuters, bloomberg, cnbc, forbes, wsj y ft: esa informacion va en la pestaña de noticias.\n` +
    `- Case studies de proveedores (aws, microsoft, salesforce, sap, accenture, deloitte): van en la pestaña de implementaciones.\n` +
    `- Redes sociales (linkedin, facebook, x, instagram, youtube).\n\n` +
    `Para CADA documento indica su titulo, su tipo y su fecha de publicacion en formato YYYY-MM-DD, y cita la URL.` +
    (isLatam ? ` Buscar en español e ingles.` : ` Search in English.`)
  )
}
