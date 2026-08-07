/**
 * Prompt Y schema de estructuracion de noticias, compartidos por el endpoint y
 * los scripts.
 *
 * El schema vive JUNTO al prompt a proposito: tienen que coincidir. Con
 * `generateObject`, un prompt que pide un campo que el schema no declara (o al
 * reves) hace fallar la llamada entera. Separarlos en dos archivos es garantizar
 * que algun dia deriven.
 *
 * Vive en su propio modulo, sin dependencias pesadas, por dos razones:
 *
 * 1. Una sola fuente de verdad. `scripts/reprocess-degraded-news.mts` reprocesa
 *    filas historicas y tiene que usar el prompt EXACTO de produccion; si lo
 *    copiara, los dos derivarian y el reproceso dejaria de reflejar el endpoint.
 *
 * 2. Importar `app/api/research/news/route.ts` desde un script es imposible:
 *    arrastra `lib/parallel.ts`, que instancia el cliente de Parallel a nivel de
 *    modulo y lanza si falta `PARALLEL_API_KEY`. Un prompt no deberia obligar a
 *    tener credenciales de un servicio de busqueda para poder leerlo.
 */

import { z } from 'zod/v3';

/**
 * Forma esperada de la salida del structurer.
 *
 * ── Esto es lo que mata el bug de los 2 meses ──
 * Antes la etapa era `generateText` + `JSON.parse`: una respuesta truncada era
 * un string invalido que caia al `catch`, y el `catch` publicaba excerpts crudos
 * como si fueran noticias (47 filas de basura en produccion, sin una sola
 * alerta). Con un schema, el SDK valida y LANZA.
 *
 * Los campos son LAXOS a proposito (`nullable`, `category` sin enum) porque el
 * schema esta para garantizar la FORMA, no para adivinar el contenido. Un schema
 * demasiado estricto se vuelve otra fuente de fallos: `category` en la base ya
 * tiene valores fuera del enum del prompt (incluido el typo "alanzas"), asi que
 * restringirlo aca tiraria noticias validas.
 *
 * ── Por que `news` y `digest` NO llevan `.default()` ──
 * Llevaban `.default([])` y `.default(null)`, y eso ROMPIA el digest. Motivo:
 * `.default()` marca el campo como OPCIONAL en el JSON Schema que el SDK le pasa
 * al modelo, asi que el modelo lo lee como "podes omitirlo" y lo omite, por mucho
 * que el prompt dedique un parrafo entero a pedirlo.
 *
 * Medido con el mismo input y 3 corridas por variante: con `.default()` el digest
 * salio 0/3; declarado `nullable` y REQUERIDO, 3/3. `nullable` sin `.default()`
 * obliga a que la clave este presente y a la vez permite null cuando de verdad no
 * hay noticias, que es lo que pide la regla 5 del prompt.
 *
 * El sintoma era invisible: no hay error, solo un digest que nunca se genera.
 */
export const NewsSchema = z.object({
  news: z
    .array(
      z.object({
        /** 1-based. Es la clave del mapeo determinista item -> URL de la fuente. */
        source_index: z.number(),
        title: z.string(),
        summary: z.string().nullable(),
        source_name: z.string().nullable(),
        published_at: z.string().nullable(),
        category: z.string().nullable(),
      })
    ),
  digest: z.string().nullable(),
})

export type NewsItem = z.infer<typeof NewsSchema>["news"][number]

export const GEMINI_SYSTEM = `Eres un analista de inteligencia comercial B2B.
Se te dan excerpts de paginas web sobre una empresa. Tu tarea es extraer noticias relevantes como senales de compra B2B.

REGLAS DE RELEVANCIA (CRITICAS):
A. La empresa objetivo (te la indico abajo entre comillas) debe ser el SUJETO PRINCIPAL de la noticia.
B. EXCLUIR cualquier excerpt donde la empresa objetivo solo se mencione:
   - al pasar como ejemplo o comparacion ("...como Garbarino, Falabella, etc.")
   - en una lista de empresas de un sector ("...el rubro retail incluye a X, Y, Z")
   - en un contexto historico tangencial ("...desde la epoca de la quiebra de X")
   - en publicidad o cross-mencion no relacionada al hecho noticioso
C. SI tienes dudas sobre si la empresa es el sujeto principal, EXCLUYE el item. Mejor 0 noticias que 1 ruidosa.
D. El "title" y el "summary" que generes DEBEN mencionar explicitamente el nombre de la empresa objetivo.

REGLAS DE FORMATO:
1. Responde UNICAMENTE con JSON valido (sin markdown, sin texto extra).
2. Resume con TUS PROPIAS PALABRAS, NO copies texto literal.
3. Cada noticia debe tener relevancia para un vendedor B2B.
4. Minimo 0, maximo 15 noticias. Prioriza calidad sobre cantidad.
5. Si no hay noticias relevantes (todas son tangenciales), devuelve {"news":[], "digest": null}
6. Las fechas deben ser YYYY-MM-DD. Si no hay fecha exacta, intenta inferirla del contexto. Si es imposible, usa null.
7. CADA item DEBE incluir el campo "source_index" (numero entero >=1) que indica de cual "Fuente N" del listado abajo proviene la noticia. ESTE CAMPO ES OBLIGATORIO. Si una noticia se basa en multiples fuentes, elige la PRIMARIA (la que mas evidencia aporta sobre la empresa). NUNCA inventes URLs ni mezcles fuentes. Si no podes asignar un source_index claro, NO incluyas el item.

CATEGORIAS validas: inversion | transformacion | crecimiento | ejecutivos | desafios | alianzas | regulatorio | ma | innovacion

ADEMAS de las noticias, genera un "digest" de EXACTAMENTE 1 parrafo (2-4 oraciones) en ESPAÑOL que resuma:
- Los hallazgos mas importantes para un vendedor B2B
- Senales de compra o oportunidades detectadas
- Tono: informativo y accionable

El digest debe responder: "¿Por que deberia prestar atencion a esta empresa ahora?"

FORMATO JSON:
{
  "news": [
    {
      "source_index": 1,
      "title": "string (titulo descriptivo de la noticia)",
      "summary": "string (analisis de 150-250 chars de por que es relevante para ventas B2B)",
      "source_name": "string (nombre del medio/sitio)",
      "published_at": "YYYY-MM-DD o null",
      "category": "string (una de las categorias validas)"
    }
  ],
  "digest": "string (parrafo resumen en ESPAÑOL) o null si no hay noticias relevantes"
}`
