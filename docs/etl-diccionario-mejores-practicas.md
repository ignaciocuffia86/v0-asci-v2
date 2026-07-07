# Mejores prácticas — Procesamiento de keywords del diccionario (ETL v2)

> Última actualización: Julio 2026
> Alcance: matcheo de keywords sobre `contacts` / `job_postings` para generar `signals`.
> Objetivo: procesamiento estable, con IO/CPU acotados y **sin cambiar el output** (mismas señales).

Este documento resume por qué el diseño anterior escalaba mal y qué patrones seguir de acá en adelante.
Sirve como guía para cualquier tarea que recorra tablas grandes (contactos 2 GB, señales 856 MB).

---

## 1. Nunca paginar con OFFSET sobre tablas grandes → usar keyset (seek)

**Problema.** `... ORDER BY id LIMIT n OFFSET k` obliga a Postgres a leer y **descartar** las primeras `k`
filas en cada llamada. Recorrer toda la tabla en lotes cuesta ~O(n²/lote): los primeros lotes vuelan y los
últimos se arrastran. A medida que la tabla crece, todo el proceso se vuelve más lento y más caro en CPU/IO.
Esta es la causa principal de "cada vez requiere más procesamiento".

**Práctica.** Paginación **keyset**: guardar un cursor (`id` de la última fila procesada) y avanzar con
`WHERE id > :cursor ORDER BY id LIMIT n`. Es O(1) por lote porque salta directo vía índice.

```sql
-- ❌ Anti-patrón (costo cuadrático)
SELECT * FROM contacts ORDER BY id LIMIT 2000 OFFSET 400000;

-- ✅ Keyset (constante por lote)
SELECT * FROM contacts WHERE id > :last_id ORDER BY id LIMIT 2000;
```

El cursor se persiste en el job (`dictionary_jobs.contacts_cursor`, `job_postings_cursor`), no como un
contador-offset. El `*_processed` se mantiene solo para mostrar progreso en la UI.

---

## 2. Preferir operaciones set-based a RBAR (row-by-row)

**Problema.** El loop PL/pgSQL fila-por-fila con un `SELECT EXISTS(... companies ...)` por contacto genera
cientos de miles de round-trips internos. RBAR = "Row By Agonizing Row".

**Práctica.** Un solo `INSERT ... SELECT` por lote, resolviendo la validación de empresa con un `JOIN`
y la deduplicación con `ON CONFLICT DO NOTHING`. El planner lo ejecuta en conjunto, mucho más barato.

```sql
INSERT INTO signals (contact_id, company_id, signal_type, signal_id, keyword_matched, ...)
SELECT c.id, c.current_company_id, :signal_type, :signal_id, :keyword, ...
FROM contacts c
JOIN companies co ON co.id = c.current_company_id           -- reemplaza el EXISTS por fila
WHERE c.id > :last_id
  AND c.current_company_id IS NOT NULL
  AND (<expr_texto>) ~* :pattern                            -- usa índice trigram
ORDER BY c.id
LIMIT :batch
ON CONFLICT (contact_id, company_id, signal_type, signal_id) DO NOTHING;
```

---

## 3. Indexar el texto que se busca (pg_trgm) en vez de seq-scan

**Problema.** `columna ~* '\ykeyword\y'` sin índice = seq scan de 2 GB por cada keyword.

**Práctica.** `pg_trgm` (ya instalada) con un índice **GIN `gin_trgm_ops`** acelera `~`, `~*`, `LIKE` e
`ILIKE` mediante Bitmap Index Scan. Funciona case-insensitive y soporta búsqueda por límites de palabra
siempre que el patrón tenga **≥ 3 caracteres** (keywords más cortas caen a recheck secuencial, es raro).

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY idx_contacts_kw_trgm
ON contacts USING gin (
  (coalesce(current_position_title,'')||E'\n'||coalesce(headline,'')||E'\n'||
   coalesce(about,'')||E'\n'||coalesce(current_position_description,'')) gin_trgm_ops
);
```

**Regla de oro:** la **expresión del índice debe ser idéntica** a la de la query (mismas columnas, mismo
`coalesce`, mismo separador) o el planner no lo usa. Verificar siempre con `EXPLAIN` que aparezca
`Bitmap Index Scan on idx_contacts_kw_trgm`.

**Separador seguro para preservar semántica.** Al concatenar varias columnas en una sola expresión, usar un
separador que **no** sea espacio (ej. `E'\n'`). Los `\y` (límites de palabra) tratan cualquier no-alfanumérico
como frontera, así que un keyword con espacio (ej. `"Palo Alto"`) **no** puede matchear a caballo entre dos
columnas. Esto garantiza el **mismo conjunto de resultados** que el `OR` de 4 predicados originales.

---

## 4. Escritura masiva y borrado: siempre en background y en lotes

**Problema.** Un `DELETE ... ILIKE` sobre `signals` (856 MB) ejecutado **desde el browser** corre bajo el rol
`authenticated` (`statement_timeout = 8s`) y sin índice → `canceling statement due to lock timeout`.

**Prácticas.**
- **Nunca** ejecutar DELETE/UPDATE masivos desde el cliente (browser). Encolarlos como job
  (`dictionary_jobs.job_type = 'remove_keyword'`) y procesarlos con el service role.
- Borrar/actualizar **en lotes** (`LIMIT` + keyset o `ctid`), devolviendo `has_more` para reintentar hasta
  vaciar, en vez de una sentencia gigante que toma locks largos.
- Indexar la columna de filtrado del borrado (`signals (signal_id, keyword_matched)`).

---

## 5. Un solo worker por job (guardia de concurrencia)

**Problema.** El cron `process-dictionary` y el server action `processDictionaryJobs` toman ambos "el job más
viejo" y lo bombean. Sin guardia, **dos runners procesan el mismo job**: duplican trabajo y compiten por locks
sobre `signals`.

**Práctica.** Serializar el trabajo por job con un advisory lock dentro del RPC:

```sql
IF NOT pg_try_advisory_xact_lock(hashtext(p_job_id::text)) THEN
  RETURN jsonb_build_object('success', true, 'skipped', 'locked');
END IF;
```

Alternativa: gate del server action contra `cron_executions` (el patrón que ya usa `process-queue`).

---

## 6. Timeouts coherentes de punta a punta

**Problema.** El cliente aborta el fetch a los 25s (`AbortSignal.timeout(25_000)`) mientras el RPC tiene
`statement_timeout = 120s`. El batch tarda más que el cliente → `TimeoutError: operation aborted` aunque
Postgres siga trabajando.

**Prácticas.**
- Dimensionar el lote para que **cada llamada** cierre bastante por debajo del timeout del cliente
  (con keyset + trigram, cada llamada baja a ms/pocos segundos).
- Mantener la cadena de timeouts coherente: `lote` ⟶ `statement_timeout` del RPC ⟶ `AbortSignal.timeout`
  del cliente ⟶ `maxDuration` de la función serverless.
- No confiar en `COUNT(*)` de tablas grandes en el hot path: calcular el total **una vez** por fase y cachearlo,
  o estimar con `pg_class.reltuples`.

---

## 7. Operaciones de esquema sin downtime

- Crear índices con `CREATE INDEX CONCURRENTLY` (no bloquea escrituras; correr **fuera** de transacción).
- Cambios de columnas: **aditivos** y `NULL`-ables (`ADD COLUMN ... uuid`), sin `DEFAULT` costoso.
- `ANALYZE` después de crear índices o cargas grandes para que el planner los use.
- En schema compartido (v2 + v3): preferir `CREATE OR REPLACE FUNCTION` conservando **firma y JSON de
  retorno**, para no romper consumidores.

---

## Checklist para tareas de ETL/matcheo sobre tablas grandes
- [ ] ¿Paginás con keyset (no OFFSET)?
- [ ] ¿Es set-based (`INSERT...SELECT`) en vez de loop por fila?
- [ ] ¿Existe índice trigram cuya expresión es idéntica a la query? (`EXPLAIN` lo confirma)
- [ ] ¿Los DELETE/UPDATE masivos corren en background, en lotes e indexados?
- [ ] ¿Hay guardia para que un solo worker procese cada job?
- [ ] ¿Los timeouts (lote → RPC → cliente → serverless) son coherentes?
- [ ] ¿Preservás el contrato de dedupe (`ON CONFLICT` sobre las unique keys de `signals`)?

## Referencias
- Keyset vs OFFSET: OFFSET degrada O(n) con el desplazamiento; keyset es O(1) por página vía índice.
- pg_trgm: índice GIN `gin_trgm_ops` acelera `~ / ~* / LIKE / ILIKE` con Bitmap Index Scan (patrón ≥ 3 chars).
