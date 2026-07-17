-- =============================================================================
-- ASCI v3 — Research en dos fases
-- Snapshot interno + fit preliminar + pipeline durable.
-- Solo cambios aditivos en schema v3. public/v2 permanece read-only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Evolución operativa de research_jobs
-- -----------------------------------------------------------------------------
ALTER TABLE v3.research_jobs
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS preliminary_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_started_at timestamptz;

ALTER TABLE v3.research_jobs DROP CONSTRAINT IF EXISTS research_jobs_phase_check;
ALTER TABLE v3.research_jobs ADD CONSTRAINT research_jobs_phase_check
  CHECK (phase IN ('internal','external','finalizing'));

ALTER TABLE v3.research_jobs DROP CONSTRAINT IF EXISTS research_jobs_status_check;
ALTER TABLE v3.research_jobs ADD CONSTRAINT research_jobs_status_check
  CHECK (status IN (
    'pending','running','preliminary_ready','completed','completed_with_warnings',
    'failed','failed_retriable','failed_terminal','cancelled'
  ));

CREATE INDEX IF NOT EXISTS idx_v3_research_jobs_retry
  ON v3.research_jobs (next_retry_at)
  WHERE status = 'failed_retriable';
CREATE INDEX IF NOT EXISTS idx_v3_research_jobs_expired_lease
  ON v3.research_jobs (lease_expires_at)
  WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS uq_v3_research_jobs_active_account
  ON v3.research_jobs (workspace_id, company_id)
  WHERE company_id IS NOT NULL
    AND force_refresh = false
    AND status IN ('pending','running','preliminary_ready');

-- -----------------------------------------------------------------------------
-- 2. Snapshots internos tenant-specific
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3.account_internal_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  research_job_id uuid REFERENCES v3.research_jobs(id) ON DELETE SET NULL,
  snapshot_version text NOT NULL,
  profile_version text,
  status text NOT NULL CHECK (status IN ('ready','partial','failed')),
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  freshness jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (workspace_id, company_id, snapshot_version, profile_version)
);
CREATE INDEX IF NOT EXISTS idx_v3_internal_snapshots_account
  ON v3.account_internal_snapshots (workspace_id, company_id, generated_at DESC);

-- -----------------------------------------------------------------------------
-- 3. Scorecards versionados por etapa
-- -----------------------------------------------------------------------------
ALTER TABLE v3.account_scorecards
  ALTER COLUMN score DROP NOT NULL,
  ALTER COLUMN fit_score DROP NOT NULL,
  ALTER COLUMN buying_signals_score DROP NOT NULL,
  ALTER COLUMN accessibility_score DROP NOT NULL,
  ALTER COLUMN timing_score DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS score_stage text NOT NULL DEFAULT 'final',
  ADD COLUMN IF NOT EXISTS fit_status text NOT NULL DEFAULT 'evaluated',
  ADD COLUMN IF NOT EXISTS profile_version text,
  ADD COLUMN IF NOT EXISTS snapshot_version text,
  ADD COLUMN IF NOT EXISTS supersedes_scorecard_id uuid REFERENCES v3.account_scorecards(id) ON DELETE SET NULL;

ALTER TABLE v3.account_scorecards DROP CONSTRAINT IF EXISTS account_scorecards_score_stage_check;
ALTER TABLE v3.account_scorecards ADD CONSTRAINT account_scorecards_score_stage_check
  CHECK (score_stage IN ('preliminary','final'));
ALTER TABLE v3.account_scorecards DROP CONSTRAINT IF EXISTS account_scorecards_fit_status_check;
ALTER TABLE v3.account_scorecards ADD CONSTRAINT account_scorecards_fit_status_check
  CHECK (fit_status IN ('evaluated','fit_not_evaluated'));
CREATE INDEX IF NOT EXISTS idx_v3_scorecards_stage
  ON v3.account_scorecards (workspace_id, company_id, score_stage, created_at DESC);

-- -----------------------------------------------------------------------------
-- 4. Account briefs preliminares/finales
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3.account_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  research_job_id uuid REFERENCES v3.research_jobs(id) ON DELETE SET NULL,
  scorecard_id uuid REFERENCES v3.account_scorecards(id) ON DELETE SET NULL,
  stage text NOT NULL CHECK (stage IN ('preliminary','final')),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','partial','failed')),
  headline text NOT NULL,
  why_now text,
  fit_summary text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  freshness jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  profile_version text,
  snapshot_version text,
  input_hash text NOT NULL,
  prompt_version text,
  model text,
  supersedes_brief_id uuid REFERENCES v3.account_briefs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, company_id, stage, input_hash)
);
CREATE INDEX IF NOT EXISTS idx_v3_account_briefs_account
  ON v3.account_briefs (workspace_id, company_id, stage, created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Stage runs idempotentes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3.research_stage_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_job_id uuid NOT NULL REFERENCES v3.research_jobs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN (
    'resolve_company','internal_snapshot','preliminary_fit','external_collect',
    'external_classify','jobs_interpret','contacts','final_score','final_brief'
  )),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','skipped','cancelled')),
  attempt integer NOT NULL DEFAULT 1,
  input_hash text NOT NULL,
  output_reference jsonb,
  error_code text,
  error_message text,
  heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (research_job_id, stage, input_hash)
);
CREATE INDEX IF NOT EXISTS idx_v3_stage_runs_job
  ON v3.research_stage_runs (research_job_id, created_at);

-- -----------------------------------------------------------------------------
-- 6. Memoria compacta de conversación
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3.conversation_memory (
  conversation_id uuid PRIMARY KEY REFERENCES v3.chat_conversations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES v3.workspaces(id) ON DELETE CASCADE,
  summary text NOT NULL DEFAULT '',
  active_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  compacted_through timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 7. RLS
-- -----------------------------------------------------------------------------
ALTER TABLE v3.account_internal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.account_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.research_stage_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE v3.conversation_memory ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_internal_snapshots','account_briefs','research_stage_runs','conversation_memory']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='v3' AND tablename=t AND policyname=('Service role full access ' || t)
    ) THEN
      EXECUTE format('CREATE POLICY %I ON v3.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        'Service role full access ' || t, t);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname='v3' AND tablename=t AND policyname=('Workspace access ' || t)
    ) THEN
      EXECUTE format('CREATE POLICY %I ON v3.%I FOR ALL TO authenticated USING (workspace_id = v3.user_workspace_id(auth.uid())) WITH CHECK (workspace_id = v3.user_workspace_id(auth.uid()))',
        'Workspace access ' || t, t);
    END IF;
  END LOOP;
END $$;
