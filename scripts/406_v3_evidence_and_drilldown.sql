-- ═══════════════════════════════════════════════════════════
-- Fase 1/2/3: nivel de evidencia canónico, drilldown a pedido,
-- procedencia de noticias y pools de cuota nuevos.
--
-- Todos los cambios son ADITIVOS. v2 está en producción con usuarios reales:
-- ninguna columna existente se renombra ni se reescribe, y v2 sigue leyendo
-- exactamente lo que leía antes.
-- ═══════════════════════════════════════════════════════════

begin;

-- ── 1. Nivel de evidencia ternario ────────────────────────
-- radar_findings vive en `public` (no en v3) y su CHECK era binario:
--   CHECK (evidence_level IN ('explicit','inferred'))
-- Se amplía para admitir el enum canónico SIN backfill: las filas históricas
-- conservan 'explicit'/'inferred' y se traducen en lectura con toEvidenceLevel().
alter table public.radar_findings
  drop constraint if exists radar_findings_evidence_level_check;

alter table public.radar_findings
  add constraint radar_findings_evidence_level_check
  check (evidence_level in ('explicit','inferred','Confirmado','Probable','Inferido'));

-- ── 2. Procedencia de noticias ────────────────────────────
-- company_news es un caché COMPARTIDO con v2 ("all news for this company").
-- Sin procedencia era imposible distinguir una nota verificada por Parallel de
-- una que trajo el modelo de un cliente MCP, ni revertirla.
alter table public.company_news
  add column if not exists source text not null default 'parallel',
  add column if not exists sourced_by_workspace uuid,
  add column if not exists verified_at timestamptz,
  -- Dirección del hecho, ORTOGONAL a `category` (que se conserva intacta).
  -- Permite que el timing reste ante contracción en vez de premiar actividad negativa.
  add column if not exists direction text;

alter table public.company_news
  drop constraint if exists company_news_source_check;
alter table public.company_news
  add constraint company_news_source_check
  check (source in ('parallel','client_mcp','tech_radar'));

alter table public.company_news
  drop constraint if exists company_news_direction_check;
alter table public.company_news
  add constraint company_news_direction_check
  check (direction is null or direction in ('expansion','contraccion','neutro'));

create index if not exists idx_company_news_company_direction
  on public.company_news(company_id, direction, published_at desc);

-- ── 3. Pools de cuota nuevos ──────────────────────────────
-- El CHECK actual admite research_server, icebreaker_server, research_client,
-- icebreaker_client y apollo_enrichment. Sin ampliarlo, reservar cuota para las
-- features nuevas fallaría con violación de constraint.
alter table v3.mcp_usage_reservations
  drop constraint if exists mcp_usage_reservations_pool_check;

alter table v3.mcp_usage_reservations
  add constraint mcp_usage_reservations_pool_check
  check (pool in (
    'research_server','icebreaker_server','research_client','icebreaker_client',
    'apollo_enrichment','success_cases_client','news_client','apify_jobs'
  ));

-- ── 4. Features nuevas de ejecución client-assisted ───────
alter table v3.client_ai_executions
  drop constraint if exists client_ai_executions_feature_check;

alter table v3.client_ai_executions
  add constraint client_ai_executions_feature_check
  check (feature in ('account_research','icebreaker','success_cases','company_news'));

-- ── 5. Drilldown: snapshot completo separado del panorama ──
-- El panorama liviano viaja al cliente; la evidencia detallada queda acá y se
-- consulta por término a pedido, sin re-investigar ni gastar cuota.
create table if not exists v3.account_evidence_details (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  company_id uuid not null,
  execution_id uuid references v3.client_ai_executions(id) on delete cascade,
  -- term_id es el id del diccionario (producto o proceso)
  term_id uuid not null,
  term_kind text not null check (term_kind in ('product','process')),
  term_name text not null,
  evidence_level text not null check (evidence_level in ('Confirmado','Probable','Inferido')),
  mention_count integer not null default 0,
  latest_at timestamptz,
  -- Detalle completo: snippets + attribution (incluye linkedin_url del contacto)
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, company_id, term_id, execution_id)
);

create index if not exists idx_account_evidence_details_lookup
  on v3.account_evidence_details(workspace_id, company_id, term_id);
create index if not exists idx_account_evidence_details_execution
  on v3.account_evidence_details(execution_id);

alter table v3.account_evidence_details enable row level security;

-- ── 6. TTL configurable por lote ──────────────────────────
-- El TTL era fijo (60 min). Con lotes procesados en serie, las últimas cuentas
-- expiraban antes de llegar a ejecutarse.
alter table v3.client_ai_executions
  add column if not exists batch_size integer not null default 1,
  add column if not exists refreshed_count integer not null default 0;

commit;
