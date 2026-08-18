-- =============================================================================
-- Contrato de evidencia compartido entre v2, v3 y el MCP — Fases A y B
--
-- Problema que resuelve: company_news, company_implementations y radar_findings
-- guardan el mismo tipo de hecho ("algo pasó en esta empresa") en tres formatos
-- incompatibles, porque cada motor le fue agregando a SU tabla la columna que
-- necesitaba. Hoy escribir una feature que lea las tres significa escribir tres
-- lectores, y v3 termina parcheando alrededor de los índices de v2 en vez de
-- arreglar el contrato (ver el comentario de persistClientNews en
-- lib/v3/services/external-drilldown.ts).
--
-- Regla de oro del proyecto: v2 está en producción y no se puede romper. Esta
-- migración es ESTRICTAMENTE ADITIVA:
--   - NO renombra ninguna columna existente
--   - NO borra ni migra datos entre tablas
--   - NO cambia defaults, constraints ni tipos de columnas existentes
--   - Sólo agrega columnas nullables, una vista e índices
-- Las queries actuales de v2 y v3 siguen funcionando exactamente igual.
--
-- Referencia: docs/plan-unificacion-evidencia-v2-v3.md
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- FASE A.1 — Núcleo de columnas comunes
--
-- `produced_by` es la columna clave del modelo colaborativo: dice QUÉ MOTOR
-- produjo la fila, con el mismo vocabulario en las cuatro tablas. No se reusa
-- `company_news.source` porque es NOT NULL con DEFAULT 'parallel' y sólo existe
-- en esa tabla: cambiarle valores o default sí sería tocar v2 con riesgo.
-- `source` queda como legado.
--
-- Vocabulario (validado en TypeScript, no con CHECK, para que sumar un motor no
-- exija migración):
--   v2_research · v2_manual · v3_radar · v3_drilldown · mcp_client
--   etl_apify   · cron_refresh
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.company_news
  add column if not exists produced_by        text,
  add column if not exists evidence_level     text,
  add column if not exists confidence         numeric(3,2),
  add column if not exists micro_agent        text,
  add column if not exists convergent_sources integer,
  add column if not exists supporting_sources jsonb,
  add column if not exists prompt_version     text,
  add column if not exists dedupe_hash        text;

alter table public.company_implementations
  add column if not exists produced_by          text,
  add column if not exists confidence           numeric(3,2),
  add column if not exists sourced_by_workspace uuid,
  add column if not exists verified_at          timestamptz,
  add column if not exists dedupe_hash          text;

alter table public.radar_findings
  add column if not exists produced_by          text,
  add column if not exists sourced_by_workspace uuid,
  add column if not exists requested_by         uuid,
  add column if not exists verified_at          timestamptz,
  add column if not exists ai_provider          text,
  add column if not exists prompt_version       text;

alter table public.job_postings
  add column if not exists produced_by          text,
  add column if not exists sourced_by_workspace uuid;

comment on column public.company_news.produced_by is
  'Motor que produjo la fila. Vocabulario compartido con company_implementations, radar_findings y job_postings. Ver lib/shared/evidence.ts';


-- ─────────────────────────────────────────────────────────────────────────────
-- FASE A.2 — Backfill de produced_by
--
-- Llena una columna NUEVA, no pisa nada. Idempotente por el `where ... is null`.
-- Los valores salen de lo que ya se sabe de cada tabla:
--   - company_news.source = 'client_mcp' → lo escribió el MCP
--   - el resto de company_news e implementations → research de v2
--   - radar_findings → sólo lo escribe v3 (radar.ts, jobs-interpreter.ts)
--   - job_postings → ETL de Apify
-- ─────────────────────────────────────────────────────────────────────────────

update public.company_news
   set produced_by = case when source = 'client_mcp' then 'mcp_client' else 'v2_research' end
 where produced_by is null;

update public.company_implementations
   set produced_by = 'v2_research'
 where produced_by is null;

update public.radar_findings
   set produced_by = 'v3_radar'
 where produced_by is null;

update public.job_postings
   set produced_by = 'etl_apify'
 where produced_by is null;


-- ─────────────────────────────────────────────────────────────────────────────
-- FASE A.3 — Índices
--
-- Las tres tablas de evidencia son chicas (1.133 / 727 / 706 filas al
-- 2026-08-17) y job_postings tiene 41k, así que un CREATE INDEX normal toma
-- milisegundos y no justifica CONCURRENTLY (que además no corre dentro de una
-- transacción). radar_findings ya tiene (company_id, detected_at desc) del
-- script 400.
--
-- El índice UNIQUE de dedupe es PARCIAL sobre `dedupe_hash is not null`: da
-- deduplicación a las filas nuevas sin exigirle nada a las viejas, que lo tienen
-- en null. No colisiona con idx_company_news_unique_source, que sigue vigente.
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists idx_company_news_company_created
  on public.company_news (company_id, created_at desc);

create index if not exists idx_company_impl_company_created
  on public.company_implementations (company_id, created_at desc);

create index if not exists idx_job_postings_company_created
  on public.job_postings (company_id, created_at desc);

create unique index if not exists idx_company_news_dedupe
  on public.company_news (dedupe_hash)
  where dedupe_hash is not null;

create unique index if not exists idx_company_impl_dedupe
  on public.company_implementations (dedupe_hash)
  where dedupe_hash is not null;


-- ─────────────────────────────────────────────────────────────────────────────
-- FASE B — Vista canónica public.company_evidence
--
-- Es el único lugar donde se resuelven las diferencias de nombre entre las tres
-- tablas (url/source_url, source_date/published_at, area/category). Las tablas
-- físicas no se tocan, así que ni v2 ni v3 se enteran.
--
-- security_invoker = true: la vista respeta la RLS del que consulta. Importa
-- porque radar_findings sólo es legible por service_role — sin esto, cualquier
-- usuario autenticado vería todo el radar consultando la vista directo. El
-- camino sancionado de lectura son las RPC `security definer` (ver
-- get_account_updates en docs/feature-centro-de-notificaciones-v2.md §6.3).
--
-- job_postings NO entra: no es evidencia narrativa (no tiene summary ni fuente
-- citada). Se consume aparte.
-- ─────────────────────────────────────────────────────────────────────────────

drop view if exists public.company_evidence;

create view public.company_evidence
with (security_invoker = true)
as
select
  'news'::text                as evidence_kind,
  n.id,
  n.company_id,
  n.title,
  n.summary,
  n.source_url,
  n.source_name,
  n.published_at              as occurred_at,
  n.created_at                as detected_at,
  n.category,
  n.evidence_level,
  n.confidence,
  n.produced_by,
  n.sourced_by_workspace,
  n.requested_by,
  n.verified_at,
  n.micro_agent,
  n.convergent_sources,
  n.supporting_sources,
  n.prompt_version
from public.company_news n

union all

select
  'implementation'::text,
  i.id,
  i.company_id,
  i.title,
  i.summary,
  i.source_url,
  i.source_name,
  i.published_at,
  i.created_at,
  i.area                      as category,
  i.evidence_level,
  i.confidence,
  i.produced_by,
  i.sourced_by_workspace,
  i.requested_by,
  i.verified_at,
  i.micro_agent,
  i.convergent_sources,
  i.supporting_source_urls    as supporting_sources,
  i.prompt_version
from public.company_implementations i

union all

select
  'radar'::text,
  r.id,
  r.company_id,
  r.title,
  r.summary,
  r.url                       as source_url,
  r.source_name,
  r.source_date::timestamptz  as occurred_at,
  r.detected_at,
  r.category,
  r.evidence_level,
  r.confidence,
  r.produced_by,
  r.sourced_by_workspace,
  r.requested_by,
  r.verified_at,
  r.micro_agent,
  r.convergent_sources,
  r.supporting_sources,
  r.prompt_version
from public.radar_findings r;

comment on view public.company_evidence is
  'Vista canónica de evidencia por compañía: unifica company_news, company_implementations y radar_findings bajo un mismo esquema sin mover datos. Escritura: lib/shared/evidence.ts. Ver docs/plan-unificacion-evidencia-v2-v3.md';

grant select on public.company_evidence to authenticated;
grant select on public.company_evidence to service_role;
