# Feature: Carga masiva de cuentas por archivo + cron mensual de job postings (v3)

**Estado:** Diseño aprobado por producto (decisiones abajo), pendiente de implementación.
**Reemplaza parcialmente a:** `docs/feature-import-accounts-from-csv.md` (blueprint v2 sobre
bookmarks, nunca implementado; su cascada de matching y su UI de review se reutilizan acá,
pero el destino ahora es `v3.followed_accounts`, no `public.bookmarks`).

---

## 1. Problema

Los clientes que hacen ABM ya tienen su lista de cuentas target en un Excel/CSV. Hoy el alta
en ASCI es manual, cuenta por cuenta (buscar → seguir), lo que es una fricción real para
onboardings de decenas o cientos de cuentas por workspace.

Además, el seguimiento mensual de novedades de vacantes (job postings) de esas cuentas es
hoy on-demand (tool MCP / botón en UI): no existe un barrido programado que traiga las
novedades del mes de **todas** las cuentas seguidas.

## 2. Decisiones de producto (cerradas)

| Decisión | Elección |
|---|---|
| Quién sube el archivo | **Superadmin** (eligiendo workspace destino en `/v3/admin`) **y admin de workspace** (para su propio tenant en `/v3/accounts`) |
| Formato y matching | Template con `company_name` (requerido) + `linkedin_url` / `website` / `country` (opcionales). Matching automático con **pantalla de review** para dudosos/no encontrados |
| Cuotas | El alta masiva **respeta `followedCap`** del plan, con **preflight** que muestra el impacto antes de confirmar. El superadmin puede ajustar el plan desde la misma pantalla y reintentar |
| Dónde vive el cron de scraping | **Vercel Cron que invoca Apify** (patrón casero: lock + auditoría + presupuesto + cooldown). No se usan schedules nativos de Apify ni webhooks |

## 3. Principios que impone la arquitectura actual

Estos no son opinables; salen del código vigente:

1. **`public.companies` es un catálogo global** (UNIQUE `name`, UNIQUE `linkedin_url`), no
   tenant-scoped. Dos workspaces que suben "BBVA" comparten el mismo `company_id`. La
   pertenencia al workgroup se expresa **solo** con la fila en `v3.followed_accounts`
   (UNIQUE `(workspace_id, company_id)` → la re-subida es naturalmente idempotente).
2. Toda creación/actualización de compañías pasa por **`upsert_company()`** (match por
   `linkedin_url` → nombre normalizado → insert; solo completa columnas NULL) o por
   `resolveCompany()` (`lib/v3/services/company-resolver.ts`). Nunca INSERT directo.
3. El alta de seguimiento pasa por **`followAccount()`** (`lib/v3/services/accounts.ts:12`):
   idempotente, reactiva soft-deletes, chequea `checkFollowQuota()`, asigna `refresh_day`
   aleatorio 1–28 y auto-suscribe al digest. La carga masiva lo reutiliza, no lo duplica.
4. Tablas `v3.*`: RLS habilitado **sin políticas permisivas**; el acceso va por
   `createAdminClient()` (service role) filtrando siempre `workspace_id` en TypeScript.
   Las tablas nuevas siguen ese patrón.
5. Los layouts de admin solo gatean navegación: **cada server action / route handler
   re-chequea** `requireSuperadmin()` o `requireWorkspaceAdmin()`.
6. Toda ingesta de vacantes fluye por el **pipeline ETL v2 compartido**
   (`import_batches`/`import_rows` con `batch_type='job_postings'`, provenance en el
   `filename` `apify://<companyId>/<runId>`) y por el guardrail de atribución
   **`belongsToCompany()`** (`lib/v3/services/apify-job-ingest.ts:206`). El cron nuevo no
   crea un pipeline paralelo.
7. Crons: patrón casero obligatorio — `assertCron()` (Bearer `CRON_SECRET`),
   `acquire_cron_lock`, fila en `cron_executions`, `BUDGET_MS` por debajo de `maxDuration`,
   **marcar el intento antes del trabajo pago** (lección medida del refresh: 48% de corridas
   Opus desperdiciadas cuando el intento se registraba solo al éxito), `?dryRun=1` /
   `?force=1`.

---

## 4. Parte 1 — Carga masiva de cuentas a un workgroup

### 4.1 Template de archivo (CSV y XLSX)

Botón "Descargar plantilla" en ambas pantallas. Columnas (auto-detect de headers en
español/inglés, con override manual como propone el blueprint v2):

| Columna | Requerida | Uso |
|---|---|---|
| `company_name` | Sí | Nombre de la empresa tal como la conoce el cliente |
| `linkedin_url` | No (muy recomendada) | Match exacto contra `companies.linkedin_url`; es el identificador más confiable y el que después permite apuntar bien el scraping |
| `website` | No | Segunda señal de identidad (via `resolveCompany`, que ya puntúa dominio +70) |
| `country` | No | Desambigua multinacionales ("Accenture" existe en 15+ países en la base) |
| `notes` | No | Se guarda como contexto de la fila importada |

```csv
company_name,linkedin_url,website,country,notes
"Banco Galicia","https://www.linkedin.com/company/banco-galicia","bancogalicia.com","Argentina","Target Q2"
"YPF S.A.","https://www.linkedin.com/company/ypf","ypf.com","Argentina",""
```

Límites: **máx. 500 filas por import**, 1 import activo por workspace a la vez,
deduplicación de filas repetidas en el parseo (con aviso).

Parseo: CSV con `papaparse` (ya en uso). XLSX con `exceljs`, que ya está en
`package.json` como write-only (`lib/export-bookmarks.ts`) y también lee — **no se agrega
dependencia** (el blueprint v2 proponía SheetJS; se descarta).

### 4.2 Flujo y superficies de UI

Mecánica de upload: copiar el patrón productivo de `/admin/ingest` — browser →
Vercel Blob (`/api/v3/account-imports/blob-upload`, token minting + tipos permitidos) →
el server descarga el blob y parsea. Evita el límite de 4.5 MB de body serverless.

**Superadmin** — `/v3/admin/account-imports` (nuevo tab "Importar cuentas" en
`admin-nav.tsx`) + acción por fila "Importar cuentas" en
`admin-workspaces-view.tsx` que llega con el workspace preseleccionado:

```
Paso 0: Selector de workspace destino (o preseleccionado desde Workspaces)
Paso 1: Upload (dropzone .csv/.xlsx) + preview de primeras 5 filas + mapeo de columnas
Paso 2: Matching automático → tabla de review (ver 4.3)
Paso 3: Preflight de cuota (ver 4.4) → botón "Dar de alta N cuentas"
Paso 4: Resumen (altas, ya seguidas, descartadas, creadas nuevas) + CTA a /v3/accounts
```

**Admin de workspace** — botón "Importar cuentas" en `/v3/accounts`
(`accounts-view.tsx`), mismo wizard sin el paso 0 (workspace implícito por
`requireWorkspaceAdmin()`). Miembros `member` no lo ven.

El estado del wizard se persiste (tablas de 4.5), así que un import grande se puede
retomar si se corta la sesión: el batch queda en `reviewing` hasta confirmar o descartar.

### 4.3 Cascada de matching y review

Por fila, en este orden (reutiliza `resolveCompany` y las heurísticas del blueprint v2):

```
1. linkedin_url presente → match EXACTO contra companies.linkedin_url (normalizando slug)
     → matched (confianza alta)
2. website presente → resolveCompany() con dominio → matched si score alto
3. Nombre normalizado (normalizeCompanyName: quita SA/SRL/Inc/acentos) EXACTO contra
   companies.normalized_name, filtrado por country si vino
     → 1 resultado: matched · varios: ambiguous · 0: sigue
4. Fuzzy (scoring de resolveCompany / ILIKE)
     → 1 candidato con score medio: candidate · varios: ambiguous · 0: not_found
```

Estados por fila: `matched` · `candidate` (confirmación 1-click) · `ambiguous`
(dropdown de candidatos + mini-búsqueda inline) · `not_found` · `already_followed`
(ya existe fila activa en `followed_accounts` para ese workspace) · `error`.

En la pantalla de review:

- `matched` se confirman en bloque ("Confirmar todos", default on).
- `not_found` ofrece **"Crear compañía"**: pasa por `upsert_company()` con los datos de la
  fila y encola el enriquecimiento LinkedIn existente (`v3.linkedin_company_enrichment`,
  procesado por el cron `v3-enrich-companies-linkedin` cada 10 min) para completar
  industria, país, logo y — clave para la Parte 3 — el identificador de LinkedIn.
  Crear requiere `linkedin_url` **o** `website` en la fila; con nombre solo, la fila se
  descarta con aviso (evita ensuciar el catálogo global, que ya arrastra nombres sucios
  de ingestas CSV históricas — ver header de `companyNameVariants`).
- Cualquier fila se puede "Ignorar".

### 4.4 Cuotas: preflight obligatorio

Antes de confirmar, la pantalla muestra:

```
Archivo: 120 filas → 95 matcheadas, 12 a crear, 8 ya seguidas, 5 descartadas
Workspace "Acme" (plan gold): 41/60 cuentas seguidas → cupo disponible: 19
⚠ El alta pedida (107) excede el cupo en 88.
```

- Si excede: **no se da de alta nada parcial por defecto** (el admin puede optar por
  "dar de alta hasta el cupo" marcando qué filas priorizar). El superadmin ve inline el
  selector de plan (`setWorkspacePlan`, ya existe en `app/actions/v3/admin.ts`) para
  ajustar y reintentar sin salir del wizard. El admin de workspace ve un CTA de contacto.
- La confirmación final vuelve a validar contra `checkFollowQuota()` **dentro de la
  transacción de alta** (la cuota pudo cambiar entre preflight y confirm).
- El alta usa `followAccount()` por fila (idempotencia, reactivación, `refresh_day`
  aleatorio 1–28 que mantiene repartida la carga de los crons mensuales, auto-suscripción
  al digest del usuario que importó).

### 4.5 Modelo de datos (migración nueva)

**No** se reutiliza la cola ETL v2 para el import de cuentas: agregar un `batch_type`
nuevo exige tocar el PL/pgSQL de `process_import_batch` (que hace `EXIT` ante tipos
desconocidos y dejaría el batch en loop), y el flujo acá es interactivo (review), no de
cola. Tablas nuevas en `v3` (RLS on, sin políticas, patrón service-role):

```sql
CREATE TABLE v3.account_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES auth.users(id),
  filename      text NOT NULL,
  blob_url      text,
  status        text NOT NULL DEFAULT 'parsing'
                CHECK (status IN ('parsing','reviewing','confirming','completed','failed','discarded')),
  total_rows    int NOT NULL DEFAULT 0,
  followed_rows int NOT NULL DEFAULT 0,
  created_companies int NOT NULL DEFAULT 0,
  skipped_rows  int NOT NULL DEFAULT 0,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE TABLE v3.account_import_rows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id     uuid NOT NULL REFERENCES v3.account_imports(id) ON DELETE CASCADE,
  row_number    int NOT NULL,
  row_data      jsonb NOT NULL,                -- fila cruda del archivo
  match_status  text NOT NULL DEFAULT 'pending'
                CHECK (match_status IN ('pending','matched','candidate','ambiguous',
                                        'not_found','already_followed','error')),
  matched_company_id uuid REFERENCES public.companies(id),
  match_score   numeric,
  candidates    jsonb,                          -- [{company_id, name, country, score}]
  resolution    text CHECK (resolution IN ('confirmed','created','ignored')),
  resolved_by   uuid REFERENCES auth.users(id),
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON v3.account_import_rows (import_id, match_status);
```

Nota: existe código muerto que apunta a `v3.csv_imports` / `v3.csv_import_rows`
(`app/actions/v3/csv-import.ts`, tablas que **no existen** en la baseline y que consultan
una columna `companies.domain` inexistente). Ese archivo se toma como referencia del
matcher y **se elimina** en esta feature para que no confunda.

### 4.6 Server actions / endpoints

| Pieza | Guard | Responsabilidad |
|---|---|---|
| `POST /api/v3/account-imports/blob-upload` | superadmin o workspace admin | Token de Vercel Blob (tipos csv/xlsx, máx 10 MB) |
| `createAccountImport(workspaceId, blobUrl, filename, mapping)` | ídem (superadmin puede pasar cualquier `workspaceId`; workspace admin solo el propio) | Descarga blob, parsea, deduplica, corre la cascada de matching, persiste filas, devuelve `importId` |
| `resolveImportRow(rowId, {companyId | create | ignore})` | ídem | Resolución individual desde la review |
| `confirmAccountImport(importId)` | ídem | Preflight final de cuota + `followAccount()` por fila confirmada + contadores + `revalidatePath` |
| `discardAccountImport(importId)` | ídem | Cierra el batch sin alta |

Matching síncrono hasta 500 filas (queries en chunks de 50 nombres por IN, como propone el
blueprint); si en la práctica se queda corto, se pasa a procesamiento por polling del
status (la persistencia ya lo permite).

---

## 5. Parte 2 — LinkedIn company ID numérico (prerequisito del scraping "bien apuntado")

El actor de jobs (`bebity~linkedin-jobs-scraper`) tiene dos filtros: `companyName`
(array, el que se usa hoy, con variantes + guardrail `belongsToCompany` por el problema
real de homónimos) y **`companyId` (array de IDs numéricos de LinkedIn, filtro EXACTO)**.
Hoy no se usa porque `companies` no guarda ese ID. El pedido de producto es apuntar por ID.

### 5.1 Migración

```sql
ALTER TABLE public.companies ADD COLUMN linkedin_company_id bigint;
CREATE UNIQUE INDEX companies_linkedin_company_id_key
  ON public.companies (linkedin_company_id) WHERE linkedin_company_id IS NOT NULL;
```

### 5.2 Cómo se puebla (cuatro fuentes, sin trabajo manual)

0. **Backfill desde las vacantes ya cargadas** (verificado contra producción, ago 2026):
   las 41.224 vacantes existentes entraron por CSV (no hay aún ningún batch `apify://`),
   pero el CSV era un export del mismo scraper y `job_postings.source_data->'_original'`
   conserva la fila cruda **incluyendo `companyId`**. Números reales:
   - 6.619 compañías tienen vacantes; **4.058 tienen ID recuperable**, y 4.051 de ellas
     con un único ID consistente en todas sus vacantes.
   - 7 compañías tienen IDs mezclados (atribución imperfecta del CSV): se toma el ID
     dominante solo si cubre ≥80% de sus vacantes (6 de las 7); la restante se deja NULL.
   - 22 LinkedIn IDs apuntan a más de un `company_id` nuestro — duplicados probables del
     catálogo. Esas colisiones **no se backfillean** (romperían el índice único); se
     exportan como reporte para la pantalla de duplicados de `/admin/companies`.
   - De las 12 cuentas seguidas activas en v3 hoy, 8 quedan cubiertas de entrada.

   El backfill es un script SQL one-shot (mismo criterio write-once), que corre junto
   con la migración de la columna:

   ```sql
   WITH dominante AS (
     SELECT DISTINCT ON (company_id) company_id,
            (source_data->'_original'->>'companyId')::bigint AS lid,
            count(*) AS jobs,
            sum(count(*)) OVER (PARTITION BY company_id) AS total
     FROM public.job_postings
     WHERE source_data->'_original'->>'companyId' ~ '^[0-9]+$'
     GROUP BY company_id, lid
     ORDER BY company_id, count(*) DESC
   ), elegibles AS (
     SELECT company_id, lid FROM dominante
     WHERE jobs::numeric / total >= 0.8
       AND lid IN (SELECT lid FROM dominante GROUP BY lid HAVING count(*) = 1)
   )
   UPDATE public.companies c
   SET linkedin_company_id = e.lid
   FROM elegibles e
   WHERE c.id = e.company_id AND c.linkedin_company_id IS NULL;
   ```

1. **Resultados del propio scraper**: verificado en `apify-client.ts` (header, ago 2026)
   que **cada vacante devuelta trae el `companyId`**. `ingestApifyJobPostings()` se
   extiende: cuando una vacante pasa el guardrail `belongsToCompany()` y la compañía no
   tiene `linkedin_company_id`, se persiste (write-once; ante conflicto de UNIQUE se
   loguea y no se pisa). Así el primer barrido por nombre "aprende" el ID y los
   siguientes ya son exactos.
2. **Enriquecimiento harvestapi** (`linkedin-company-enrichment.ts`): verificar si el
   payload del actor incluye el ID numérico; si sí, mapearlo en el mismo write-once.
3. **Columna opcional del archivo** (`linkedin_company_id`) para clientes ABM que ya lo
   tienen; se valida numérico y se aplica write-once.

### 5.3 Uso en el scraper

`runLinkedinJobsActor()` acepta `companyIds?: number[]`; la selección del cron manda
`companyId: [id]` cuando existe y **omite** `companyName` (el filtro exacto no necesita
variantes). Sin ID, se mantiene el flujo actual `companyNameVariants()`. El guardrail
`belongsToCompany()` **no se relaja en ningún caso**: costo cero y cubre el modo nombre.

---

## 6. Parte 3 — Cron mensual de job postings de cuentas seguidas

### 6.1 Diseño general

Nuevo endpoint `app/api/cron/v3-scrape-job-postings/route.ts` + entrada en `vercel.json`.
Es un **Vercel Cron que invoca Apify** (decisión cerrada): Apify queda solo como motor de
scraping; scheduling, presupuesto, reintentos y auditoría siguen el patrón casero.

- **Cadencia mensual repartida**: reutiliza el `refresh_day` (1–28) que ya tiene cada
  `followed_accounts`. Cada cuenta se scrapea una vez al mes, el día que le toca.
- **Ventana de novedades**: `publishedAt: "r2592000"` (30 días — la ventana más amplia
  que el actor soporta de forma cerrada; encaja exacto con la cadencia mensual, con leve
  solapamiento en meses de 31 días que la ingesta idempotente absorbe).
- **Horario**: `0 3-5 * * *` cada 20 min (`*/20 3-5 * * *`), es decir **antes** de
  `v3-refresh-accounts` (`*/15 6-11 * * *`): el research mensual de la cuenta corre con
  las vacantes ya frescas en `job_postings` y las señales ya generadas.
- **Presupuesto por invocación**: `maxDuration = 300`, `BUDGET_MS = 270_000`,
  `MAX_COMPANIES_PER_RUN = 2` (un run del actor tarda 1–3 min con proxy residencial;
  2 por invocación × 9 invocaciones/día ≈ 18 compañías/día ≫ necesario para repartir
  ~cientos de cuentas en 28 días; se ajusta con datos reales de `cron_executions`).

### 6.2 Selección de trabajo: por compañía, no por cuenta seguida

`job_postings` es global por `company_id`; si dos workspaces siguen a BBVA, scrapear dos
veces el mismo mes duplica gasto de Apify sin valor. La selección:

```sql
-- Conceptual: compañías con al menos una cuenta seguida activa cuyo día es hoy,
-- deduplicadas por company_id
SELECT DISTINCT fa.company_id
FROM v3.followed_accounts fa
WHERE fa.is_active = true AND fa.refresh_day = extract(day from now())
```

y sobre cada `company_id` un **cooldown de 25 días** verificado con el mecanismo ya
existente: último `import_batches` no-`failed` con `filename LIKE 'apify://<companyId>/%'`
(mismo precedente que el cooldown de 12 h del botón on-demand en
`app/actions/v3/accounts.ts`). Así el scraping manual reciente también cuenta y no se
paga dos veces. No hace falta tabla de estado nueva.

Tracking de intentos (para no reintentar infinito una compañía que falla): dos columnas
en `public.companies` sería contaminar el catálogo; en su lugar, el batch `failed` de
`import_batches` con el prefijo `apify://<companyId>/` + `consecutive_failures` ya da la
señal, y el cron aplica `MAX_SCRAPE_ATTEMPTS = 3` por mes contando batches fallidos del
prefijo en los últimos 28 días.

### 6.3 Cuerpo del cron (patrón casero completo)

```
1. assertCron(request) · flags ?dryRun=1 ?force=1 (force ignora cooldown)
2. acquire_cron_lock("v3-scrape-job-postings", ttl 600s)
3. INSERT cron_executions (status 'running')
4. isApifyConfigured() + checkApifyQuota() → si no hay cuota, cerrar 'completed'
   con detail 'quota', sin gastar (guardrail existente de enrichment)
5. Por compañía seleccionada (hasta MAX_COMPANIES_PER_RUN, respetando BUDGET_MS):
   a. runLinkedinJobsActor({ companyIds: [id] } o companyNameVariants, rows: 200,
      publishedAt: "r2592000", proxy residencial, flujo async de 3 llamadas —
      NUNCA run-sync, por el incidente documentado del 502 que pierde datos pagos)
   b. ingestApifyJobPostings(...) → import_batches 'apify://<companyId>/<runId>',
      batch_type 'job_postings', belongsToCompany(), dedup por UNIQUE job_url
   c. El process-queue existente (cada minuto) upsertea job_postings y dispara
      process_job_signals → señales → digest mensual a suscriptores. Sin código nuevo.
6. UPDATE cron_executions (completed/failed, records_processed, details con
   companyIds, runIds, jobs traídos/insertados/skipped)
```

Nota deliberada: **no** se marca "intento" en `followed_accounts` — el registro de intento
vive en el batch `apify://…` creado al lanzar el run (paso 5.b ocurre aunque el run
termine TIMED-OUT: el cliente ya lee datasets parciales), cumpliendo la regla de
"registrar antes/junto al gasto".

### 6.4 Costos y guardrails

- Techo natural de gasto: `followedCap` por plan (la Parte 1 lo respeta) × 1 run/mes por
  compañía deduplicada. Plan `platinum` (120 cuentas) ≈ 4–5 runs de actor por día.
- `checkApifyQuota()` antes de cada invocación (margen 2%, patrón del enrichment).
- `rows: 200` por run (techo verificado; sin proxy residencial el actor expira).
- Si un workspace tiene `plan.allowsCron = false` (revisar `PLAN_CONFIG`), sus compañías
  solo entran a la selección si otro workspace con cron habilitado también las sigue.

---

## 7. Resumen de migraciones

1. `v3.account_imports` + `v3.account_import_rows` (RLS on, sin políticas).
2. `public.companies.linkedin_company_id bigint` + índice único parcial.
3. Nada en el PL/pgSQL del ETL: el cron de scraping reutiliza `batch_type='job_postings'`.

## 8. Fases de implementación

**Fase 1 — Import core (superadmin):** migración 1 · parseo CSV/XLSX + blob upload ·
cascada de matching · UI wizard en `/v3/admin/account-imports` + acción desde Workspaces ·
preflight de cuota · alta vía `followAccount()` · borrar `app/actions/v3/csv-import.ts`.

**Fase 2 — Self-service (workspace admin):** mismo wizard en `/v3/accounts` con
`requireWorkspaceAdmin()`; CTA de upgrade cuando el archivo excede el cupo.

**Fase 3 — LinkedIn company ID:** migración 2 **+ backfill histórico de 5.2.0**
(recupera ~4.050 compañías de entrada, 8 de las 12 cuentas seguidas actuales) · captura
write-once desde ingesta de jobs y (si aplica) desde harvestapi · columna opcional en el
template · `companyIds` en `runLinkedinJobsActor()` · reporte de los 22 IDs en colisión
hacia la pantalla de duplicados de `/admin/companies`.

**Fase 4 — Cron mensual:** `v3-scrape-job-postings` + entrada en `vercel.json` ·
selección deduplicada por compañía + cooldown 25 días por prefijo `apify://` ·
observabilidad en `cron_executions` y en el panel de uso de `/v3/admin`.

Fases 3 y 4 son independientes de la 2; el cron mejora su puntería solo con desplegar la 3.

## 9. Métricas de éxito

- % de filas con match automático (`matched`) sin intervención (target >70% en LATAM).
- Tiempo end-to-end de un import de 100 cuentas (target <5 min incluyendo review).
- % de compañías seguidas con `linkedin_company_id` poblado a los 60 días (target >80%).
- Pureza de atribución de vacantes (jobs descartados por `belongsToCompany` / traídos):
  debe bajar al scrapear por ID.
- Costo Apify por compañía/mes estable y visible en `cron_executions.details`.

## 10. Preguntas abiertas (no bloquean Fase 1)

1. ¿El payload de `harvestapi~linkedin-company` incluye el ID numérico? (verificar con un
   run real; si no, la fuente principal es la ingesta de jobs, que está confirmada).
2. `PLAN_CONFIG.allowsCron`: ¿aplica al scraping de jobs o solo al research? Definir si un
   plan sin cron igual recibe novedades mensuales de vacantes.
3. ¿El digest mensual existente debe destacar "vacantes nuevas del mes" como sección
   propia? (Hoy las señales derivadas ya entran; es cuestión de presentación.)
4. Límite de 500 filas por import: validar contra el tamaño real de listas ABM de los
   clientes actuales.
