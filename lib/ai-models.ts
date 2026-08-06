/**
 * Fuente UNICA de verdad de los modelos de IA, compartida por v2 y v3.
 *
 * Existe por un incidente concreto: v2 y v3 tenian su propia constante de
 * modelo estructurador (`STRUCTURER_DEFAULT_MODEL` en lib/ai-structurer.ts y
 * `MODELS.STRUCTURER` en lib/v3/services/types.ts). Las dos apuntaban a un
 * modelo retirado del catalogo del AI Gateway, pero **fallaban distinto**:
 *
 *  - v2 lo llamaba con `maxOutputTokens: 4000` y parseando JSON a mano, asi que
 *    el JSON truncado caia al fallback degradado EN SILENCIO. Estuvo 2 meses
 *    roto y se detecto recien por las 47 filas marcadas 'degraded-fallback'.
 *  - v3 lo llamaba sin tope de salida, asi que no se noto.
 *
 * Con dos constantes, arreglar una no arreglaba la otra. Este modulo es un LEAF
 * a proposito (cero imports) para que lo pueda consumir cualquiera de los dos
 * mundos sin arrastrar el SDK ni crear ciclos de importacion.
 *
 * Al cambiar un valor de aca, correr `scripts/bench-structurer-models.mts`: el
 * catalogo del Gateway retira modelos sin aviso y un id inexistente NO falla
 * al importar, falla en runtime dentro de un try/catch.
 *
 * Ademas verificar que el modelo tenga precio propio en `MODEL_PRICING` de
 * `lib/v3/usage.ts`, o el costo se reporta con el fallback 3/15 y queda mal.
 */

/**
 * Estructuracion y tareas baratas (etapa B del radar, structurer de noticias
 * y docs publicos).
 *
 * Es `-lite` en los DOS mundos. Benchmark con prompts y datos reales de
 * produccion (4 casos: 2 de noticias, 2 de radar):
 *
 *   modelo                  JSON valido   items usables   latencia   costo
 *   2.5-flash-lite            4/4              25           5,8 s    $0,0026
 *   2.5-flash                 1/4               5          21,1 s    $0,0089
 *   3.5-flash-lite            4/4              19           3,4 s    (sin precio)
 *
 * `2.5-flash` es un modelo de RAZONAMIENTO: gasto entre 3.800 y 5.700 tokens
 * "pensando" antes de escribir, se comio el presupuesto de `maxOutputTokens` y
 * corto el JSON a mitad (finishReason `length`) en 3 de 4 casos. Para pasar
 * texto a JSON no hay nada que razonar: ese pensamiento es puro costo y latencia.
 *
 * `3.5-flash-lite` tambien acerto 4/4 y es el mas rapido, pero NO tiene precio
 * en `MODEL_PRICING`. Es el candidato natural a futuro, agregando primero su
 * precio real.
 *
 * CONTRAPARTIDA MEDIDA, a tener presente: `-lite` mostro MENOS recall en
 * extraccion (encontro menos items en el mismo texto). Para estructurar JSON a
 * partir de texto ya recolectado alcanza, pero si aparecen informes de radar
 * con menos hallazgos que antes, este es el primer sospechoso.
 */
export const STRUCTURER_MODEL = "google/gemini-2.5-flash-lite"

/**
 * Investigacion con busqueda web server-side (etapa A del radar y del motor
 * unificado de research).
 *
 * ── Por que haiku y no opus (medido, `scripts/bench-search-providers.mts`) ──
 * 3 empresas reales, mismo prompt, busqueda `web_search` server-side:
 *
 *   candidato                items  URLs vivas   dominios  latencia   costo
 *   claude-haiku-4.5          23     81/84 (96%)    54      15,6 s   $0,1256
 *   claude-opus-4.5           25     64/66 (97%)    47      30,8 s   $0,5922
 *
 * haiku sale **4,7x mas barato y 2x mas rapido**, y ademas trae MAS URLs (84 vs
 * 66) y MAS dominios distintos (54 vs 47). Opus solo aporta +2 items. Los dos
 * dieron 100% de relevancia contra `filterRelevantToCompany`, o sea que el
 * guardrail del prompt alcanza y no hace falta pagar razonamiento para evitar
 * ruido. Referencia historica: los $62,31 ya gastados en Opus habrian sido ~$13.
 *
 * ⚠️ ALCANCE DE LA EVIDENCIA: el benchmark midio busqueda de NOTICIAS. El radar
 * TECNICO (inferir el stack de una empresa a partir de evidencia dispersa) es
 * otra tarea, y ahi el razonamiento de Opus podria valer lo que cuesta. Se migro
 * igual por decision explicita de producto, priorizando el ahorro. Si los
 * informes tecnicos empiezan a salir mas pobres, ESTE es el primer sospechoso.
 *
 * ROLLBACK SIN REDEPLOY: setear la env var `V3_RESEARCH_MODEL` (por ejemplo a
 * `anthropic/claude-opus-4.5`) pisa este default. Se eligio asi justamente
 * porque es un cambio de calidad en produccion y queria que volver atras no
 * dependiera de un deploy.
 *
 * Nota sobre el id: el catalogo del Gateway lo publica como `claude-haiku-4.5`
 * (con PUNTO). El Gateway acepta igual la variante con guion, y
 * `normalizeModelKey` de lib/v3/usage.ts compara sin separadores, asi que el
 * precio (1/5 por 1M tokens) resuelve bien en ambas formas.
 */
export const RESEARCH_MODEL = process.env.V3_RESEARCH_MODEL?.trim() || "anthropic/claude-haiku-4.5"
