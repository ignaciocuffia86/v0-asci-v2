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
