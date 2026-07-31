# Test de UX del MCP de ASCI: estudio de cuentas

Diseño y resultados del test que recorre el camino real de un usuario que pregunta
por varias cuentas, decide si vale la pena guardarlas y profundiza con información
fresca y citable.

Ejecutado el 31/07/2026 contra el workspace **Bigua** (plan silver) y el servidor
MCP local (`/api/v3/mcp/server/mcp`), con una API key de prueba emitida y revocada
dentro de la misma corrida.

---

## 1. Qué pregunta responde el test

El test no valida "que el servidor conteste 200". Valida la **decisión del usuario**
y la del modelo que lo asiste:

| # | Pregunta | Cómo se mide |
|---|---|---|
| 1 | ¿La info inicial alcanza para decidir si guardo la cuenta? | Cuántas llamadas necesita el modelo antes de poder recomendar guardar/descartar, y si esa info es sustantiva |
| 2 | ¿Cuánta fricción tiene? | Roundtrips, si el orden sale solo con las descripciones, y si el modelo intenta llamar tools que no existen |
| 3 | ¿La evidencia viene con fuente verificable? | Se envían hallazgos buenos y defectuosos a propósito y se observa qué descarta el servidor |
| 4 | ¿Cuánto cuesta vs. el camino server-managed? | Qué pool consume, con qué topes y en qué momento se cobra |
| 5 | ¿Los cupos y las confirmaciones funcionan? | Si guardar consume cupo y si lo que gasta pide confirmación explícita |

### Principio de diseño

El harness **hace de cliente IA**: solo ve lo que ve Claude (nombres, descripciones
y JSON Schema de las 36 tools) y decide con eso. No lee el código fuente para elegir
qué llamar ni para adivinar argumentos. Todo lo que el harness no puede deducir del
catálogo es, por definición, un defecto de UX.

Los IDs de empresa y términos de evidencia se extraen **de la respuesta anterior**,
nunca de una lista fija. Si un paso no se puede encadenar, eso también es hallazgo.

---

## 2. Cómo correrlo

```bash
node scripts/mcp-ux-harness.mjs <fase>
```

| Fase | Costo | Qué hace |
|---|---|---|
| `catalogo` | cero | Lista las 36 tools y detecta descripciones que citan tools inexistentes |
| `schemas` | cero | Vuelca los argumentos de cada tool, como los ve el cliente |
| `descubrimiento` | cero | Búsqueda + cuentas guardadas + cupo |
| `panorama` | cero | El camino completo de decisión sobre una cuenta **no** guardada |
| `determinismo` | cero | Corre la misma búsqueda 5 veces y compara el candidato elegido |
| `preparar-noticias` | **1 unidad** | Paso 1 del client-assisted; guarda el prompt package en `/tmp` |
| `submit-noticias` | escribe | Paso 2 con 1 hallazgo bueno + 4 defectuosos |

Las fases que escriben usan el prefijo `[TEST v0]` en los títulos, porque las
noticias son **globales a todo v3**, no del workspace. Limpieza:

```sql
DELETE FROM public.company_news WHERE title LIKE '%[TEST v0]%';
```

---

## 3. Lo que funciona bien

- **El prompt package es sólido.** Devuelve system+user prompt, `resultSchema`
  explícito, `packageHash`, `expiresAt` (60 min) y la ventana temporal pedida. El
  modelo no tiene que inventar el formato de salida.
- **La clasificación expansión / contracción / neutro existe** y viaja en el schema,
  que es exactamente el eje de negocio que se buscaba.
- **El descubrimiento avisa de la ambigüedad.** `search_companies` devuelve
  `totalMatches`, marca `likelyCanonical` y trae conteos de evidencia por candidato.
- **La ventana temporal se respeta.** El hallazgo fechado en 2019 con ventana de
  180 días fue rechazado con `fuera_de_ventana`.
- **Los pools están bien separados.** El client-assisted consume `research_client`,
  distinto del pool server-managed: el gasto de tokens del usuario no come la cuota
  de research del plan. Esto valida la premisa del proyecto.
- **`prepare_save_account` previsualiza el costo en cupo** antes de confirmar.

---

## 4. Hallazgos

Ordenados por impacto sobre el flujo que se quiere habilitar.

### H1 · El guardrail de "fuente viva" no filtra nada (crítico)

Se enviaron 5 hallazgos y **entraron 4**, incluyendo dos que debían caer:

| Caso enviado | Esperado | Real |
|---|---|---|
| Dominio inexistente (`este-dominio-no-existe-…com`) | rechazado | **guardado** |
| Home de La Nación, no menciona a Arcor | rechazado | **guardado** |
| Soft-404 en arcor.com (200 sin contenido) | rechazado | guardado |
| Fecha 2019, ventana 180 días | rechazado | rechazado correctamente |

Causa raíz, en `lib/ai-structurer.ts` (`checkUrlsAlive`): con `undici`/Node 18+, un
fallo de DNS llega como `err.message === "fetch failed"` y el código real queda en
**`err.cause.code`**. El chequeo hace `/ENOTFOUND|getaddrinfo|EAI_AGAIN/.test(message)`,
que nunca matchea, y el dominio muerto cae en la rama `assume_alive`.

Verificado de forma aislada:

```
THROW msg="fetch failed" cause="ENOTFOUND"  -> detecta DNS? false
```

Afecta a **noticias y casos de éxito**, porque ambos comparten
`lib/v3/services/external-drilldown.ts`.

Impacto: la promesa de "información con fuente" no se cumple, y los datos falsos
quedan **globales para todos los tenants**.

Fix: leer `err.cause?.code` además de `err.message`, y tratar el 200 sin mención de
la empresa como no verificado.

### H2 · Las descripciones mandan al modelo a una tool que no existe (alto)

Cuatro lugares citan **`get_account_panorama`**, que no está entre las 36 tools
registradas. La real es `get_company_signal_summary`. Dos de esas citas son texto
que el modelo lee **en tiempo de ejecución**:

- `mcp-read-tools.ts:101` — dentro de una respuesta: *"Para el panorama completo […]
  usá get_account_panorama"*.
- `route.ts:123` — *"Consultá get_account_panorama en unos minutos"*.

Golpea justo el paso inicial que este test quiere medir. Fix: renombrar las
referencias, o exponer un alias con ese nombre.

### H3 · La búsqueda es no determinista y no prioriza por evidencia (alto)

`search_companies("Techint")`, 5 corridas, **5 candidatos distintos** marcados
`likelyCanonical` — uno fue *Seatech International* (match legítimo por
`seatechint.com`, pero irrelevante). El verdadero canónico,
**Techint Engineering & Construction con 726 señales, no apareció en ningún top-3**.

Además `totalMatches` informó 15 cuando los matches reales son **240**.

Causa: el orden viene sin `ORDER BY` estable y el `limit` recorta antes de ponderar
por volumen de evidencia. Con `limit: 3`, el usuario ve tres cuentas casi vacías y
concluye que ASCI no sabe nada de Techint.

Impacto directo sobre la pregunta 1: el modelo puede recomendar guardar —y gastar
cupo en— la empresa equivocada.

Fix: ordenar por evidencia (señales + vacantes) y desempatar por `id`.

### H4 · Reenviar una noticia ya guardada rompe el lote entero (medio)

Con una fuente repetida, el submit devuelve un error crudo de Postgres:

```
duplicate key value violates unique constraint "idx_company_news_unique_source"
```

Y se pierden **todos** los hallazgos del lote, incluidos los válidos. Como el modelo
reintenta con naturalidad, es un escenario frecuente. Fix: `ON CONFLICT DO NOTHING`
y reportar el duplicado como omitido, no como error.

### H5 · `submit_*` exige un dato que el package no devuelve (medio)

`submit_company_news` requiere `idempotencyKey`, pero el prompt package no la
incluye: el modelo debe recordar la que él mismo inventó en el `prepare`. En un
cliente real, con la conversación de por medio, es la clase de dato que se pierde.
La primera corrida del harness falló exactamente por esto.

Fix: devolver la `idempotencyKey` dentro del package.

### H6 · La cuota se cobra aunque no se guarde nada (medio)

De las 3 reservas del test, las 3 quedaron `committed` — incluida la de una
ejecución que quedó en `prepared` y nunca llegó a submit. El cobro ocurre al
preparar, sin importar el resultado. Un lote que muere por H4 igual le cuesta al
usuario.

### H7 · Los topes por plan del client-assisted son decorativos (medio)

`getMonthlyPoolUsage` solo se llama desde `mcp-contact-enrichment.ts`, **no** desde
`mcp-client-ai.ts`, que maneja noticias y casos de éxito. El propio comentario del
código lo anticipa: *"Sin esta función, los topes mensuales por plan serían
decorativos"*.

Lo único que aplica son límites planos hardcodeados en el RPC `reserve_mcp_usage`
(5/min, 25/día, 75/semana por usuario), **idénticos para bronze, silver y gold**.

### H8 · El filtro de relevancia mira el texto del modelo, no la página

`filterRelevantToCompany` busca el nombre de la empresa en el **título y resumen que
escribió el modelo**, no en el contenido de la fuente. Es un filtro contra alucinación
de tema, no de fuente, y explica por qué el caso de La Nación pasó.

Efecto lateral en el reporte: hallazgos legítimos rechazados acá se informan como
`no_menciona_empresa` aunque el problema sea otro, lo que confunde el diagnóstico.

---

## 5. Balances y reportes de sustentabilidad

Hoy no hay tool para esto. El único camino es el genérico de documentos
(`create_document_draft` + `get_document_text` + `confirm_document_analysis`), y
**`create_document_draft` no recibe `companyId`**: los documentos se asocian al
workspace, no a la cuenta. Sirve para "mi empresa", no para "la cuenta que estudio".

Spec propuesta, espejo del flujo de noticias para no introducir un patrón nuevo:

```
prepare_company_public_docs(companyId*, docTypes[], windowMonths, idempotencyKey*)
  -> promptPackage con resultSchema + packageHash + idempotencyKey (arreglando H5)

submit_company_public_docs(executionId*, packageHash*, idempotencyKey*, result*)
  -> result.items[]: {
       docType: "balance" | "memoria" | "sustentabilidad" | "presentacion_inversores",
       fiscalYear, title, sourceUrl, publisher, publishedAt,
       findings[]: { claim, metric?, value?, page?, quote* },
       direction: "expansion" | "contraccion" | "neutro"
     }
```

Dos condiciones para que aporte valor real:

1. **Reusar el pool `research_client`**, sin crear uno nuevo (el código ya sigue ese
   criterio y lo documenta).
2. **Exigir `quote` textual y `page`.** Un balance tiene cientos de páginas: sin cita
   verificable el dato no es auditable. Y conviene resolver H1 antes, o la
   verificación de fuente nacerá igual de permisiva.

---

## 6. Conclusión sobre las preguntas del test

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Alcanza la info inicial? | **Sí, y es barata**: 3 llamadas de costo cero (`search` → `check_account_access` → `get_company_signal_summary`) permiten decidir sobre una cuenta no guardada, con `prepare_save_account` para ver el costo antes de confirmar. Pero H3 hace que la decisión pueda tomarse sobre la empresa equivocada. |
| 2 | ¿Cuánta fricción? | El orden se deduce bien de las descripciones. Rompen H2 (tool inexistente citada en runtime) y H5 (dato obligatorio que no se entrega). |
| 3 | ¿Fuente verificable? | **No hoy.** La ventana temporal filtra, pero H1 deja pasar dominios inexistentes y páginas ajenas, y lo publica global. |
| 4 | ¿Costo vs. server-managed? | La arquitectura acierta: pool separado, prompt package bien armado, tokens del usuario. Falta el metering por plan (H7) y corregir el cobro de trabajo no entregado (H6). |
| 5 | ¿Cupos y confirmaciones? | Rate limiting y previsualización de cupo funcionan; los topes por plan del client-assisted no se aplican. |

**Orden sugerido de arreglos:** H1 y H2 primero (rompen la promesa central y el
primer paso), después H3 (decisión sobre la cuenta equivocada), luego H4/H5
(fricción del ciclo), y por último H6/H7 antes de abrir el flujo a más usuarios.
