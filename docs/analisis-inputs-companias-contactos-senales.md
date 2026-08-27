# Análisis de inputs a companies / contacts / signals

*Análisis del 2026-08-25. Código: ETLs y `scripts/443-458`. Datos: medidos en producción
(asciv2-database) ese día. Objetivo: entender cómo se construye el catálogo, por qué el
75% de las compañías queda "solo nombre", cómo se matchea/mergea, y cómo priorizar el
enrichment interno (merge) y externo (APIFY / Apollo) sin pisar información.*

---

## 1. El número que ordena todo

| Métrica | Valor |
|---|---|
| Compañías | **514.391** |
| Compañías "solo nombre" (sin `linkedin_url`, `website`, `industry` ni `description`) | **385.898 (75%)** |
| Compañías referenciadas como empleador **anterior** de algún contacto | 454.296 |
| De las "solo nombre", referenciadas como empleador anterior | **381.372 (99%)** |
| De las "solo nombre": empleador actual de alguien / con vacantes / con señales | 723 / 80 / **131.946** |
| Contactos | 544.391 (+ 1.495.531 `contact_identities`) |
| Señales | 1.551.638 (proceso 1,24 M · tecnología 316 k; mitad y mitad current/past) |
| Vacantes | 43.052 |

**Conclusión central:** el generador de compañías vacías no es un bug sino una asimetría
de diseño del ETL de contactos. El empleador actual entra con 7 campos; cada empleador
anterior (hasta 6 por contacto) entra como `upsert_company(nombre, NULL×6)`
(`supabase/migrations/20260825000000_contact_identity_resolution.sql:501-522`). Como el
matching por núcleo exige identidad externa (ver §3), casi todos crean fila nueva y vacía.

Cobertura de columnas en `companies`: `industry` 128.282 · `website` 128.075 ·
`country` 125.819 · `linkedin_url` 64.635 · `description` 62.315 ·
`linkedin_company_id` 14.489 · `apollo_organization_id` **194**.

Prioridad de las vacías por # de referencias como empleador anterior:

| Referencias | Empresas solo-nombre |
|---|---|
| 50+ | 98 |
| 10–49 | 2.617 |
| 5–9 | 7.879 |
| 2–4 | 56.013 |
| 1 | 314.765 |

---

## 2. Mapa de inputs

### ETL de contactos (única vía: CSV manual)

CSV tipo SalesQL en `/admin/ingest` → Vercel Blob → `import_rows` (staging JSONB,
`app/api/ingest/upload/route.ts:20-89` tiene el mapeo de columnas) → cron cada minuto
(`app/api/cron/process-queue/route.ts`) → `process_import_batch` →
`process_contact_batch_internal`
(`supabase/migrations/20260825000000_contact_identity_resolution.sql:457-666`).

- **Empleador actual** → `upsert_company(company_name, company_linkedin_url,
  company_website, company_industry, company_country, company_logo_url,
  company_description)` (`:490-498`). No ingresa dotación ni `linkedin_company_id`.
- **Empleadores anteriores (1..6)** → `upsert_company(previous_company_N, NULL×6)`
  (`:501-522`). No hay tabla de posiciones: quedan embebidos en
  `contacts.previous_positions` (JSONB) con `company_id, company_name, title,
  description, started_on, ended_on`.
- Contacto: upsert `ON CONFLICT (linkedin_url)` con resolución de identidad previa
  (`resolve_contact_id`, `:362-437`).
- Señales inline: `process_contact_signals` (`baseline.sql:5256-5345`).
- Apollo y APIFY **no** escriben en `contacts` ni en `companies` por esta vía.

### ETL de vacantes (APIFY)

Actor `bebity/linkedin-jobs-scraper` (`lib/v3/services/apify-client.ts`), disparado por
cron `v3-scrape-job-postings` (10 min), MCP y kick al seguir cuenta. Por posting trae
solo `companyName`, `companyId` (LinkedIn numérico) y `companyUrl` como datos de empresa.

`lib/v3/services/apify-job-ingest.ts`: guardrail `belongsToCompany` (`:226-268`,
prioridad `linkedin_company_id` → slug → nombre normalizado → contención por palabra con
guarda geográfica) → mismo staging `import_rows` (`batch_type='job_postings'`,
`filename=apify://<companyId>/<runId>`) → `process_job_batch_internal`
(versión viva `supabase/migrations/20260825002000_job_posted_at.sql:125-251`) →
`upsert_company` + `job_postings` (`ON CONFLICT (job_url)`) + `process_job_signals`.

La ingesta impone la identidad canónica de la cuenta destino después del spread del item
(`apify-job-ingest.ts:337-354`) para que el nombre del scraper no gane.

### Enrichment

- **APIFY company** (`lib/v3/services/linkedin-company-enrichment.ts`, actor
  `harvestapi~linkedin-company`, cron 10 min): **exige `linkedin_url`**, escribe por
  columna con `setIfEmpty` (nunca pisa), guard de identidad `esLaMismaEmpresa`,
  checkpoint en `v3.linkedin_company_enrichment` con `filled_columns` (modelo de
  procedencia a imitar). Estado: 13.696 intentos → 8.497 ok, 4.052 no_hq,
  1.094 no_result, 50 error, 3 identity_mismatch. **Cola casi agotada**: quedan 182
  compañías con URL y sin datos. Las 385 k vacías son inalcanzables (sin URL).
- **Apollo org enrich** (`lib/apollo/organizations.ts`, `lib/apollo/org-enrichment-runner.ts`):
  por dominio. **Cuesta 1 crédito por cuenta resuelta** — la nota anterior decía
  "0 créditos" y estaba mal: confundía el cupo interno de ASCI por plan (que sí es
  0 en este paso) con la facturación de Apollo. Escribe las 19 columnas `apollo_*`
  siempre y las genéricas sólo si están vacías (`lib/apollo/company-writer.ts`).
  Estado al 26-ago-2026: 197 compañías resueltas, 61.304 candidatas con website
  sin tocar.

---

## 3. Matching y merge

### upsert_company — versión viva en `scripts/450_dedupe_en_la_ingesta.sql:101-224`

Cascada: ① `linkedin_url` canonizada (`normalize_linkedin_url`, script 448) → ② nombre
exacto (`name` o `normalized_name`) → ③ núcleo `company_core_name` **solo si exactamente
una fila del núcleo tiene identidad externa** (linkedin_url o website); sin identidad,
solo con fila única y núcleo ≥ 8 chars → ④ alta escribiendo siempre `normalized_name`.
Todos los caminos actualizan con `COALESCE`: rellenan huecos, nunca pisan.

`company_core_name` (versión viva `scripts/443:80-119`): NULL para URLs/"unknown
company", unaccent, prefijos grupo/holding solo al inicio, sufijos societarios solo al
final con separador real. `company_legal_form` (`443:131-151`) bloquea merges S.A. vs
S.R.L.

### Pipeline de dedup

`v3.sync_company_name_index` → `v3.company_dup_groups` (por núcleo exacto) →
`v3.refresh_company_dup_candidates` (clasifica seguro/ambiguo; ambiguo si ≥2 LinkedIn o
≥2 países) → IA (`lib/v3/dedupe-ai.ts`, solo veredicto) → `merge_companies` auditado en
`v3.company_merges`, reversible. Todo manual desde `/admin/companies/duplicates`
(decisión documentada en `scripts/455:63-71`).

Estado real: **28.196 merges** (24.766 core · 2.932 IA · 498 manual); cola: 21.013
merged, **4.900 pending**, 81 ai_different, 26 dismissed. Match por núcleo exacto casi
agotado: quedan **2.127** vacías que matchean el core de una compañía con datos.

**Potencial difuso:** muestra aleatoria (n=40) de vacías-con-señales: 27/40 (~67%)
tienen match trigram ≥ 0.45 (`idx_companies_name_trgm`) contra una compañía con
identidad externa. A ese umbral hay muchos falsos positivos → es exactamente el caso de
uso del verificador IA existente, que hoy solo recibe candidatos por núcleo exacto.

---

## 4. Dónde se pisa o se pierde información

1. **[Crítico] `merge_companies` pierde campos del duplicado.** La lista de coalesce
   (`scripts/451:249-263`) no incluye `linkedin_company_id`, `hq_country_iso`,
   `apollo_employees_count`, `apollo_org_status/synced_at`, `is_public/ticker/cik/
   stock_exchange`. Si el duplicado los tenía y el master no, se borran con la fila
   (recuperables solo desde `duplicate_snapshot`). `linkedin_company_id` es el decisor
   de máxima prioridad de `belongsToCompany` → cada merge que lo pierde degrada la
   atribución de vacantes. El UNIQUE parcial (`20260819100000:26-28`) complica
   re-escribirlo después.
2. **[Crítico] `previous_positions` se pisa entero** en cada re-import
   (`20260825000000:592`, `= EXCLUDED.previous_positions`), a diferencia de
   emails/teléfonos (COALESCE). Un export con menos posiciones borra historial.
3. **[Crítico] El ETL de vacantes ensucia identidad:** `p_website ← companyUrl` (URL de
   LinkedIn escrita en `website`) y `p_country ← location` (ubicación del aviso como
   país de la empresa) (`20260825002000:156-164`). El website falso además **fabrica
   identidad externa** y altera el paso ③ de `upsert_company`. En el camino CSV de
   vacantes `country` siempre sale de la ubicación (`app/api/ingest/upload/route.ts:91-113`).
4. **[Alto] Fuga de atribución:** `upsert_company` resuelve primero por `linkedin_url`;
   si la cuenta destino no tiene URL y la del actor ya pertenece a otra fila, las
   vacantes aterrizan en esa otra fila mientras el batch queda rotulado con el
   `companyId` original, y el write-once de `linkedin_company_id`
   (`apify-job-ingest.ts:364-385`) escribe sobre la cuenta pedida → desalineados.
5. **[Alto] COALESCE "primero gana":** el dato mediocre del CSV de contactos
   (`description`, `logo_url`, `website` adosados a la empresa por el proveedor de
   personas) bloquea para siempre al dato bueno del enrichment. No hay procedencia en
   `companies` (solo `v3.linkedin_company_enrichment.filled_columns`).
6. **[Alto] Deriva scripts/ ↔ migrations:** `upsert_company` (450), `merge_companies`
   (451), `company_core_name` (443) y el borrado de `normalize_company_name` (455)
   viven solo en `scripts/`. Un rebuild desde `supabase/migrations/` restaura la
   ingesta pre-dedup. Contradice la regla de CLAUDE.md.
7. **[Medio] Señales inconsistentes:**
   - ETL inline de contactos escanea solo el *título* de puestos anteriores
     (`source_field='past_position'`, `baseline.sql:5277-5342`); el retro-scan de
     diccionario escanea título+descripción (`'previous_position'`,
     `scripts/166:160-224`). Tampoco escanea la descripción del puesto actual.
     `docs/ETL_PROCESS.md:57` describe otra cosa.
   - `process_job_signals` hardcodea `source_field='job_description'` aunque el match
     sea en título, y **no escribe `job_posted_at`** (sí lo hace
     `process_add_keyword_job_postings`): v3 fecha esas señales con `created_at`
     (`company-signal-summary.ts:227`).
   - `signals.is_current_employee` queda `false` sin sentido para señales de vacante.

---

## 5. Columnas / código innecesarios

| Ítem | Diagnóstico |
|---|---|
| `job_postings.is_active` + `idx_job_postings_company_active` | Muerta (43.052 true, 0 false); lecturas ya limpiadas (`20260825141319`), columna e índice quedaron. |
| `job_postings.apply_url` | Nunca escrita por el ETL vivo; leída con fallback en drawer y export. |
| `pending_signals` + `process_pending_queue` + `process_pending_signals_batch` | Sin llamadores. |
| `job_postings.source_data` (camino APIFY) | Item completo duplicado en JSONB; 247 MB / 33 k filas. El CSV sí adelgaza (`leanOriginal`). |
| `companies.country` (crudo) | 1.287 valores sucios; existe solo para alimentar el trigger de `country_normalized`; quedan lecturas residuales (`baseline.sql:6381`). |
| `app/actions/ingest.ts` (`createImportBatch` etc.) | Código muerto que duplica el mapeo de columnas del upload real. |
| `lib/v3/services/value-proposition-recommender.ts:33` | Bug: selecciona `posted_date`/`url` (no existen; son `posted_at`/`job_url`) — falla siempre. |
| `_v3_source`/`_v3_run_id` en `source_data` | Sin lector (se usa el prefijo `apify://` del filename). |
| `companies.normalized_name` | Necesaria pero frágil: sin trigger de sincronización con `name`; un UPDATE por fuera la desalinea. |

---

## 6. Plan de optimización

**Fase 0 — Higiene antes de mergear masivamente**
*Implementada en las migraciones `20260825160000` a `20260825163000` (pendientes de
aplicar: decisión del dueño del proyecto). Cada una fue validada contra la base de
producción dentro de una transacción con ROLLBACK, incluyendo tests end-to-end de
ingesta y de merge.*
1. Agregar `linkedin_company_id`, `hq_country_iso` y `apollo_*` al coalesce de
   `merge_companies` (manejando el UNIQUE parcial).
2. Cortar `companyUrl→website` y `location→country` en el ETL de vacantes.
3. `previous_positions` aditivo (merge por company_id+título) en vez de reemplazo.
4. Consolidar las funciones vivas de `scripts/` en migraciones.

**Fase 1 — Merge interno (costo cero)**
1. Ejecutar la cola: 4.900 pending + 2.127 núcleo-exacto residuales.
2. Nuevo generador de candidatos difusos (trigram ≥ 0.45 sobre
   `idx_companies_name_trgm`, restringido a vacía→con-identidad), verificado por el
   pipeline IA existente. Empezar por las ~10.600 vacías con 5+ referencias.

**Fase 2 — APIFY dirigido**
1. Paso previo que falta: **resolver `linkedin_url` por búsqueda de nombre** (actor de
   company-search) reusando el guard `esLaMismaEmpresa`; la cola de enrichment
   existente completa el resto.
2. Orden de gasto: 10.600 (5+ refs) → 56.013 (2–4 refs) → las 314.765 de una sola
   referencia solo on-demand.
3. Registrar cada intento en `v3.linkedin_company_enrichment` (checkpoint +
   `filled_columns`).

**Fase 3 — Apollo por dominio (1 crédito por match, casi sin usar)**
- `organizations/enrich` (**1 crédito por empresa resuelta**, 0 si no matchea — lo
  confirman `countEnrichCredits` en `lib/apollo/parsers.ts` y la tabla de costos de
  `docs/plan-mcp-admin.md`; este documento decía "0 créditos" y estaba equivocado)
  sobre las 128 k con website → habilita filtros y
  enrichment de Apollo, llena `apollo_employees_count`/`apollo_industry` sin tocar
  columnas de LinkedIn. Hoy solo 194 sincronizadas.

**Fase 3.5 — Apollo por NOMBRE para las que no tienen dominio (gratis, en curso)**
*Implementada el 27-ago-2026: `lib/apollo/domain-lookup.ts`, su runner, el cron
`v3-apollo-domain-lookup` y la migración `20260827203000` (pendiente de aplicar).*
- El problema que resuelve: las 455.747 companies sin `website` (88% del catálogo)
  no entran a **ninguna** fase de Apollo, porque `enrich` y `bulk_enrich` reciben
  dominios, no nombres. Descontando las ~34.700 `Unknown Company <uuid>` quedan
  **420.753 candidatas** con nombre buscable.
- `organizations/search` con `display_mode: fuzzy_select_mode` devuelve candidatos
  shallow (id, name, domain, website_url, logo_url) **sin consumir créditos**.
- **El techo es la cuota, no el precio: 400 llamadas/hora** del plan sobre ese
  endpoint (medido; el mensaje de rechazo de Apollo nombra el endpoint y remite a
  upgradear el plan). Es cuota del plan, no del transporte: un script con API key
  tiene el mismo techo que el MCP. No confundir con el `x-rate-limit-minute: 1000`
  de `organizations/enrich`, que es otro endpoint.
- El cron usa **350/hora y deja 50 libres** para trabajo manual, y cuenta lo gastado
  leyendo `apollo_api_calls` (no un contador propio), así la reserva sobrevive a
  llamadas hechas por fuera del cron. A ese ritmo el barrido completo son ~50 días:
  es el precio de la cuota, y para eso está el checkpoint.
- **Sólo se promueve `auto_ok` a `companies`**, y sólo sobre columnas vacías. El
  match por nombre es difuso: medido, "Joyeria Vasari" matcheó con "JOYERIA VASARI
  MADRID SL" con similitud 0.67 y contención 1.00 — pasaba como automático hasta
  que se agregó la guarda que baja a `revisar` cualquier match con un token
  geográfico presente de un solo lado. Los `revisar` esperan ojo humano.
- Medición preliminar sobre 180 casos reales: 23% `auto_ok`, 36% con algún dominio
  candidato, 60% sin match. Falta rehacerla sobre la muestra completa.

**Fase 4 — Coherencia de señales y limpieza**
- `job_posted_at` en `process_job_signals`; `source_field` real (título vs descripción);
  unificar `past_position`/`previous_position`; escanear descripciones también inline;
  retirar columnas muertas de §5.

---

## Apéndice: seguridad

El advisor de Supabase reporta RLS deshabilitado en `public.company_news_scrapes` y
`public.dictionary_backup_20260824` (expuestas a la anon key). Habilitar RLS requiere
definir políticas primero para no bloquear el acceso legítimo.

---

## Apéndice: cómo corre el enrichment de Apollo en producción

Hay dos caminos y hacen lo mismo por debajo (`applyCompanyEnrichment`), así que
las reglas de precedencia valen para los dos.

**1. Oportunista, al buscar decisores.** `prepare_contact_enrichment` resuelve la
organización antes de buscar personas, y de paso enriquece la compañía. Es el
camino que alimentó las primeras 197. No se planifica: llega la empresa que el
usuario pidió.

**2. En lote, por cron.** `/api/cron/v3-apollo-org-enrichment`, cada 10 minutos,
lotes de 100 dominios vía `organizations/bulk_enrich` (10 por llamada).

El detalle que importa del cron: **no descubre trabajo, lo consume**. Sólo procesa
filas de `v3.apollo_company_enrichment` con `status = 'pending'` y nunca sale a
buscar candidatas. Es deliberado — barrer las 61.304 candidatas son ~38.000
créditos, y eso lo decide el dueño del proyecto, no un cron. Con la cola vacía la
corrida no llama a Apollo y gasta cero.

Autorizar un lote es sembrarlo. Priorizado por contactos, que es lo que
discrimina (el 85 % de las compañías tiene alguna señal, así que las señales no
ordenan nada):

```sql
insert into v3.apollo_company_enrichment (company_id, requested_domain, status, next_attempt_at)
select c.id, null, 'pending', now()
  from public.companies c
  left join v3.apollo_company_enrichment e on e.company_id = c.id
 where nullif(btrim(c.website), '') is not null
   and coalesce(c.apollo_org_status, 'unknown') not in ('found', 'not_found')
   and e.company_id is null
 order by (select count(*) from public.contacts ct where ct.current_company_id = c.id) desc, c.id
 limit 500
on conflict (company_id) do nothing;
```

Los estados de la cola: `pending` (sembrada, sin tocar), `error` (falló, vuelve
en 30 minutos), `found` / `not_found` (resuelta), `skipped` (website sin dominio
parseable) y `failed` (agotó los 3 intentos). Los tres últimos son terminales.

Para seguirlo sin abrir la base: `cron_executions` con `cron_name =
'v3-apollo-org-enrichment'` guarda por corrida los créditos gastados, el hit
rate, las columnas genéricas completadas y cuántas quedan en cola.

**Fuera de prod** el mismo trabajo lo hace `scripts/460_apollo_org_enrichment.mjs`
(dry-run por defecto, `--commit` para escribir, `--max-credits` con tope 500), que
necesita `APOLLO_API_KEY` y `POSTGRES_URL_NON_POOLING`. El cron existe justamente
para no depender de tener esas dos variables a mano.
