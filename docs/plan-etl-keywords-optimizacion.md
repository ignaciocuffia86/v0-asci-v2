# Plan: Estabilizar y optimizar el ETL de keywords del diccionario (v2)

> Estado: propuesta (pendiente de OK para aplicar en PROD vía MCP)

## Objetivo
Eliminar los errores al agregar/quitar keywords (`TimeoutError: operation aborted` y
`canceling statement due to lock timeout`) y frenar el crecimiento de CPU/IO, **sin cambiar el output**
del procesamiento de señales (misma creación de `signals`, misma semántica de match, misma deduplicación).
Cambios lo menos disruptivos posibles y compatibles con v3 (schema `public` compartido).

---

## Relevamiento (estado actual)

### Flujo
1. `components/dictionary/edit-keywords-dialog.tsx` → al confirmar:
   - **Borrado**: `supabase.from("signals").delete().eq("signal_id", id).ilike("keyword_matched", kw)`
     ejecutado **desde el browser** (rol `authenticated`, `statement_timeout = 8s`).
   - **Alta**: inserta un `dictionary_jobs` con `job_type='add_keyword'`, `status='pending'`.
2. Dos workers consumen la cola **en paralelo y sin guardia entre sí**:
   - Cron `app/api/cron/process-dictionary/route.ts` (cada 1 min, `AbortSignal.timeout(25s)`, `p_batch_size=2000`).
   - Server action `app/actions/processing.ts::processDictionaryJobs` (budget 25s, `p_batch_size=1000`).
   - Ambos toman "el job más viejo" y lo bombean → **pueden trabajar el mismo job a la vez**.
3. RPC `process_dictionary_job` (SECURITY DEFINER, `statement_timeout=120s`), 2 fases: `contacts` → `job_postings`.
   - Conduce el avance con **OFFSET** = `contacts_processed` / `job_postings_processed`.
   - Llama a `process_add_keyword_contacts` / `process_add_keyword_job_postings`.

### Workers (hot path) — `process_add_keyword_contacts`
- `SELECT COUNT(*) FROM contacts` **en cada llamada** (2 GB, full scan).
- `FOR ... IN SELECT * FROM contacts ORDER BY id LIMIT batch OFFSET offset` (**OFFSET creciente**).
- Loop **fila por fila** (RBAR): por cada contacto, `SELECT EXISTS(... companies ...)` + regex `~*`
  con `\y..\y` sobre 4 columnas (`current_position_title`, `headline`, `about`, `current_position_description`).
- `INSERT INTO signals ... ON CONFLICT DO NOTHING`.

### Métricas medidas (PROD)
| Tabla | Filas | Tamaño |
|---|---|---|
| signals | 1.384.899 | 856 MB |
| contacts | 472.929 | **2.071 MB** |
| companies | 476.063 | 362 MB |
| job_postings | 33.457 | 247 MB |
| dictionary_jobs | 5.485 | 1.8 MB |

- `pg_trgm` **instalada pero NO usada** (no hay índice trigram en columnas de texto).
- `statement_timeout`: db=120s, rol `authenticated`=8s, `anon`=3s.
- `signals`: sin índice sobre `keyword_matched` (el borrado por `ilike` hace seq scan de 856 MB).

### Contrato de salida a preservar (constraints únicas de `signals`)
- `unique_signal_per_contact_company_dict UNIQUE (contact_id, company_id, signal_type, signal_id)`
- `signals_job_posting_signal_unique UNIQUE (job_posting_id, signal_type, signal_id)`

---

## Causas raíz
1. **OFFSET creciente = costo cuadrático.** Cada batch re-lee y descarta las filas previas. El costo de
   procesar toda la tabla es ~O(n²/batch). Es la causa central de "cada vez requiere más procesamiento".
2. **RBAR + `COUNT(*)` por llamada + `EXISTS` por fila.** ~473k iteraciones PL/pgSQL, ~473k subconsultas a
   `companies`, y un `COUNT(*)` de 2 GB por llamada.
3. **Sin índice de texto.** Cada regex `~*` es un seq scan de 2 GB; `pg_trgm` está pero no se aprovecha.
4. **Timeout de cliente < duración de batch.** El cron aborta el fetch a los 25s mientras el batch de 2000
   filas con OFFSET alto tarda más → `TimeoutError: The operation was aborted due to timeout`.
5. **Borrado síncrono desde el browser.** `DELETE ... ilike` sobre 856 MB sin índice, bajo `statement_timeout=8s`
   y compitiendo con los crons → `canceling statement due to lock timeout`.
6. **Doble worker sin guardia.** Cron + server action pueden procesar el mismo job → duplican trabajo y
   generan contención de locks sobre `signals`.

---

## Solución (mínimamente disruptiva, mismo output)

### A) Índices (aditivos, `CREATE INDEX CONCURRENTLY`, fuera de transacción)
1. `idx_contacts_kw_trgm` GIN trigram sobre la **expresión concatenada** de las 4 columnas, con separador
   `E'\n'` (carácter no-palabra → preserva `\y` y **no** crea coincidencias cruzadas entre columnas → mismo
   conjunto de matches que hoy).
2. `idx_job_postings_kw_trgm` GIN trigram sobre la expresión equivalente de `job_postings`.
3. `idx_signals_signalid_keyword` sobre `signals (signal_id, keyword_matched)` para el borrado por keyword.
4. `ANALYZE` de las tres tablas.

### B) Workers set-based + keyset (mismo contrato de RPC y de salida)
- Avance **OFFSET → keyset** (cursor por `id`). Columnas nullable nuevas en `dictionary_jobs`:
  `contacts_cursor uuid`, `job_postings_cursor uuid` (aditivo; se conservan `*_processed`/`*_total` para la UI).
- Reemplazar el loop RBAR por **un `INSERT ... SELECT`** por ventana keyset (usa el índice trigram, hace el
  JOIN a `companies` en vez de `EXISTS` por fila, `ON CONFLICT DO NOTHING`).
- `total` de la fase se calcula **una sola vez** al inicio y se cachea; se elimina el `COUNT(*)` por llamada.
- Firma del RPC `process_dictionary_job` y su JSON de retorno **sin cambios**.

### C) Borrado de keyword → job en background
- Quitar el `DELETE` síncrono del dialog; encolar `dictionary_jobs` con `job_type='remove_keyword'`
  (driver y `process_remove_keyword` ya existen).
- Reescribir `process_remove_keyword` para borrar **en batches** con `idx_signals_signalid_keyword`,
  devolviendo `has_more` hasta terminar.

### D) Guardia de concurrencia
- `pg_try_advisory_xact_lock(hashtext(job_id))` dentro del RPC (o gate del server action contra el cron).

### E) Defensivos
- Alinear `AbortSignal.timeout` del cron con la duración real (con keyset+trigram cada llamada es de ms a
  pocos s), y `ANALYZE` post-índices.

---

## Compatibilidad con v3
Todo es `schema public` (compartido). Los cambios son **aditivos** (índices y columnas nullable) y
**reescritura interna** de funciones existentes; no cambian nombres/firmas de RPC ni el esquema de `signals`.
v3 no consume estas funciones. Riesgo de output: nulo. Impacto de performance: positivo.

## Orden de aplicación (vía MCP)
1. `CREATE INDEX CONCURRENTLY` (x3) + `ANALYZE` (no bloquea; se puede en vivo).
2. `ALTER TABLE dictionary_jobs ADD COLUMN ... cursor uuid`.
3. `CREATE OR REPLACE FUNCTION` de los 3 workers + driver (cambio atómico).
4. Deploy `edit-keywords-dialog.tsx` (borrado → job) + guardia de concurrencia.
5. Reset a `pending` de las keywords en `Error`.

## Validación
- Comparar conteo de `signals` creadas (nuevo vs viejo) en una muestra → debe coincidir exacto.
- `EXPLAIN` del `INSERT...SELECT` debe mostrar Bitmap Index Scan sobre el índice trigram.
- Cada llamada < 5s; sin `TimeoutError` ni `lock timeout`.

## Archivos afectados
- `scripts/09X_etl_keywords_setbased.sql` — **nuevo**: índices, columnas cursor, funciones reescritas.
- `components/dictionary/edit-keywords-dialog.tsx` — borrado pasa a encolar `remove_keyword`.
- `app/actions/processing.ts` — guardia de concurrencia.
- `docs/etl-diccionario-mejores-practicas.md` — **nuevo**: mejores prácticas.

## Fuera de alcance
- No se migran señales legacy ni se cambia el esquema de `signals`.
- No se cambia la cadencia de los crons (salvo la guardia).
