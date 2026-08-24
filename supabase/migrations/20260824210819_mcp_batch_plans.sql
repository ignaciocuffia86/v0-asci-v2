-- ═══════════════════════════════════════════════════════════
-- Fase 2: preflight de costo POR LOTE.
--
-- POR QUÉ EXISTE
--   Medido en el screening de Power BI sobre 61 cuentas chilenas: no había forma
--   de responder "¿cuánto me cuesta este lote de 42?". La única vía era pedir 42
--   previews individuales, o sea 42 confirmaciones para una sola decisión de
--   presupuesto. El circuito prepare_* → planHash → run_*(userConfirmed) ya
--   resuelve esto bien, pero a nivel de UNA cuenta; esta tabla lo lleva al nivel
--   correcto, que es el lote.
--
--   El resultado es que un lote de 42 cuentas con un costo estimado se autoriza
--   UNA vez, no 42.
--
-- QUÉ CONGELA
--   `plan_payload` guarda los companyIds y los parámetros exactos que se
--   cotizaron. `estimate` guarda el número que se le mostró al usuario. Los dos
--   hacen falta y son cosas distintas: el payload es lo que se va a ejecutar, y
--   el estimate es lo que la persona autorizó. Si después el lote sale más caro,
--   se puede probar contra qué se comparó.
--
--   Igual que `contact_enrichment_runs.plan_hash`, el hash liga la autorización a
--   ESOS parámetros: cambiar las cuentas o los roles invalida el plan en vez de
--   ejecutar algo que nadie aprobó.
--
-- QUÉ NO HACE
--   No reserva cupo ni créditos: estimar es Tier 0 y no tiene por qué costar. La
--   reserva ocurre cuando el lote se ejecuta (Fase 3, create_batch_job).
-- ═══════════════════════════════════════════════════════════

create table if not exists v3.mcp_batch_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references v3.workspaces(id) on delete cascade,
  user_id uuid not null,
  api_key_id uuid,
  oauth_token_id uuid,
  /** sha256 de plan_payload, recortado. Es lo que se confirma. */
  batch_plan_hash text not null,
  /** research | enrichment | research+enrichment */
  operation text not null,
  /** Los parámetros exactos cotizados: lo que se va a ejecutar. */
  plan_payload jsonb not null,
  /** El número que se le mostró al usuario: contra qué comparó al autorizar. */
  estimate jsonb not null,
  /** estimated → consumed (lo tomó un batch job) | expired */
  status text not null default 'estimated',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

-- Único por workspace y no global: dos workspaces pueden cotizar exactamente el
-- mismo lote y son autorizaciones distintas. Además vuelve idempotente reestimar:
-- pedir dos veces la misma cotización devuelve el mismo hash, no dos filas.
create unique index if not exists mcp_batch_plans_workspace_hash_idx
  on v3.mcp_batch_plans (workspace_id, batch_plan_hash);

create index if not exists mcp_batch_plans_workspace_created_idx
  on v3.mcp_batch_plans (workspace_id, created_at desc);

alter table v3.mcp_batch_plans enable row level security;

comment on table v3.mcp_batch_plans is
  'Fase 2: cotización congelada de un lote (estimate_batch). Un batchPlanHash autoriza el lote entero con UNA confirmación, en vez de una por cuenta.';
