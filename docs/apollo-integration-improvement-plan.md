# Plan de mejora de la integración con Apollo

**Autor:** equipo de ingeniería
**Estado:** Propuesta — pendiente de aprobación
**Última actualización:** 2026-04-20

## Contexto

Se reportaron diferencias de resultados entre búsquedas realizadas desde la UI de Apollo y búsquedas ejecutadas a través de nuestra API (`searchApolloProspects` en `app/actions/apollo.ts`).

Tras el relevamiento de `app/actions/apollo.ts`, `app/api/webhooks/apollo/route.ts`, `scripts/098_apollo_prospects.sql`, `scripts/099_fix_apollo_rls.sql` y `app/bookmarks/[id]/_components/prospects-tab.tsx`, identificamos que la brecha proviene de cuatro áreas: **matching de empresa por nombre/dominio en vez de `organization_ids`**, **cache que corta llamadas a Apollo sin respetar los filtros de la query**, **uso del endpoint `api_search` con parámetros limitados** y **falta de observabilidad** para diagnosticar discrepancias.

Este plan organiza las mejoras en cuatro fases incrementales. Cada fase es independiente, entrega valor por sí sola y puede pausarse/retomarse sin bloquear producción.

---

## Objetivos

- Alcanzar **paridad de resultados** con la UI de Apollo para la misma empresa y mismos filtros.
- **Elevar la calidad del input de búsqueda** (cargos, seniority, departamento) para evitar falsos negativos por strings inexistentes en el índice de Apollo.
- Hacer el **cache determinístico** respecto a la query (mismos inputs → mismos outputs).
- **Reducir costos** de créditos Apollo haciendo opt-in los reveals caros.
- Poder **auditar y reproducir** cualquier búsqueda reportada como inconsistente.

## No-objetivos

- Rediseñar la UI de prospectos (se mantiene el tab actual).
- Cambiar el proveedor de enriquecimiento (seguimos en Apollo).
- Migrar la persistencia de contactos fuera de Supabase.

---

## Fase 1 — Paridad con la UI de Apollo

**Objetivo:** que una búsqueda ejecutada desde nuestra API devuelva el mismo universo de candidatos que la UI oficial de Apollo para la misma empresa y filtros equivalentes.

### Cambios de API

1. Reemplazar el endpoint `POST /api/v1/mixed_people/api_search` por `POST /api/v1/mixed_people/search`.
2. Dejar de usar `q_organization_domains` y `q_organization_name` como filtros primarios. Usar **`organization_ids: [apollo_organization_id]`**.
3. Agregar los parámetros que la UI aplica por default:
   - `include_similar_titles: true`
   - `person_seniorities` (opcional, complementario a `person_titles`)
   - `person_departments` (opcional)
   - `organization_locations` además de `person_locations` cuando se filtra por país de la empresa
4. Paginar: `per_page: 25`, recorrer páginas hasta `total_entries` o un tope configurable (ej. `MAX_PAGES = 4`).

### Resolución de `apollo_organization_id`

Nueva función `getOrFetchApolloOrgId(companyId)`:

1. Si `companies.apollo_organization_id` existe, se usa.
2. Si no, se llama a `POST /api/v1/organizations/enrich` con `domain` y `name`, se persiste `apollo_organization_id`, `apollo_org_synced_at` y algunos metadatos (empleados, industria).
3. Si Apollo no encuentra la empresa, se persiste `apollo_organization_id = NOT_FOUND` con TTL para no reintentar en loop.

### Mejoras de normalización de dominio

- Integrar `tldts` para extraer el dominio registrable (soporta `.com.ar`, subdominios `ar.acme.com`, etc.).
- Si el primer lookup de `organizations/enrich` falla, reintentar con variantes comunes (`acme.com`, `acme.com.ar`).

### Cambios de DB (Fase 1)

`scripts/100_apollo_org_ids.sql`:

```sql
alter table companies
  add column if not exists apollo_organization_id text,
  add column if not exists apollo_org_synced_at timestamptz,
  add column if not exists apollo_employees_count int,
  add column if not exists apollo_industry text;

create index if not exists idx_companies_apollo_org_id
  on companies (apollo_organization_id);
```

### Criterios de aceptación

- Dadas 10 empresas de muestra, la cantidad de contactos devueltos por nuestra API vs UI de Apollo difiere en **< 10%** (vs. diferencia actual reportada > 40% en algunos casos).
- Las búsquedas que hoy devuelven 0 porque el nombre no matchea, devuelven resultados cuando se filtra por `organization_ids`.
- No se rompe la UI existente del tab de prospectos (mismo payload de salida).

### Riesgos

- `organizations/enrich` tiene costo de créditos. Mitigación: cachear permanentemente el `apollo_organization_id`, que rara vez cambia.
- `include_similar_titles: true` puede ampliar demasiado el universo. Mitigación: exponerlo como toggle en UI en Fase 4, por ahora mantenerlo `true` para replicar el comportamiento de la UI.

---

## Fase 2 — Rediseño del cache

**Objetivo:** que el cache sea determinístico respecto a la query completa y no sirva resultados de otras búsquedas.

### Problema actual

La función `searchApolloCache` lee contactos de `apollo_contacts_cache` filtrados sólo por `domain`/`linkedin_url` y fecha. El corte `if (contacts.length < 3) call Apollo` hace que una búsqueda previa con otros `job_titles` o `country` bloquee llamadas a Apollo. Resultado: el usuario ve contactos que **no corresponden** a los filtros que seleccionó.

### Diseño propuesto

Introducir dos conceptos separados:

1. **Tabla `apollo_people`** (reemplazo de `apollo_contacts_cache`): una fila por persona, con todos los campos enriquecidos. Clave natural: `apollo_person_id`.
2. **Tabla `apollo_search_results`**: guarda el resultado de cada query contra Apollo.
   - Clave de query = `hash(apollo_organization_id, sorted(person_titles), sorted(person_seniorities), country, include_similar_titles)`.
   - Una fila por `(query_hash, apollo_person_id)`.
   - Columnas: `query_hash`, `query_payload jsonb`, `apollo_person_id`, `rank`, `fetched_at`, `total_entries_at_fetch`.

### Flujo nuevo

```
searchApolloProspects(input):
  query_hash = hash(normalize(input))
  rows = select * from apollo_search_results where query_hash = ? and fetched_at > now() - interval '14 days'
  if rows exists:
    return join(apollo_people, rows)  // hit completo
  else:
    results = callApolloSearch(input)           // Fase 1
    upsert apollo_people
    insert apollo_search_results(query_hash, ...)
    return results
```

Si el usuario modifica cualquier filtro, el `query_hash` cambia → miss → llamada fresca a Apollo.

### Cambios de DB (Fase 2)

`scripts/101_apollo_search_cache.sql`:

```sql
create table apollo_people (
  apollo_person_id text primary key,
  first_name text,
  last_name text,
  full_name text,
  title text,
  linkedin_url text,
  email text,
  email_status text,
  phone text,
  phone_revealed_at timestamptz,
  apollo_organization_id text,
  raw jsonb,
  last_enriched_at timestamptz default now()
);

create table apollo_search_results (
  query_hash text not null,
  apollo_person_id text not null references apollo_people(apollo_person_id),
  rank int not null,
  query_payload jsonb not null,
  total_entries_at_fetch int,
  fetched_at timestamptz default now(),
  primary key (query_hash, apollo_person_id)
);

create index idx_apollo_search_results_hash_fetched
  on apollo_search_results (query_hash, fetched_at desc);
```

### Migración

`scripts/102_migrate_apollo_contacts_cache.sql`: poblar `apollo_people` desde `apollo_contacts_cache` y luego dropear la tabla vieja.

### TTL y refresh

- TTL por default: **14 días**.
- Botón "Actualizar desde Apollo" en la UI del tab de prospectos que invalida el `query_hash` actual y fuerza una llamada fresca.

### Criterios de aceptación

- Dos búsquedas distintas sobre la misma empresa (ej. "CFO en AR" vs "CTO en MX") devuelven **conjuntos disjuntos** cuando corresponde.
- Repetir la misma búsqueda dos veces seguidas hace 1 sola llamada a Apollo (hit en la segunda).
- Cambiar un solo filtro fuerza llamada nueva.

### Riesgos

- Mayor consumo de créditos Apollo al principio (cada combinación de filtros es un miss). Mitigación: medir hit-rate en Fase 3 y ajustar TTL.

---

## Fase 3 — Observabilidad y enrichment robusto

**Objetivo:** poder reproducir cualquier búsqueda reportada y no perder contactos silenciosamente por fallos de enriquecimiento.

### Logging de llamadas

Nueva tabla `apollo_api_calls`:

```sql
create table apollo_api_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  bookmark_id uuid,
  company_id uuid,
  endpoint text not null,          -- 'mixed_people/search', 'people/match', etc
  request_body jsonb not null,
  response_status int,
  response_total_entries int,
  response_count int,              -- personas devueltas
  latency_ms int,
  error text,
  created_at timestamptz default now()
);

create index idx_apollo_api_calls_user_created
  on apollo_api_calls (user_id, created_at desc);
create index idx_apollo_api_calls_company
  on apollo_api_calls (company_id, created_at desc);
```

Cada llamada (`search`, `enrich`, `match`, `organizations/enrich`) se loggea. Sin el `response_body` completo para no inflar storage, solo metadata.

### Enrichment resiliente

- Reintentos con backoff exponencial (250ms, 1s, 4s) para 429/500/502/503/504.
- Circuit breaker simple: si el ratio de error en los últimos 5 minutos > 30%, pausar enrichment por 60s y devolver lo que haya.
- El resultado de `searchApolloProspects` devuelve:
  ```ts
  {
    contacts: EnrichedContact[],
    stats: {
      fromCache: number,
      apiReturned: number,
      enrichedOk: number,
      enrichedFailed: number,
      totalEntriesInApollo: number,
    }
  }
  ```
- UI muestra banner "Apollo devolvió 18 contactos; 12 enriquecidos, 6 pendientes. [Reintentar]".

### Job de reintento de enrichment

Nueva server action `retryFailedEnrichment(company_id)` que busca en `apollo_people` las filas con `last_enriched_at` null o con email status `pending` y reintenta.

### Criterios de aceptación

- Un admin puede, dado un bookmark y una fecha, recuperar exactamente qué se le envió a Apollo y qué devolvió.
- Un fallo transitorio de Apollo no resulta en contactos silenciosamente descartados.
- La UI comunica el estado parcial cuando sucede.

---

## Fase 4 — Control de costos y calidad de datos

**Objetivo:** reducir créditos Apollo consumidos, mejorar la calidad de dedup y mantener los datos frescos.

### Opt-in reveals

- Hoy: por cada persona se llaman **dos** `people/match` (uno con `reveal_personal_emails`, otro con `reveal_phone_number + webhook_url`). Son 2 créditos por contacto + 1 de la search.
- Propuesta: en la UI del tab de prospectos, dos toggles:
  - "Revelar email personal" (default off)
  - "Revelar teléfono móvil" (default off)
- Si ambos están off, la búsqueda devuelve solo email corporativo (que ya viene en la search sin costo extra). El usuario paga sólo cuando elige revelar.

### Dedup por `apollo_person_id`

`scripts/103_user_company_contacts_apollo_id.sql`:

```sql
alter table user_company_contacts
  add column if not exists apollo_person_id text;

create unique index if not exists uq_user_company_contacts_apollo
  on user_company_contacts (user_id, company_id, apollo_person_id)
  where apollo_person_id is not null;
```

Lógica de upsert: primero intenta match por `apollo_person_id`, luego por `linkedin_url`, luego por `full_name` (fallback legacy).

### Re-verify periódico

Cron en `app/api/cron/apollo-reverify/route.ts` (diario):

- Selecciona contactos con `last_enriched_at < now() - interval '90 days'` y `user_company_contacts` aún activos.
- Llama `people/match` en batch (hasta 10 por corrida), actualiza, marca `needs_review = true` si cambió empresa.
- Se expone como setting del workspace (on/off) para evitar consumo no deseado.

### Calidad del input de cargo (job titles)

> Esta sección es crítica: **la calidad de los resultados depende más del input de título que de cualquier otro filtro**. Un título mal planteado (ej. "Director de Tecnología y Transformación Digital") produce 0 matches aunque la persona exista en Apollo. Hoy dependemos de la inferencia libre de Gemini en `inferJobTitles`, que puede inventar variantes largas que no existen como strings indexados.

#### 1. Catálogo de títulos verificados contra Apollo

Nueva tabla `apollo_title_catalog`, alimentada por feedback loop de producción:

`scripts/105_apollo_title_catalog.sql`:

```sql
create table apollo_title_catalog (
  normalized_title text primary key,             -- ej: "chief financial officer"
  display_title text not null,                   -- ej: "Chief Financial Officer"
  language text,                                  -- 'en' | 'es' | 'pt' | null
  seniority text,                                 -- 'c_suite' | 'vp' | 'director' | ...
  department text,                                -- 'finance' | 'engineering' | ...
  aliases text[] default '{}',                    -- ['CFO', 'Director Financiero', 'Finance Director']
  usage_count int default 0,                      -- veces que Apollo lo devolvió
  success_count int default 0,                    -- veces que fue usado en search y devolvió >0
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now()
);

create index idx_apollo_title_catalog_dept on apollo_title_catalog (department);
create index idx_apollo_title_catalog_seniority on apollo_title_catalog (seniority);
-- GIN index para búsqueda por aliases
create index idx_apollo_title_catalog_aliases on apollo_title_catalog using gin (aliases);
```

**Cómo se alimenta:**

- Cada vez que Apollo devuelve resultados en Fase 1/2, se insertan/actualizan los `title` recibidos en el catálogo (`on conflict ... do update set usage_count = usage_count + 1, last_seen_at = now()`).
- Cada vez que una búsqueda con un `person_titles` dado devuelve `total_entries > 0`, se incrementa `success_count` de ese título.
- El catálogo se vuelve **datos reales de Apollo**, no una lista estática.

#### 2. Cambio en `inferJobTitles`

El prompt deja de pedir a Gemini "sugerí 12 títulos" en texto libre. Pasa a un proceso en dos pasos:

1. **Gemini clasifica**: dado el contexto del bookmark (rol objetivo, industria), devuelve un JSON con `{ seniorities: [...], departments: [...], language: "es" | "en" }`. No inventa títulos.
2. **Query al catálogo**: `select display_title from apollo_title_catalog where seniority = any($1) and department = any($2) and success_count > 0 order by success_count desc limit 20`.

El usuario ve títulos que **demostradamente existen** en Apollo y han devuelto resultados antes. Fallback: si el catálogo aún está vacío (primer uso por industria), usar inferencia libre y marcar esos títulos como `is_inferred: true` para auditarlos.

#### 3. UX en el tab de prospectos

Cambios en `app/bookmarks/[id]/_components/prospects-tab.tsx`:

- **Selector de títulos con autocomplete** alimentado por `apollo_title_catalog`, con chips agrupados por `seniority` / `department`.
- **Filtros explícitos** de `seniority` y `department` (que Apollo soporta nativamente y son mucho más estables que strings de título).
- **Preview de query**: antes de ejecutar, mostrar el payload normalizado que se va a mandar a Apollo (títulos, seniorities, país, organization_id). Esto elimina la sensación de "caja negra" cuando los resultados no coinciden con la expectativa.
- **Feedback del último resultado**: "Esta combinación devolvió X contactos la última vez (hace Y días)" — leído de `apollo_search_results` (Fase 2) + `apollo_api_calls` (Fase 3).
- **Sugerencia de ensanchar filtros**: si `total_entries == 0`, el sistema propone alternativas desde el catálogo (ej: "No encontramos 'Chief Revenue Officer'. ¿Probar 'VP of Sales' o 'Chief Sales Officer'?") — basadas en títulos del mismo `department` con mayor `success_count`.

#### 4. Validación de aliases multilingües

El catálogo guarda `aliases` para unificar variantes sin pegarle al usuario con decisiones técnicas:

- "CFO", "Chief Financial Officer", "Director Financiero", "Diretor Financeiro" → mismo `normalized_title`.
- Cuando el usuario escribe "CFO", el sistema expande a **todos los aliases** antes de mandar a Apollo, maximizando recall sin perder precisión (Apollo trata la lista como OR).

#### Nota sobre priorización

Si el feedback de usuarios sugiere que la calidad del título es el bloqueo principal, los puntos **1, 2 y 3** de esta sección pueden adelantarse a la **Fase 2** (quedan agrupados como "mejoras de input" junto al rediseño de cache, porque ambas afectan directamente la relevancia del resultado). Los puntos **4** y el re-verify quedan en Fase 4.

### RLS endurecido

Revisar `scripts/099_fix_apollo_rls.sql`:

- Lectura de `apollo_people` y `apollo_search_results`: authenticated users (compartido entre workspaces es intencional, el cache es global).
- Escritura: **sólo** `service_role`. Los inserts se hacen desde server actions con el cliente de servicio.
- `apollo_api_calls`: lectura sólo admin; escritura `service_role`.

### Criterios de aceptación

- Consumo promedio de créditos Apollo por búsqueda baja al menos **50%** cuando los toggles están off (medido en la tabla `apollo_api_calls` de Fase 3).
- No existen duplicados de la misma persona en `user_company_contacts` para el mismo `(user_id, company_id)`.
- El cron re-verify detecta cambios de empresa en muestras de prueba.

---

## Cronograma sugerido

El orden importa: Fase 1 es prerequisito de Fase 2 (sin `apollo_organization_id` confiable el cache no vale). Fase 3 se puede empezar en paralelo con Fase 2. Fase 4 asume Fase 3 para medir el impacto.

> **Nota sobre calidad de input (títulos):** si en producción se confirma que los falsos negativos vienen mayormente de títulos mal formados, los puntos 1-3 de "Calidad del input de cargo" pueden adelantarse a Fase 2 sin romper dependencias. El catálogo se puede empezar a poblar desde el primer día con los títulos que Apollo devuelva en Fase 1, aunque el uso activo del catálogo se active después.

```
Fase 1 ─────────►
       Fase 2 ─────────►
            Fase 3 ─────────►
                      Fase 4 ─────────►
```

## Métricas de éxito globales

- **Paridad**: % de diferencia entre resultados de nuestra API y UI de Apollo sobre 20 empresas de test. Meta: < 10%.
- **Cache hit-rate**: búsquedas servidas desde `apollo_search_results`. Meta: > 40% después del primer mes.
- **Cost efficiency**: créditos Apollo por contacto nuevo agregado. Meta: baja 50% vs hoy.
- **MTTR de issues**: tiempo en reproducir y cerrar un ticket "resultados no coinciden". Meta: < 1 hora (con Fase 3).
- **Calidad de título**: % de `person_titles` enviados a Apollo que corresponden a entradas del `apollo_title_catalog` con `success_count > 0`. Meta: > 85% después de 2 meses de feedback loop.
- **Recall por búsqueda**: promedio de `total_entries` devuelto por Apollo por búsqueda. Meta: incremento > 30% vs hoy (indicador indirecto de mejor input).

## Anexo — Archivos tocados por fase

| Fase | Archivos nuevos | Archivos modificados |
|---|---|---|
| 1 | `scripts/100_apollo_org_ids.sql` | `app/actions/apollo.ts` |
| 2 | `scripts/101_apollo_search_cache.sql`, `scripts/102_migrate_apollo_contacts_cache.sql` | `app/actions/apollo.ts` |
| 3 | `scripts/103_apollo_api_calls.sql`, server action `retryFailedEnrichment` | `app/actions/apollo.ts`, `app/bookmarks/[id]/_components/prospects-tab.tsx`, `app/api/webhooks/apollo/route.ts` |
| 4 | `scripts/104_user_company_contacts_apollo_id.sql`, `scripts/105_apollo_title_catalog.sql`, `app/api/cron/apollo-reverify/route.ts` | `app/actions/apollo.ts`, `app/bookmarks/[id]/_components/prospects-tab.tsx`, `scripts/099_fix_apollo_rls.sql` (via `scripts/106_harden_apollo_rls.sql`) |
