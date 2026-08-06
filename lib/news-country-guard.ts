/**
 * Señal de "el contenido parece ser de otro país que la cuenta".
 *
 * ── De dónde sale ──
 * En la revisión de las 47 noticias degradadas aparecieron 4 filas de la cuenta
 * **OXXO Chile** cuyo contenido era de México y Perú: un PDF consolidado de
 * FEMSA, dos notas de Spin by OXXO México y la apertura de una tienda en
 * Arequipa. Las cuatro pasaron `filterRelevantToCompany` porque el texto dice
 * "OXXO", que es exactamente lo que ese guardrail verifica.
 *
 * Es la misma clase de colisión que la nota de Dynabook aprobada para "Parque
 * del Recuerdo" por compartir la palabra "recuerdo", pero más difícil: acá el
 * nombre es correcto, lo que no corresponde es la geografía.
 *
 * ── Por qué es una SEÑAL y no un filtro ──
 * Una nota legítima sobre una empresa chilena puede publicarse en un medio
 * extranjero (Bloomberg, Reuters, un diario español), y un grupo regional
 * legítimamente aparece en notas de varios países. Descartar por país tiraría
 * noticias reales. Así que esto devuelve evidencia para loguear o ponderar, y la
 * decisión de filtrar queda afuera y medida.
 *
 * ── Regla conservadora ──
 * Solo marca sospecha cuando hay evidencia de un país extranjero **y** ninguna
 * evidencia del país de la cuenta. Si la nota menciona los dos, no se marca:
 * "OXXO Chile expande operaciones desde México" es legítima.
 *
 * ── MEDIDO: NO USAR COMO FILTRO ──
 * `scripts/measure-country-guard.mts` contra el pool sano de producción:
 *
 *   atrapa 3/4 de las malas conocidas (la 4ta, el PDF "1T 2026 Resultados"
 *   de FEMSA, no tiene NINGUNA señal de país: no hay nada que detectar)
 *   cuestiona 68/963 noticias sanas = 7,1%
 *
 * El 7,1% parece bajo hasta que se leen las 68, y ahí está el problema: **la
 * mayoría son legítimas y de las más valiosas comercialmente**. Ejemplos reales:
 *
 *   [Ualá / Argentina]        "Ualá se alía con Western Union"        (fuente .mx)
 *   [Naranja X / Argentina]   "se expande en la región..."            (texto: México)
 *   [Rappi / Colombia]        "Amazon invierte en Rappi"              (fuente .ar)
 *   [Ledesma / Argentina]     "confirma compra del Ingenio Concepción"(texto: Chile)
 *
 * La causa es estructural: **las empresas de LatAm son regionales**, y la noticia
 * cross-border no es un error sino muchas veces la señal de compra más fuerte
 * que existe (expansión, M&A, alianzas). Un filtro por país borraría justo eso.
 *
 * Por eso este módulo se usa SOLO para auditar y explicar, y deliberadamente
 * NO está enganchado como filtro en ningún camino de producción. Si algún día se
 * quiere filtrar, hay que hacerlo con la entidad legal (`OXXO Chile` vs `FEMSA`),
 * no con la geografía del contenido.
 */

/** Países hispanoamericanos + los que más aparecen en el pool, con sus señales. */
const PAISES: Array<{ pais: string; tld: string; gentilicios: string[]; ciudades: string[] }> = [
  { pais: "Argentina", tld: ".ar", gentilicios: ["argentina", "argentino"], ciudades: ["buenos aires", "cordoba", "rosario", "mendoza"] },
  { pais: "Chile", tld: ".cl", gentilicios: ["chile", "chileno", "chilena"], ciudades: ["santiago", "valparaiso", "antofagasta", "concepcion"] },
  { pais: "Mexico", tld: ".mx", gentilicios: ["mexico", "mexicano", "mexicana"], ciudades: ["ciudad de mexico", "monterrey", "guadalajara", "cdmx"] },
  { pais: "Peru", tld: ".pe", gentilicios: ["peru", "peruano", "peruana"], ciudades: ["lima", "arequipa", "trujillo"] },
  { pais: "Colombia", tld: ".co", gentilicios: ["colombia", "colombiano", "colombiana"], ciudades: ["bogota", "medellin", "cali", "barranquilla"] },
  { pais: "Brasil", tld: ".br", gentilicios: ["brasil", "brasileno", "brasilena", "brazil"], ciudades: ["sao paulo", "rio de janeiro", "brasilia"] },
  { pais: "Uruguay", tld: ".uy", gentilicios: ["uruguay", "uruguayo", "uruguaya"], ciudades: ["montevideo"] },
  { pais: "Paraguay", tld: ".py", gentilicios: ["paraguay", "paraguayo"], ciudades: ["asuncion"] },
  { pais: "Bolivia", tld: ".bo", gentilicios: ["bolivia", "boliviano"], ciudades: ["la paz", "santa cruz de la sierra"] },
  { pais: "Ecuador", tld: ".ec", gentilicios: ["ecuador", "ecuatoriano"], ciudades: ["quito", "guayaquil"] },
  { pais: "Venezuela", tld: ".ve", gentilicios: ["venezuela", "venezolano"], ciudades: ["caracas"] },
  { pais: "Guatemala", tld: ".gt", gentilicios: ["guatemala", "guatemalteco"], ciudades: ["ciudad de guatemala"] },
  { pais: "El Salvador", tld: ".sv", gentilicios: ["salvador", "salvadoreno"], ciudades: ["san salvador"] },
  { pais: "Honduras", tld: ".hn", gentilicios: ["honduras", "hondureno"], ciudades: ["tegucigalpa"] },
  { pais: "Costa Rica", tld: ".cr", gentilicios: ["costa rica", "costarricense"], ciudades: ["san jose"] },
  { pais: "Panama", tld: ".pa", gentilicios: ["panama", "panameno"], ciudades: ["ciudad de panama"] },
  { pais: "Nicaragua", tld: ".ni", gentilicios: ["nicaragua", "nicaraguense"], ciudades: ["managua"] },
  { pais: "Republica Dominicana", tld: ".do", gentilicios: ["dominicana", "dominicano"], ciudades: ["santo domingo"] },
  { pais: "España", tld: ".es", gentilicios: ["espana", "espanol", "espanola"], ciudades: ["madrid", "barcelona"] },
]

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/**
 * `.co` es ambiguo a propósito: es el TLD de Colombia pero también un dominio
 * genérico global (`latamfintech.co`, `angel.co`). Confiar en él produjo falsos
 * positivos, así que como TLD NO cuenta; Colombia se detecta solo por texto.
 */
const TLD_AMBIGUOS = new Set([".co"])

export type CountrySignal = {
  /** País de la cuenta que se usó como referencia. */
  paisCuenta: string
  /** Países extranjeros con evidencia en el contenido. */
  extranjeros: string[]
  /** true si el contenido menciona el país de la cuenta. */
  mencionaPaisCuenta: boolean
  /** Solo true si hay extranjero Y no hay mención del país propio. */
  sospechosa: boolean
  /** Para poder auditar por qué se marcó. */
  evidencia: string[]
}

/**
 * Evalúa si el contenido de una noticia parece corresponder a otro país que la
 * cuenta. NO descarta nada: devuelve la evidencia.
 *
 * `paisCuenta` debe ser el NOMBRE del país ("Argentina"), que es lo que guarda
 * `companies.country_normalized`. Ojo: esa columna guarda el nombre y NO el ISO,
 * y solo está poblada en una fracción de las empresas, así que el llamador tiene
 * que tolerar que no haya país.
 */
export function evaluarPais(args: {
  paisCuenta: string | null
  titulo: string | null
  resumen: string | null
  sourceUrl: string | null
}): CountrySignal | null {
  const { paisCuenta, titulo, resumen, sourceUrl } = args
  if (!paisCuenta) return null

  const refNorm = normalizar(paisCuenta)
  const ref = PAISES.find((p) => normalizar(p.pais) === refNorm || p.gentilicios.includes(refNorm))
  if (!ref) return null // país fuera de la tabla: no se opina

  const texto = normalizar(`${titulo ?? ""} ${resumen ?? ""}`)
  let host = ""
  try {
    host = sourceUrl ? new URL(sourceUrl).hostname.toLowerCase() : ""
  } catch {
    host = ""
  }

  const evidencia: string[] = []
  const extranjeros: string[] = []
  let mencionaPaisCuenta = false

  for (const p of PAISES) {
    const porTld = !TLD_AMBIGUOS.has(p.tld) && (host.endsWith(p.tld) || host.includes(`${p.tld}/`))
    // Se exige límite de palabra: sin esto "chile" matchea dentro de otras
    // palabras y "peru" aparece dentro de "peruano" pero también de "perume".
    const porTexto =
      p.gentilicios.some((g) => new RegExp(`\\b${g}\\b`).test(texto)) ||
      p.ciudades.some((ciu) => texto.includes(ciu))

    if (!porTld && !porTexto) continue

    const comoSe = [porTld ? `tld ${p.tld}` : null, porTexto ? "texto" : null].filter(Boolean).join("+")
    if (p.pais === ref.pais) {
      mencionaPaisCuenta = true
      evidencia.push(`propio:${p.pais}(${comoSe})`)
    } else {
      extranjeros.push(p.pais)
      evidencia.push(`extranjero:${p.pais}(${comoSe})`)
    }
  }

  return {
    paisCuenta: ref.pais,
    extranjeros,
    mencionaPaisCuenta,
    sospechosa: extranjeros.length > 0 && !mencionaPaisCuenta,
    evidencia,
  }
}
