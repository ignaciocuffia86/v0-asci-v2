# Unificación del store de evidencia entre v2, v3 y el MCP

Fecha: 2026-08-17
Alcance: `public.company_news`, `public.company_implementations`,
`public.radar_findings`, `public.job_postings`
Restricción del pedido: **aditivo sobre v2, nunca destructivo.**
Antecedente: `docs/feature-centro-de-notificaciones-v2.md` §12 y la recomendación
de *"evidence store compartido"* de `asci-v3-architecture-audit.md` (§11, días 31–60).

---

## 0. Estado de construcción

| Fase | Qué | Estado |
|---|---|---|
| **A** | Columnas del contrato + backfill de `produced_by` + índices | ✅ **Escrito** — `supabase/migrations/20260818045619_evidence_contract.sql` |
| **B** | Vista canónica `public.company_evidence` | ✅ **Escrito** — mismo script |
| **C** | Escritor único `recordEvidence` | 🟡 **Módulo listo** — `lib/shared/evidence.ts` + 15 tests. Falta migrar los 6 productores |
| **D** | Consolidación física | ⛔ No empezada, y no debe empezarse todavía |

> ✅ **Aplicado en producción el 2026-08-18**, después de validarlo contra una
> réplica local del esquema (§0.1). Backfill verificado: `company_news`=1.133
> `v2_research`, `company_implementations`=727 `v2_research`, `radar_findings`=706
> `v3_radar`, `job_postings`=41.224 `etl_apify`. La vista devuelve 2.566 filas y
> quedó con `security_invoker = true`. Los grants de `authenticated` sobre las
> tablas base están, así que el riesgo de "permission denied" no se materializó.

### 0.1 Validación (2026-08-17)

Se validó con `scripts/validate-migration-local.sh`, que levanta un Postgres
efímero, le aplica el baseline del esquema de producción
(`supabase/migrations/20250101000000_baseline.sql`, dump real del 2026-08-12) y
encima la migración. **No se usó una branch de Supabase**: cuesta plata y no trae
los datos, y para validar DDL la réplica local alcanza.

| Chequeo | Resultado |
|---|---|
| Réplica del esquema | **54 tablas** en `public` — igual que producción |
| Aplicación del 505 | Limpia, sin errores |
| Idempotencia | Reaplicable: segunda corrida sólo emite `NOTICE ... skipping` |
| Vista `company_evidence` | Unifica los tres formatos: `area`→`category`, `url`→`source_url`, `source_date`→`occurred_at` |
| `security_invoker = true` | Confirmado en `pg_class.reloptions` |
| Índice de dedupe | Rechaza la repetida con `23505` y **no molesta a las filas viejas** con `dedupe_hash` nulo |
| RPC `get_account_updates` sobre la vista | Devuelve los conteos correctos por `evidence_kind` |
| Aislamiento entre usuarios | Otro `auth.uid()` → 0 filas |

**Performance (el riesgo abierto de la spec de notificaciones):** con volumen
equivalente a producción —412 bookmarks para un usuario, 1.136 noticias, 728
implementaciones, 707 findings y 41.224 vacantes— la RPC corre en **~9 ms**
(tres corridas: 9,4 / 8,2 / 8,8 ms). El objetivo era < 200 ms, así que sobra un
orden de magnitud y **no hace falta contador materializado**.

Detalle honesto del plan: a este volumen el planner **no usa** los índices
`(company_id, created_at)` de las tablas de evidencia — hace un `Seq Scan` de las
tres (2.571 filas en total) y las hashea, que es lo correcto para tablas chicas.
Los índices empiezan a pagar cuando crezcan. `job_postings` sí entra por índice.

**Seguridad, verificada con roles reales:** consultando la vista como
`authenticated`, `radar_findings` devuelve **0 filas** (su RLS es sólo
`service_role`), mientras la RPC `security definer` sí ve todo. O sea que
`security_invoker = true` hace lo que se buscaba: la vista no es un agujero para
saltear RLS, y el camino sancionado de lectura son las RPC.

> **Un hallazgo para el deploy:** con `security_invoker = true`, las policies de
> `company_news` se evalúan como el usuario que consulta, y una de ellas
> referencia otras tablas. Si el rol `authenticated` no tuviera `SELECT` sobre
> ellas, la query **falla con "permission denied"** en vez de devolver menos
> filas. En producción v2 funciona, así que los grants están; conviene igual
> correr un `select from company_evidence` como usuario real justo después de
> aplicar el script.

**Productores pendientes de migrar a `recordEvidence` (fase C), en el orden
recomendado** — de menos a más riesgoso, un PR cada uno:

1. ~~`lib/v3/services/external-drilldown.ts`~~ ✅ **migrado**
2. `lib/v3/services/radar.ts` → escritura de `radar_findings`
3. `lib/v3/services/jobs-interpreter.ts`
4. `app/actions/workspace.ts` (dos call sites)
5. `app/api/research/implementations/route.ts`
6. `app/api/research/news/route.ts` *(el último: es el que más tráfico tiene)*

### 0.2 Hallazgo durante la migración: un tercer dialecto

`evidence_level` usa **dos vocabularios distintos** en producción, verificado:

| Tabla | Valores | Filas |
|---|---|---|
| `company_implementations` | `directa` / `convergente` / `inferencia` / null | 309 / 260 / 104 / 54 |
| `radar_findings` | `explicit` / `inferred` | 405 / 301 |

La vista los exponía crudos, así que `evidence_level` era justamente la columna
que **no** quedaba unificada. Se corrigió con
`20260818050000_evidence_level_canonical`: la vista los normaliza al canónico de
`lib/shared/evidence-level.ts` (`Confirmado` | `Probable` | `Inferido`) vía la
función `public.canonical_evidence_level()`, y conserva el original en
`evidence_level_raw`.

Del lado del código, `recordEvidence` recibe **siempre** el canónico y traduce al
dialecto de cada tabla al escribir, reusando los traductores que ya existían
(`toV2EvidenceLevel`, `toRadarEvidenceLevel`). Por eso `evidence-level.ts` se mudó
de `lib/v3/services/` a `lib/shared/`: `lib/shared` no puede depender de `lib/v3`
sin invertir la dependencia que pide P1.3. Queda un reexport en la ruta vieja.

Cerrada la migración, se agrega la regla de lint que prohíbe `.from("company_news")`,
`.from("company_implementations")` y `.from("radar_findings")` fuera de
`lib/shared/evidence.ts`.

---

## 1. Dónde escribe el MCP (respuesta directa)

Trazado sobre `app/api/v3/mcp/server/[transport]/route.ts` y los módulos
`lib/v3/mcp-*`:

| Tool MCP | Escribe en `public` | Escribe en `v3` |
|---|---|---|
| `submit_company_news` | **`company_news`** (vía `persistClientNews`) | `client_ai_stage_submissions`, `client_ai_executions` |
| `submit_company_success_cases` | **`company_implementations`** (vía `persistClientSuccessCases`) | ídem |
| `scrape_company_job_postings` | **`job_postings`** (vía `apify-job-ingest`) | — |
| `run_account_research` / `submit_account_research_stage` | **`radar_findings`** (vía `radar.ts`) | `research_jobs`, `account_scorecards`, `account_briefs`, `account_internal_snapshots` |
| `run_contact_enrichment` | lee `apollo_contacts_cache` | `contact_enrichment_runs`, `account_contacts` |
| `save_account` / `remove_workspace_account` | — | `followed_accounts` |
| `submit_account_icebreaker` | — | `icebreakers` |
| `create_document_draft` / `confirm_document_analysis` | — | `workspace_documents` |
| Explore | — | `explore_sessions` |

**Conclusión:** el MCP **ya escribe en el cache compartido de `public`** — las
mismas cuatro tablas que usa v2. No es un mundo aparte. Y es el productor con mejor
atribución: es el único que setea `source='client_mcp'` y `sourced_by_workspace`.

### 1.1 Pero en los datos no aparece ninguna fila suya

| Verificación | Resultado |
|---|---|
| `company_news` por `source` | **1.133 de 1.133 son `'parallel'`** (el `DEFAULT` de la columna). Cero `'client_mcp'` |
| `company_news.sourced_by_workspace` | **0 filas** |
| `company_implementations` por `search_context` | **727 de 727 son `'general'`**. Cero `'v3-drilldown'` |
| `v3.client_ai_stage_submissions` por stage | Sólo `account_brief`, `internal_analysis`, `fit_scoring`, `signal_classification` — 8 cada uno, última el 2026-08-05 |

O sea: **el circuito client-assisted se usa para el research de cuenta, pero
`submit_company_news` y `submit_company_success_cases` nunca se ejecutaron en
producción.** No hay evidencia de un bug: hay evidencia de un camino sin uso.

El fix del insert (commit `3235f3a`, 2026-08-03) **sí está en `origin/main`**, así
que la ruta debería funcionar. Vale una prueba end-to-end antes de asumir que anda.

---

## 2. El diagnóstico: tres dialectos del mismo idioma

Las tres tablas ya convergieron ~70% **por su cuenta**, sin contrato. Cada motor le
fue agregando a *su* tabla la columna que necesitaba:

| Campo | `company_news` | `company_implementations` | `radar_findings` |
|---|:---:|:---:|:---:|
| `company_id`, `title`, `summary`, `source_name` | ✅ | ✅ | ✅ |
| URL de la fuente | `source_url` | `source_url` | **`url`** |
| Fecha del hecho | `published_at` | `published_at` | **`source_date`** |
| Clasificación | `category` | **`area`** | `category` |
| `evidence_level` | ❌ | ✅ | ✅ |
| `confidence` | ❌ | ❌ | ✅ |
| `micro_agent` | ❌ | ✅ | ✅ |
| `convergent_sources` | ❌ | ✅ | ✅ |
| Fuentes de apoyo | ❌ | `supporting_source_urls` | `supporting_sources` |
| `ai_provider` | ✅ | ✅ | ❌ |
| `prompt_version` | ❌ | ✅ | ❌ |
| `dedupe_hash` | ❌ (índice parcial por URL) | ❌ | ✅ |
| `requested_by` | ✅ | ✅ | ❌ |
| `sourced_by_workspace` | ✅ | ❌ | ❌ |
| `verified_at` | ✅ | ❌ | ❌ |
| `direction` | ✅ | ❌ | ❌ |

No hay una tabla "mejor": hay tres formatos incompatibles para el mismo hecho.
Escribir una feature que lea las tres hoy significa escribir tres lectores.

### 2.1 El síntoma más caro: v3 parchea en vez de arreglar

De `lib/v3/services/external-drilldown.ts`, comentario textual en el código:

> *"El `.upsert({ onConflict })` que había acá NO funcionaba: `idx_company_news_unique_source`
> es un índice PARCIAL y Postgres solo lo infiere si el ON CONFLICT repite ese predicado…
> Verificado en runtime: NINGUNA noticia del drilldown llegaba a guardarse (0 filas con
> `source='client_mcp'`). **El índice vive en una tabla que v2 usa en producción, así que se
> arregla del lado de v3**: se descartan las conocidas con un SELECT previo."*

Ahí está el problema en una frase: **como no hay contrato, v3 no se anima a tocar el
índice compartido y se escribe un workaround con una race condition conocida.** El
costo fue un período con cero filas persistidas.

Unificar no es prolijidad: es dejar de pagar esto.

---

## 3. La propuesta: contrato en cuatro fases, todas aditivas

> Principio: **nada se renombra, nada se borra, nada se migra de tabla.** Lo que se
> agrega son columnas nullables, una vista y un módulo de escritura.

### Fase A — Núcleo de columnas comunes (`ALTER TABLE ADD COLUMN`)

Se completa en cada tabla lo que le falta del núcleo. Todo nullable, sin `DEFAULT`
que reescriba filas.

```sql
-- supabase/migrations/20260818045619_evidence_contract.sql

-- ── Núcleo de procedencia: quién produjo la fila y para qué workspace ──
alter table public.company_news
  add column if not exists produced_by text,
  add column if not exists evidence_level text,
  add column if not exists confidence numeric(3,2),
  add column if not exists micro_agent text,
  add column if not exists convergent_sources int,
  add column if not exists supporting_sources jsonb,
  add column if not exists prompt_version text,
  add column if not exists dedupe_hash text;

alter table public.company_implementations
  add column if not exists produced_by text,
  add column if not exists confidence numeric(3,2),
  add column if not exists sourced_by_workspace uuid,
  add column if not exists verified_at timestamptz,
  add column if not exists dedupe_hash text;

alter table public.radar_findings
  add column if not exists produced_by text,
  add column if not exists sourced_by_workspace uuid,
  add column if not exists requested_by uuid,
  add column if not exists verified_at timestamptz,
  add column if not exists ai_provider text,
  add column if not exists prompt_version text;

alter table public.job_postings
  add column if not exists produced_by text,
  add column if not exists sourced_by_workspace uuid;
```

**Backfill de `produced_by`** (llena una columna nueva, no pisa nada existente):

```sql
update public.company_news
   set produced_by = case when source = 'client_mcp' then 'mcp_client' else 'v2_research' end
 where produced_by is null;

update public.company_implementations set produced_by = 'v2_research' where produced_by is null;
update public.radar_findings          set produced_by = 'v3_radar'    where produced_by is null;
update public.job_postings            set produced_by = 'etl_apify'   where produced_by is null;
```

> **Por qué `produced_by` y no reusar `company_news.source`:** `source` es `NOT NULL`
> con `DEFAULT 'parallel'` y sólo existe en una de las cuatro tablas. Cambiarle el
> default o los valores sí sería tocar v2 de forma riesgosa. `produced_by` nace
> limpia, con el mismo vocabulario en las cuatro, y `source` queda como legado.

**Vocabulario cerrado de `produced_by`:**
`v2_research` · `v2_manual` · `v3_radar` · `v3_drilldown` · `mcp_client` · `etl_apify` · `cron_refresh`

Se valida en código (fase C), no con un `CHECK`, para que agregar un motor no
requiera migración.

### Fase B — La vista canónica `public.company_evidence`

Es **la respuesta a "dónde leemos"**. No mueve un solo dato:

```sql
create or replace view public.company_evidence as
select
  'news'::text                         as evidence_kind,
  n.id, n.company_id, n.title, n.summary,
  n.source_url, n.source_name,
  n.published_at::timestamptz          as occurred_at,
  n.created_at                         as detected_at,
  n.category, n.evidence_level, n.confidence,
  n.produced_by, n.sourced_by_workspace, n.requested_by, n.verified_at,
  n.micro_agent, n.convergent_sources
from public.company_news n
union all
select
  'implementation', i.id, i.company_id, i.title, i.summary,
  i.source_url, i.source_name,
  i.published_at, i.created_at,
  i.area, i.evidence_level, i.confidence,
  i.produced_by, i.sourced_by_workspace, i.requested_by, i.verified_at,
  i.micro_agent, i.convergent_sources
from public.company_implementations i
union all
select
  'radar', r.id, r.company_id, r.title, r.summary,
  r.url, r.source_name,
  r.source_date::timestamptz, r.detected_at,
  r.category, r.evidence_level, r.confidence,
  r.produced_by, r.sourced_by_workspace, r.requested_by, r.verified_at,
  r.micro_agent, r.convergent_sources
from public.radar_findings r;
```

Acá es donde se resuelven las diferencias de nombre (`url` vs `source_url`,
`source_date` vs `published_at`, `area` vs `category`) **sin renombrar nada** en las
tablas físicas, así que ni v2 ni v3 se enteran.

`job_postings` queda fuera de esta vista: no es evidencia narrativa (no tiene
`summary` ni fuente citada). Sigue consumiéndose aparte.

> **Nota de RLS:** `radar_findings` sólo es legible por `service_role`, así que las
> lecturas de esta vista van por RPC `security definer`, igual que
> `get_account_updates` (ver spec del centro de notificaciones §11.3).

### Fase C — El escritor único: `lib/shared/evidence.ts`

Es lo que **unifica criterios de verdad**. El contrato en SQL sin contrato en código
se degrada en el primer PR apurado.

```ts
// lib/shared/evidence.ts
export type EvidenceKind = "news" | "implementation" | "radar"
export type ProducedBy =
  | "v2_research" | "v2_manual" | "v3_radar"
  | "v3_drilldown" | "mcp_client" | "etl_apify" | "cron_refresh"

export type EvidenceInput = {
  kind: EvidenceKind
  companyId: string
  title: string
  summary?: string | null
  sourceUrl?: string | null
  sourceName?: string | null
  occurredAt?: string | null
  category?: string | null
  evidenceLevel?: "explicit" | "inferred"
  confidence?: number | null
  producedBy: ProducedBy                 // obligatorio
  sourcedByWorkspace?: string | null
  requestedBy?: string | null
  microAgent?: string | null
  convergentSources?: number | null
  supportingSources?: unknown
  promptVersion?: string | null
}

/** Único punto de escritura de evidencia. Resuelve tabla física, calcula
 *  dedupe_hash y garantiza el núcleo del contrato. */
export async function recordEvidence(input: EvidenceInput): Promise<{ id: string; duplicate: boolean }>
```

Todos los productores pasan por acá: `/api/research/news`, `/api/research/implementations`,
`radar.ts`, `external-drilldown.ts` (`persistClientNews` / `persistClientSuccessCases`)
y `app/actions/workspace.ts`.

**Regla de lint que lo sostiene** (la auditoría ya propone `lib/shared/` con lint,
P1.3): prohibir `.from("company_news")`, `.from("company_implementations")` y
`.from("radar_findings")` **fuera de `lib/shared/evidence.ts`**. Sin esa regla, en
tres sprints hay un cuarto dialecto.

**Y de paso se arregla el índice compartido** desde el escritor único: `dedupe_hash`
determinístico en las tres tablas hace innecesario el SELECT-previo-con-race del
drilldown, sin tocar `idx_company_news_unique_source`.

### Fase D — Consolidación física (NO ahora)

Una tabla real `public.company_evidence` con las tres actuales como vistas de
compatibilidad. Es el evidence store de la auditoría. **No lo haría hasta que las
fases A–C estén asentadas**: es la única fase con riesgo real para v2, y las tres
anteriores ya entregan el 90% del beneficio.

---

## 4. Qué cambia para cada uno

| | Cambio | Riesgo |
|---|---|---|
| **v2** | Nada obligatorio. Sus queries siguen funcionando igual. Opcionalmente sus escrituras pasan por `recordEvidence` | **Nulo** — sólo columnas nuevas nullables |
| **v3** | Deja de parchear: escribe por `recordEvidence`, lee por la vista | Bajo |
| **MCP** | `persistClientNews` / `persistClientSuccessCases` pasan a `recordEvidence` y heredan `dedupe_hash` | Bajo — y arregla la race condition documentada |
| **Features nuevas** | Leen una sola cosa: `company_evidence` | — |

---

## 5. Impacto en lo que ya está diseñado

- **Centro de notificaciones** (`feature-centro-de-notificaciones-v2.md` §11.3): la
  RPC `get_account_updates` deja de contar tres tablas por separado y cuenta
  `company_evidence` agrupando por `evidence_kind`. Menos código y un solo índice
  que cuidar. **Se puede construir antes o después de esto**: si la fase 1 sale
  primero, migrar la RPC después es un cambio de una query.
- **Movimientos de contactos** (`feature-movimientos-de-contactos-v2.md`): el
  extractor `people-moves` deja de necesitar un `radar_type` nuevo — entra como
  evidencia con `category = 'executive-change'`, que **ya existe con 14 filas**.
- **Install base competitivo**: pasa a ser una query sobre `company_evidence`
  filtrando por `dictionary_product_ids`, en vez de tres.

---

## 6. Orden y esfuerzo

| Fase | Qué | Esfuerzo | Riesgo v2 |
|---|---|---|---|
| **A** | `20260818045619_evidence_contract.sql` + backfill de `produced_by` | 0,5 día | Nulo |
| **B** | Vista `company_evidence` + RPC de lectura | 1 día | Nulo |
| **C** | `lib/shared/evidence.ts` + migrar los 6 productores + regla de lint | 3–4 días | Bajo |
| **D** | Consolidación física | — | **No hacer todavía** |

**Total A–C: ~5 días.** Se puede hacer en paralelo al centro de notificaciones, o
antes si se prefiere construir la feature ya sobre el contrato definitivo.

---

## 7. No-objetivos y riesgos

- **No se toca `signals`.** 1,69M de filas de ETL, otra naturaleza: no es evidencia
  narrativa sino match de diccionario. Entra por otra puerta si alguna vez entra.
- **No se renombra ninguna columna existente.** El único lugar donde `url` se llama
  `source_url` es la vista.
- **No se agrega `CHECK` sobre `produced_by`.** El vocabulario se valida en TypeScript
  para que sumar un motor no exija migración.
- **Riesgo de la fase C:** migrar seis productores a un escritor único toca código de
  v2 en producción. Mitigación: `recordEvidence` replica exactamente el payload
  actual de cada uno; se migra de a un productor por PR, empezando por el MCP (el que
  menos filas tiene hoy) y dejando `/api/research/news` para el final.
- **Verificación pendiente:** probar end-to-end `prepare_company_news` →
  `submit_company_news` antes de migrarlo, porque hoy no hay una sola fila suya en
  producción y conviene saber si la ruta funciona antes de refactorizarla.
