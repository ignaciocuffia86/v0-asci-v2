-- ═══════════════════════════════════════════════════════════
-- Fase 3: ejecución de un lote autorizado por UN batchPlanHash.
--
-- QUE RESUELVE
--   `estimate_batch` cotiza el lote y devuelve un hash. Sin esto, ejecutar esas
--   42 cuentas seguía siendo 42 llamadas sueltas, sin estado compartido: si la
--   sesión se cortaba, no había forma de saber qué había quedado hecho.
--
-- QUE **NO** INVENTA
--   La reanudación del research NO se construye acá: `v3.research_jobs` ya tiene
--   lease, heartbeat, attempt_count y estados de reintento, y el cron
--   v3-research-watchdog (cada 5 min) recupera los que quedaron colgados. Este
--   lote se apoya en eso; duplicarlo habría sido una segunda máquina de estados
--   que se desincroniza con la primera.
--
-- POR QUE LOS ENRICHMENTS NO SE PREPARAN AL CREAR EL LOTE
--   Se evaluó dejar un enrichment de Apollo PREPARADO por cuenta al momento de
--   crear el lote. No sirve, y el número lo decide: una preparación vive 30
--   minutos (PREPARE_TTL_MINUTES) y el research de 42 cuentas tarda bastante más.
--   Todas habrían vencido antes de poder usarse, y mientras tanto habrían dejado
--   42 x contactsPerAccount créditos de Apollo RESERVADOS sin gastarse — cupo
--   inmovilizado a cambio de nada.
--
--   Por eso el lote guarda la INTENCION (los cargos y cuántos contactos por
--   cuenta, tal como se cotizaron) y `get_batch_job` avisa qué cuentas ya están
--   listas para preparar. La preparación ocurre cuando se va a usar.
--
--   El gasto en Apollo sigue necesitando su confirmación explícita: es Tier 3 e
--   irreversible. El batchPlanHash autoriza el research y los lugares del plan,
--   no el crédito de un tercero.
-- ═══════════════════════════════════════════════════════════

create table if not exists v3.mcp_batch_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references v3.workspaces(id) on delete cascade,
  user_id uuid not null,
  api_key_id uuid,
  oauth_token_id uuid,
  /** El hash que autorizó este lote. Único por workspace: reejecutar el mismo
      plan devuelve el job existente en vez de volver a ocupar cupo. */
  batch_plan_hash text not null,
  operation text not null,
  /** running | completed | partial | failed */
  status text not null default 'running',
  /** Batch de v3.research_jobs, que es quien lleva el estado real del research. */
  research_batch_id uuid,
  /** Intención de enrichment, congelada del plan cotizado. */
  enrichment_roles jsonb,
  contacts_per_account integer,
  accounts_total integer not null default 0,
  accounts_saved_by_job integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create unique index if not exists mcp_batch_jobs_workspace_plan_idx
  on v3.mcp_batch_jobs (workspace_id, batch_plan_hash);

create index if not exists mcp_batch_jobs_workspace_created_idx
  on v3.mcp_batch_jobs (workspace_id, created_at desc);

alter table v3.mcp_batch_jobs enable row level security;

comment on table v3.mcp_batch_jobs is
  'Fase 3: ejecución de un lote autorizado por un batchPlanHash. El estado del research vive en v3.research_jobs; acá va el envoltorio y la intención de enrichment.';

create table if not exists v3.mcp_batch_job_items (
  id uuid primary key default gen_random_uuid(),
  batch_job_id uuid not null references v3.mcp_batch_jobs(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  company_name text,
  /** true si el lote ocupó un lugar del plan por esta cuenta. Sirve para poder
      revertir con precisión: las que ya estaban guardadas no se tocan. */
  saved_by_job boolean not null default false,
  research_job_id uuid,
  /** not_requested | awaiting_research | ready_to_prepare | prepared | done */
  enrichment_status text not null default 'not_requested',
  enrichment_plan_hash text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mcp_batch_job_items_job_company_idx
  on v3.mcp_batch_job_items (batch_job_id, company_id);

alter table v3.mcp_batch_job_items enable row level security;

comment on table v3.mcp_batch_job_items is
  'Fase 3: una fila por cuenta del lote. saved_by_job marca las que ocuparon cupo por causa del lote, para poder revertir sin tocar las que ya estaban.';
